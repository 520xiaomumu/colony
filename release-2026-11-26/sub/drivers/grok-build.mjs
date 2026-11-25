import { clearCreds, loginManager, readCreds, withLock, writeCreds } from '../lib/store.mjs';
import { HttpError, corsHeaders } from '../lib/openai.mjs';
import { decodeJwtClaims, handleResponsesChat } from '../lib/responses.mjs';

const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
const XAI_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const XAI_API_BASE = 'https://cli-chat-proxy.grok.com/v1';
const XAI_NPM_LATEST_URL = 'https://registry.npmjs.org/@xai-official/grok/latest';
const XAI_FALLBACK_CLIENT_VERSION = '1.0.46';
const REFRESH_LEAD_MS = 5 * 60 * 1000;

let cachedClientVersion = XAI_FALLBACK_CLIENT_VERSION;
let versionFetchedAt = 0;
let discoveryCache = null;

async function getClientVersion() {
  if (Date.now() - versionFetchedAt < 3 * 60 * 60 * 1000) return cachedClientVersion;
  versionFetchedAt = Date.now();
  try {
    const r = await fetch(XAI_NPM_LATEST_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const j = await r.json();
      if (typeof j?.version === 'string' && /^\d+\.\d+\.\d+$/.test(j.version.trim())) {
        cachedClientVersion = j.version.trim();
      }
    }
  } catch {}
  return cachedClientVersion;
}

async function discoverOAuth(signal) {
  if (discoveryCache && Date.now() - discoveryCache.at < 30 * 60 * 1000) return discoveryCache;
  const r = await fetch(XAI_DISCOVERY_URL, { headers: { Accept: 'application/json' }, signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.device_authorization_endpoint || !j.token_endpoint) {
    throw new Error(`xAI OIDC discovery 失败 (HTTP ${r.status})`);
  }
  discoveryCache = {
    deviceEndpoint: j.device_authorization_endpoint,
    tokenEndpoint: j.token_endpoint,
    at: Date.now(),
  };
  return discoveryCache;
}

const XAI_MODELS = [
  { id: 'grok-4.7', displayName: 'Grok 4.7', owned_by: 'xai' },
  { id: 'grok-4.7-build-fast', displayName: 'Grok 4.7 Fast', owned_by: 'xai' },
  { id: 'grok-4.6', displayName: 'Grok 4.6', owned_by: 'xai' },
  { id: 'grok-build-0.1', displayName: 'Grok Build 0.1', owned_by: 'xai' },
  { id: 'grok-4.5', displayName: 'Grok 4.5', owned_by: 'xai' },
  { id: 'grok-4.3', displayName: 'Grok 4.3', owned_by: 'xai' },
  { id: 'grok-4.20-0309-reasoning', displayName: 'Grok 4.20 0309 Reasoning', owned_by: 'xai' },
  { id: 'grok-4.20-0309-non-reasoning', displayName: 'Grok 4.20 0309 Non Reasoning', owned_by: 'xai' },
  { id: 'grok-4.20-multi-agent-0309', displayName: 'Grok 4.20 Multi Agent 0309', owned_by: 'xai' },
  { id: 'grok-3-mini', displayName: 'Grok 3 Mini', owned_by: 'xai' },
  { id: 'grok-3-mini-fast', displayName: 'Grok 3 Mini Fast', owned_by: 'xai' },
  { id: 'grok-composer-2.5-fast', displayName: 'Composer 2.5 Fast', owned_by: 'xai' },
  { id: 'grok-imagine-image', displayName: 'Grok Imagine Image', owned_by: 'xai' },
  { id: 'grok-imagine-image-2.0', displayName: 'Grok Imagine Image 2.0', owned_by: 'xai' },
  { id: 'grok-imagine-image-quality', displayName: 'Grok Imagine Image Quality', owned_by: 'xai' },
  { id: 'grok-imagine-video', displayName: 'Grok Imagine Video', owned_by: 'xai' },
  { id: 'grok-imagine-video-1.5', displayName: 'Grok Imagine Video 1.5', owned_by: 'xai' },
  { id: 'grok-imagine-video-1.5-lite', displayName: 'Grok Imagine Video 1.5 Lite', owned_by: 'xai' },
];

function extractAccount(tokenResp) {
  const claims = decodeJwtClaims(tokenResp?.id_token) || decodeJwtClaims(tokenResp?.access_token);
  if (!claims) return 'xAI 账号';
  return claims.email || claims.preferred_username || claims.name || claims.sub || 'xAI 账号';
}

function xaiHeaders(token, clientVer, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': `xai-grok-workspace/${clientVer}`,
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-client-version': clientVer,
    'x-grok-client-identifier': 'grok-shell',
    'x-authenticateresponse': 'authenticate-response',
    ...extra,
  };
}

function getCreds() {
  const c = readCreds('grok-build');
  if (!c || !c.accessToken) return null;
  return c;
}

async function refreshAccessToken(creds) {
  return withLock('grok-build-refresh', async () => {
    const latest = readCreds('grok-build') || creds;
    if (latest?.accessToken && latest.expiresAt && Date.now() < latest.expiresAt - REFRESH_LEAD_MS) {
      return latest;
    }
    if (!latest?.refreshToken) {
      throw new HttpError(401, 'Grok Build 登录已过期，请重新登录', 'authentication_error');
    }
    const tokenEndpoint = latest.tokenEndpoint || (await discoverOAuth()).tokenEndpoint;
    const form = new URLSearchParams({
      client_id: XAI_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: latest.refreshToken,
    });
    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${resp.status}`;
      throw new HttpError(401, `Grok Build 刷新 Token 失败: ${desc}`, 'authentication_error');
    }
    const updated = {
      ...latest,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      idToken: data.id_token || latest.idToken || '',
      tokenEndpoint,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: extractAccount(data) || latest.email,
    };
    writeCreds('grok-build', updated);
    return updated;
  });
}

async function ensureToken() {
  const c = getCreds();
  if (!c) throw new HttpError(401, 'Grok Build 尚未登录，请先在订阅中心扫码/设备码登录', 'authentication_error');
  if (c.expiresAt && Date.now() >= c.expiresAt - REFRESH_LEAD_MS && c.refreshToken) {
    const refreshed = await refreshAccessToken(c);
    return refreshed.accessToken;
  }
  return c.accessToken;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已取消登录'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('已取消登录'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchXai(urlPath, { method = 'POST', body = null, accept = 'application/json', signal } = {}) {
  const clientVer = await getClientVersion();
  const runOnce = async (token) => {
    const headers = xaiHeaders(token, clientVer, { Accept: accept });
    const init = { method, headers, signal };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return fetch(`${XAI_API_BASE}${urlPath}`, init);
  };

  let token = await ensureToken();
  let resp = await runOnce(token);
  if (resp.status === 401) {
    const c = getCreds();
    if (c?.refreshToken) {
      const refreshed = await refreshAccessToken(c);
      resp = await runOnce(refreshed.accessToken);
    }
  }
  return resp;
}

export default {
  id: 'grok-build',
  name: 'Grok Build',
  providerName: '订阅 · Grok Build',
  desc: 'xAI Grok Build 订阅模型（官方设备码 OAuth，支持 Grok 4.7、思考、工具调用、生图与生视频）',
  authModes: ['device'],
  capabilities: ['chat', 'image', 'video'],

  async status() {
    const c = getCreds();
    const login = loginManager.get('grok-build');
    return {
      loggedIn: !!c,
      account: c?.email || null,
      expiresAt: c?.expiresAt || null,
      authMode: c ? 'device' : null,
      modelCount: c ? XAI_MODELS.length : null,
      login,
    };
  },

  async startLogin() {
    const session = loginManager.begin('grok-build', 'device', '正在向 xAI 申请设备授权码…');
    try {
      const disc = await discoverOAuth(session.signal);
      const form = new URLSearchParams({
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
      });
      const resp = await fetch(disc.deviceEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
        signal: session.signal,
      });
      const dc = await resp.json().catch(() => ({}));
      if (!resp.ok || !dc.device_code || !dc.user_code) {
        throw new Error(dc.error_description || dc.error || `申请设备码失败 (HTTP ${resp.status})`);
      }

      const verifyUrl = dc.verification_uri_complete || dc.verification_uri || 'https://auth.x.ai/device';
      let intervalSec = Math.max(5, Number(dc.interval) || 5);
      const deadline = Date.now() + (Number(dc.expires_in) || 600) * 1000;

      session.update({
        url: verifyUrl,
        userCode: dc.user_code,
        message: '请在浏览器打开链接确认授权（如页面要求输入验证码，请填下方设备码）…',
      });

      (async () => {
        try {
          while (Date.now() < deadline) {
            await sleep(intervalSec * 1000, session.signal);
            const pollForm = new URLSearchParams({
              client_id: XAI_OAUTH_CLIENT_ID,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              device_code: dc.device_code,
            });
            const pr = await fetch(disc.tokenEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: pollForm.toString(),
              signal: session.signal,
            });
            const tok = await pr.json().catch(() => ({}));
            if (pr.ok && tok.access_token) {
              const email = extractAccount(tok);
              writeCreds('grok-build', {
                accessToken: tok.access_token,
                refreshToken: tok.refresh_token || '',
                idToken: tok.id_token || '',
                tokenEndpoint: disc.tokenEndpoint,
                expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
                email,
              });
              session.succeed(`已登录：${email}`);
              return;
            }
            const errCode = tok.error || '';
            if (errCode === 'authorization_pending') continue;
            if (errCode === 'slow_down') {
              intervalSec += 5;
              continue;
            }
            if (errCode === 'expired_token') throw new Error('设备码已过期，请重新点击登录');
            if (errCode === 'access_denied') throw new Error('授权已被拒绝');
            throw new Error(tok.error_description || errCode || `轮询失败 (HTTP ${pr.status})`);
          }
          throw new Error('设备码已过期，请重新点击登录');
        } catch (err) {
          if (session.signal.aborted) loginManager.clear('grok-build');
          else session.fail(err);
        }
      })();

      return {
        status: 'pending',
        mode: 'device',
        url: verifyUrl,
        userCode: dc.user_code,
        message: '请在浏览器中确认 xAI 授权',
      };
    } catch (err) {
      session.fail(err);
      throw new HttpError(502, err instanceof Error ? err.message : String(err), 'api_error');
    }
  },

  async cancelLogin() {
    loginManager.cancel('grok-build');
    return { ok: true };
  },

  async logout() {
    loginManager.clear('grok-build');
    clearCreds('grok-build');
    return { ok: true };
  },

  async listModels() {
    await ensureToken();
    return XAI_MODELS;
  },

  async chat(_ctx, body, req, res) {
    return handleResponsesChat({
      body,
      req,
      res,
      defaultModel: 'grok-4.7',
      providerLabel: 'xAI',
      fetchResponses: (payload, signal) => fetchXai('/responses', {
        method: 'POST',
        body: payload,
        accept: 'text/event-stream',
        signal,
      }),
    });
  },

  // Pass through xAI native media & responses endpoints (/images/generations, /images/edits, /videos/*, /responses)
  async handleExtra(_ctx, tail, req, res) {
    const allowed = [
      '/responses',
      '/images/generations',
      '/images/edits',
      '/videos/generations',
      '/videos/edits',
      '/videos/extensions',
    ];
    const isVideoPoll = req.method === 'GET' && /^\/videos\/[^/]+$/.test(tail);
    if (!isVideoPoll && !allowed.includes(tail)) {
      throw new HttpError(404, `Grok Build 不支持路径 ${tail}`, 'invalid_request_error');
    }

    const chunks = [];
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      for await (const c of req) chunks.push(c);
    }
    const rawBody = chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
    const upstream = await fetchXai(tail, {
      method: req.method,
      body: rawBody,
      accept: req.headers.accept || 'application/json',
    });

    const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    res.writeHead(upstream.status, corsHeaders({ 'Content-Type': ct }));
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (!res.writableEnded) res.write(chunk);
      }
    }
    if (!res.writableEnded) res.end();
  },
};

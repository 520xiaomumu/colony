import { loginManager } from '../lib/store.mjs';
import { HttpError, corsHeaders, normalizeModels } from '../lib/openai.mjs';
import { cachedListModels, invalidateModelCache } from '../lib/models.mjs';
import { abortableSleep, createOAuthRuntime, postOAuthToken } from '../lib/oauth-driver.mjs';
import { decodeJwtClaims, handleResponsesChat } from '../lib/responses.mjs';
import { GROK_SPEC } from '../lib/sub-specs.mjs';

const XAI_DISCOVERY_URL = GROK_SPEC.discoveryUrl;
const XAI_OAUTH_CLIENT_ID = GROK_SPEC.clientId;
const XAI_OAUTH_SCOPE = GROK_SPEC.scope;
const XAI_API_BASE = GROK_SPEC.apiBase;
const XAI_NPM_LATEST_URL = GROK_SPEC.npmLatestUrl;
const XAI_FALLBACK_CLIENT_VERSION = GROK_SPEC.fallbackClientVersion;
const REFRESH_LEAD_MS = 5 * 60 * 1000;

let cachedClientVersion = XAI_FALLBACK_CLIENT_VERSION;
let versionFetchedAt = 0;
let discoveryCache = null;

function getClientVersion() {
  if (Date.now() - versionFetchedAt > 3 * 60 * 60 * 1000) {
    versionFetchedAt = Date.now();
    fetch(XAI_NPM_LATEST_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (typeof j?.version === 'string' && /^\d+\.\d+\.\d+$/.test(j.version.trim())) {
          cachedClientVersion = j.version.trim();
        }
      })
      .catch(() => {});
  }
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

const XAI_MEDIA_MODELS = GROK_SPEC.mediaModels;
const XAI_FALLBACK_MODELS = GROK_SPEC.fallbackModels;

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

const oauth = createOAuthRuntime({
  id: 'grok-build',
  label: 'Grok Build',
  notLoggedInMessage: 'Grok Build 尚未登录，请先在订阅中心扫码/设备码登录',
  expiredMessage: 'Grok Build 登录已过期，请重新登录',
  refreshLeadMs: REFRESH_LEAD_MS,
  credKeyOf: (c) => (c ? (c.email || c.refreshToken || c.accessToken || 'grok') : ''),
  async doRefresh(latest) {
    const tokenEndpoint = latest.tokenEndpoint || (await discoverOAuth()).tokenEndpoint;
    const { ok, status, data } = await postOAuthToken(tokenEndpoint, {
      client_id: XAI_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: latest.refreshToken,
    });
    if (!ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${status}`;
      throw new HttpError(401, `Grok Build 刷新 Token 失败: ${desc}`, 'authentication_error');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      idToken: data.id_token || latest.idToken || '',
      tokenEndpoint,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: extractAccount(data) || latest.email,
    };
  },
});

async function fetchXai(urlPath, { method = 'POST', body = null, accept = 'application/json', signal } = {}) {
  const clientVer = getClientVersion();
  const { resp } = await oauth.fetchWithAuth((creds) => {
    const headers = xaiHeaders(creds.accessToken, clientVer, { Accept: accept });
    const init = { method, headers, signal };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return fetch(`${XAI_API_BASE}${urlPath}`, init);
  }, signal);
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
    return oauth.buildStatus({
      authModeOf: () => 'device',
      fallbackModelCount: XAI_FALLBACK_MODELS.length,
    });
  },

  async startLogin() {
    const session = loginManager.begin('grok-build', 'device', '正在向 xAI 申请设备授权码…');
    try {
      const disc = await discoverOAuth(session.signal);
      const { ok, status, data: dc } = await postOAuthToken(disc.deviceEndpoint, {
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
      }, { signal: session.signal });
      if (!ok || !dc.device_code || !dc.user_code) {
        throw new Error(dc.error_description || dc.error || `申请设备码失败 (HTTP ${status})`);
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
            await abortableSleep(intervalSec * 1000, session.signal);
            const { ok: pok, status: pstatus, data: tok } = await postOAuthToken(disc.tokenEndpoint, {
              client_id: XAI_OAUTH_CLIENT_ID,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              device_code: dc.device_code,
            }, { signal: session.signal });
            if (pok && tok.access_token) {
              const email = extractAccount(tok);
              invalidateModelCache('grok-build');
              session.commitCreds({
                accessToken: tok.access_token,
                refreshToken: tok.refresh_token || '',
                idToken: tok.id_token || '',
                tokenEndpoint: disc.tokenEndpoint,
                expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
                email,
              }, `已登录：${email}`);
              return;
            }
            const errCode = tok.error || '';
            if (errCode === 'authorization_pending') continue;
            if (errCode === 'slow_down') { intervalSec += 5; continue; }
            if (errCode === 'expired_token') throw new Error('设备码已过期，请重新点击登录');
            if (errCode === 'access_denied') throw new Error('授权已被拒绝');
            throw new Error(tok.error_description || errCode || `轮询失败 (HTTP ${pstatus})`);
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

  cancelLogin: () => oauth.cancelLogin(),
  logout: () => oauth.logout(),

  async listModels(_ctx, { force = false } = {}) {
    const c = await oauth.ensureCreds();
    return cachedListModels('grok-build', oauth.credKeyOf(c), async () => {
      const resp = await fetchXai('/models', {
        method: 'GET',
        accept: 'application/json',
        signal: AbortSignal.timeout(12000),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.error?.message || data?.message || `获取 xAI 模型列表失败 (HTTP ${resp.status})`;
        throw new HttpError(resp.status, msg, resp.status === 401 ? 'authentication_error' : 'api_error');
      }
      const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
      const chatModels = raw
        .filter((m) => m && m.visibility !== 'hide')
        .map((m) => ({
          id: m.id || m.slug || m.name,
          displayName: m.name || m.displayName || m.id,
          description: m.description || '',
          owned_by: 'xai',
          capabilities: ['chat'],
        }))
        .filter((m) => m.id);
      if (!chatModels.length) return [];
      return normalizeModels([...chatModels, ...XAI_MEDIA_MODELS], { ownedBy: 'xai', fallback: XAI_FALLBACK_MODELS });
    }, { force, fallback: XAI_FALLBACK_MODELS });
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

import crypto from 'node:crypto';
import { loginManager } from '../lib/store.mjs';
import { HttpError } from '../lib/openai.mjs';
import { listenOAuthCallback } from '../lib/oauth-callback.mjs';
import { cachedListModels, invalidateModelCache } from '../lib/models.mjs';
import { createOAuthRuntime, postOAuthToken } from '../lib/oauth-driver.mjs';
import { handleCloudCodeChat } from '../lib/cloudcode.mjs';
import { ANTIGRAVITY_SPEC } from '../lib/sub-specs.mjs';

const REFRESH_LEAD_MS = 5 * 60 * 1000;
const NODE_API_CLIENT_UA = 'google-api-nodejs-client/10.3.0';
const GOOG_API_CLIENT_UA = 'gl-node/22.21.1';

let cachedVersion = ANTIGRAVITY_SPEC.fallbackVersion;
let versionFetchedAt = 0;

function resolveVersionAndCL(ver) {
  const map = ANTIGRAVITY_SPEC.hubChangelists;
  if (map[ver]) return { version: ver, cl: map[ver] };
  return { version: ANTIGRAVITY_SPEC.fallbackVersion, cl: map[ANTIGRAVITY_SPEC.fallbackVersion] };
}

function getHubUserAgent() {
  if (Date.now() - versionFetchedAt > 6 * 60 * 60 * 1000) {
    versionFetchedAt = Date.now();
    fetch(ANTIGRAVITY_SPEC.hubManifestUrl, {
      headers: { 'User-Agent': 'electron-builder', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000),
    }).then((r) => (r.ok ? r.text() : '')).then((txt) => {
      const m = txt.match(/^\s*version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m);
      if (m && ANTIGRAVITY_SPEC.hubChangelists[m[1]]) cachedVersion = m[1];
    }).catch(() => {});
  }
  const { version, cl } = resolveVersionAndCL(cachedVersion);
  return {
    version,
    shortUA: `antigravity/hub/${version} (aidev_client; os_type=darwin; arch=arm64; cl=${cl})`,
    longUA: `antigravity/hub/${version} (aidev_client; os_type=darwin; arch=arm64; cl=${cl}) ${NODE_API_CLIENT_UA}`,
  };
}

function credKeyOf(c) {
  return c ? (c.projectId || c.email || c.refreshToken || c.accessToken || 'antigravity') : '';
}

function extractProjectId(data) {
  if (!data || typeof data !== 'object') return '';
  for (const key of ['cloudaicompanionProject', 'projectId', 'project']) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof v.id === 'string' && v.id.trim()) return v.id.trim();
  }
  return '';
}

function pickDefaultTierId(loadResp) {
  if (Array.isArray(loadResp?.allowedTiers)) {
    for (const t of loadResp.allowedTiers) {
      if (t?.isDefault && typeof t.id === 'string' && t.id.trim()) return t.id.trim();
    }
  }
  if (typeof loadResp?.currentTier?.id === 'string' && loadResp.currentTier.id.trim()) {
    return loadResp.currentTier.id.trim();
  }
  return 'free-tier';
}

async function fetchUserEmail(accessToken, shortUA, signal) {
  const r = await fetch(ANTIGRAVITY_SPEC.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': shortUA },
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.email) {
    throw new Error(`获取 Google 账号邮箱失败 (HTTP ${r.status})`);
  }
  return String(j.email).trim();
}

async function onboardUser(accessToken, tierId, { version, longUA }, signal) {
  const body = JSON.stringify({
    tier_id: tierId,
    metadata: { ide_type: 'ANTIGRAVITY', ide_version: version, ide_name: 'antigravity' },
  });
  for (let attempt = 1; attempt <= 10; attempt++) {
    const r = await fetch(`${ANTIGRAVITY_SPEC.dailyApiEndpoint}/${ANTIGRAVITY_SPEC.apiVersion}:onboardUser`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': longUA,
        'X-Goog-Api-Client': GOOG_API_CLIENT_UA,
      },
      body,
      signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Antigravity onboardUser 失败 (HTTP ${r.status}): ${text.slice(0, 300)}`);
    const lro = JSON.parse(text || '{}');
    if (lro.done) {
      const pid = extractProjectId(lro.response);
      if (!pid) throw new Error('Antigravity onboardUser 已完成但未返回 projectId');
      return pid;
    }
    if (attempt < 10) {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 2000);
        signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('已取消登录')); }, { once: true });
      });
    }
  }
  throw new Error('Antigravity 开通项目超时，请稍后重试');
}

async function fetchProjectId(accessToken, uaInfo, signal) {
  const r = await fetch(`${ANTIGRAVITY_SPEC.dailyApiEndpoint}/${ANTIGRAVITY_SPEC.apiVersion}:loadCodeAssist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': uaInfo.longUA,
      'X-Goog-Api-Client': GOOG_API_CLIENT_UA,
    },
    body: JSON.stringify({
      metadata: { ide_type: 'ANTIGRAVITY', ide_version: uaInfo.version, ide_name: 'antigravity' },
    }),
    signal,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Antigravity loadCodeAssist 失败 (HTTP ${r.status}): ${text.slice(0, 300)}`);
  const loadResp = JSON.parse(text || '{}');
  const pid = extractProjectId(loadResp);
  if (pid) return pid;
  return onboardUser(accessToken, pickDefaultTierId(loadResp), uaInfo, signal);
}

const oauth = createOAuthRuntime({
  id: 'antigravity',
  label: 'Antigravity',
  notLoggedInMessage: 'Antigravity 尚未登录，请先在订阅中心点击登录',
  expiredMessage: 'Antigravity 登录已过期，请重新登录',
  refreshLeadMs: REFRESH_LEAD_MS,
  credKeyOf,
  isReady: (c) => Boolean(c?.projectId),
  async doRefresh(latest) {
    const { ok, status, data } = await postOAuthToken(ANTIGRAVITY_SPEC.tokenUrl, {
      client_id: ANTIGRAVITY_SPEC.clientId,
      client_secret: ANTIGRAVITY_SPEC.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: latest.refreshToken,
    });
    if (!ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${status}`;
      throw new HttpError(401, `Antigravity 刷新 Token 失败: ${desc}`, 'authentication_error');
    }
    const patch = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      projectId: latest.projectId || '',
    };
    if (!patch.projectId) {
      const uaInfo = getHubUserAgent();
      patch.projectId = await fetchProjectId(patch.accessToken, uaInfo);
    }
    return patch;
  },
});

async function fetchAntigravityStream(payload, signal) {
  const uaInfo = getHubUserAgent();
  const { resp } = await oauth.fetchWithAuth((creds) => fetch(
    `${ANTIGRAVITY_SPEC.dailyApiEndpoint}/${ANTIGRAVITY_SPEC.apiVersion}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': uaInfo.shortUA,
      },
      body: JSON.stringify({ ...payload, project: creds.projectId }),
      signal,
    },
  ), signal);
  return resp;
}

export default {
  id: 'antigravity',
  name: 'Antigravity',
  providerName: '订阅 · Antigravity',
  desc: 'Google Antigravity 订阅模型（官方 Google OAuth 登录，支持 Gemini 4、Claude 5.5/4.6 与生图）',
  authModes: ['browser'],
  capabilities: ['chat'],

  async status() {
    return oauth.buildStatus({
      authModeOf: () => 'browser',
      fallbackModelCount: ANTIGRAVITY_SPEC.fallbackModels.length,
    });
  },

  async startLogin() {
    const session = loginManager.begin('antigravity', 'browser', '正在启动本地回调服务…');
    try {
      const state = crypto.randomBytes(16).toString('hex');
      let cb;
      try {
        cb = await listenOAuthCallback({
          port: ANTIGRAVITY_SPEC.callbackPort,
          host: undefined,
          redirectHost: 'localhost',
          callbackPath: '/oauth-callback',
          expectedState: state,
          signal: session.signal,
        });
      } catch {
        cb = await listenOAuthCallback({
          port: 0,
          host: undefined,
          redirectHost: 'localhost',
          callbackPath: '/oauth-callback',
          expectedState: state,
          signal: session.signal,
        });
      }

      const params = new URLSearchParams({
        access_type: 'offline',
        client_id: ANTIGRAVITY_SPEC.clientId,
        prompt: 'consent',
        redirect_uri: cb.redirectUri,
        response_type: 'code',
        scope: ANTIGRAVITY_SPEC.scopes.join(' '),
        state,
      });
      const authUrl = `${ANTIGRAVITY_SPEC.authUrl}?${params.toString()}`;
      session.update({ url: authUrl, message: '请在浏览器中完成 Google 账号授权…' });

      (async () => {
        try {
          const { code } = await cb.waitForCode();
          session.update({ message: '已收到授权，正在换取凭据与项目信息…' });

          const { ok: tokOk, status: tokStatus, data: tok } = await postOAuthToken(ANTIGRAVITY_SPEC.tokenUrl, {
            code,
            client_id: ANTIGRAVITY_SPEC.clientId,
            client_secret: ANTIGRAVITY_SPEC.clientSecret,
            redirect_uri: cb.redirectUri,
            grant_type: 'authorization_code',
          }, { signal: session.signal });
          if (!tokOk || !tok.access_token) {
            throw new Error(tok.error_description || tok.error || `换取 Token 失败 (HTTP ${tokStatus})`);
          }

          const uaInfo = getHubUserAgent();
          const email = await fetchUserEmail(tok.access_token, uaInfo.shortUA, session.signal);
          const projectId = await fetchProjectId(tok.access_token, uaInfo, session.signal);

          invalidateModelCache('antigravity');
          session.commitCreds({
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token || '',
            expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
            email,
            projectId,
          }, `已登录：${email}`);
        } catch (err) {
          if (session.signal.aborted) loginManager.clear('antigravity');
          else session.fail(err);
        } finally {
          cb.close();
        }
      })();

      return {
        status: 'pending',
        mode: 'browser',
        url: authUrl,
        message: '请在浏览器中登录 Google 账号完成 Antigravity 授权',
      };
    } catch (err) {
      session.fail(err);
      throw new HttpError(500, err instanceof Error ? err.message : String(err), 'api_error');
    }
  },

  cancelLogin: () => oauth.cancelLogin(),
  logout: () => oauth.logout(),

  async listModels(_ctx, { force = false } = {}) {
    const initialCreds = await oauth.ensureCreds();
    return cachedListModels('antigravity', credKeyOf(initialCreds), async () => {
      const uaInfo = getHubUserAgent();
      const { resp } = await oauth.fetchWithAuth((c) => fetch(
        `${ANTIGRAVITY_SPEC.dailyApiEndpoint}/${ANTIGRAVITY_SPEC.apiVersion}:fetchAvailableModels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': uaInfo.shortUA,
          },
          body: JSON.stringify({ project: c.projectId || '' }),
          signal: AbortSignal.timeout(12000),
        },
      ));
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.error?.message || data?.message || `Antigravity 获取模型失败 (HTTP ${resp.status})`;
        throw new HttpError(resp.status, msg, resp.status === 401 ? 'authentication_error' : 'api_error');
      }
      const raw = data?.models;
      if (!raw || typeof raw !== 'object') return [];
      const entries = Array.isArray(raw) ? raw.map((v) => [v?.id || v?.name, v]) : Object.entries(raw);
      return entries
        .filter(([id]) => typeof id === 'string' && id.trim() && !/^tab_/i.test(id.trim()))
        .sort((a, b) => Number(!!b[1]?.recommended) - Number(!!a[1]?.recommended) || a[0].localeCompare(b[0]))
        .map(([id, v]) => ({
          id: id.trim(),
          displayName: String(v?.displayName || id).trim(),
          owned_by: 'antigravity',
          capabilities: /image/i.test(id) ? ['chat', 'image'] : ['chat'],
        }));
    }, { force, fallback: ANTIGRAVITY_SPEC.fallbackModels });
  },

  async chat(_ctx, body, req, res) {
    const creds = await oauth.ensureCreds();
    return handleCloudCodeChat({
      body,
      req,
      res,
      creds,
      fetchStream: fetchAntigravityStream,
    });
  },
};

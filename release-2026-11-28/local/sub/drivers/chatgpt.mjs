import crypto from 'node:crypto';
import { loginManager, readStateJson, writeStateJson } from '../lib/store.mjs';
import { HttpError, normalizeModels, sendJson } from '../lib/openai.mjs';
import { createPkce, listenOAuthCallback } from '../lib/oauth-callback.mjs';
import { cachedListModels, invalidateModelCache, mergeCodexModels } from '../lib/models.mjs';
import { createOAuthRuntime, postOAuthToken } from '../lib/oauth-driver.mjs';
import { decodeJwtClaims, handleResponsesChat, parseSseEvents } from '../lib/responses.mjs';
import { CHATGPT_SPEC } from '../lib/sub-specs.mjs';

const {
  discoveryUrl: DISCOVERY_URL,
  usageUrl: USAGE_URL,
  codex: {
    authUrl: CODEX_AUTH_URL,
    tokenUrl: CODEX_TOKEN_URL,
    clientId: CODEX_CLIENT_ID,
    callbackPort: CODEX_CALLBACK_PORT,
    clientVersion: CODEX_CLIENT_VERSION,
    apiBase: CODEX_API_BASE,
    userAgent: CODEX_USER_AGENT,
    originator: CODEX_ORIGINATOR,
    imageModels: IMAGE_MODELS,
  },
  siwc: {
    apiBase: SIWC_API_BASE,
    resource: SIWC_RESOURCE,
    dynamicClientId: SIWC_DYNAMIC_CLIENT_ID,
    agentNameHint: SIWC_AGENT_NAME_HINT,
    scopes: SIWC_SCOPES,
    requiredScope: SIWC_REQUIRED_SCOPE,
  },
} = CHATGPT_SPEC;
const REFRESH_LEAD_MS = 2 * 60 * 1000;

let discoveryCache = null;

function credKeyOf(c) {
  if (!c) return '';
  return `${isCodexCreds(c) ? 'codex' : 'siwc'}:${c.accountId || c.email || c.refreshToken || c.accessToken}`;
}

function readHostId() {
  const data = readStateJson('chatgpt-host');
  if (typeof data?.hostId === 'string' && data.hostId) return data.hostId;
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  writeStateJson('chatgpt-host', { hostId });
  return hostId;
}

async function discoverOAuth(signal) {
  if (discoveryCache && Date.now() - discoveryCache.at < 30 * 60 * 1000) return discoveryCache;
  const r = await fetch(DISCOVERY_URL, { headers: { Accept: 'application/json' }, signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.authorization_endpoint || !j.token_endpoint) {
    throw new Error(`OpenAI OIDC discovery 失败 (HTTP ${r.status})`);
  }
  discoveryCache = {
    authEndpoint: j.authorization_endpoint,
    tokenEndpoint: j.token_endpoint,
    revocationEndpoint: j.revocation_endpoint || '',
    at: Date.now(),
  };
  return discoveryCache;
}

function extractAccount(tokenResp) {
  const idClaims = decodeJwtClaims(tokenResp?.id_token);
  const accessClaims = decodeJwtClaims(tokenResp?.access_token);
  const idAuth = idClaims?.['https://api.openai.com/auth'] || {};
  const accAuth = accessClaims?.['https://api.openai.com/auth'] || {};
  const email = idClaims?.email || accessClaims?.email || idClaims?.preferred_username || idClaims?.name || 'ChatGPT 账号';
  return {
    email,
    plan: accAuth.chatgpt_plan_type || idAuth.chatgpt_plan_type || null,
    accountId: idAuth.chatgpt_account_id || accAuth.chatgpt_account_id || null,
  };
}

function parseEarliestRefresh(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
  const ms = Date.parse(String(val));
  return Number.isFinite(ms) ? ms : 0;
}

function isCodexCreds(c) {
  return c?.authMode === 'codex';
}

const oauth = createOAuthRuntime({
  id: 'chatgpt',
  label: 'ChatGPT',
  notLoggedInMessage: 'ChatGPT 尚未登录，请先在订阅中心选择登录方式',
  expiredMessage: 'ChatGPT 登录已过期，请重新登录',
  refreshLeadMs: REFRESH_LEAD_MS,
  credKeyOf,
  canSkipRefresh(latest) {
    return Boolean(
      !isCodexCreds(latest)
      && latest?.earliestRefreshAt
      && Date.now() < latest.earliestRefreshAt
      && latest.expiresAt
      && Date.now() < latest.expiresAt - 15000,
    );
  },
  async doRefresh(latest) {
    const codex = isCodexCreds(latest);
    if (!codex && !latest?.clientId) {
      throw new HttpError(401, 'ChatGPT 登录已过期，请重新登录', 'authentication_error');
    }
    const tokenEndpoint = codex
      ? CODEX_TOKEN_URL
      : (latest.tokenEndpoint || (await discoverOAuth()).tokenEndpoint);
    const { ok, status, data } = await postOAuthToken(tokenEndpoint, codex
      ? {
          client_id: CODEX_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: latest.refreshToken,
          scope: 'openid profile email',
        }
      : {
          grant_type: 'refresh_token',
          client_id: latest.clientId,
          refresh_token: latest.refreshToken,
          resource: SIWC_RESOURCE,
        });
    if (!ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${status}`;
      throw new HttpError(401, `ChatGPT 刷新 Token 失败，请重新登录: ${desc}`, 'authentication_error');
    }
    const acct = extractAccount(data);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      idToken: data.id_token || latest.idToken || '',
      scope: data.scope || latest.scope || '',
      tokenEndpoint,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      earliestRefreshAt: codex ? 0 : parseEarliestRefresh(data.earliest_refresh_at),
      email: acct.email || latest.email,
      plan: acct.plan || latest.plan || null,
      accountId: acct.accountId || latest.accountId || null,
    };
  },
});

const ensureCreds = () => oauth.ensureCreds();

async function fetchUpstream(urlPath, { method = 'GET', body = null, accept = 'application/json', signal, extraHeaders = {}, baseOverride = '' } = {}) {
  const { resp } = await oauth.fetchWithAuth((creds) => {
    const codex = isCodexCreds(creds);
    const base = baseOverride || (codex ? CODEX_API_BASE : SIWC_API_BASE);
    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: accept,
      ...(codex ? {
        'User-Agent': CODEX_USER_AGENT,
        Originator: CODEX_ORIGINATOR,
        ...(creds.accountId ? { 'Chatgpt-Account-Id': creds.accountId } : {}),
      } : {}),
      ...extraHeaders,
    };
    const init = { method, headers, signal };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return fetch(`${base}${urlPath}`, init);
  }, signal);
  return resp;
}

export function mapChatGptError(status, msg, code) {
  const lower = `${code || ''} ${msg || ''}`.toLowerCase();
  if (lower.includes('subscription_sharing_user_not_eligible')) {
    return new HttpError(
      403,
      `OpenAI SIWC 通道拒绝了此账号的订阅共享资格；可在订阅中心退出后改用「Codex OAuth 登录」通道。原始信息：${msg}`,
      'permission_error',
      code,
    );
  }
  if (lower.includes('insufficient_quota') || lower.includes('usage_limit') || lower.includes('usage limit') || lower.includes('plan_limit')) {
    return new HttpError(429, `ChatGPT 订阅额度不足或已达上限，可在 ${USAGE_URL} 查看：${msg}`, 'rate_limit_error', code);
  }
  if (status === 403 && (lower.includes('scope') || lower.includes('chatgpt.tokens') || lower.includes('permission'))) {
    return new HttpError(403, `当前授权缺少调用权限，请在订阅中心重新登录：${msg}`, 'authentication_error', code);
  }
  return null;
}

async function startCodexLogin(session) {
  const pkce = createPkce();
  let cb;
  try {
    cb = await listenOAuthCallback({
      port: CODEX_CALLBACK_PORT,
      host: undefined,
      redirectHost: 'localhost',
      callbackPath: '/auth/callback',
      expectedState: pkce.state,
      signal: session.signal,
    });
  } catch (err) {
    throw new Error(`Codex OAuth 需要本地回调端口 ${CODEX_CALLBACK_PORT}，当前被占用（请关闭占用 ${CODEX_CALLBACK_PORT} 的登录窗口后重试）：${err.message}`);
  }

  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    response_type: 'code',
    redirect_uri: cb.redirectUri,
    scope: 'openid email profile offline_access',
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  });
  const authUrl = `${CODEX_AUTH_URL}?${params.toString()}`;
  session.update({ url: authUrl, message: '请在浏览器中完成 Codex OAuth 登录…' });

  (async () => {
    try {
      const { code } = await cb.waitForCode();
      session.update({ message: '已收到授权，正在换取 Codex 订阅凭据…' });

      const { ok: tokOk, status: tokStatus, data: tok } = await postOAuthToken(CODEX_TOKEN_URL, {
        grant_type: 'authorization_code',
        client_id: CODEX_CLIENT_ID,
        code,
        redirect_uri: cb.redirectUri,
        code_verifier: pkce.verifier,
      }, { signal: session.signal });
      if (!tokOk || !tok.access_token) {
        throw new Error(tok.error_description || tok.error || `换取 Codex Token 失败 (HTTP ${tokStatus})`);
      }

      const acct = extractAccount(tok);
      const label = acct.plan ? `${acct.email} (${acct.plan} · Codex)` : `${acct.email} (Codex)`;
      invalidateModelCache('chatgpt');
      session.commitCreds({
        authMode: 'codex',
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || '',
        idToken: tok.id_token || '',
        clientId: CODEX_CLIENT_ID,
        scope: tok.scope || 'openid email profile offline_access',
        tokenEndpoint: CODEX_TOKEN_URL,
        expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
        earliestRefreshAt: 0,
        email: acct.email,
        plan: acct.plan,
        accountId: acct.accountId,
      }, `已登录：${label}`);
    } catch (err) {
      if (session.signal.aborted) loginManager.clear('chatgpt');
      else session.fail(err);
    } finally {
      cb.close();
    }
  })();

  return {
    status: 'pending',
    mode: 'codex',
    url: authUrl,
    message: '请在浏览器中完成 Codex OAuth 授权',
  };
}

async function startSiwcLogin(session) {
  const disc = await discoverOAuth(session.signal);
  const hostId = readHostId();
  const pkce = createPkce();
  const cb = await listenOAuthCallback({
    port: 0,
    host: '127.0.0.1',
    redirectHost: '127.0.0.1',
    callbackPath: '/auth/callback',
    expectedState: pkce.state,
    signal: session.signal,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SIWC_DYNAMIC_CLIENT_ID,
    redirect_uri: cb.redirectUri,
    scope: SIWC_SCOPES.join(' '),
    resource: SIWC_RESOURCE,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: hostId,
    agent_name_hint: SIWC_AGENT_NAME_HINT,
  });
  const authUrl = `${disc.authEndpoint}?${params.toString()}`;
  session.update({ url: authUrl, message: '请在浏览器中登录 ChatGPT 并允许 Colony 使用你的订阅额度…' });

  (async () => {
    try {
      const { code, params: cbParams } = await cb.waitForCode();
      const issuedClientId = (cbParams?.client_id || '').trim();
      if (!issuedClientId || issuedClientId === SIWC_DYNAMIC_CLIENT_ID) {
        throw new Error('OpenAI 回调未返回签发的 client_id，请重试登录');
      }

      session.update({ message: '已收到授权，正在换取 OpenAI 访问凭证…' });

      const { ok: tokOk, status: tokStatus, data: tok } = await postOAuthToken(disc.tokenEndpoint, {
        grant_type: 'authorization_code',
        client_id: issuedClientId,
        code,
        redirect_uri: cb.redirectUri,
        code_verifier: pkce.verifier,
        resource: SIWC_RESOURCE,
      }, { signal: session.signal });
      if (!tokOk || !tok.access_token) {
        throw new Error(tok.error_description || tok.error || `换取 Token 失败 (HTTP ${tokStatus})`);
      }

      if (tok.scope && !String(tok.scope).split(/\s+/).includes(SIWC_REQUIRED_SCOPE)) {
        throw new Error('登录未授予 ChatGPT 订阅额度使用权限（chatgpt.tokens.use.direct），请重新登录并勾选允许');
      }

      const idClaims = decodeJwtClaims(tok.id_token);
      if (idClaims?.nonce && idClaims.nonce !== pkce.nonce) {
        throw new Error('OpenAI 返回的 id_token nonce 校验失败');
      }

      const acct = extractAccount(tok);
      const label = acct.plan ? `${acct.email} (${acct.plan} · SIWC)` : `${acct.email} (SIWC)`;
      invalidateModelCache('chatgpt');
      session.commitCreds({
        authMode: 'browser',
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || '',
        idToken: tok.id_token || '',
        clientId: issuedClientId,
        scope: tok.scope || SIWC_SCOPES.join(' '),
        tokenEndpoint: disc.tokenEndpoint,
        revocationEndpoint: disc.revocationEndpoint || '',
        expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
        earliestRefreshAt: parseEarliestRefresh(tok.earliest_refresh_at),
        email: acct.email,
        plan: acct.plan,
        accountId: acct.accountId,
      }, `已登录：${label}`);
    } catch (err) {
      if (session.signal.aborted) loginManager.clear('chatgpt');
      else session.fail(err);
    } finally {
      cb.close();
    }
  })();

  return {
    status: 'pending',
    mode: 'browser',
    url: authUrl,
    message: '请在浏览器中完成 Sign in with ChatGPT 授权',
  };
}

export default {
  id: 'chatgpt',
  name: 'ChatGPT / Codex',
  providerName: '订阅 · ChatGPT',
  desc: '支持 Codex OAuth（稳定走 Codex 订阅通道）与官方 SIWC（直连 api.openai.com）两种登录方式，同卡切换',
  authModes: ['codex', 'browser'],
  capabilities: ['chat', 'image'],
  usageUrl: USAGE_URL,

  async status() {
    return oauth.buildStatus({
      authModeOf: (c) => (isCodexCreds(c) ? 'codex' : 'browser'),
      accountOf: (c) => {
        const modeTag = isCodexCreds(c) ? 'Codex' : 'SIWC';
        return c?.email ? `${c.email} (${[c.plan, modeTag].filter(Boolean).join(' · ')})` : null;
      },
      extra: { usageUrl: USAGE_URL },
    });
  },

  async startLogin(_ctx, body = {}) {
    const mode = body?.mode === 'browser' ? 'browser' : 'codex';
    const session = loginManager.begin(
      'chatgpt',
      mode,
      mode === 'codex' ? '正在启动 Codex OAuth 回调服务…' : '正在向 OpenAI 获取 SIWC 授权地址…',
    );
    try {
      return mode === 'codex' ? await startCodexLogin(session) : await startSiwcLogin(session);
    } catch (err) {
      session.fail(err);
      throw new HttpError(502, err instanceof Error ? err.message : String(err), 'api_error');
    }
  },

  cancelLogin: () => oauth.cancelLogin(),

  logout: () => oauth.logout((c) => {
    if (!isCodexCreds(c) && c.refreshToken && c.clientId && c.revocationEndpoint) {
      postOAuthToken(c.revocationEndpoint, {
        client_id: c.clientId,
        token: c.refreshToken,
        token_type_hint: 'refresh_token',
      }, { signal: AbortSignal.timeout(4000) }).catch(() => {});
    }
  }),

  async listModels(_ctx, { force = false } = {}) {
    const creds = await ensureCreds();
    const codex = isCodexCreds(creds);
    return cachedListModels('chatgpt', credKeyOf(creds), async () => {
      const pathUrl = codex ? `/models?client_version=${CODEX_CLIENT_VERSION}` : '/models';
      const [resp, webResp] = await Promise.all([
        fetchUpstream(pathUrl, { method: 'GET', signal: AbortSignal.timeout(15000) }),
        codex
          ? fetchUpstream('/models', { method: 'GET', baseOverride: 'https://chatgpt.com/backend-api', signal: AbortSignal.timeout(15000) }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.error?.message || data?.message || `获取 OpenAI 模型列表失败 (HTTP ${resp.status})`;
        const custom = mapChatGptError(resp.status, msg, data?.error?.code);
        if (custom) throw custom;
        throw new HttpError(resp.status, msg, resp.status === 401 ? 'authentication_error' : 'api_error');
      }
      let modelsData = data;
      if (codex) {
        const webData = webResp?.ok ? await webResp.json().catch(() => ({})) : {};
        modelsData = { models: mergeCodexModels(data, webData) };
      }
      const models = normalizeModels(modelsData, { ownedBy: 'openai' });
      if (codex) {
        for (const id of IMAGE_MODELS) {
          if (!models.some((m) => m.id === id)) {
            models.push({ id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai', displayName: id, capabilities: ['image_generation'] });
          }
        }
      }
      return models;
    }, { force });
  },

  async handleExtra(_ctx, tail, req, res) {
    if (req.method !== 'POST' || tail !== '/images/generations') throw new HttpError(404, `不支持路径 ${tail}`, 'invalid_request_error');
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body', 'invalid_request_error'); }
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new HttpError(400, 'prompt 不能为空', 'invalid_request_error');
    const tool = { type: 'image_generation', action: 'generate', model: String(body.model || 'gpt-image-2.6'), ...Object.fromEntries(['size', 'quality', 'background', 'output_format', 'moderation', 'output_compression', 'partial_images'].filter(k => body[k] != null).map(k => [k, body[k]])) };
    const payload = { model: 'gpt-6.2-sol', instructions: '', stream: true, store: false, tool_choice: { type: 'image_generation' }, tools: [tool], input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }] };
    const upstream = await fetchUpstream('/responses', { method: 'POST', body: payload, accept: 'text/event-stream' });
    if (!upstream.ok) { const text = await upstream.text(); throw new HttpError(upstream.status, text || '图片生成失败', 'api_error'); }
    const images = [];
    await parseSseEvents(upstream.body, (_type, ev) => {
      for (const item of ev?.response?.output || ev?.output || []) if (item?.type === 'image_generation_call' && item.result) images.push({ b64_json: item.result, revised_prompt: item.revised_prompt });
      if (ev?.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call' && ev.item.result) images.push({ b64_json: ev.item.result, revised_prompt: ev.item.revised_prompt });
    });
    sendJson(res, { created: Math.floor(Date.now() / 1000), data: images });
  },

  async chat(_ctx, body, req, res) {
    const creds = await ensureCreds();
    const codex = isCodexCreds(creds);
    return handleResponsesChat({
      body,
      req,
      res,
      defaultModel: 'gpt-6.2-sol',
      providerLabel: codex ? 'Codex' : 'ChatGPT',
      stripSampling: true,
      extractInstructions: true,
      alwaysInstructions: codex,
      fetchResponses: (payload, signal) => fetchUpstream('/responses', {
        method: 'POST',
        body: payload,
        accept: 'text/event-stream',
        signal,
        extraHeaders: codex ? { 'X-Codex-Routing-Hint': `model=${payload.model}` } : {},
      }),
      mapUpstreamError: mapChatGptError,
    });
  },
};

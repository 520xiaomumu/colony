import { loginManager } from '../lib/store.mjs';
import {
  HttpError,
  buildChatCompletion,
  buildUsage,
  corsHeaders,
  createChatSse,
  flattenTextContent,
  genId,
  normalizeModels,
  readJsonBody,
  sendJson,
  withTimeoutSignal,
} from '../lib/openai.mjs';
import { createPkce, listenOAuthCallback } from '../lib/oauth-callback.mjs';
import { cachedListModels, invalidateModelCache } from '../lib/models.mjs';
import { createOAuthRuntime, postOAuthToken } from '../lib/oauth-driver.mjs';
import { parseSseEvents } from '../lib/responses.mjs';
import { CLAUDE_SPEC } from '../lib/sub-specs.mjs';

const {
  authUrl: AUTH_URL,
  tokenUrl: TOKEN_URL,
  apiBase: API_BASE,
  clientId: CLIENT_ID,
  callbackPort: CALLBACK_PORT,
  loginScope: LOGIN_SCOPE,
  refreshScope: REFRESH_SCOPE,
  apiVersion: API_VERSION,
  oauthBeta: OAUTH_BETA,
  userAgent: USER_AGENT,
  usageUrl: USAGE_URL,
  fallbackModels: CLAUDE_FALLBACK_MODELS,
} = CLAUDE_SPEC;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

const oauth = createOAuthRuntime({
  id: 'claude',
  label: 'Claude',
  notLoggedInMessage: 'Claude 尚未登录，请先在订阅中心点击登录',
  expiredMessage: 'Claude 登录已过期，请重新登录',
  credKeyOf: (c) => c?.accountId || c?.email || c?.refreshToken || c?.accessToken || 'claude',
  async doRefresh(latest) {
    const { ok, status, data } = await postOAuthToken(TOKEN_URL, {
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: latest.refreshToken,
      scope: REFRESH_SCOPE,
    }, { json: true });
    if (!ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${status}`;
      throw new HttpError(401, `Claude Token 刷新失败: ${desc}`, 'authentication_error');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: data.account?.email_address || latest.email || '',
      accountId: data.account?.uuid || latest.accountId || '',
    };
  },
});

async function fetchAnthropic(urlPath, { method = 'POST', body = null, stream = false, signal } = {}) {
  const { resp } = await oauth.fetchWithAuth((creds) => {
    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: stream ? 'text/event-stream' : 'application/json',
      'anthropic-version': API_VERSION,
      'anthropic-beta': OAUTH_BETA,
      'User-Agent': USER_AGENT,
    };
    const init = { method, headers, signal };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return fetch(`${API_BASE}${urlPath}`, init);
  }, signal);
  return resp;
}

function mapAnthropicError(status, text) {
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const msg = j?.error?.message || j?.message || text || `Claude HTTP ${status}`;
  const type = status === 401
    ? 'authentication_error'
    : status === 429
      ? 'rate_limit_error'
      : 'api_error';
  return new HttpError(status, msg, type, j?.error?.type || null);
}

function parseJsonSafe(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function toAnthropicContentBlocks(content) {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      if (part) blocks.push({ type: 'text', text: part });
      continue;
    }
    if ((part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') && part.text) {
      blocks.push({ type: 'text', text: String(part.text) });
    } else if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (!url) continue;
      const m = /^data:([^;]+);base64,(.+)$/s.exec(url);
      if (m) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      } else {
        blocks.push({ type: 'image', source: { type: 'url', url } });
      }
    } else if (part.type === 'image' && part.source) {
      blocks.push(part);
    }
  }
  return blocks;
}

export function openAiToAnthropicPayload(body = {}, defaultModel = CLAUDE_FALLBACK_MODELS[1].id) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const sysParts = [];
  const outMsgs = [];

  const pushMerged = (role, blocks) => {
    if (!blocks.length) return;
    const prev = outMsgs[outMsgs.length - 1];
    if (prev && prev.role === role) {
      prev.content.push(...blocks);
    } else {
      outMsgs.push({ role, content: [...blocks] });
    }
  };

  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'system' || m.role === 'developer') {
      const s = flattenTextContent(m.content);
      if (s) sysParts.push(s);
      continue;
    }
    if (m.role === 'tool') {
      const resultText = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? flattenTextContent(m.content) : JSON.stringify(m.content ?? ''));
      pushMerged('user', [{
        type: 'tool_result',
        tool_use_id: m.tool_call_id || genId('toolu'),
        content: resultText || '',
      }]);
      continue;
    }
    if (m.role === 'assistant') {
      const blocks = toAnthropicContentBlocks(m.content);
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc?.function || {};
          blocks.push({
            type: 'tool_use',
            id: tc.id || genId('toolu'),
            name: fn.name || tc.name || 'tool',
            input: parseJsonSafe(fn.arguments ?? tc.input, {}),
          });
        }
      }
      pushMerged('assistant', blocks.length ? blocks : [{ type: 'text', text: '' }]);
      continue;
    }
    const userBlocks = toAnthropicContentBlocks(m.content);
    pushMerged('user', userBlocks.length ? userBlocks : [{ type: 'text', text: '' }]);
  }

  let maxTokens = Number(body.max_tokens || body.max_completion_tokens || 8192);
  const payload = {
    model: (typeof body.model === 'string' && body.model.trim()) || defaultModel,
    max_tokens: maxTokens,
    messages: outMsgs.length ? outMsgs : [{ role: 'user', content: [{ type: 'text', text: '' }] }],
    stream: body.stream === true,
  };

  if (sysParts.length) payload.system = sysParts.join('\n\n');
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.top_p === 'number') payload.top_p = body.top_p;
  if (Array.isArray(body.stop) && body.stop.length) payload.stop_sequences = body.stop;
  else if (typeof body.stop === 'string' && body.stop) payload.stop_sequences = [body.stop];

  const effort = body.reasoning_effort || body.reasoning?.effort;
  if (body.thinking?.type === 'enabled' || (effort && effort !== 'none')) {
    const budget = Number(body.thinking?.budget_tokens)
      || (effort === 'high' || effort === 'xhigh' ? 16384 : effort === 'low' ? 2048 : 8192);
    if (maxTokens <= budget) payload.max_tokens = budget + 4096;
    payload.thinking = { type: 'enabled', budget_tokens: budget };
    delete payload.temperature;
    delete payload.top_p;
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    payload.tools = body.tools.map((t) => ({
      name: t.function?.name || t.name,
      description: t.function?.description || t.description || '',
      input_schema: t.function?.parameters || t.input_schema || { type: 'object', properties: {} },
    }));
    if (body.tool_choice === 'auto') payload.tool_choice = { type: 'auto' };
    else if (body.tool_choice === 'required') payload.tool_choice = { type: 'any' };
    else if (body.tool_choice?.type === 'function' && body.tool_choice.function?.name) {
      payload.tool_choice = { type: 'tool', name: body.tool_choice.function.name };
    }
  }

  return payload;
}

function mapStopReason(reason, hasTools) {
  if (reason === 'tool_use' || hasTools) return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  return 'stop';
}

export default {
  id: 'claude',
  name: 'Claude',
  providerName: '订阅 · Claude',
  desc: 'Claude Code OAuth / Anthropic Messages',
  authModes: ['browser'],
  capabilities: ['chat', 'messages'],
  usageUrl: USAGE_URL,

  async status() {
    return oauth.buildStatus({
      authModeOf: () => 'browser',
      accountOf: (c) => c?.email || 'Claude 账号',
      fallbackModelCount: CLAUDE_FALLBACK_MODELS.length,
      extra: { usageUrl: USAGE_URL },
    });
  },

  async startLogin() {
    const session = loginManager.begin('claude', 'browser', '正在启动 Claude OAuth 回调服务…');
    const pkce = createPkce();
    let cb;
    try {
      cb = await listenOAuthCallback({
        port: CALLBACK_PORT,
        host: undefined,
        redirectHost: 'localhost',
        callbackPath: '/callback',
        expectedState: pkce.state,
        signal: session.signal,
      });
    } catch (err) {
      session.fail(err);
      throw new HttpError(500, `启动本地 OAuth 回调端口 ${CALLBACK_PORT} 失败: ${err.message}`, 'api_error');
    }

    const authUrl = `${AUTH_URL}?${new URLSearchParams({
      code: 'true',
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: LOGIN_SCOPE,
      state: pkce.state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    })}`;
    session.update({ url: authUrl, message: '请在浏览器中完成 Claude OAuth 登录…' });

    (async () => {
      try {
        const { code } = await cb.waitForCode();
        const { ok, status, data } = await postOAuthToken(TOKEN_URL, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          code_verifier: pkce.verifier,
          state: pkce.state,
        }, { json: true, signal: session.signal });
        if (!ok || !data.access_token) {
          throw new Error(data.error_description || data.error || `Claude Token 交换失败 (HTTP ${status})`);
        }
        const email = data.account?.email_address || 'Claude 账号';
        invalidateModelCache('claude');
        session.commitCreds({
          authMode: 'oauth',
          accessToken: data.access_token,
          refreshToken: data.refresh_token || '',
          expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
          email,
          accountId: data.account?.uuid || '',
          plan: 'Claude',
        }, `已登录：${email}`);
      } catch (err) {
        if (session.signal.aborted) loginManager.clear('claude');
        else session.fail(err);
      } finally {
        cb.close();
      }
    })();

    return {
      status: 'pending',
      mode: 'browser',
      url: authUrl,
      message: '请在浏览器中完成 Claude OAuth 授权',
    };
  },

  cancelLogin: () => oauth.cancelLogin(),
  logout: () => oauth.logout(),

  async listModels(_ctx, { force = false } = {}) {
    const c = await oauth.ensureCreds();
    return cachedListModels('claude', oauth.credKeyOf(c), async () => {
      const resp = await fetchAnthropic('/models', {
        method: 'GET',
        stream: false,
        signal: AbortSignal.timeout(12000),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw mapAnthropicError(resp.status, JSON.stringify(data));
      }
      const raw = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
      if (!raw.length) return [];
      return normalizeModels(
        raw.map((m) => ({
          id: m.id,
          displayName: m.display_name || m.displayName || m.id,
          created: m.created_at ? Math.floor(Date.parse(m.created_at) / 1000) || undefined : undefined,
          owned_by: 'anthropic',
          capabilities: ['chat'],
          protocol: 'anthropic-messages',
        })),
        { ownedBy: 'anthropic', fallback: CLAUDE_FALLBACK_MODELS },
      );
    }, { force, fallback: CLAUDE_FALLBACK_MODELS });
  },

  async chat(_ctx, body, req, res) {
    const payload = openAiToAnthropicPayload(body);
    const stream = payload.stream;
    const completionId = genId('chatcmpl');
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('close', onClose);

    const sse = stream ? createChatSse(res, { id: completionId, model: payload.model }) : null;

    try {
      const upstream = await fetchAnthropic('/messages', {
        method: 'POST',
        body: payload,
        stream,
        signal: withTimeoutSignal(ac.signal, 180000),
      });
      if (!upstream.ok) {
        throw mapAnthropicError(upstream.status, await upstream.text());
      }

      if (!stream) {
        const j = await upstream.json();
        const blocks = Array.isArray(j?.content) ? j.content : [];
        const text = blocks.filter((x) => x?.type === 'text').map((x) => x.text || '').join('');
        const reasoning = blocks.filter((x) => x?.type === 'thinking').map((x) => x.thinking || '').join('');
        const toolCalls = blocks
          .filter((x) => x?.type === 'tool_use')
          .map((x) => ({
            id: x.id || genId('toolu'),
            type: 'function',
            function: { name: x.name || 'tool', arguments: JSON.stringify(x.input || {}) },
          }));
        sendJson(res, buildChatCompletion({
          id: completionId,
          model: payload.model,
          text,
          reasoning,
          toolCalls,
          usage: buildUsage(j?.usage),
          finishReason: mapStopReason(j?.stop_reason, toolCalls.length > 0),
        }));
        return;
      }

      let roleSent = false;
      let rawUsage = {};
      let stopReason = 'stop';
      const toolIndexByBlock = new Map();
      let nextToolIdx = 0;

      const emitRole = () => {
        if (!roleSent) {
          sse.role();
          roleSent = true;
        }
      };

      await parseSseEvents(upstream.body, (_ev, e) => {
        if (!e || typeof e !== 'object') return;
        if (e.type === 'message_start' && e.message?.usage) {
          rawUsage = { ...rawUsage, ...e.message.usage };
        } else if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
          const toolIdx = nextToolIdx++;
          toolIndexByBlock.set(e.index, toolIdx);
          emitRole();
          sse.toolCalls([{
            index: toolIdx,
            id: e.content_block.id || genId('toolu'),
            name: e.content_block.name || 'tool',
            arguments: '',
          }]);
        } else if (e.type === 'content_block_delta') {
          if (e.delta?.type === 'text_delta' && e.delta.text) {
            emitRole();
            sse.text(e.delta.text);
          } else if (e.delta?.type === 'thinking_delta' && e.delta.thinking) {
            emitRole();
            sse.thinking(e.delta.thinking);
          } else if (e.delta?.type === 'input_json_delta' && typeof e.delta.partial_json === 'string') {
            const toolIdx = toolIndexByBlock.get(e.index) ?? Math.max(0, nextToolIdx - 1);
            emitRole();
            sse.toolCallArgs(toolIdx, e.delta.partial_json);
          }
        } else if (e.type === 'message_delta') {
          if (e.usage) rawUsage = { ...rawUsage, ...e.usage };
          if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
        } else if (e.type === 'error') {
          throw new HttpError(502, e.error?.message || 'Claude stream error', 'api_error', e.error?.type || null);
        }
      });

      emitRole();
      sse.done(mapStopReason(stopReason, nextToolIdx > 0), buildUsage(rawUsage));
    } catch (err) {
      if (ac.signal.aborted) return;
      const mapped = err instanceof HttpError ? err : new HttpError(502, err?.message || String(err), 'api_error');
      if (sse) sse.fail(mapped);
      else throw mapped;
    } finally {
      req.off('close', onClose);
      if (sse) sse.cleanup();
    }
  },

  async handleExtra(_ctx, tail, req, res) {
    if (tail !== '/messages' || req.method !== 'POST') {
      throw new HttpError(404, `Claude 不支持路径 ${tail}`, 'invalid_request_error');
    }
    const body = await readJsonBody(req);
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('close', onClose);
    try {
      const upstream = await fetchAnthropic('/messages', {
        method: 'POST',
        body,
        stream: body?.stream === true,
        signal: withTimeoutSignal(ac.signal, 180000),
      });
      if (!upstream.ok) {
        throw mapAnthropicError(upstream.status, await upstream.text());
      }
      const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
      res.writeHead(upstream.status, corsHeaders({ 'Content-Type': ct }));
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (res.writableEnded) break;
          res.write(chunk);
        }
      }
      if (!res.writableEnded) res.end();
    } finally {
      req.off('close', onClose);
    }
  },
};

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_DIR, clearCreds, loginManager, readCreds, writeCreds } from '../lib/store.mjs';
import { HttpError, buildChatCompletion, createChatSse, genId, sendJson } from '../lib/openai.mjs';
import { cachedListModels, invalidateModelCache, peekCachedModels } from '../lib/models.mjs';

const SUB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let _cursorSdk = null;
async function loadCursorSdk() {
  if (_cursorSdk) return _cursorSdk;
  try { _cursorSdk = await import('@cursor/sdk'); return _cursorSdk; } catch {}
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: SUB_DIR, stdio: 'ignore', windowsHide: true });
  try { _cursorSdk = await import('@cursor/sdk'); return _cursorSdk; }
  catch (e) { throw new HttpError(500, 'Cursor SDK 未就绪(请在 local/sub 目录运行 npm install): ' + e.message, 'server_error'); }
}

const CURSOR_STATE_DIR = path.join(STATE_DIR, 'cursor');
fs.mkdirSync(CURSOR_STATE_DIR, { recursive: true });

function getCreds() {
  const c = readCreds('cursor');
  if (!c || !c.apiKey) return null;
  if (c.expiresAt && Date.now() >= c.expiresAt) return null;
  return c;
}

function requireApiKey() {
  const c = getCreds();
  if (!c) throw new HttpError(401, 'Cursor 尚未登录或凭证已过期，请先在订阅中心完成登录', 'authentication_error');
  return c.apiKey;
}

function normalizeJson(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.map(normalizeJson);
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (v === undefined) continue;
      out[k] = normalizeJson(v);
    }
    return out;
  }
  return String(val);
}

function extractTextAndImages(content) {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: content == null ? '' : String(content), images: [] };
  const parts = [];
  const images = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image_url') {
      const url = typeof block.image_url === 'string' ? block.image_url : block.image_url?.url;
      if (typeof url === 'string' && url) {
        const m = /^data:([^;]+);base64,(.+)$/i.exec(url);
        if (m) images.push({ mimeType: m[1], data: m[2] });
        else images.push({ url });
      }
    }
  }
  return { text: parts.join('\n'), images };
}

function parseOpenAiTools(rawTools, toolChoice) {
  if (toolChoice === 'none' || !Array.isArray(rawTools)) return [];
  const out = [];
  for (const item of rawTools) {
    const fn = item?.type === 'function' ? item.function : item;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;
    const parameters = fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
      ? normalizeJson(fn.parameters)
      : { type: 'object', properties: {} };
    out.push({
      name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters,
    });
  }
  return out;
}

function buildCursorPrompt(messages, tools) {
  const systemParts = [];
  const convLines = [];
  const images = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user').toLowerCase();
    const { text, images: msgImgs } = extractTextAndImages(msg.content);
    if (msgImgs.length) images.push(...msgImgs);

    if (role === 'system' || role === 'developer') {
      if (text.trim()) systemParts.push(text.trim());
      continue;
    }

    if (role === 'tool') {
      const name = msg.name ? ` name=${msg.name}` : '';
      const id = msg.tool_call_id ? ` id=${msg.tool_call_id}` : '';
      convLines.push(`[TOOL_RESULT${name}${id}]\n${text || '(empty)'}\n[/TOOL_RESULT]`);
      continue;
    }

    if (role === 'assistant') {
      if (text) convLines.push(`ASSISTANT:\n${text}`);
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const calls = msg.tool_calls.map((c) => ({
          id: c.id,
          name: c.function?.name || c.name,
          arguments: c.function?.arguments || c.arguments,
        }));
        convLines.push(`ASSISTANT_TOOL_CALLS:\n${JSON.stringify(calls)}`);
      }
      continue;
    }

    convLines.push(`USER:\n${text || '(empty)'}`);
  }

  const header = [];
  if (tools.length) {
    header.push(
      'You are acting as a stateless OpenAI-compatible API backend.',
      'Follow the SYSTEM INSTRUCTIONS below strictly. Only use the custom tools provided to you in this request when needed; never mention Cursor IDE or built-in workspace tools. Return direct answers when no tool is needed.'
    );
  } else {
    header.push(
      'You are acting as a stateless OpenAI-compatible API backend.',
      'Follow the SYSTEM INSTRUCTIONS below strictly and answer directly without mentioning Cursor IDE or coding agent harness.'
    );
  }

  const sections = [header.join('\n')];
  if (systemParts.length) {
    sections.push(`=== SYSTEM INSTRUCTIONS ===\n${systemParts.join('\n\n')}`);
  }
  sections.push(`=== CONVERSATION ===\n${convLines.join('\n\n')}`);
  sections.push('Respond as ASSISTANT to the latest message above.');

  const promptText = sections.join('\n\n');
  return images.length ? { text: promptText, images } : promptText;
}

function mapSdkError(err) {
  if (err instanceof HttpError) return err;
  const name = err?.name || '';
  const msg = err?.message || String(err || 'Cursor SDK error');
  if (name === 'AuthenticationError' || /unauthenticated|invalid.*key|unauthorized/i.test(msg)) {
    return new HttpError(401, `Cursor 认证失败: ${msg}`, 'authentication_error');
  }
  if (name === 'RateLimitError' || /rate.?limit|429/i.test(msg)) {
    return new HttpError(429, `Cursor 触发限流: ${msg}`, 'rate_limit_error');
  }
  if (name === 'ConfigurationError' || /invalid.?model|not found/i.test(msg)) {
    return new HttpError(400, msg, 'invalid_request_error');
  }
  return new HttpError(502, `Cursor 请求失败: ${msg}`, 'api_error');
}

export default {
  id: 'cursor',
  name: 'Cursor',
  providerName: '订阅 · Cursor',
  desc: 'Cursor 订阅模型（官方 @cursor/sdk，一键浏览器登录自动签发 90 天 Key，或手动贴 Key）',
  authModes: ['browser', 'apiKey'],
  capabilities: ['chat'],

  async status() {
    const c = getCreds();
    const login = loginManager.get('cursor');
    return {
      loggedIn: !!c,
      account: c?.email || (c ? 'API Key 用户' : null),
      expiresAt: c?.expiresAt || null,
      authMode: c?.authMode || null,
      modelCount: c ? (peekCachedModels('cursor', c.apiKey)?.length ?? null) : null,
      login,
    };
  },

  async startLogin(_ctx, input = {}) {
    const mode = input.mode || (input.apiKey ? 'apiKey' : 'browser');

    if (mode === 'apiKey') {
      const apiKey = String(input.apiKey || '').trim();
      if (!apiKey) throw new HttpError(400, '请提供 Cursor API Key（crsr_...）', 'invalid_request_error');
      const session = loginManager.begin('cursor', 'apiKey', '正在验证 Cursor API Key…');
      try {
        const { Cursor } = await loadCursorSdk();
        const me = await Cursor.me({ apiKey });
        const email = me?.userEmail || me?.apiKeyName || 'Cursor Key';
        writeCreds('cursor', { apiKey, email, authMode: 'apiKey', expiresAt: null });
        invalidateModelCache('cursor');
        session.succeed(`已登录：${email}`);
        return { status: 'done', account: email };
      } catch (err) {
        const mapped = mapSdkError(err);
        session.fail(mapped);
        throw mapped;
      }
    }

    if (mode !== 'browser') {
      throw new HttpError(400, `不支持的登录方式: ${mode}`, 'invalid_request_error');
    }

    const { Cursor } = await loadCursorSdk();
    const session = loginManager.begin('cursor', 'browser', '正在获取 Cursor 授权链接…');
    let resolveUrl, rejectUrl;
    const urlPromise = new Promise((res, rej) => { resolveUrl = res; rejectUrl = rej; });
    const urlTimer = setTimeout(() => rejectUrl(new Error('获取 Cursor 登录链接超时')), 15000);

    const loginPromise = Cursor.auth.login({
      openBrowser: false,
      store: null,
      apiKeyName: 'Colony Sub',
      signal: session.signal,
      onLoginUrl: (url) => {
        clearTimeout(urlTimer);
        session.update({
          url,
          message: '请在浏览器中确认 Cursor 授权（使用你当前已登录的 GitHub/Cursor 账号）…',
        });
        resolveUrl(url);
      },
    });

    loginPromise.then((res) => {
      writeCreds('cursor', {
        apiKey: res.apiKey,
        email: res.email || 'Cursor 账号',
        authMode: 'browser',
        expiresAt: res.apiKeyExpiresAtMs || null,
      });
      invalidateModelCache('cursor');
      session.succeed(`已登录：${res.email || 'Cursor 账号'}`);
    }).catch((err) => {
      clearTimeout(urlTimer);
      rejectUrl(err);
      if (session.signal.aborted) {
        loginManager.clear('cursor');
      } else {
        session.fail(mapSdkError(err));
      }
    });

    const url = await urlPromise;
    return {
      status: 'pending',
      mode: 'browser',
      url,
      message: '请在弹出的浏览器页面中点击确认授权',
    };
  },

  async cancelLogin() {
    loginManager.cancel('cursor');
    return { ok: true };
  },

  async logout() {
    loginManager.clear('cursor');
    clearCreds('cursor');
    invalidateModelCache('cursor');
    return { ok: true };
  },

  async listModels(_ctx, { force = false } = {}) {
    const apiKey = requireApiKey();
    return cachedListModels('cursor', apiKey, async () => {
      try {
        const { Cursor } = await loadCursorSdk();
        const items = await Cursor.models.list({ apiKey });
        return (Array.isArray(items) ? items : []).map((m) => ({
          id: m.id,
          displayName: m.displayName || m.id,
          description: m.description || '',
          owned_by: 'cursor',
        }));
      } catch (err) {
        throw mapSdkError(err);
      }
    }, { force });
  },

  async chat(_ctx, body, req, res) {
    const apiKey = requireApiKey();
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      throw new HttpError(400, 'messages 不能为空', 'invalid_request_error');
    }

    const modelId = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'composer-2.5';
    const stream = body.stream === true;
    const clientTools = parseOpenAiTools(body.tools, body.tool_choice);
    const promptInput = buildCursorPrompt(messages, clientTools);
    const completionId = genId('chatcmpl');

    const sse = stream ? createChatSse(res, { id: completionId, model: modelId }) : null;
    let agent = null;
    let run = null;
    let aborted = false;

    const onClientAbort = () => {
      aborted = true;
      if (run) run.cancel().catch(() => {});
    };
    req.on('close', onClientAbort);

    const capturedToolCalls = [];
    let toolCancelScheduled = false;

    const customTools = {};
    for (const tool of clientTools) {
      customTools[tool.name] = {
        description: tool.description || undefined,
        inputSchema: tool.parameters,
        execute: async (args, toolCtx) => {
          capturedToolCalls.push({
            id: toolCtx?.toolCallId || genId('call'),
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(args && typeof args === 'object' ? args : {}),
            },
          });
          if (!toolCancelScheduled) {
            toolCancelScheduled = true;
            // Allow same-tick parallel tool calls to register, then cancel the internal loop cleanly
            setTimeout(() => {
              if (run) run.cancel().catch(() => {});
            }, 35);
          }
          return 'TOOL_CALL_FORWARDED_TO_CLIENT';
        },
      };
    }

    let text = '';
    let reasoning = '';
    let usage = null;
    let roleSent = false;

    try {
      const { Agent, emptyFs } = await loadCursorSdk();
      agent = await Agent.create({
        apiKey,
        model: { id: modelId },
        mode: 'agent',
        name: 'colony-sub-api',
        tools: clientTools.length ? ['mcp'] : [],
        local: {
          cwd: CURSOR_STATE_DIR,
          fs: emptyFs(),
          settingSources: [],
          enableAgentRetries: true,
          ...(clientTools.length ? { customTools } : {}),
        },
      });

      run = await agent.send(promptInput, {
        model: { id: modelId },
        mode: 'agent',
        onDelta: ({ update }) => {
          if (aborted || capturedToolCalls.length) return;
          if (!update || typeof update !== 'object') return;
          if (update.type === 'thinking-delta' && typeof update.text === 'string' && update.text) {
            reasoning += update.text;
            if (sse) {
              if (!roleSent) { sse.role(); roleSent = true; }
              sse.thinking(update.text);
            }
          } else if (update.type === 'text-delta' && typeof update.text === 'string' && update.text) {
            text += update.text;
            if (sse) {
              if (!roleSent) { sse.role(); roleSent = true; }
              sse.text(update.text);
            }
          } else if (update.type === 'turn-ended' && update.usage) {
            usage = update.usage;
          }
        },
      });

      const result = await run.wait();
      if (result.usage && !usage) usage = result.usage;

      if (capturedToolCalls.length) {
        if (sse) {
          if (!roleSent) { sse.role(); roleSent = true; }
          sse.toolCalls(capturedToolCalls);
          sse.done('tool_calls', usage);
        } else {
          sendJson(res, buildChatCompletion({
            id: completionId,
            model: modelId,
            text,
            reasoning,
            toolCalls: capturedToolCalls,
            usage,
          }));
        }
        return;
      }

      if (result.status === 'error') {
        throw new HttpError(502, result.error?.message || 'Cursor 模型调用失败', 'api_error', result.error?.code || null);
      }

      if (!text && typeof result.result === 'string' && result.result) {
        text = result.result;
        if (sse) {
          if (!roleSent) { sse.role(); roleSent = true; }
          sse.text(text);
        }
      }

      if (sse) {
        if (!roleSent) { sse.role(); roleSent = true; }
        sse.done('stop', usage);
      } else {
        sendJson(res, buildChatCompletion({
          id: completionId,
          model: modelId,
          text,
          reasoning,
          toolCalls: [],
          usage,
        }));
      }
    } catch (err) {
      if (aborted) return;
      const mapped = mapSdkError(err);
      if (sse) sse.fail(mapped);
      else throw mapped;
    } finally {
      req.off('close', onClientAbort);
      if (sse) sse.cleanup();
      if (agent) {
        try { agent.close(); } catch {}
      }
    }
  },
};

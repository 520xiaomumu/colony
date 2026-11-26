import { clearCreds, loginManager, readCreds, withLock, writeCreds } from '../lib/store.mjs';
import { HttpError, buildChatCompletion, buildUsage, createChatSse, genId, normalizeModels, readJsonBody, sendJson, throwUpstreamError, withTimeoutSignal } from '../lib/openai.mjs';
import { createPkce, listenOAuthCallback } from '../lib/oauth-callback.mjs';

const AUTH_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const API_BASE = 'https://api.anthropic.com/v1';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT_URI = 'http://localhost:54545/callback';
const SCOPE = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';
const API_VERSION = '2023-06-01';
const OAUTH_BETA = 'oauth-2025-04-20';
const MODELS = [
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
];
const REFRESH_LEAD_MS = 120000;

function creds() { return readCreds('claude'); }
function modelList() { return MODELS.map(m => ({ ...m, owned_by: 'anthropic', capabilities: ['chat'], protocol: 'anthropic-messages', source: 'catalog' })); }
function textOf(v) {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v.filter(x => x?.type === 'text' || x?.type === 'input_text').map(x => x.text || '').join('');
}
function toAnthropic(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const system = messages.filter(m => m.role === 'system').map(m => textOf(m.content)).filter(Boolean).join('\n\n');
  const out = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : (m.content || []) }));
  return { model: body.model || MODELS[1].id, max_tokens: Number(body.max_tokens || body.max_completion_tokens || 4096), ...(system ? { system } : {}), messages: out, stream: body.stream === true, ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools.map(t => ({ name: t.function?.name || t.name, description: t.function?.description || t.description || '', input_schema: t.function?.parameters || t.input_schema || { type: 'object', properties: {} } })) } : {}) };
}
async function refresh(c, force = false) {
  return withLock('claude-refresh', async () => {
    const latest = creds() || c;
    if (!force && latest?.accessToken && latest.expiresAt && Date.now() < latest.expiresAt - REFRESH_LEAD_MS) return latest;
    if (!latest?.refreshToken) throw new HttpError(401, 'Claude 登录已过期，请重新登录', 'authentication_error');
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: latest.refreshToken, scope: 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new HttpError(401, `Claude Token 刷新失败: ${j.error_description || j.error || r.status}`, 'authentication_error');
    const next = { ...latest, accessToken: j.access_token, refreshToken: j.refresh_token || latest.refreshToken, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    writeCreds('claude', next); return next;
  });
}
async function ensure() { const c = creds(); if (!c?.accessToken) throw new HttpError(401, 'Claude 尚未登录，请先登录', 'authentication_error'); return c.expiresAt && Date.now() >= c.expiresAt - REFRESH_LEAD_MS ? refresh(c) : c; }
async function request(path, body, signal) {
  let c = await ensure();
  const run = x => fetch(`${API_BASE}${path}`, { method: 'POST', signal, headers: { Authorization: `Bearer ${x.accessToken}`, 'Content-Type': 'application/json', Accept: body.stream ? 'text/event-stream' : 'application/json', 'anthropic-version': API_VERSION, 'anthropic-beta': OAUTH_BETA, 'User-Agent': 'claude-code/2.1.0' }, body: JSON.stringify(body) });
  let r = await run(c); if (r.status === 401 && c.refreshToken) r = await run(await refresh(c, true)); return r;
}
function mapError(status, text) { let j; try { j = JSON.parse(text); } catch {} return new HttpError(status, j?.error?.message || j?.message || text || `Claude HTTP ${status}`, status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'api_error', j?.error?.type); }
async function chat(_ctx, body, _req, res) {
  const payload = toAnthropic(body); payload.stream = body.stream === true;
  const r = await request('/messages', payload, withTimeoutSignal(null));
  if (!r.ok) throw mapError(r.status, await r.text());
  const id = genId('chatcmpl');
  if (!payload.stream) {
    const j = await r.json();
    const text = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const tools = (j.content || []).filter(x => x.type === 'tool_use').map(x => ({ id: x.id, type: 'function', function: { name: x.name, arguments: JSON.stringify(x.input || {}) } }));
    sendJson(res, buildChatCompletion({ id, model: body.model, text, toolCalls: tools, usage: j.usage, finishReason: j.stop_reason === 'tool_use' ? 'tool_calls' : 'stop' })); return;
  }
  const sse = createChatSse(res, { id, model: body.model }); let usage = null; let tools = [];
  const reader = r.body.getReader(); const decoder = new TextDecoder(); let buf = '';
  try { while (true) { const { value, done } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const parts = buf.split(/\n\n/); buf = parts.pop() || ''; for (const part of parts) { const line = part.split('\n').find(x => x.startsWith('data:')); if (!line) continue; let e; try { e = JSON.parse(line.slice(5).trim()); } catch { continue; } if (e.type === 'message_start') usage = e.message?.usage; else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') sse.text(e.delta.text); else if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') tools.push({ id: e.content_block.id, name: e.content_block.name, arguments: '' }); else if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') sse.toolCallArgs(tools.length - 1, e.delta.partial_json); else if (e.type === 'message_delta') { usage = { ...usage, ...e.usage }; if (tools.length) sse.toolCalls(tools); sse.done(e.delta?.stop_reason === 'tool_use' ? 'tool_calls' : 'stop', usage); } } } } catch (e) { sse.fail(e); }
}
async function startLogin(_ctx, _body) {
  const session = loginManager.begin('claude', 'browser', '正在启动 Claude OAuth…'); const pkce = createPkce();
  const cb = await listenOAuthCallback({ port: 54545, host: undefined, redirectHost: 'localhost', callbackPath: '/callback', expectedState: pkce.state, signal: session.signal });
  const url = `${AUTH_URL}?${new URLSearchParams({ code: 'true', client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPE, state: pkce.state, code_challenge: pkce.challenge, code_challenge_method: 'S256' })}`;
  session.update({ url, message: '请在浏览器中完成 Claude OAuth 登录…' });
  (async () => { try { const { code } = await cb.waitForCode(); const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: pkce.verifier, state: pkce.state }) }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Claude Token 失败 (${r.status})`); writeCreds('claude', { authMode: 'oauth', accessToken: j.access_token, refreshToken: j.refresh_token || '', expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: j.account?.email_address || '', accountId: j.account?.uuid || '', plan: 'Claude' }); session.commitCreds({}); } catch (e) { session.fail(e); } finally { cb.close(); } })();
  return { status: 'pending', mode: 'browser', url, message: '请在浏览器中完成 Claude OAuth 授权' };
}
export default { id: 'claude', name: 'Claude', providerName: '订阅 · Claude', desc: 'Claude Code OAuth / Anthropic Messages', authModes: ['browser'], capabilities: ['chat', 'messages'], usageUrl: 'https://claude.ai/settings/billing', async status() { const c = creds(); return { loggedIn: !!c?.accessToken, account: c?.email || null, expiresAt: c?.expiresAt || null, authMode: c ? 'browser' : null }; }, startLogin, async cancelLogin() { loginManager.cancel('claude'); return { ok: true }; }, async logout() { loginManager.clear('claude'); clearCreds('claude'); return { ok: true }; }, async listModels() { await ensure(); return modelList(); }, chat, async handleExtra(_ctx, tail, req, res) { if (tail !== '/messages' || req.method !== 'POST') throw new HttpError(404, `不支持路径 ${tail}`, 'invalid_request_error'); const body = await readJsonBody(req); const r = await request('/messages', body, withTimeoutSignal(null)); if (!r.ok) throw mapError(r.status, await r.text()); res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }); r.body.pipeTo(new WritableStream({ write(chunk) { res.write(Buffer.from(chunk)); }, close() { res.end(); } })); } };

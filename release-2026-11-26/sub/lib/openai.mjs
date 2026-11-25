import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, type = 'api_error', code = null) {
    super(message);
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

export function withTimeoutSignal(signal, timeoutMs = 120000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function sendJson(res, data, status = 200) {
  if (res.writableEnded || res.destroyed || res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, corsHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }));
  res.end(body);
}

export function sendOpenAiError(res, err) {
  const status = Number(err?.status) || 500;
  const message = err instanceof Error ? err.message : String(err || 'Internal server error');
  const type = err?.type || (
    status === 401 ? 'authentication_error'
      : status === 400 ? 'invalid_request_error'
      : status === 429 ? 'rate_limit_error'
      : 'api_error'
  );
  const code = err?.code || null;
  sendJson(res, { error: { message, type, code } }, status);
}

export async function throwUpstreamError(resp, label = 'Upstream', mapError = null) {
  const rawErr = await resp.text().catch(() => '');
  let parsed = null;
  try { parsed = JSON.parse(rawErr); } catch {}
  const msg = parsed?.error?.message || parsed?.message || parsed?.error || rawErr || `${label} HTTP ${resp.status}`;
  const code = parsed?.error?.code || parsed?.code || null;
  if (mapError) {
    const custom = mapError(resp.status, String(msg), code, parsed);
    if (custom) throw custom;
  }
  throw new HttpError(
    resp.status,
    String(msg),
    resp.status === 401 ? 'authentication_error' : (resp.status === 429 ? 'rate_limit_error' : 'api_error'),
    code,
  );
}

export async function readJsonBody(req, maxBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, 'Request body too large', 'invalid_request_error');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'invalid_request_error');
  }
}

export function genId(prefix = 'chatcmpl') {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

export function parseDataUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  const parts = meta.split(';');
  const mimeType = parts[0] || 'application/octet-stream';
  if (!parts.includes('base64') || !data) return null;
  return { mimeType, data };
}

export function flattenTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.type === 'text' && typeof p.text === 'string' ? p.text : '')))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function normalizeModels(raw, { ownedBy = 'colony-sub', fallback = [] } = {}) {
  const list = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw?.models) ? raw.models : (Array.isArray(raw?.items) ? raw.items : [])));

  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (!m) continue;
    if (typeof m === 'string') {
      const id = m.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, displayName: id, owned_by: ownedBy });
      }
      continue;
    }
    if (typeof m !== 'object') continue;
    if (m.visibility === 'hide' || m.supported_in_api === false) continue;
    const rawId = m.slug || m.id || m.name;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = String(m.displayName || m.display_name || m.title || id).trim();
    const item = {
      id,
      displayName,
      owned_by: m.owned_by || m.provider || ownedBy,
    };
    if (m.description) item.description = String(m.description);
    if (m.created) item.created = m.created;
    if (Array.isArray(m.capabilities) && m.capabilities.length) item.capabilities = [...m.capabilities];
    if (m.protocol) item.protocol = String(m.protocol);
    if (m.source) item.source = String(m.source);
    out.push(item);
  }
  return out.length ? out : (fallback.length ? normalizeModels(fallback, { ownedBy }) : []);
}

export function formatModelList(models = []) {
  const created = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: normalizeModels(models).map((m) => ({
      id: m.id,
      object: 'model',
      created: m.created || created,
      owned_by: m.owned_by || 'colony-sub',
      ...(m.displayName ? { display_name: m.displayName } : {}),
      ...(m.description ? { description: m.description } : {}),
      ...(Array.isArray(m.capabilities) ? { capabilities: m.capabilities } : {}),
      ...(m.protocol ? { protocol: m.protocol } : {}),
      ...(m.source ? { source: m.source } : {}),
    })),
  };
}

export function buildUsage(u) {
  if (!u || typeof u !== 'object') return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? u.promptTokenCount ?? 0) || 0;
  const completion = Number(
    u.completion_tokens ?? u.output_tokens ?? u.outputTokens ??
    ((Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0))
  ) || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(u.total_tokens ?? u.totalTokenCount) || (prompt + completion),
  };
}

export function buildChatCompletion({ id, model, text = '', reasoning = '', toolCalls = [], usage = null, finishReason = null }) {
  const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
  const message = {
    role: 'assistant',
    content: hasTools && !text ? null : text,
  };
  if (reasoning) message.reasoning_content = reasoning;
  if (hasTools) message.tool_calls = toolCalls;
  return {
    id: id || genId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason || (hasTools ? 'tool_calls' : 'stop'),
    }],
    usage: buildUsage(usage),
  };
}

export function createChatSse(res, { id, model }) {
  const completionId = id || genId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);
  let closed = false;
  let started = false;

  const onClose = () => { closed = true; };
  res.on('close', onClose);
  res.on('error', onClose);

  function ensureHeaders() {
    if (started || closed || res.headersSent) return;
    started = true;
    res.writeHead(200, corsHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }));
  }

  function writeChunk(delta, finishReason = null, usage = null) {
    if (closed || res.writableEnded || res.destroyed) return false;
    ensureHeaders();
    const payload = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) payload.usage = buildUsage(usage);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  }

  return {
    get closed() { return closed; },
    get started() { return started; },
    role() {
      writeChunk({ role: 'assistant' });
    },
    thinking(delta) {
      if (delta) writeChunk({ reasoning_content: delta });
    },
    text(delta) {
      if (delta) writeChunk({ content: delta });
    },
    toolCalls(calls) {
      if (!Array.isArray(calls) || !calls.length) return;
      writeChunk({
        tool_calls: calls.map((c, idx) => ({
          index: typeof c.index === 'number' ? c.index : idx,
          id: c.id || genId('call'),
          type: 'function',
          function: {
            name: c.function?.name || c.name,
            arguments: typeof c.function?.arguments === 'string'
              ? c.function.arguments
              : (typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {})),
          },
        })),
      });
    },
    toolCallArgs(index, delta) {
      if (typeof delta === 'string' && delta) {
        writeChunk({ tool_calls: [{ index, function: { arguments: delta } }] });
      }
    },
    rawDelta(delta) {
      if (delta && typeof delta === 'object') writeChunk(delta);
    },
    done(finishReason = 'stop', usage = null) {
      if (closed || res.writableEnded || res.destroyed) return;
      ensureHeaders();
      writeChunk({}, finishReason, usage);
      res.write('data: [DONE]\n\n');
      res.end();
      closed = true;
    },
    fail(err) {
      if (closed || res.writableEnded || res.destroyed) return;
      if (!started && !res.headersSent) {
        sendOpenAiError(res, err);
        closed = true;
        return;
      }
      const message = err instanceof Error ? err.message : String(err || 'Stream error');
      res.write(`data: ${JSON.stringify({ error: { message, type: err?.type || 'api_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      closed = true;
    },
    cleanup() {
      res.off('close', onClose);
      res.off('error', onClose);
    },
  };
}

export async function pipeUpstreamResponse(upstream, res) {
  if (res.writableEnded || res.destroyed) return;
  const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  if (!res.headersSent) {
    res.writeHead(upstream.status, corsHeaders({ 'Content-Type': ct }));
  }
  if (upstream.body) {
    for await (const chunk of upstream.body) {
      if (res.writableEnded || res.destroyed) break;
      res.write(chunk);
    }
  }
  if (!res.writableEnded && !res.destroyed) res.end();
}

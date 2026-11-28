import { Readable } from 'node:stream';
import { HttpError, corsHeaders, genId, pipeUpstreamResponse, sendJson } from './openai.mjs';

const SKIP_REQ_HEADERS = new Set([
  'host', 'origin', 'referer', 'connection', 'keep-alive', 'content-length',
  'transfer-encoding', 'upgrade', 'accept-encoding', 'sec-fetch-site',
  'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
]);

const SKIP_RES_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
  'access-control-allow-credentials', 'access-control-allow-private-network',
]);

export async function handleCorsProxy(req, res, url, requireLoopback) {
  requireLoopback(req, '/proxy');
  const raw = url.searchParams.get('url') || '';
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, '无效的代理目标地址: 请传 ?url=https://...', 'invalid_request_error');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, '代理仅支持 http/https 协议', 'invalid_request_error');
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || SKIP_REQ_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = Array.isArray(v) ? v.join(', ') : v;
  }

  const hasBody = !/^(GET|HEAD)$/i.test(req.method || 'GET');
  let bodyBuf;
  if (hasBody) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodyBuf = Buffer.concat(chunks);
  }

  const ac = new AbortController();
  const onClose = () => { if (!res.writableEnded) ac.abort(); };
  req.on('close', onClose);

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: bodyBuf,
      redirect: 'follow',
      signal: ac.signal,
    });

    const outHeaders = corsHeaders({ 'Access-Control-Allow-Private-Network': 'true' });
    upstream.headers.forEach((v, k) => {
      if (!SKIP_RES_HEADERS.has(k.toLowerCase())) outHeaders[k] = v;
    });
    res.writeHead(upstream.status, outHeaders);
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (res.writableEnded || res.destroyed) break;
        res.write(chunk);
      }
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  } finally {
    req.off('close', onClose);
  }
}

// ── Anthropic Messages <-> OpenAI Chat Completions 翻译（让 Claude Code 等工具可调任意模型）
function anthropicTextOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && (b.type === 'text' || typeof b === 'string'))
    .map((b) => (typeof b === 'string' ? b : b.text || ''))
    .join('\n');
}

export function anthropicToOpenAiBody(body, modelId) {
  const messages = [];
  if (body.system) {
    const sys = anthropicTextOf(body.system);
    if (sys) messages.push({ role: 'system', content: sys });
  }
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.content === 'string') {
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      continue;
    }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text || '').join('');
      const toolCalls = blocks
        .filter((b) => b?.type === 'tool_use')
        .map((b) => ({
          id: b.id || genId('toolu'),
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
        }));
      const msg = { role: 'assistant', content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      messages.push(msg);
      continue;
    }
    const toolResults = blocks.filter((b) => b?.type === 'tool_result');
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id || genId('toolu'),
        content: anthropicTextOf(tr.content) || '(empty)',
      });
    }
    const rest = blocks.filter((b) => b?.type !== 'tool_result');
    if (rest.length) {
      const parts = [];
      for (const b of rest) {
        if (b?.type === 'text') parts.push({ type: 'text', text: b.text || '' });
        else if (b?.type === 'image' && b.source?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${b.source.media_type || 'image/png'};base64,${b.source.data}` },
          });
        }
      }
      if (parts.length === 1 && parts[0].type === 'text') messages.push({ role: 'user', content: parts[0].text });
      else if (parts.length) messages.push({ role: 'user', content: parts });
    }
  }
  const tools = Array.isArray(body.tools) && body.tools.length
    ? body.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }))
    : undefined;
  return {
    model: modelId,
    messages,
    stream: body.stream === true,
    ...(body.max_tokens ? { max_tokens: Number(body.max_tokens) } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    ...(tools ? { tools } : {}),
  };
}

export function openAiJsonToAnthropic(j, modelId) {
  const ch = j?.choices?.[0] || {};
  const msg = ch.message || {};
  const content = [];
  if (msg.reasoning_content) content.push({ type: 'thinking', thinking: msg.reasoning_content });
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch {}
    content.push({ type: 'tool_use', id: tc.id || genId('toolu'), name: tc.function?.name || 'tool', input });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  const stopMap = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn' };
  return {
    id: j.id || genId('msg'),
    type: 'message',
    role: 'assistant',
    model: modelId,
    content,
    stop_reason: stopMap[ch.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Number(j.usage?.prompt_tokens || 0),
      output_tokens: Number(j.usage?.completion_tokens || 0),
    },
  };
}

function createVirtualRes(onOpenAiDone, onOpenAiSseData) {
  let status = 200;
  let contentType = 'application/json';
  const chunks = [];
  let sseBuf = '';
  const listeners = new Map();
  const vres = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return vres; },
    off(ev, fn) { listeners.get(ev)?.delete(fn); return vres; },
    writeHead(code, hdrs = {}) {
      status = code;
      vres.headersSent = true;
      for (const [k, v] of Object.entries(hdrs)) {
        if (k.toLowerCase() === 'content-type') contentType = String(v);
      }
    },
    write(chunk) {
      const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      if (contentType.includes('text/event-stream') && onOpenAiSseData) {
        sseBuf += str;
        let idx;
        while ((idx = sseBuf.indexOf('\n\n')) >= 0) {
          const block = sseBuf.slice(0, idx);
          sseBuf = sseBuf.slice(idx + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload) onOpenAiSseData(payload);
          }
        }
      } else {
        chunks.push(str);
      }
      return true;
    },
    end(chunk) {
      if (chunk) vres.write(chunk);
      vres.writableEnded = true;
      if (onOpenAiDone) onOpenAiDone(status, contentType, chunks.join(''));
    },
  };
  return vres;
}

export async function runAnthropicViaOpenAi(runOpenAi, anthropicBody, modelId, res) {
  const oaBody = anthropicToOpenAiBody(anthropicBody, modelId);
  const msgId = genId('msg');

  if (!oaBody.stream) {
    let donePayload = null;
    const vres = createVirtualRes((status, _ct, text) => {
      donePayload = { status, text };
    });
    await runOpenAi(oaBody, vres);
    if (!donePayload) throw new HttpError(502, '上游未返回响应', 'api_error');
    if (donePayload.status >= 400) {
      let msg = donePayload.text;
      try { msg = JSON.parse(donePayload.text)?.error?.message || msg; } catch {}
      throw new HttpError(donePayload.status, msg, 'api_error');
    }
    const parsed = JSON.parse(donePayload.text || '{}');
    sendJson(res, openAiJsonToAnthropic(parsed, modelId));
    return;
  }

  let started = false;
  let blockIdx = -1;
  let curKind = '';
  const toolBlocks = new Map();
  let finishReason = 'end_turn';
  let usage = { input_tokens: 0, output_tokens: 0 };

  const emit = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    if (!started) {
      started = true;
      res.writeHead(200, corsHeaders({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      }));
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: msgId, type: 'message', role: 'assistant', model: modelId,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n\n`);
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const closeCurBlock = () => {
    if (curKind) {
      emit('content_block_stop', { type: 'content_block_stop', index: blockIdx });
      curKind = '';
    }
  };

  const stopMap = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn' };
  const vres = createVirtualRes(
    (status, _ct, text) => {
      if (status >= 400 && !started) {
        sendJson(res, { type: 'error', error: { type: 'api_error', message: text || `HTTP ${status}` } }, status);
        return;
      }
      closeCurBlock();
      for (const tb of toolBlocks.values()) {
        if (!tb.closed) {
          emit('content_block_stop', { type: 'content_block_stop', index: tb.index });
          tb.closed = true;
        }
      }
      if (started && !res.writableEnded) {
        emit('message_delta', { type: 'message_delta', delta: { stop_reason: finishReason, stop_sequence: null }, usage });
        emit('message_stop', { type: 'message_stop' });
        res.end();
      }
    },
    (payload) => {
      if (payload === '[DONE]') return;
      let j;
      try { j = JSON.parse(payload); } catch { return; }
      if (j.error && !started) {
        sendJson(res, { type: 'error', error: { type: j.error.type || 'api_error', message: j.error.message || JSON.stringify(j.error) } }, 502);
        return;
      }
      if (j.usage) {
        usage = {
          input_tokens: Number(j.usage.prompt_tokens || usage.input_tokens || 0),
          output_tokens: Number(j.usage.completion_tokens || usage.output_tokens || 0),
        };
      }
      const ch = j.choices?.[0];
      if (!ch) return;
      if (ch.finish_reason) finishReason = stopMap[ch.finish_reason] || 'end_turn';
      const d = ch.delta || {};
      if (d.reasoning_content) {
        if (curKind !== 'thinking') {
          closeCurBlock();
          blockIdx++;
          curKind = 'thinking';
          emit('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'thinking', thinking: '' } });
        }
        emit('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'thinking_delta', thinking: d.reasoning_content } });
      }
      if (d.content) {
        if (curKind !== 'text') {
          closeCurBlock();
          blockIdx++;
          curKind = 'text';
          emit('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'text', text: '' } });
        }
        emit('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: d.content } });
      }
      if (Array.isArray(d.tool_calls)) {
        closeCurBlock();
        for (const tc of d.tool_calls) {
          const ti = Number(tc.index ?? 0);
          let tb = toolBlocks.get(ti);
          if (!tb) {
            blockIdx++;
            tb = { index: blockIdx, closed: false };
            toolBlocks.set(ti, tb);
            emit('content_block_start', {
              type: 'content_block_start',
              index: tb.index,
              content_block: { type: 'tool_use', id: tc.id || genId('toolu'), name: tc.function?.name || 'tool', input: {} },
            });
          }
          if (tc.function?.arguments) {
            emit('content_block_delta', {
              type: 'content_block_delta',
              index: tb.index,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            });
          }
        }
      }
    },
  );
  await runOpenAi(oaBody, vres);
}

export function makeReplayReq(req, buf, methodOverride) {
  const s = Readable.from(buf && buf.length ? [buf] : []);
  s.headers = req.headers;
  s.method = methodOverride || req.method;
  s.url = req.url;
  s.socket = req.socket;
  return s;
}

export function estimateTokens(body) {
  const raw = JSON.stringify({ system: body?.system, messages: body?.messages, tools: body?.tools }) || '';
  let cjk = 0, rest = 0;
  for (let i = 0; i < raw.length; i++) (raw.charCodeAt(i) > 0x7f ? cjk++ : rest++);
  return Math.max(1, Math.ceil(cjk * 0.7 + rest / 3.8));
}

export async function forwardToProvider(provider, tail, method, body, req, res, rawContentType) {
  const url = `${provider.endpoint}${tail}`;
  const headers = { Accept: req.headers?.accept || 'application/json, text/event-stream' };
  if (provider.protocol === 'anthropic') {
    if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = req.headers['anthropic-version'] || '2023-06-01';
  } else if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  const init = { method, headers };
  if (body !== undefined && body !== null && !/^(GET|HEAD)$/i.test(method)) {
    if (Buffer.isBuffer(body)) {
      if (rawContentType) headers['Content-Type'] = rawContentType;
      init.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }
  const ac = new AbortController();
  const onClose = () => { if (!res.writableEnded) ac.abort(); };
  req.on('close', onClose);
  init.signal = ac.signal;
  try {
    const upstream = await fetch(url, init);
    await pipeUpstreamResponse(upstream, res);
  } finally {
    req.off('close', onClose);
  }
}

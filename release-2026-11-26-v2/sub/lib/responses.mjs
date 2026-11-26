import {
  HttpError,
  buildChatCompletion,
  buildUsage,
  createChatSse,
  flattenTextContent,
  genId,
  sendJson,
  throwUpstreamError,
  withTimeoutSignal,
} from './openai.mjs';

export function decodeJwtClaims(jwt) {
  try {
    const parts = String(jwt || '').split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export async function parseSseEvents(bodyStream, onEvent) {
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = '';
  let dataLines = [];

  const flush = () => {
    if (!dataLines.length) {
      eventName = '';
      return;
    }
    const raw = dataLines.join('\n').trim();
    const ev = eventName;
    eventName = '';
    dataLines = [];
    if (!raw || raw === '[DONE]') return;
    try {
      const parsed = JSON.parse(raw);
      onEvent(ev || parsed.type || '', parsed);
    } catch {}
  };

  for await (const chunk of bodyStream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') flush();
      else if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
  }
  buf += decoder.decode();
  if (buf.trim()) {
    for (const line of buf.split(/\r?\n/)) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    flush();
  }
}

export function chatToResponsesRequest(body, {
  defaultModel = 'gpt-5',
  stripSampling = false,
  extractInstructions = false,
  alwaysInstructions = false,
} = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new HttpError(400, 'messages 不能为空', 'invalid_request_error');

  const input = [];
  const instructionParts = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user').toLowerCase();

    if (role === 'tool') {
      const output = typeof msg.content === 'string'
        ? msg.content
        : (flattenTextContent(msg.content) || JSON.stringify(msg.content ?? ''));
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id || genId('call'),
        output,
      });
      continue;
    }

    if ((role === 'system' || role === 'developer') && extractInstructions) {
      const txt = flattenTextContent(msg.content).trim();
      if (txt) instructionParts.push(txt);
      continue;
    }

    const mappedRole = role === 'system' ? 'developer' : (role === 'assistant' ? 'assistant' : 'user');
    const textType = mappedRole === 'assistant' ? 'output_text' : 'input_text';
    const contentParts = [];

    if (typeof msg.content === 'string') {
      if (msg.content) contentParts.push({ type: textType, text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const p of msg.content) {
        if (!p) continue;
        if (typeof p === 'string') contentParts.push({ type: textType, text: p });
        else if (p.type === 'text' && typeof p.text === 'string') contentParts.push({ type: textType, text: p.text });
        else if (p.type === 'image_url' && mappedRole !== 'assistant') {
          const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
          if (url) contentParts.push({ type: 'input_image', image_url: url });
        }
      }
    }

    if (contentParts.length) {
      input.push({ type: 'message', role: mappedRole, content: contentParts });
    }

    if (mappedRole === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = tc?.function || tc;
        if (!fn?.name) continue;
        input.push({
          type: 'function_call',
          call_id: tc.id || genId('call'),
          name: fn.name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}),
        });
      }
    }
  }

  const out = {
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel,
    input,
    stream: true,
    store: false,
  };

  if (instructionParts.length) out.instructions = instructionParts.join('\n\n');
  else if (alwaysInstructions) out.instructions = '';

  if (Array.isArray(body.tools) && body.tools.length) {
    const tools = [];
    for (const t of body.tools) {
      if (t?.type === 'function' && t.function?.name) {
        tools.push({
          type: 'function',
          name: t.function.name,
          description: t.function.description || '',
          parameters: t.function.parameters || { type: 'object', properties: {} },
        });
      } else if (!stripSampling && t) {
        tools.push(t);
      }
    }
    if (tools.length) {
      out.tools = tools;
      if (body.tool_choice !== undefined) {
        if (typeof body.tool_choice === 'string') out.tool_choice = body.tool_choice;
        else if (body.tool_choice?.type === 'function' && body.tool_choice.function?.name) {
          out.tool_choice = { type: 'function', name: body.tool_choice.function.name };
        }
      }
    }
  }

  if (body.parallel_tool_calls !== undefined) out.parallel_tool_calls = Boolean(body.parallel_tool_calls);

  if (!stripSampling) {
    if (typeof body.temperature === 'number') out.temperature = body.temperature;
    if (typeof body.top_p === 'number') out.top_p = body.top_p;
    if (typeof body.max_completion_tokens === 'number') out.max_output_tokens = body.max_completion_tokens;
    else if (typeof body.max_tokens === 'number') out.max_output_tokens = body.max_tokens;
  }

  const effort = body.reasoning_effort || body.reasoning?.effort;
  if (effort && effort !== 'none') {
    out.reasoning = { effort, summary: 'auto' };
  }

  return out;
}

export const normalizeResponsesUsage = buildUsage;

export async function handleResponsesChat({
  body,
  req,
  res,
  defaultModel,
  providerLabel,
  stripSampling = false,
  extractInstructions = false,
  alwaysInstructions = false,
  fetchResponses,
  mapUpstreamError,
}) {
  const modelId = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel;
  const stream = body?.stream === true;
  const payload = chatToResponsesRequest(body, { defaultModel, stripSampling, extractInstructions, alwaysInstructions });
  const completionId = genId('chatcmpl');
  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on('close', onClose);

  const sse = stream ? createChatSse(res, { id: completionId, model: modelId }) : null;

  try {
    const upstream = await fetchResponses(payload, withTimeoutSignal(ac.signal, 180000));
    if (!upstream.ok) {
      await throwUpstreamError(upstream, providerLabel, mapUpstreamError);
    }

    let roleSent = false;
    let text = '';
    let reasoning = '';
    let usage = null;
    const toolCallIndexByItem = new Map();
    const toolCalls = [];
    let nextToolIndex = 0;

    const emitRole = () => {
      if (sse && !roleSent) {
        sse.role();
        roleSent = true;
      }
    };

    const ensureToolSlot = (itemId, callId, name) => {
      let idx = toolCallIndexByItem.get(itemId);
      if (idx === undefined) {
        idx = nextToolIndex++;
        toolCallIndexByItem.set(itemId, idx);
        toolCalls[idx] = {
          index: idx,
          id: callId || genId('call'),
          type: 'function',
          function: { name: name || '', arguments: '' },
        };
      } else {
        if (callId && !toolCalls[idx].id) toolCalls[idx].id = callId;
        if (name && !toolCalls[idx].function.name) toolCalls[idx].function.name = name;
      }
      return idx;
    };

    await parseSseEvents(upstream.body, (evType, data) => {
      const t = data?.type || evType;
      if (t === 'response.output_text.delta' && typeof data.delta === 'string') {
        text += data.delta;
        if (sse) { emitRole(); sse.text(data.delta); }
      } else if (
        (t === 'response.reasoning_summary_text.delta' || t === 'response.reasoning_text.delta')
        && typeof data.delta === 'string'
      ) {
        reasoning += data.delta;
        if (sse) { emitRole(); sse.thinking(data.delta); }
      } else if (t === 'response.output_item.added' && data.item?.type === 'function_call') {
        const item = data.item;
        const idx = ensureToolSlot(item.id || String(data.output_index ?? nextToolIndex), item.call_id, item.name);
        if (sse) {
          emitRole();
          const tc = toolCalls[idx];
          sse.toolCalls([{ index: idx, id: tc.id, name: tc.function.name, arguments: '' }]);
        }
      } else if (t === 'response.function_call_arguments.delta' && typeof data.delta === 'string') {
        const key = data.item_id || String(data.output_index ?? 0);
        const idx = ensureToolSlot(key, data.call_id, data.name);
        toolCalls[idx].function.arguments += data.delta;
        if (sse) { emitRole(); sse.toolCallArgs(idx, data.delta); }
      } else if (t === 'response.output_item.done' && data.item?.type === 'function_call') {
        const item = data.item;
        const key = item.id || String(data.output_index ?? 0);
        const idx = ensureToolSlot(key, item.call_id, item.name);
        if (!toolCalls[idx].function.arguments && typeof item.arguments === 'string') {
          toolCalls[idx].function.arguments = item.arguments;
        }
      } else if (t === 'response.completed' && data.response) {
        if (data.response.usage) usage = buildUsage(data.response.usage);
        if (!text && !toolCalls.length && Array.isArray(data.response.output)) {
          for (const item of data.response.output) {
            if (item.type === 'message' && Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c.type === 'output_text' && c.text) text += c.text;
              }
            } else if (item.type === 'function_call') {
              const idx = ensureToolSlot(item.id || genId('fc'), item.call_id, item.name);
              toolCalls[idx].function.arguments = typeof item.arguments === 'string'
                ? item.arguments
                : JSON.stringify(item.arguments || {});
            }
          }
        }
      } else if (t === 'response.failed' || t === 'error') {
        const errObj = data?.response?.error || data?.error || {};
        const errMsg = errObj.message || data?.message || `${providerLabel} response failed`;
        const errCode = errObj.code || null;
        if (mapUpstreamError) {
          const custom = mapUpstreamError(502, String(errMsg), errCode, data);
          if (custom) throw custom;
        }
        throw new HttpError(502, String(errMsg), 'api_error', errCode);
      }
    });

    const finalTools = toolCalls.filter(Boolean).map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments || '{}',
      },
    }));

    if (sse) {
      emitRole();
      sse.done(finalTools.length ? 'tool_calls' : 'stop', usage);
    } else {
      sendJson(res, buildChatCompletion({
        id: completionId,
        model: modelId,
        text,
        reasoning,
        toolCalls: finalTools,
        usage,
      }));
    }
  } catch (err) {
    if (ac.signal.aborted) return;
    const mapped = err instanceof HttpError ? err : new HttpError(502, err?.message || String(err), 'api_error');
    if (sse) sse.fail(mapped);
    else throw mapped;
  } finally {
    req.off('close', onClose);
    if (sse) sse.cleanup();
  }
}

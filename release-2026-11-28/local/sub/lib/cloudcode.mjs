import crypto from 'node:crypto';
import { HttpError, buildChatCompletion, createChatSse, genId, sendJson } from './openai.mjs';
import { parseSseEvents } from './responses.mjs';

const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

const DROP_SCHEMA_KEYS = [
  '$schema', '$id', '$ref', '$defs', 'definitions',
  'additionalProperties', 'strict', 'default', 'title',
  'examples', 'exclusiveMinimum', 'exclusiveMaximum',
  'propertyNames', 'patternProperties', 'const',
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems',
];

export function cleanCloudCodeSchema(schema, isClaude) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const s = JSON.parse(JSON.stringify(schema));

  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1));

    for (const unionKey of ['anyOf', 'oneOf']) {
      if (Array.isArray(node[unionKey])) {
        const nonNull = node[unionKey].filter((b) => b && b.type !== 'null');
        if (isClaude || nonNull.length === 1) {
          const picked = nonNull[0] || node[unionKey][0] || { type: 'string' };
          const desc = node.description;
          delete node[unionKey];
          Object.assign(node, picked);
          if (desc && !node.description) node.description = desc;
        }
      }
    }

    if (Array.isArray(node.type)) {
      node.type = node.type.find((t) => t !== 'null') || 'string';
    }

    for (const k of DROP_SCHEMA_KEYS) delete node[k];

    if (node.properties && typeof node.properties === 'object') {
      const nextProps = {};
      for (const [k, v] of Object.entries(node.properties)) {
        nextProps[k] = walk(v, depth + 1);
      }
      node.properties = nextProps;
      if (Array.isArray(node.required)) {
        node.required = node.required.filter((r) => Object.prototype.hasOwnProperty.call(nextProps, r));
        if (!node.required.length) delete node.required;
      }
    }

    if (node.items) node.items = walk(node.items, depth + 1);

    if (node.type === 'object' && (!node.properties || !Object.keys(node.properties).length)) {
      node.properties = isClaude ? { _unused: { type: 'string', description: 'placeholder' } } : {};
    }

    return node;
  };

  const cleaned = walk(s, 0);
  if (!cleaned.type) cleaned.type = 'object';
  if (cleaned.type === 'object' && !cleaned.properties) cleaned.properties = {};
  return cleaned;
}

function parseDataUrl(url) {
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

function deriveStableSessionId(contents, email) {
  let firstUserText = '';
  for (const c of contents) {
    if (c.role !== 'user' || !Array.isArray(c.parts)) continue;
    for (const p of c.parts) {
      if (typeof p.text === 'string' && p.text) {
        firstUserText = p.text;
        break;
      }
    }
    if (firstUserText) break;
  }
  if (!firstUserText) {
    return `-${crypto.randomInt(1, 9_000_000_000_000)}`;
  }
  const hash = crypto.createHash('sha256')
    .update(`colony-sub:antigravity:${email || ''}\0${firstUserText}`)
    .digest();
  const val = hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${val.toString()}`;
}

export function chatToCloudCodeRequest(body, creds, defaultModel = 'gemini-4-argon-high') {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new HttpError(400, 'messages 不能为空', 'invalid_request_error');

  const modelId = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel;
  const lowerModel = modelId.toLowerCase();
  const isClaude = lowerModel.includes('claude');
  const isImage = lowerModel.includes('image');

  const systemParts = [];
  const contents = [];
  let seenConversation = false;

  const pushContent = (role, parts) => {
    if (!parts.length) return;
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else contents.push({ role, parts });
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user').toLowerCase();

    if ((role === 'system' || role === 'developer') && messages.length > 1 && !seenConversation) {
      if (typeof msg.content === 'string' && msg.content) {
        systemParts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (typeof p === 'string' && p) systemParts.push({ text: p });
          else if (p?.type === 'text' && p.text) systemParts.push({ text: p.text });
        }
      }
      continue;
    }

    if (role === 'user' || role === 'system' || role === 'developer') {
      seenConversation = true;
      const parts = [];
      if (typeof msg.content === 'string') {
        if (msg.content) parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (!p) continue;
          if (typeof p === 'string') parts.push({ text: p });
          else if (p.type === 'text' && typeof p.text === 'string' && p.text) parts.push({ text: p.text });
          else if (p.type === 'image_url') {
            const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
            const parsed = parseDataUrl(url);
            if (parsed) parts.push({ inlineData: parsed });
          } else if (p.type === 'input_audio' && p.input_audio?.data) {
            const fmt = String(p.input_audio.format || 'wav').toLowerCase();
            const mime = fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}`;
            parts.push({ inlineData: { mimeType: mime, data: p.input_audio.data } });
          }
        }
      }
      pushContent('user', parts);
      continue;
    }

    if (role === 'assistant') {
      seenConversation = true;
      const parts = [];
      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
        parts.push({ text: msg.reasoning_content, thought: true });
      }
      if (typeof msg.content === 'string' && msg.content) {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (p?.type === 'text' && p.text) parts.push({ text: p.text });
          else if (p?.type === 'image_url') {
            const parsed = parseDataUrl(typeof p.image_url === 'string' ? p.image_url : p.image_url?.url);
            if (parsed) parts.push({ inlineData: parsed });
          }
        }
      }

      const calls = [];
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fn = tc?.function || tc;
          if (!fn?.name) continue;
          const id = tc.id || genId('call');
          let argsObj = {};
          if (typeof fn.arguments === 'string') {
            try { argsObj = JSON.parse(fn.arguments || '{}'); } catch { argsObj = { params: fn.arguments }; }
          } else if (fn.arguments && typeof fn.arguments === 'object') {
            argsObj = fn.arguments;
          }
          parts.push({
            functionCall: { id, name: fn.name, args: argsObj },
            thoughtSignature: SKIP_THOUGHT_SIGNATURE,
          });
          calls.push({ id, name: fn.name });
        }
      }

      pushContent('model', parts);

      if (calls.length) {
        const respByCallId = new Map();
        for (let j = i + 1; j < messages.length; j++) {
          const r = String(messages[j]?.role || '').toLowerCase();
          if (r === 'assistant') break;
          if (r === 'tool' && messages[j].tool_call_id) {
            const raw = messages[j].content;
            respByCallId.set(messages[j].tool_call_id, typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''));
          }
        }
        pushContent('user', calls.map((c) => ({
          functionResponse: {
            id: c.id,
            name: c.name,
            response: { result: respByCallId.get(c.id) || '{}' },
          },
        })));
      }
    }
  }

  if (!isClaude) {
    if (!contents.length || contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: '' }] });
    }
    if (contents[contents.length - 1].role !== 'user') {
      contents.push({ role: 'user', parts: [{ text: '' }] });
    }
  }

  const generationConfig = {};
  if (typeof body.temperature === 'number') generationConfig.temperature = body.temperature;
  if (typeof body.top_p === 'number') generationConfig.topP = body.top_p;
  if (typeof body.top_k === 'number') generationConfig.topK = body.top_k;
  if (isClaude) {
    const maxTok = typeof body.max_completion_tokens === 'number'
      ? body.max_completion_tokens
      : (typeof body.max_tokens === 'number' ? body.max_tokens : null);
    if (maxTok) generationConfig.maxOutputTokens = Math.min(maxTok, 64000);
  }

  const effort = String(body.reasoning_effort || body.reasoning?.effort || '').toLowerCase().trim();
  if (effort && effort !== 'none') {
    generationConfig.thinkingConfig = effort === 'auto'
      ? { includeThoughts: true, thinkingBudget: -1 }
      : { includeThoughts: true, thinkingLevel: effort };
  }

  if (body.response_format?.type === 'json_object' || body.response_format?.type === 'json_schema') {
    generationConfig.responseMimeType = 'application/json';
    if (body.response_format.type === 'json_schema' && body.response_format.json_schema?.schema) {
      generationConfig.responseSchema = cleanCloudCodeSchema(body.response_format.json_schema.schema, false);
    }
  }

  if (Array.isArray(body.modalities) && body.modalities.length) {
    const mods = [];
    for (const m of body.modalities) {
      const lm = String(m).toLowerCase();
      if (lm === 'text') mods.push('TEXT');
      else if (lm === 'image') mods.push('IMAGE');
    }
    if (mods.length) generationConfig.responseModalities = mods;
  }

  if (body.image_config && typeof body.image_config === 'object') {
    const ic = {};
    if (body.image_config.aspect_ratio) ic.aspectRatio = body.image_config.aspect_ratio;
    if (body.image_config.image_size) ic.imageSize = body.image_config.image_size;
    if (Object.keys(ic).length) generationConfig.imageConfig = ic;
  }

  const requestObj = { contents };
  if (systemParts.length) requestObj.systemInstruction = { role: 'user', parts: systemParts };
  if (Object.keys(generationConfig).length) requestObj.generationConfig = generationConfig;

  if (Array.isArray(body.tools) && body.tools.length) {
    const fnDecls = [];
    const extraTools = [];
    for (const t of body.tools) {
      if (t?.type === 'function' && t.function?.name) {
        fnDecls.push({
          name: t.function.name,
          description: t.function.description || '',
          parameters: cleanCloudCodeSchema(t.function.parameters, isClaude),
        });
      } else if (t?.google_search) {
        extraTools.push({ googleSearch: t.google_search });
      }
    }
    const toolsOut = [];
    if (fnDecls.length) toolsOut.push({ functionDeclarations: fnDecls });
    toolsOut.push(...extraTools);
    if (toolsOut.length) {
      requestObj.tools = toolsOut;
      if (isClaude && !body.response_format) {
        requestObj.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
      }
    }
  }

  if (!isImage) {
    requestObj.sessionId = deriveStableSessionId(contents, creds?.email);
  }

  return {
    project: creds?.projectId || '',
    model: modelId,
    userAgent: 'antigravity',
    requestType: isImage ? 'image_gen' : 'agent',
    requestId: isImage
      ? `image_gen/${Date.now()}/${crypto.randomUUID()}/12`
      : `agent-${crypto.randomUUID()}`,
    request: requestObj,
  };
}

function mapFinishReason(upstreamReason, hasToolCalls) {
  if (hasToolCalls) return 'tool_calls';
  const r = String(upstreamReason || '').toUpperCase();
  if (r === 'MAX_TOKENS') return 'length';
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(r)) {
    return 'content_filter';
  }
  return 'stop';
}

function mapUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const prompt = Number(u.promptTokenCount) || 0;
  const cand = Number(u.candidatesTokenCount) || 0;
  const thoughts = Number(u.thoughtsTokenCount) || 0;
  const completion = cand + thoughts;
  const total = Number(u.totalTokenCount) || (prompt + completion);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

export async function handleCloudCodeChat({
  body,
  req,
  res,
  creds,
  defaultModel = 'gemini-4-argon-high',
  fetchStream,
}) {
  const modelId = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel;
  const stream = body?.stream === true;
  const payload = chatToCloudCodeRequest(body, creds, defaultModel);
  const completionId = genId('chatcmpl');
  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on('close', onClose);

  const sse = stream ? createChatSse(res, { id: completionId, model: modelId }) : null;

  try {
    const upstream = await fetchStream(payload, ac.signal);
    if (!upstream.ok) {
      const rawErr = await upstream.text().catch(() => '');
      let msg = rawErr || `Antigravity HTTP ${upstream.status}`;
      try {
        const parsed = JSON.parse(rawErr);
        msg = parsed?.error?.message || parsed?.message || msg;
      } catch {}
      throw new HttpError(
        upstream.status,
        String(msg),
        upstream.status === 401 ? 'authentication_error' : 'api_error',
      );
    }

    let roleSent = false;
    let text = '';
    let reasoning = '';
    let usage = null;
    let finishReason = '';
    const toolCalls = [];
    let toolIndex = 0;

    const emitRole = () => {
      if (sse && !roleSent) {
        sse.role();
        roleSent = true;
      }
    };

    await parseSseEvents(upstream.body, (_ev, chunk) => {
      if (chunk?.error) {
        const code = Number(chunk.error.code) || 502;
        throw new HttpError(code >= 400 && code < 600 ? code : 502, chunk.error.message || JSON.stringify(chunk.error), 'api_error');
      }
      const r = chunk?.response || chunk;
      if (!r || typeof r !== 'object') return;
      if (r.usageMetadata) usage = mapUsage(r.usageMetadata);

      const cand = Array.isArray(r.candidates) ? r.candidates[0] : null;
      if (cand?.finishReason) finishReason = cand.finishReason;

      const parts = cand?.content?.parts;
      if (!Array.isArray(parts)) return;

      for (const p of parts) {
        if (!p || typeof p !== 'object') continue;
        if (typeof p.text === 'string' && p.text) {
          if (p.thought) {
            reasoning += p.text;
            if (sse) { emitRole(); sse.thinking(p.text); }
          } else {
            text += p.text;
            if (sse) { emitRole(); sse.text(p.text); }
          }
        } else if (p.functionCall?.name) {
          const idx = toolIndex++;
          const fcId = p.functionCall.id || genId('call');
          const argsStr = typeof p.functionCall.args === 'string'
            ? p.functionCall.args
            : JSON.stringify(p.functionCall.args || {});
          toolCalls.push({
            id: fcId,
            type: 'function',
            function: { name: p.functionCall.name, arguments: argsStr },
          });
          if (sse) {
            emitRole();
            sse.toolCalls([{ index: idx, id: fcId, name: p.functionCall.name, arguments: argsStr }]);
          }
        } else if (p.inlineData?.data && !p.thought) {
          const mime = p.inlineData.mimeType || p.inlineData.mime_type || 'image/png';
          const dataUrl = `data:${mime};base64,${p.inlineData.data}`;
          if (sse) {
            emitRole();
            sse.rawDelta({ images: [{ index: 0, type: 'image_url', image_url: { url: dataUrl } }] });
          }
        }
      }
    });

    const finalReason = mapFinishReason(finishReason, toolCalls.length > 0);
    if (sse) {
      emitRole();
      sse.done(finalReason, usage);
    } else {
      sendJson(res, buildChatCompletion({
        id: completionId,
        model: modelId,
        text,
        reasoning,
        toolCalls,
        usage,
        finishReason: finalReason,
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

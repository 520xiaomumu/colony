import crypto from 'node:crypto';
import { clearCreds, loginManager, readCreds, withLock, writeCreds } from '../lib/store.mjs';
import { HttpError, buildChatCompletion, createChatSse, genId, sendJson } from '../lib/openai.mjs';
import { listenOAuthCallback } from '../lib/oauth-callback.mjs';
import { parseSseEvents } from '../lib/responses.mjs';

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('-');
const DEFAULT_CALLBACK_PORT = 51121;
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/aicode',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo?alt=json';
const DAILY_API_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
const API_VERSION = 'v1internal';
const REFRESH_LEAD_MS = 5 * 60 * 1000;

const HUB_MANIFEST_URL = 'https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/latest-arm64-mac.yml';
const HUB_CHANGELISTS = {
  '2.23.0': '998057262',
  '2.24.0': '1000335682',
  '2.29.0': '1013060670',
  '2.32.1': '1021296516',
  '2.32.2': '1022991777',
  '2.33.0': '1023160026',
  '2.34.0': '1026637980',
};
const FALLBACK_VERSION = '2.34.0';
const NODE_API_CLIENT_UA = 'google-api-nodejs-client/10.3.0';
const GOOG_API_CLIENT_UA = 'gl-node/22.21.1';
const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

const ANTIGRAVITY_MODELS = [
  { id: 'gemini-4-neon-xhigh', displayName: 'Gemini 4 Neon', owned_by: 'antigravity' },
  { id: 'gemini-4-hydrogen-xhigh', displayName: 'Gemini 4 Hydrogen', owned_by: 'antigravity' },
  { id: 'gemini-4-argon-high', displayName: 'Gemini 4 Argon', owned_by: 'antigravity' },
  { id: 'gemini-4-carbon-high', displayName: 'Gemini 4 Carbon', owned_by: 'antigravity' },
  { id: 'claude-opus-5-5-high', displayName: 'Claude Opus 5.5 (High)', owned_by: 'antigravity' },
  { id: 'claude-sonnet-5-5-high', displayName: 'Claude Sonnet 5.5 (High)', owned_by: 'antigravity' },
  { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', owned_by: 'antigravity' },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', owned_by: 'antigravity' },
  { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash', owned_by: 'antigravity' },
  { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash (Tiered)', owned_by: 'antigravity' },
  { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite', owned_by: 'antigravity' },
  { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash', owned_by: 'antigravity' },
  { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', owned_by: 'antigravity' },
  { id: 'gemini-3.1-flash-image', displayName: 'Gemini 3.1 Flash Image', owned_by: 'antigravity' },
  { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', owned_by: 'antigravity' },
];

let cachedVersion = FALLBACK_VERSION;
let versionFetchedAt = 0;

function resolveVersionAndCL(ver) {
  if (HUB_CHANGELISTS[ver]) return { version: ver, cl: HUB_CHANGELISTS[ver] };
  return { version: FALLBACK_VERSION, cl: HUB_CHANGELISTS[FALLBACK_VERSION] };
}

async function getHubUserAgent() {
  if (Date.now() - versionFetchedAt > 6 * 60 * 60 * 1000) {
    versionFetchedAt = Date.now();
    try {
      const r = await fetch(HUB_MANIFEST_URL, {
        headers: { 'User-Agent': 'electron-builder', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const txt = await r.text();
        const m = txt.match(/^\s*version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m);
        if (m && HUB_CHANGELISTS[m[1]]) cachedVersion = m[1];
      }
    } catch {}
  }
  const { version, cl } = resolveVersionAndCL(cachedVersion);
  return {
    version,
    shortUA: `antigravity/hub/${version} (aidev_client; os_type=darwin; arch=arm64; cl=${cl})`,
    longUA: `antigravity/hub/${version} (aidev_client; os_type=darwin; arch=arm64; cl=${cl}) ${NODE_API_CLIENT_UA}`,
  };
}

function getCreds() {
  const c = readCreds('antigravity');
  if (!c || !c.accessToken) return null;
  return c;
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
  const r = await fetch(USERINFO_ENDPOINT, {
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
    metadata: {
      ide_type: 'ANTIGRAVITY',
      ide_version: version,
      ide_name: 'antigravity',
    },
  });
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await fetch(`${DAILY_API_ENDPOINT}/${API_VERSION}:onboardUser`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
        'Content-Type': 'application/json',
        'User-Agent': longUA,
        'X-Goog-Api-Client': GOOG_API_CLIENT_UA,
      },
      body,
      signal,
    });
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      throw new Error(`Antigravity onboardUser 失败 (HTTP ${r.status}): ${text.slice(0, 300)}`);
    }
    const data = JSON.parse(text || '{}');
    if (data.done) {
      if (data.error) {
        const msg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
        throw new Error(`Antigravity onboard 失败: ${msg}`);
      }
      const pid = extractProjectId(data.response);
      if (pid) return pid;
      throw new Error('Antigravity 未返回 project_id');
    }
    if (attempt < 5) await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error('Antigravity onboard 超时未完成');
}

async function fetchProjectId(accessToken, uaInfo, signal) {
  const r = await fetch(`${DAILY_API_ENDPOINT}/${API_VERSION}:loadCodeAssist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': uaInfo.shortUA,
    },
    body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    signal,
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    throw new Error(`Antigravity loadCodeAssist 失败 (HTTP ${r.status}): ${text.slice(0, 300)}`);
  }
  const loadResp = JSON.parse(text || '{}');
  const pid = extractProjectId(loadResp);
  if (pid) return pid;
  return onboardUser(accessToken, pickDefaultTierId(loadResp), uaInfo, signal);
}

async function refreshAccessToken(creds) {
  return withLock('antigravity-refresh', async () => {
    const latest = readCreds('antigravity') || creds;
    if (latest?.accessToken && latest.expiresAt && Date.now() < latest.expiresAt - REFRESH_LEAD_MS && latest.projectId) {
      return latest;
    }
    if (!latest?.refreshToken) {
      throw new HttpError(401, 'Antigravity 登录已过期，请重新登录', 'authentication_error');
    }
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: latest.refreshToken,
    });
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) {
      const desc = data.error_description || data.error || `HTTP ${resp.status}`;
      throw new HttpError(401, `Antigravity 刷新 Token 失败: ${desc}`, 'authentication_error');
    }
    const updated = {
      ...latest,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || latest.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    if (!updated.projectId) {
      const uaInfo = await getHubUserAgent();
      updated.projectId = await fetchProjectId(updated.accessToken, uaInfo);
    }
    writeCreds('antigravity', updated);
    return updated;
  });
}

async function ensureAuth() {
  const c = getCreds();
  if (!c) throw new HttpError(401, 'Antigravity 尚未登录，请先在订阅中心点击登录', 'authentication_error');
  if ((c.expiresAt && Date.now() >= c.expiresAt - REFRESH_LEAD_MS) || !c.projectId) {
    return refreshAccessToken(c);
  }
  return c;
}

// Sanitize JSON schema so Antigravity Gemini & Claude upstream accept it cleanly
function cleanJsonSchema(schema, isClaude) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const s = JSON.parse(JSON.stringify(schema));

  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1));

    // Flatten anyOf / oneOf when Claude model or nullable union
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

    // Handle array type like ["string", "null"]
    if (Array.isArray(node.type)) {
      const first = node.type.find((t) => t !== 'null') || 'string';
      node.type = first;
    }

    const dropKeys = [
      '$schema', '$id', '$ref', '$defs', 'definitions',
      'additionalProperties', 'strict', 'default', 'title',
      'examples', 'exclusiveMinimum', 'exclusiveMaximum',
      'propertyNames', 'patternProperties', 'const',
      'minLength', 'maxLength', 'pattern', 'format',
      'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems',
    ];
    for (const k of dropKeys) delete node[k];

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
    const n = crypto.randomInt(1, 9_000_000_000_000);
    return `-${n}`;
  }
  const hash = crypto.createHash('sha256')
    .update(`colony-sub:antigravity:${email || ''}\0${firstUserText}`)
    .digest();
  const val = hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${val.toString()}`;
}

function chatToAntigravityRequest(body, creds) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new HttpError(400, 'messages 不能为空', 'invalid_request_error');

  const modelId = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-4-argon-high';
  const lowerModel = modelId.toLowerCase();
  const isClaude = lowerModel.includes('claude');
  const isImage = lowerModel.includes('image');

  const systemParts = [];
  const contents = [];
  let seenConversation = false;

  const pushContent = (role, parts) => {
    if (!parts.length) return;
    const prev = contents[contents.length - 1];
    // Merge adjacent same-role turns when neither is a tool-call boundary clash
    if (prev && prev.role === role) {
      prev.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
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
          if (r === 'tool') {
            const cid = messages[j].tool_call_id;
            if (cid) {
              const raw = messages[j].content;
              const str = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
              respByCallId.set(cid, str);
            }
          }
        }
        const respParts = calls.map((c) => ({
          functionResponse: {
            id: c.id,
            name: c.name,
            response: { result: respByCallId.get(c.id) || '{}' },
          },
        }));
        pushContent('user', respParts);
      }
      continue;
    }

    // Standalone tool messages already paired above; ignore orphans safely
  }

  // Gemini requires leading/trailing boundary safety (do not alter Claude turns with empty text)
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
      generationConfig.responseSchema = cleanJsonSchema(body.response_format.json_schema.schema, false);
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
  if (systemParts.length) {
    requestObj.systemInstruction = { role: 'user', parts: systemParts };
  }
  if (Object.keys(generationConfig).length) {
    requestObj.generationConfig = generationConfig;
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    const fnDecls = [];
    const extraTools = [];
    for (const t of body.tools) {
      if (t?.type === 'function' && t.function?.name) {
        fnDecls.push({
          name: t.function.name,
          description: t.function.description || '',
          parameters: cleanJsonSchema(t.function.parameters, isClaude),
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
    requestObj.sessionId = deriveStableSessionId(contents, creds.email);
  }

  return {
    project: creds.projectId,
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

async function fetchAntigravityStream(payload, signal) {
  const uaInfo = await getHubUserAgent();
  const runOnce = async (creds) => {
    const body = { ...payload, project: creds.projectId };
    return fetch(`${DAILY_API_ENDPOINT}/${API_VERSION}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': uaInfo.shortUA,
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  let creds = await ensureAuth();
  let resp = await runOnce(creds);
  if (resp.status === 401 && creds.refreshToken) {
    creds = await refreshAccessToken(creds);
    resp = await runOnce(creds);
  }
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
    const c = getCreds();
    const login = loginManager.get('antigravity');
    return {
      loggedIn: !!c,
      account: c?.email || null,
      expiresAt: c?.expiresAt || null,
      authMode: c ? 'browser' : null,
      modelCount: c ? ANTIGRAVITY_MODELS.length : null,
      login,
    };
  },

  async startLogin() {
    const session = loginManager.begin('antigravity', 'browser', '正在启动本地回调服务…');
    try {
      const state = crypto.randomBytes(16).toString('hex');
      let cb;
      try {
        cb = await listenOAuthCallback({
          port: DEFAULT_CALLBACK_PORT,
          host: undefined,
          redirectHost: 'localhost',
          callbackPath: '/oauth-callback',
          expectedState: state,
          signal: session.signal,
        });
      } catch {
        // Fallback to ephemeral port if 51121 is busy
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
        client_id: CLIENT_ID,
        prompt: 'consent',
        redirect_uri: cb.redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state,
      });
      const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

      session.update({
        url: authUrl,
        message: '请在浏览器中完成 Google 账号授权…',
      });

      (async () => {
        try {
          const { code } = await cb.waitForCode();
          session.update({ message: '已收到授权，正在换取凭据与项目信息…' });

          const form = new URLSearchParams({
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: cb.redirectUri,
            grant_type: 'authorization_code',
          });
          const tr = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: session.signal,
          });
          const tok = await tr.json().catch(() => ({}));
          if (!tr.ok || !tok.access_token) {
            throw new Error(tok.error_description || tok.error || `换取 Token 失败 (HTTP ${tr.status})`);
          }

          const uaInfo = await getHubUserAgent();
          const email = await fetchUserEmail(tok.access_token, uaInfo.shortUA, session.signal);
          const projectId = await fetchProjectId(tok.access_token, uaInfo, session.signal);

          writeCreds('antigravity', {
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token || '',
            expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
            email,
            projectId,
          });

          session.succeed(`已登录：${email}`);
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

  async cancelLogin() {
    loginManager.cancel('antigravity');
    return { ok: true };
  },

  async logout() {
    loginManager.clear('antigravity');
    clearCreds('antigravity');
    return { ok: true };
  },

  async listModels() {
    await ensureAuth();
    return ANTIGRAVITY_MODELS;
  },

  async chat(_ctx, body, req, res) {
    const modelId = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-4-argon-high';
    const stream = body?.stream === true;
    const creds = await ensureAuth();
    const payload = chatToAntigravityRequest(body, creds);
    const completionId = genId('chatcmpl');
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('close', onClose);

    const sse = stream ? createChatSse(res, { id: completionId, model: modelId }) : null;

    try {
      const upstream = await fetchAntigravityStream(payload, ac.signal);
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
  },
};

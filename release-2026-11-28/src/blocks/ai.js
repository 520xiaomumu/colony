'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 stem 的 换段
// ═ 网络请求 · 借用者: petri:porter ═
// 超时与重试唯一入口; 未填转发时遇 CORS 自动阶梯回退(插件 → 本机 /proxy)
async function 网络请求(url, opt = {}) {
  const { retries = 1, timeout = 60000, signal: sg } = opt;
  let 真 = url, 经 = '', last;
  // ✂ 转发 · 要: 网络请求
  const 转 = opt.转发;
  if (转) [真, 经] = [(转.includes('{url}') ? 转 : 转 + '{url}').replace('{url}', encodeURIComponent(url)), `(经转发地址 ${转})`];
  // ✂ 转发 完
  // ✂ 绕跨域 · 要: 网络请求
  const 显式插件 = typeof url === 'string' && url.startsWith('colony-relay:');
  if (显式插件) url = 真 = url.slice('colony-relay:'.length);
  const 源 = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  const 是回环 = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(url);
  const 经插件 = async (长流) => {
    if (!await 网络请求.探插件()) return null;
    const method = (opt.method || 'GET').toUpperCase(), headers = 网络请求.头(opt.headers, 显式插件);
    const bodyStr = typeof opt.body === 'string' ? opt.body : undefined;
    if (opt.body && bodyStr === undefined) return null;
    if (长流 || (method === 'POST' && bodyStr && /"stream"\s*:\s*true\b/.test(bodyStr)))
      return 网络请求.插件流({ url, method, headers, body: bodyStr }, sg, true, 长流 ? 0 : 3500);
    const r = await 网络请求.插件发('fetch', { url, method, headers, body: bodyStr, timeout }, timeout + 2000).catch(() => null);
    if (!r || (r.error && !r.status)) return null;
    const rh = new Headers();
    Object.entries(r.headers || {}).forEach(([k, v]) => { try { rh.set(k, String(v)); } catch {} });
    let body = r.text ?? '';
    if (r.base64) body = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
    return new Response(body, { status: Number(r.status) || 200, headers: rh });
  };
  if (显式插件) {
    const r0 = await 经插件(true);
    if (r0) { if (opt.报通道) opt.报通道('plugin'); return r0; }
  }
  const 经本机 = () => 网络请求.跑限(sg, timeout, s => fetch((网络请求.本机代理 || 'http://127.0.0.1:4135').replace(/\/+$/, '') + '/proxy?url=' + encodeURIComponent(url), Object.assign({}, opt, { signal: s }))).catch(() => null);
  const 记通道 = via => { if (源) 网络请求.通道.set(源, via); if (opt.报通道) opt.报通道(via); };
  if (!转 && !是回环 && 源 && 网络请求.通道.has(源)) {
    const via = 网络请求.通道.get(源), res = via === 'plugin' ? await 经插件() : await 经本机();
    if (res) { if (opt.报通道) opt.报通道(via); return res; }
    网络请求.通道.delete(源);
  }
  // ✂ 绕跨域 完
  for (let i = 0; i <= retries; i++) {
    if (i) await new Promise(r => setTimeout(r, 800));
    const ctrl = new AbortController(), onAbort = () => ctrl.abort(), timer = setTimeout(onAbort, timeout);
    if (sg) sg.aborted ? onAbort() : sg.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(真, Object.assign({}, opt, { signal: ctrl.signal }));
      if (opt.报通道) opt.报通道(opt.转发 ? 'proxy' : 'direct');
      if (res.status < 500 || i >= retries) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e; if (sg?.aborted) throw e; if (ctrl.signal.aborted) break;
      // ✂ 绕跨域
      if (e?.name === 'TypeError' && !转 && !是回环) {
        const r1 = await 经插件(); if (r1) { 记通道('plugin'); return r1; }
        const r2 = await 经本机(); if (r2) { 记通道('local'); return r2; }
      }
      // ✂ 绕跨域 完
    } finally { clearTimeout(timer); if (sg) sg.removeEventListener('abort', onAbort); }
  }
  if (last?.name === 'TypeError')
    throw Object.assign(new Error('连不上 ' + url + 经 + ': 网络不通, 或浏览器不让网页直接连它(可装插件、连本机, 或在高级区填转发地址)'), { retry: true });
  if (last?.name === 'AbortError') throw new Error(`请求 ${url} 超过 ${Math.round(timeout / 1000)} 秒没回应`);
  throw last;
}
// ✂ 绕跨域
Object.assign(网络请求, {
  通道: new Map(), 本机代理: 'http://127.0.0.1:4135', 插件态: 0, _探中: null, _探空: 0,
  async 跑限(sg, ms, fn) {
    const c = new AbortController(), ab = () => c.abort(), t = setTimeout(ab, ms);
    if (sg) sg.aborted ? ab() : sg.addEventListener('abort', ab, { once: true });
    try { return await fn(c.signal); } finally { clearTimeout(t); if (sg) sg.removeEventListener('abort', ab); }
  },
  头(h, 删占位) {
    const o = {}; if (!h) return o;
    if (h instanceof Headers) h.forEach((v, k) => { o[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { o[k] = v; });
    else Object.entries(h).forEach(([k, v]) => { if (v != null) o[k] = String(v); });
    if (删占位) Object.keys(o).forEach(k => { if (k.toLowerCase() === 'authorization' && /^Bearer\s*(local)?$/i.test(o[k])) delete o[k]; });
    return o;
  },
  插件发: (op, req, ms = 15000, extra) => new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.postMessage) return reject(new Error('无浏览器环境'));
    const id = 'air_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const matchId = extra && extra.id ? extra.id : id;
    const on = ev => {
      if (ev.source !== window) return;
      const r = ev.data?.__colonyRelayResult; if (!r || r.id !== matchId) return;
      clearTimeout(t); window.removeEventListener('message', on); 网络请求.插件态 = 1; 网络请求._探空 = 0;
      r.error && !r.status ? reject(new Error(r.error)) : resolve(r);
    };
    window.addEventListener('message', on);
    const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('插件未响应(请确认已安装启用 Colony Bridge)')); }, ms);
    const payload = extra && typeof extra === 'object' ? Object.assign({}, extra, { id: matchId, op, req }) : { id, op, req };
    window.postMessage({ __colonyRelay: payload }, '*');
  }),
  插件流(req, sg, asRes, firstTimeout = 3500) {
    if (typeof window === 'undefined' || !window.postMessage) return asRes ? Promise.resolve(null) : null;
    const id = 'ais_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), enc = new TextEncoder();
    let settled = false, ctrlRef = null, t0 = null, resWait = null;
    const clean = () => { clearTimeout(t0); window.removeEventListener('message', on); if (sg) sg.removeEventListener('abort', abort); };
    const abort = () => {
      window.postMessage({ __colonyRelay: { id, op: 'cancel' } }, '*'); clean();
      const err = new DOMException('Aborted', 'AbortError');
      if (asRes && !settled) { settled = true; resWait(Promise.reject(err)); }
      else try { ctrlRef?.error(err); } catch {}
    };
    if (sg) sg.aborted ? abort() : sg.addEventListener('abort', abort, { once: true });
    const stream = new ReadableStream({ start(c) { ctrlRef = c; }, cancel() { window.postMessage({ __colonyRelay: { id, op: 'cancel' } }, '*'); clean(); } });
    const p = asRes ? new Promise((res, rej) => { resWait = v => (v && typeof v.then === 'function' ? v.then(res, rej) : res(v)); }) : null;
    const 起 = () => {
      if (asRes && !settled) {
        settled = true;
        resWait(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
      }
    };
    const on = ev => {
      if (ev.source !== window) return;
      const d = ev.data?.__colonyRelayChunk; if (!d || d.id !== id) return;
      clearTimeout(t0); 网络请求.插件态 = 1; 网络请求._探空 = 0;
      if (d.keepalive) { if (firstTimeout === 0) { 起(); try { ctrlRef?.enqueue(enc.encode('\n')); } catch {} } return; }
      if (asRes && !settled) {
        settled = true;
        if (d.error) { clean(); try { ctrlRef?.close(); } catch {} return resWait(d.status ? new Response(String(d.error).replace(/^HTTP \d+ /, ''), { status: d.status }) : null); }
        resWait(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
      } else if (!asRes && d.error) { clean(); try { ctrlRef?.error(Object.assign(new Error(d.error), { status: d.status })); } catch {} return; }
      if (d.delta) try { ctrlRef?.enqueue(enc.encode(d.delta)); } catch {}
      if (d.done || d.error) { clean(); 起(); try { ctrlRef?.close(); } catch {} }
    };
    window.addEventListener('message', on);
    if (asRes && firstTimeout > 0) t0 = setTimeout(() => { if (!settled) { settled = true; clean(); resWait(null); } }, firstTimeout);
    window.postMessage({ __colonyRelay: { id, op: 'stream', req } }, '*');
    return asRes ? p : stream;
  },
  探插件() {
    if (this.插件态 === 1) return Promise.resolve(true);
    if (typeof window === 'undefined' || !window.postMessage) return Promise.resolve(false);
    if (this._探空 && Date.now() - this._探空 < 3000) return Promise.resolve(false);
    if (this._探中) return this._探中;
    window.postMessage({ __colonyRelayHello: 1 }, '*');
    this._探中 = this.插件发('ping', {}, 800).then(() => true, () => { this._探空 = Date.now(); return false; })
      .finally(() => { this._探中 = null; });
    return this._探中;
  },
});
if (typeof window !== 'undefined') window.addEventListener('message', ev => { if (ev.source === window && ev.data?.__colonyRelayReady) { 网络请求.插件态 = 1; 网络请求._探空 = 0; } });
// ✂ 绕跨域 完
// ═ 并发闸 ═
// 每家同时在跑的请求有上限(默认 8, 可调 concurrency), 多的排队, 免得扇出几十个把额度打爆; 429 后 20 秒内降到 3
const 并发闸 = {
  桶: {},
  async 占(p) {   // 等到有空位, 回"放"函数: 用完调它, 出错时把错传进去
    const b = this.桶[p.id] = this.桶[p.id] || { 在跑: 0, 队: [], 降到: 0 };
    const 满 = Math.max(1, +p.concurrency || 8), 上限 = () => Date.now() < b.降到 ? Math.min(3, 满) : 满;
    while (b.在跑 >= 上限()) await new Promise(r => b.队.push(r));
    b.在跑++;
    return e => {
      b.在跑--;
      if (e && /\b429\b|rate.?limit|too many/i.test(e.message)) b.降到 = Date.now() + 20000;
      // 有几个空位叫醒几个(醒来的会再核对); 只叫一个的话, 降速期过后也一直只有 3 个在跑
      for (let n = 上限() - b.在跑; n > 0 && b.队.length; n--) b.队.shift()();
    };
  },
  async 跑(p, fn) {
    const 放 = await this.占(p);
    let 错;
    try { return await fn(); } catch (e) { throw 错 = e; } finally { 放(错); }
  },
};
// ═ 协议适配 · 借用者: petri:agent, petri:plugin-manager ═
// 一种协议 = 一个对象; adapt 两层泛化: 纯 JSON(头/路径/参数/点路径提取/轮询) + code 微转换函数, 本体零改码接异构厂商
const 厂商错 = (p, 话) => new Error(`厂商「${p.name}」${话}`);
const 协议适配 = (() => {
  const 文字 = c => Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : String(c ?? '');
  const 读行 = l => {
    const s = l.trim().startsWith('data:') ? l.trim().slice(5).trim() : '';
    if (!s || s === '[DONE]') return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  const 读 = async (x, p) => {
    const t = typeof x === 'string' ? x : await x.text();
    let j;
    try { j = /^\s*data:/.test(t) ? t.split('\n').map(读行).filter(Boolean).pop() || {} : JSON.parse(t); }
    catch { throw 厂商错(p, `回的不是 JSON(网址可能填错了): ${t.slice(0, 120)}`); }
    const 错 = j && (j.error || j.type === 'error' && j);
    if (错) throw 厂商错(p, `报错: ${错.message || JSON.stringify(错)}`);
    return j;
  };
  const 类型名 = (v, 默认) => v?.mimeType || (/^data:([^;,]+)/.exec(typeof v === 'string' ? v : v.data) || [])[1] || 默认;
  const 网址 = (v, 默认) => { const s = typeof v === 'string' ? v : v.data; return /^(https?:|data:)/.test(s) ? s : `data:${类型名(v, 默认)};base64,${s}`; };
  const 取径 = (o, path) => {
    if (!path || o == null) return undefined;
    const segs = String(path).split('.');
    let cur = o;
    for (let i = 0; i < segs.length; i++) {
      if (cur == null) return undefined;
      const k = segs[i];
      if (k.endsWith('[]')) {
        const arr = k === '[]' ? cur : cur[k.slice(0, -2)], rest = segs.slice(i + 1).join('.');
        return Array.isArray(arr) ? arr.map(x => rest ? 取径(x, rest) : x).filter(x => x !== undefined) : undefined;
      }
      cur = cur[k];
    }
    return cur;
  };
  const 媒 = x => x?.data ? 网址(x) : x;
  const 填 = (t, v) => typeof t === 'string' ? (/^\{\w+\}$/.test(t) ? 媒(v[t.slice(1, -1)])
    : t.replace(/\{(\w+)\}/g, (_, k) => v[k] == null ? '' : v[k])) : Array.isArray(t) ? t.map(x => 填(x, v))
    : t && typeof t === 'object' ? Object.fromEntries(Object.entries(t).map(([k, x]) => [k, 填(x, v)])) : t;
  const 合并体 = (base, patch, vars) => {
    if (!patch || typeof patch !== 'object') return base;
    const out = Object.assign({}, base);
    for (const [k, raw] of Object.entries(patch)) {
      if (raw === null) { delete out[k]; continue; }
      const val = vars ? 填(raw, vars) : raw;
      if (val !== undefined) out[k] = (val && typeof val === 'object' && !Array.isArray(val) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) ? 合并体(out[k], val, null) : val;
    }
    return out;
  };
  const 脚本缓 = new Map();
  const 脚本 = (p, 类) => {
    const src = p?.adapt?.[类]?.code || p?.adapt?._?.code;
    if (!src || typeof src !== 'string') return null;
    if (!脚本缓.has(src)) 脚本缓.set(src, new Function(`"use strict"; return (${src});`)());
    return 脚本缓.get(src);
  };
  const 类型 = { chat: { 名: '文本', 后缀: '/chat/completions' } };
  const 类名 = { image: '图片', imageEdit: '图片编辑', video: '视频', videoEdit: '视频编辑', stt: '转录', tts: '语音', realtime: '双工', embedding: '嵌入', rerank: '重排', music: '音乐' };
  const 兼容 = {
    名称: 'OpenAI 兼容 (绝大多数厂商、中转站、本地模型)', 默认端点: 'https://api.openai.com/v1', 类型,
    头(p, json, 类, vars) {
      const h = Object.assign({}, json && { 'Content-Type': 'application/json' }, p.apiKey && { Authorization: `Bearer ${p.apiKey}` });
      const v = Object.assign({ apiKey: p.apiKey || '', model: p.model || '' }, vars);
      for (const ex of [p.adapt?._?.headers, 类 && p.adapt?.[类]?.headers]) if (ex && typeof ex === 'object') {
        for (const [k, raw] of Object.entries(ex)) {
          if (raw === null) Object.keys(h).forEach(hk => { if (hk.toLowerCase() === k.toLowerCase()) delete h[hk]; });
          else if (raw !== undefined) h[k] = String(填(raw, v));
        }
      }
      return h;
    },
    基址(p) {
      let u = String(p.endpoint || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
      Object.values(this.类型).map(t => t.后缀).concat('/models').forEach(s => { if (u.endsWith(s)) u = u.slice(0, -s.length); });
      return u;
    },
    基(p) { const b = this.基址(p); if (!b) throw 厂商错(p, '没填 API 网址'); return b; },
    端点(p, 类, vars, stream) {
      const cfg = p.adapt?.[类] || {}, raw = (stream && cfg.streamPath) || cfg.path || this.类型[类]?.后缀 || '';
      const v = Object.assign({ apiKey: p.apiKey || '', model: p.model || '' }, vars), ps = 填(raw, v);
      let url = /^https?:\/\//i.test(ps) ? ps : this.基(p) + ps;
      const qObj = Object.assign({}, p.adapt?._?.query, cfg.query);
      const qs = Object.entries(qObj).filter(([, x]) => x != null).map(([k, x]) => `${encodeURIComponent(k)}=${encodeURIComponent(填(String(x), v))}`).join('&');
      return qs ? url + (url.includes('?') ? '&' : '?') + qs : url;
    },
    消息(m) {
      // ✂ 工具 · 要: 模型调用
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: 文字(m.content) };
      if (m.role === 'assistant') {
        const o = { role: 'assistant', content: 文字(m.content) };
        if (m.toolCalls?.length) o.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        return o;
      }
      // ✂ 工具 完
      if (!Array.isArray(m.content)) return { role: m.role, content: 文字(m.content) };
      return { role: m.role, content: m.content.map(p => p.type === 'text' || p.data == null && p.url == null
        ? { type: 'text', text: String(p.text ?? '') } : { type: 'image_url', image_url: { url: p.url || 网址(p, p.type === 'image' ? 'image/png' : 'application/octet-stream') } }) };
    },
    对话请求(p, a) {
      const model = a.model || p.model, mt = a.maxTokens || p.maxOut, vars = { model, apiKey: p.apiKey || '' };
      let o = { model, messages: a.messages.map(兼容.消息), stream: !!a.stream };
      if (a.temperature != null) o.temperature = a.temperature;
      if (mt) o.max_tokens = mt;
      // ✂ 思考 · 要: 模型调用
      const on = a.think === 'on';
      if (/^(on|off)$/.test(a.think)) Object.assign(o, p.think === 'type' ? { thinking: { type: on ? 'enabled' : 'disabled' } }
        : p.think === 'enable' ? { enable_thinking: on } : { reasoning_effort: on ? 'high' : 'none' });
      // ✂ 思考 完
      // ✂ 工具
      if (a.tools?.length) o.tools = a.tools.map(t => ({ type: 'function', function: 工具(t) }));
      // ✂ 工具 完
      if (p.adapt?.chat?.body) o = 合并体(o, p.adapt.chat.body, vars);
      const base = { url: this.端点(p, 'chat', vars, a.stream), headers: this.头(p, true, 'chat', vars), body: o };
      const hk = 脚本(p, 'chat'), fin = hk?.req ? hk.req(a, p, base) : base;
      return { url: fin.url, method: fin.method || 'POST', headers: fin.headers, body: typeof fin.body === 'string' ? fin.body : JSON.stringify(fin.body) };
    },
    解析回复(j, p) {
      const hk = 脚本(p, 'chat');
      if (hk?.res) { const r = hk.res(j, p) || {}; return { content: r.content || '', toolCalls: r.toolCalls || null, usage: r.usage || j?.usage || null, stop: r.stop || 'stop', raw: j }; }
      const pk = p?.adapt?.chat?.pick;
      if (pk) {
        const v = typeof pk === 'string' ? 取径(j, pk) : 取径(j, pk.content);
        return { content: Array.isArray(v) ? v.join('') : String(v ?? ''), toolCalls: null, usage: (pk.usage && 取径(j, pk.usage)) || j?.usage || null, stop: (pk.stop && 取径(j, pk.stop)) || 'stop', raw: j };
      }
      if (!j.choices) throw new Error(`回的不是对话结果: ${JSON.stringify(j).slice(0, 200)}`);
      const c = j.choices[0] || {}, m = c.message || {};
      const o = { content: m.content || m.reasoning_content || '', toolCalls: null, usage: j.usage || null, stop: c.finish_reason || null, raw: j };
      // ✂ 工具
      if (m.tool_calls?.length) o.toolCalls = m.tool_calls.map(x => ({ id: x.id, name: x.function?.name, args: 解参(x.function?.arguments) }));
      // ✂ 工具 完
      return o;
    },
    解析流片(j, p, rawLine) {
      const hk = 脚本(p, 'chat');
      if (hk?.chunk) return hk.chunk(j, rawLine, p);
      const pk = p?.adapt?.chat?.pick;
      if (pk && (typeof pk === 'string' || pk.delta)) {
        const dv = 取径(j, typeof pk === 'string' ? pk : pk.delta), rv = pk.reasoning ? 取径(j, pk.reasoning) : '';
        const delta = Array.isArray(dv) ? dv.join('') : String(dv ?? ''), reasoning = Array.isArray(rv) ? rv.join('') : String(rv ?? ''), stop = (pk.stop && 取径(j, pk.stop)) || null;
        return (delta || reasoning || stop) ? { delta, reasoning, stop } : null;
      }
      const ch = j.choices?.[0], d = ch?.delta;
      if (!d) return null;
      const o = { delta: d.content || '', reasoning: d.reasoning_content || d.reasoning || '', stop: ch.finish_reason || null };
      // ✂ 工具
      if (d.tool_calls) o.toolDelta = d.tool_calls.map(x => ({ index: x.index, id: x.id, name: x.function?.name, argsText: x.function?.arguments || '' }));
      // ✂ 工具 完
      return o;
    },
    模型请求(p) {
      const mCfg = p.adapt?.models, vars = { apiKey: p.apiKey || '', model: p.model || '' };
      if (mCfg?.path === false) return { skip: true };
      const q = mCfg?.path ? p : { ...p, adapt: { ...p.adapt, models: { ...mCfg, path: '/models' } } };
      const base = { url: this.端点(q, 'models', vars), headers: this.头(p, false, 'models', vars) };
      const hk = 脚本(p, 'models');
      return hk?.modelsReq ? hk.modelsReq(p, base) : base;
    },
    解析模型(j, p) {
      const hk = 脚本(p, 'models');
      if (hk?.modelsRes) return hk.modelsRes(j, p);
      const pk = p?.adapt?.models?.pick;
      if (pk) return { models: (Array.isArray(取径(j, pk)) ? 取径(j, pk) : []).map(x => String(x || '').replace(/^models\//, '')).filter(Boolean).sort(), hints: {} };
      const list = j.data || j.models || [], hints = {};
      list.forEach(x => { if (x?.id && (x.model_type || x.type)) hints[x.id] = String(x.model_type || x.type); });
      return { models: list.map(x => x.id || x.name || x).filter(x => typeof x === 'string').sort(), hints };
    },
  };
  const 出 = { 'openai-compatible': 兼容, 文字, 读行, 读, 网址, 类名, 取径, 填, 合并体, 脚本 };
  // ✂ 工具
  const 工具 = t => ({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } });
  const 解参 = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch { return { raw: String(s) }; } };
  Object.assign(出, { 工具, 解参 });
  // ✂ 工具 完
  // ✂ 非文本 · 要: 选模型
  const 没给 = (p, 什么, j) => { throw 厂商错(p, `没返回${什么}: ${JSON.stringify(j).slice(0, 200)}`); };
  const 字节 = s => Uint8Array.from(atob(String(s).replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0));
  const 成base64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const 扩展名 = t => { const x = t.split(/[/;]/)[1]; return { mpeg: 'mp3', 'x-wav': 'wav' }[x] || x; };
  const 表单 = (o, 默认) => {
    const fd = new FormData();
    Object.keys(o).forEach(k => [].concat(o[k] == null ? [] : o[k]).forEach((v, _, vs) => {
      const name = k + (vs.length > 1 ? '[]' : '');
      if (!/^(image|mask|file)$/.test(k)) return fd.append(name, String(v));
      const type = 类型名(v, 默认);
      fd.append(name, new Blob([字节(typeof v === 'string' ? v : v.data)], { type }), `${k}.${扩展名(type)}`);
    }));
    return fd;
  };
  const 取 = (什么, f) => async (res, p) => { const j = await 读(res, p); return f(j) || 没给(p, 什么, j); };
  const 件 = (j, mimeType, pick) => {
    if (pick) {
      const v = typeof pick === 'string' ? 取径(j, pick) : (取径(j, pick.url) || 取径(j, pick.data));
      const val = Array.isArray(v) ? v[0] : v;
      if (typeof val === 'string' && val) return /^(https?:|data:)/i.test(val) ? { url: val } : { mimeType, data: val };
    }
    const d = (j.data || [])[0] || j.video || j.output || j, data = d.b64_json || d.audio_base64 || d.audio,
      url = d.url || d.audio_url || d.video_url || (Array.isArray(d.results) && d.results[0]?.url);
    return typeof data === 'string' && data ? { mimeType, data } : url ? { url } : null;
  };
  Object.assign(出, { 没给, 取, 成base64, 表单, 件 });
  出.加类 = (键, 行) => { 行.名 = 类名[键]; Object.values(出).forEach(ad => { if (ad.类型 && !ad.类型[键]) ad.类型[键] = 行; }); return 行; };
  // ✂ 非文本 完
  return 出;
})();
// ═ 模型调用 · 跟着: 网络请求, 协议适配 ═
// 可借: 厂商记录由参数传进来, 不碰本块的存储
const 模型调用 = {
  适配(p) {
    const a = 协议适配[p.protocol || 'openai-compatible'], 谁 = p.name ? `厂商「${p.name}」的` : '';
    if (a?.对话请求) return a;
    // 本块停着时借用方跑剪来的那份, 别的块加给本块的协议(如桥接的 gateway)不在表上: 照实说停用了(停着 只在 Colony 里有)
    const 停 = !colony.单独 && colony.停着('petri:ai');
    if (停) throw new Error(`「${停}」块停用了, 用不了${谁}协议 ${p.protocol}`);
    throw new Error(谁 + '未知协议: ' + p.protocol + '。可用: '
      + Object.keys(协议适配).filter(k => 协议适配[k].对话请求).join(', ') + '(在 AI 配置里给它重选一个)');
  },
  没选(p, 名) { throw 厂商错(p, `还没选${名}模型: 在「AI 配置」里给它选一个`); },
  async 错误(res, p) {   // 留厂商原话, 常见的先说人话; 限流时带上它说要等几秒
    const t = await res.text().catch(() => ''), s = res.status, 话 = { 401: 'Key 不对或过期了', 402: '账号余额不足',
      403: '这把 Key 没有这个权限', 404: '网址或模型名不对', 429: '请求太快, 被限流了' }[s];
    const 等 = +res.headers.get('retry-after') || +(/(\d+(?:\.\d+)?) ?(?:s\b|秒|seconds)/.exec(t) || [0, 0])[1];
    return Object.assign(厂商错(p, (话 ? 话 + '(HTTP ' + s + ')' : 'HTTP ' + s) + ': ' + t.slice(0, 200)),
      { status: s, retry: s >= 500 || s === 429, 等: 等 * 1000 });
  },
  // 这家的请求都从这出: 填了转发地址就全经它转; 连不上时说该去哪改
  发: (p, url, opt) => 网络请求(url, Object.assign({ 转发: p.proxy }, opt)).catch(e => {
    if (e.retry && !p.proxy) e.message += '; 是后者的话, 可以在这家的「⚙ 高级」里填转发地址'
      + (模型调用.本机(p) ? '(本地模型也可以在它那边打开跨域)' : '');
    throw e;
  }),
  async 拉(p, url, headers, signal, body) {   // 取 JSON(模型清单、音色、任务进度), 给 body 就 POST
    const res = await 模型调用.发(p, url, Object.assign({ headers, timeout: 30000, signal },
      body && { method: 'POST', body: JSON.stringify(body) }));
    if (!res.ok) throw await 模型调用.错误(res, p);
    return 协议适配.读(res, p);
  },
  本机: p => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(p.endpoint || ''),
  // 超时不让人填: 本机的大模型首字慢, 给宽些
  超时(p) { return (模型调用.本机(p) ? 300 : 120) * 1000; },
  // ✂ 工具
  // 工具调用在这收口: 原生的走原生; 标了 toolMode:'text' 就把工具写成说明、让模型写围栏再解析回来。调用方只看到 toolCalls
  工具说明(tools) {
    return '\n\n## 可用工具\n要用工具时, 在回复里写一个 ```tool 围栏, 里面一个 JSON: {"name":"工具名","args":{...}};'
      + ' 一栏一个, 可写多栏; 结果会在下一条消息里给你。不用工具就直接回答。\n' + tools.map(t => {
        const ps = t.parameters || {}, req = ps.required || [];
        return '- ' + t.name + ': ' + (t.description || '') + ' 参数: ' + JSON.stringify(ps.properties || {})
          + (req.length ? ` 必填: ${req.join(', ')}` : '');
      }).join('\n');
  },
  围栏: calls => calls.map(c => `\`\`\`tool\n${JSON.stringify({ name: c.name, args: c.args || {} })}\n\`\`\``)
    .join('\n'),
  解析围栏(text) { // 围栏外是正文; 围栏里不是 JSON 就交回原文, 让调用方看到错在哪
    const calls = [];
    const content = String(text ?? '').replace(/```tool\s*\n([\s\S]*?)```/g, (all, body) => {
      const id = `text-${calls.length + 1}-${Date.now().toString(36)}`, s = body.trim();
      try {
        const j = JSON.parse(s);
        calls.push({ id, name: String(j?.name || '?'), args: j?.args || {} });
      }
      catch (e) { calls.push({ id, name: '?', args: { raw: s, error: `围栏里不是合法 JSON: ${e.message}` } }); }
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { content, toolCalls: calls.length ? calls : null };
  },
  文字化(a) { // 文字模式: 工具说明进 system, 历史里的工具调用变围栏、结果变 user 消息
    const tools = a.tools || [], msgs = [];
    let sys = a.messages.filter(m => m.role === 'system').map(m => 协议适配.文字(m.content)).join('\n');
    if (tools.length) sys += 模型调用.工具说明(tools);
    if (sys) msgs.push({ role: 'system', content: sys });
    a.messages.filter(m => m.role !== 'system').forEach(m => {
      const 字 = 协议适配.文字(m.content);
      if (m.role === 'tool') msgs.push({ role: 'user', content: `工具 ${m.name || ''} 的结果:\n${字}` });
      else if (m.role === 'assistant' && m.toolCalls?.length)
        msgs.push({ role: 'assistant', content: `${字}\n${模型调用.围栏(m.toolCalls)}`.trim() });
      else msgs.push({ role: m.role, content: m.content });
    });
    return Object.assign({}, a, { messages: msgs, tools: undefined });
  },
  // ✂ 工具 完
  async chat(p, a) { // 不要流式也走同一个读法: 有的网关照样回事件流
    let out = null;
    for await (const c of 模型调用.读(p, a, false)) out = c;
    delete out.done;
    return out;
  },
  // ✂ 流式 · 要: 模型调用
  chatStream: (p, a) => 模型调用.读(p, a, true),   // 逐片 {delta}; 最后一片 {done, content, toolCalls, usage, stop}
  // ✂ 流式 完
  async *读(p, a, stream) { // 流式与否都走这里: 事件流逐片读, 不是就整段读
    const ad = 模型调用.适配(p);
    if (!(a.model || p.model)) 模型调用.没选(p, '文本');
    const text = !!模型调用.文字化 && p.toolMode === 'text' && !!a.tools?.length;
    if (ad.执行对话) {
      const ret = ad.执行对话(p, text ? 模型调用.文字化(a) : a, stream);
      if (ret && typeof ret[Symbol.asyncIterator] === 'function') {
        let full = '';
        for await (const c of ret) {
          if (c?.done) {
            const out = Object.assign({ content: full, usage: null, stop: null, toolCalls: null }, c);
            if (text) Object.assign(out, 模型调用.解析围栏(out.content));
            if (out.toolCalls && !out.toolCalls.length) out.toolCalls = null;
            yield Object.assign(out, { done: true });
            return;
          }
          if (c?.delta) full += c.delta;
          yield c;
        }
        const out = { content: full, usage: null, stop: 'stop', toolCalls: null };
        if (text) Object.assign(out, 模型调用.解析围栏(out.content));
        yield Object.assign(out, { done: true });
        return;
      }
      const out = await ret;
      if (text) Object.assign(out, 模型调用.解析围栏(out.content));
      if (out.toolCalls && !out.toolCalls.length) out.toolCalls = null;
      if (out.content) yield { delta: out.content };
      yield Object.assign({ usage: null, stop: null, toolCalls: null }, out, { done: true });
      return;
    }
    const 发 = x => {
      const r = ad.对话请求(p, Object.assign({}, text ? 模型调用.文字化(x) : x, { stream }));
      return 模型调用.发(p, r.url, { method: r.method || 'POST', headers: r.headers, body: r.body, timeout: 模型调用.超时(p),
        signal: a.signal });
    };
    let res = await 发(a), 退 = '';
    // ✂ 思考
    if (res.status === 400 && a.think) {   // 这家不认思考档: 不带再问一次, 回的时候说一声
      退 = (await 模型调用.错误(res, p)).message;
      res = await 发(Object.assign({}, a, { think: undefined }));
    }
    // ✂ 思考 完
    if (!res.ok) throw await 模型调用.错误(res, p);
    const reader = res.body.getReader(), dec = new TextDecoder(), acc = [];
    let buf = '', idle = null, stalled = false, full = '', usage = null, stop = null, 原文 = '', 流 = false;
    const arm = () => { // 上游停滞不断连时 read 会永远挂起, 看门狗替它断
      clearTimeout(idle);
      idle = setTimeout(() => { stalled = true; try { reader.cancel(); } catch (_) { } }, 90000);
    };
    const 行 = function* (l) { // 没见过数据行就先攒着, 到底都没有就当整段 JSON
      const j = 协议适配.读行(l);
      if (!j) { if (!流) 原文 += `${l}\n`; return; }
      流 = true;
      if (j.error) { // HTTP 是 200, 错在事件里, 不挑出来就成了空回答; 5xx/过载标 retry 让上层可自动重试或切备选
        const em = j.error.message || JSON.stringify(j.error), et = String(j.error.type || j.error.code || '');
        const retry = /overloaded|unavailable|rate_limit|server_error|50[234]/i.test(`${et} ${em}`);
        throw Object.assign(厂商错(p, `流里报错: ${em}`), { retry });
      }
      if (j.usage) usage = j.usage;
      const c = ad.解析流片(j, p, l); if (!c) return;
      if (c.stop) stop = c.stop;
      // ✂ 工具
      let 写 = null;
      (c.toolDelta || []).forEach(d => { // 没 id 按编号归; 有的中转站连编号都不给, 就归最近一个
        let t = d.id ? acc.find(x => x.id === d.id)
          : acc.slice().reverse().find(x => d.index == null || x.index === d.index);
        if (!t) acc.push(t = { index: d.index, id: d.id || '', name: '', argsText: '' });
        if (d.name) t.name = d.name;
        if (d.argsText) t.argsText += d.argsText;
        写 = t;
      });
      if (写) yield { tool: 写.name, chars: 写.argsText.length, text: 写.argsText };   // 写长参数(比如整段代码)时报进度和写到哪了
      // ✂ 工具 完
      if (c.delta) full += c.delta;
      if (c.delta || c.reasoning) yield c.delta ? { delta: c.delta } : { reasoning: c.reasoning };
    };
    try {
      arm();
      for (; ;) {
        const { value, done } = await reader.read(); if (done) break; arm();
        buf += dec.decode(value, { stream: true }); let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          yield* 行(l);
        }
      }
      if (stalled) throw Object.assign(厂商错(p, '90 秒没数据, 已断开, 可重试'), { retry: true });
      yield* 行(buf); // 最后一行没有换行也算
      const out = 流 ? { content: full, usage, stop, toolCalls: null } : ad.解析回复(await 协议适配.读(原文, p), p);
      // ✂ 工具
      if (流) out.toolCalls = acc.map((t, i) => ({ id: t.id || `call-${i}`, name: t.name,
        args: 协议适配.解参(t.argsText) }));
      if (text) Object.assign(out, 模型调用.解析围栏(out.content));
      // ✂ 工具 完
      if (out.toolCalls && !out.toolCalls.length) out.toolCalls = null;
      yield Object.assign(out, { done: true }, 退 && { 没思考: 退 }); // usage、stop(length = 被截断)是厂商报的, 没报就是 null
    } finally { clearTimeout(idle); Promise.resolve(reader.cancel()).catch(() => { }); }
  },
  async models(p) {
    const ad = 模型调用.适配(p);
    if (ad.拉模型) {
      const got = await ad.拉模型(p);
      if (!got?.models?.length) throw 厂商错(p, '没返回任何模型');
      return got;
    }
    const r = ad.模型请求(p); if (r.skip) return { models: (p.models || []).slice(), hints: {} };
    const got = ad.解析模型(await 模型调用.拉(p, r.url, r.headers), p);
    if (!got.models.length) throw 厂商错(p, '没返回任何模型');
    return got; // {models, hints}
  },
};
// ═ 多模态 · 跟着: 协议适配, 模型调用, 厂商配置 ═
const 多模态 = {
  // ✂ 非文本
  间隔: 5000,
  模型(p, 类, a) { return a.model || p.modelOf?.[类] || 模型调用.没选(p, 模型调用.适配(p).类型[类].名); },
  async 调(p, 类, a) {
    const ad = 模型调用.适配(p);
    if (ad.执行多模态) return ad.执行多模态(p, 类, Object.assign({}, a, { model: this.模型(p, 类, a) }));
    const 记 = p.adapt?.[类], 串 = JSON.stringify, 法们 = [记 || {}, {}].concat(ad.类型[类].备 || [])
      .filter((x, i, all) => all.findIndex(y => 串(y) === 串(x)) === i);
    let 错;
    for (const 法 of 法们) {
      try {
        const r = await this.发(p, 类, a, ad, 法);
        if (串(法) !== 串(记 || {}) && (!记 || 错?.status === 404))
          await 厂商配置.更新(p.id, { adapt: { [类]: Object.keys(法).length ? 法 : null } });
        return r;
      } catch (e) { 错 = 错 || e; if (!/^(400|404)$/.test(e.status)) throw e; }
    }
    throw 错;
  },
  async 发(p, 类, a, ad, 改) {
    const t = ad.类型[类], model = this.模型(p, 类, a), vars = Object.assign({}, a, { model, apiKey: p.apiKey || '' });
    const q = Object.assign({}, p, { adapt: Object.assign({}, p.adapt, { [类]: 改 }) });
    let url = ad.端点(q, 类, vars), hk = 协议适配.脚本(q, 类);
    let body = 改.body ? 协议适配.合并体(t.请求(a, model, q), 改.body, vars) : t.请求(a, model, q);
    let 是表单 = typeof FormData !== 'undefined' && body instanceof FormData;
    let headers = ad.头(q, !是表单, 类, vars), method = 改.method || 'POST';
    if (hk?.req) {
      const fin = hk.req(a, q, { url, method, headers, body });
      url = fin.url || url; method = fin.method || method; headers = fin.headers || headers; body = fin.body ?? body;
      是表单 = typeof FormData !== 'undefined' && body instanceof FormData;
    }
    const res = await 模型调用.发(q, url, { method, headers, body: (是表单 || typeof body === 'string') ? body : JSON.stringify(body), timeout: 180000, signal: a.signal, retries: 0 });
    if (!res.ok) {
      const e = await 模型调用.错误(res, p);
      if (res.status === 404) e.message += ` ← 也可能是这家没有${t.名}这一类, 或路径不同: ${url}`;
      throw e;
    }
    const 查 = 改.poll || (t.查 && { path: t.查 });
    if (查) return this.等(q, ad, t, 查, await 协议适配.读(res, p), a, 改, hk);
    if (hk?.res) return hk.res(await 协议适配.读(res, p), q);
    return (改.pick ? 协议适配.取(t.名, j => 协议适配.件(j, t.件, 改.pick)) : (t.回复 || 协议适配.取(t.名, j => 协议适配.件(j, t.件))))(res, p);
  },
  async 等(p, ad, t, 查, j, a, 改, hk) {
    const id = (查.id && 协议适配.取径(j, 查.id)) || j.request_id || j.id || j.task_id || j.output?.task_id;
    const 填 = x => 协议适配.填(x, { id, apiKey: p.apiKey || '' });
    if (!id) throw new Error(`${t.名}发起了但没拿到任务号: ${JSON.stringify(j).slice(0, 200)}`);
    const failRe = new RegExp(查.fail || 'fail|error|expire|cancel|reject', 'i'), doneRe = new RegExp(查.done || 'done|succe|complete|finish', 'i');
    for (let i = 0; i < 600000 / this.间隔; i++) {
      await new Promise(r => setTimeout(r, this.间隔));
      const usePost = 查.method ? 查.method.toUpperCase() === 'POST' : !!查.body;
      const s = await 模型调用.拉(p, ad.基(p) + 填(查.path), ad.头(p, usePost, null, { id }), a.signal, usePost ? 填(查.body || {}) : undefined);
      const got = hk?.res ? hk.res(s, p) : 协议适配.件(s, t.件, 查.pick || 改?.pick);
      if (got) return got;
      const st = String((查.status && 协议适配.取径(s, 查.status)) ?? s.status ?? s.task_status ?? s.state ?? '');
      if (st && failRe.test(st)) throw new Error(`${t.名}没做成(状态 ${st}): ${JSON.stringify(s.error || s).slice(0, 200)}`);
      if (st && doneRe.test(st)) throw new Error(`${t.名}已完成(状态 ${st})但未找到结果字段(可在 adapt.poll.pick 指定): ${JSON.stringify(s).slice(0, 200)}`);
    }
    throw new Error(`${t.名}等了 10 分钟还没好, 任务号 ${id}`);
  },
  // ✂ 非文本 完
};
// ═ 各类模型 · 跟着: 协议适配, 多模态, 模型调用, 厂商配置 ═
// ✂ 图片 · 要: 非文本
const 图片 = 协议适配.加类('image', {
  后缀: '/images/generations', 测: { prompt: '一个红色圆形' },
  请求: (a, model) => ({ model, prompt: a.prompt, size: a.size, response_format: a.format }),
  件: 'image/png', 说明: '文生图: 回 {mimeType, data(base64)} 或 {url}',
  形状: { prompt: 'string', size: 'string?', format: 'b64_json|url?' },
});
// ✂ 图片 完
// ✂ 图片编辑 · 要: 图片
协议适配.加类('imageEdit', Object.assign({}, 图片, {
  后缀: '/images/edits',
  测: {   // 64x64 的灰图: 有的厂商要求宽高至少 64
    prompt: '变成蓝色',
    image: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAKklEQVR42u3MQREAAAwCIPsnM5Yh9ttBANKjCAQCgUAgEAgEA'
      + 'oFAIPgeDAQKgLWRjkNPAAAAAElFTkSuQmCC',
  },
  请求: (a, model) => 协议适配.表单({ model, prompt: a.prompt, image: a.images || a.image, mask: a.mask,
    size: a.size }, 'image/png'),
  说明: '按提示改图, 可多图可蒙版: 回同 ai.image',
  形状: { prompt: 'string', image: 'string?(base64)', images: 'string[]?', mask: 'string?(透明处重画)',
    size: 'string?' },
}));
// ✂ 图片编辑 完
// ✂ 视频 · 要: 非文本
const 视频 = 协议适配.加类('video', {
  后缀: '/videos/generations', 查: '/videos/{id}', 件: 'video/mp4',
  // 尾帧: 标记(界面照它多一格「尾帧字段」), 也是写法: 填的字段名记进这一类的接口改法, 回新的改法; 没填就叫 last_image
  尾帧: (改, 名) => (({ 尾帧, ...别 }) => 名 ? { ...别, 尾帧: 名 } : Object.keys(别).length ? 别 : null)(改 || {}),
  测: { prompt: '一只猫挥手', duration: 1 },
  请求(a, model, p) {
    const 帧 = v => v ? { url: 协议适配.网址(v, 'image/png') } : undefined;
    return { model, prompt: a.prompt, image: 帧(a.image), [p.adapt?.video?.尾帧 || 'last_image']: 帧(a.lastImage),
      duration: a.duration, aspect_ratio: a.ratio, resolution: a.resolution };
  },
  说明: '文生视频; 给 image 是图生视频(首帧), 再给 lastImage 是首尾帧; 要等一两分钟: 回 {url}',
  形状: { prompt: 'string', image: 'string?(首帧: base64、data 网址或网址, 也可给 {data, mimeType})',
    lastImage: 'string?(尾帧, 同首帧)', duration: 'number?', ratio: 'string?(如 16:9)', resolution: 'string?' },
});
// ✂ 视频 完
// ✂ 视频编辑 · 要: 视频
协议适配.加类('videoEdit', Object.assign({}, 视频, {
  后缀: '/videos/edits', 尾帧: null,
  测: s => s ? { prompt: '把画面调成黑白', video: s }
    : (() => { throw new Error('视频编辑要拿一段现成的视频(mp4 网址)当素材才能测'); })(),
  请求: (a, model) => ({ model, prompt: a.prompt, video: { url: 协议适配.网址(a.video, 'video/mp4') } }),
  说明: '按提示改一段现成的视频: 回 {url}', 形状: { prompt: 'string', video: 'string(mp4 网址)' },
}));
// ✂ 视频编辑 完
// ✂ 转录 · 要: 非文本
协议适配.加类('stt', {
  后缀: '/audio/transcriptions',
  // 一段空 wav
  测: { audio: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=', mimeType: 'audio/wav' },
  请求: (a, model) => 协议适配.表单(Object.assign({
    file: typeof a.audio === 'string' ? { data: a.audio, mimeType: a.mimeType } : a.audio,
    model, language: a.language, prompt: a.prompt,
  }, a.timestamps ? { response_format: 'verbose_json', 'timestamp_granularities[]': 'word' } : {}), 'audio/webm'),
  回复: async (res, p) => {   // 有的厂商回纯文本; 回事件流的取最后一条(带全文)。带了逐字/逐词时间的顺手收成 words
    const t = await res.text();
    if (!/^\s*(\{|data:)/.test(t)) return { text: t };
    const r = await 协议适配.取('转录文字', j => typeof j.text === 'string' && { text: j.text })(t, p), words = [];
    if (/^\s*data:/.test(t)) t.split('\n').forEach(l => {   // 事件流: delta 行带 start_time / end_time(毫秒)
      if (!l.startsWith('data:')) return; let m; try { m = JSON.parse(l.slice(5)); } catch (e) { return; }
      if (m && m.delta != null && m.start_time != null) words.push({ text: m.delta, start: m.start_time / 1000, end: m.end_time / 1000 });
    });
    else { try { const j = JSON.parse(t); (j.words || (j.segments || []).flatMap(s => s.words || [])).forEach(w => words.push({ text: w.word ?? w.text, start: w.start, end: w.end })); } catch (e) {} }
    return words.length ? Object.assign(r, { words }) : r;
  },
  // 别种写法: 事件流识别接口(JSON 进, data: 行出), 录音要 wav
  备: [{ path: '/audio/asr/sse', body: { audio: { data: '{audio}', input: { transcription: { model: '{model}',
    language: '{language}', enable_timestamp: '{timestamps}' }, format: { type: 'wav' } } } } }],
  能力: 'ai.transcribe', 说明: '语音转文字: 回 {text}; 给 timestamps: true 还回 words: [{text, start, end}](秒, 厂商给了才有)',
  形状: { audio: 'string(base64)', mimeType: 'string?(默认 audio/webm)', language: 'string?', prompt: 'string?',
    timestamps: 'boolean?(要逐字/逐词时间)' },
});
// ✂ 转录 完
// ✂ 语音 · 要: 非文本
// 文字转语音那一行 + 按模型问厂商要音色(双工也用它)。不叫「语音」: 和 agent 的撞名
const 朗读 = {
  行: 协议适配.加类('tts', {
    后缀: '/audio/speech', 音色: true, 语速: true, 测: { text: '你好, 这是现在选的音色。' },
    请求: (a, model, p) => ({
      model, input: String(a.text ?? ''),
      voice: a.voice || p.voiceOf?.tts || 朗读.首(p, model),
      response_format: a.format, speed: a.speed || p.speed, instructions: a.instructions,
    }),
    回复: async (res, p) => {
      const mimeType = (res.headers.get('content-type') || 'audio/mpeg').split(';')[0];
      if (/json/.test(mimeType)) 协议适配.没给(p, '音频', await 协议适配.读(res, p));
      return { mimeType, data: 协议适配.成base64(await res.arrayBuffer()) };
    },
    // 别种写法: generate 接口(有的模型只认它), 台词放 scripts
    备: [{ path: '/audio/generate', body: { input: null, voice: null, instructions: null,
      task: 'text_to_audio', scripts: [{ text: '{text}' }], instruction: '{instructions}' } }],
    能力: 'ai.speak', 说明: '文字转语音: 回 {mimeType, data(base64)}; 音色、语速不给就用厂商记录里存的',
    形状: { text: 'string', voice: 'string?', speed: 'number?', format: 'string?(mp3|wav)',
      instructions: 'string?(语气)' },
    另: [['ai.voices', async a => (await 朗读.音色(await 厂商配置.选(a, a.type || 'tts'), a.type || 'tts', a)).voices, {
      desc: '按模型问厂商要音色: 回 [{id, name}](厂商给多少列多少, 空表就是它没给; 顺手存下给界面的下拉用)。'
        + '不给 model 就用这一类现在选的',
      schema: { provider: 'string?', type: 'tts|realtime?(默认 tts)', model: 'string?' }, frames: false }]],
  }),
  // 音色没有标准接口: 常见两条路径带着模型名都问, 回的合起来; 填的入口都没问到, 再问同域名的 /v1
  // (有的厂商只在那开音色接口; 只有音色这样, 绝不去别的域名)
  音色后缀: ['/audio/voices', '/audio/system_voices'],
  首: (p, m) => ((p.voices?.[m] || [])[0] || {}).id,   // 没选音色用拉到的第一个: 有的厂商不给音色就拒
  async 音色(p, 类, a) {   // 回 {voices: [{id, name}], asked: 每条路问到了什么, model}; 不写死任何音色
    const model = 多模态.模型(p, 类, a), ad = 模型调用.适配(p), 填的 = ad.基(p), voices = [], asked = [];
    let 通 = 0;
    for (const b of new Set([填的, `${new URL(填的).origin}/v1`])) for (const x of voices.length ? [] : 朗读.音色后缀) {
      try {
        const n = voices.length, j = await 模型调用.拉(p, b + x + '?model=' + encodeURIComponent(model), ad.头(p));
        const 详 = j['voices-details'] || {};
        (j.data || j.voices || []).forEach(v => {
          const id = v.id || v.voice_id || v.name || v, d = 详[id] || v;
          if (typeof id === 'string' && !voices.some(w => w.id === id))
            voices.push({ id, name: d['voice-name'] || d.display_name || d.name || id });
        });
        通++;
        asked.push(b + x + ' → ' + (voices.length - n) + ' 个');
      } catch (e) {
        asked.push(b + x + ' → ' + (e.status === 404 ? '没有这个接口' : e.message.slice(0, 120)));   // 404 不是填错了
      }
    }
    // 一个都没有(双工模型常这样)就借同家选了的、名字像语音的模型的, 不问对话模型
    const 借谁 = [...new Set([p.modelOf?.tts]
      .concat(厂商配置.候选(p, 'tts').filter(m => 厂商配置.像.tts.test(m))))];
    for (const m of voices.length || a.借 ? [] : 借谁.filter(m => m && m !== model).slice(0, 3)) {
      const r = await this.音色(p, 'tts', { model: m, 借: 1 }).catch(() => null);
      if (r?.voices.length) {
        voices.push(...r.voices);
        asked.push(`借 ${m} 的`);
        break;
      }
    }
    if (!通 && !voices.length) throw new Error(`拉不到音色(这家可能没给音色表, 照它的文档手填): ${asked.join(' | ')}`);
    await 厂商配置.更新(p.id, { voices: { [model]: voices.length ? voices : null } });
    return { voices, asked, model };
  },
};
// ✂ 语音 完
// ✂ 双工 · 要: 语音, 工具, 测通
// 双工语音: 一条 WebSocket 边听边说。浏览器的 WebSocket 设不了请求头, Key 走子协议(OpenAI 的写法, 别家也认), 不进网址;
//   不走转发地址: 浏览器不拦 WebSocket 跨域
// 事件名新旧两套都认, 认不出的不理; 对外一套:
//   audio text heard toolCall{id,name,args} turnDone error close。断句由调用方做(服务端断句门槛高、它说话时听不见插话)
const 双工 = {
  开着: new Set(),   // 还连着的会话的"关"函数, 本块卸载时一起关
  async open(p, a) {
    if (a.signal?.aborted) throw a.signal.reason || new Error('已取消');
    const ad = 模型调用.适配(p), model = 多模态.模型(p, 'realtime', a);
    const url = `${ad.端点(p, 'realtime').replace(/^http/, 'ws')}?model=${encodeURIComponent(model)}`;
    let ws;
    try {
      ws = new WebSocket(url, ['realtime'].concat(p.apiKey ? `openai-insecure-api-key.${p.apiKey}` : []));
    } catch (e) {   // 浏览器的原话里带着整个子协议(也就是整把 Key), 不能原样往外报
      throw 厂商错(p, '的双工连接建不起来: 多半是 Key 里有不许用的字符(空格、/、= 等),'
        + ' 检查是不是粘贴时多带了东西');
    }
    return new Promise((成, 败) => {
      const 听 = {}, 喊 = (k, v) => (听[k] || []).slice().forEach(f => f(v));
      let 就绪 = false, 已关 = false, 在答 = false, 等答 = false;
      const 待 = new Set();   // 它要了、结果还没回的工具
      const 发 = o => {
        if (已关 || ws.readyState !== 1) throw new Error('双工连接已关');
        ws.send(JSON.stringify(o));
      };
      const 请答 = () => {   // 上一段还没完就再请厂商会拒, 工具没回齐就请它会乱说: 记下来, 等齐了再请
        等答 = 在答 || 待.size > 0;
        if (等答) return;
        在答 = true;
        发({ type: 'response.create' });
      };
      const 关 = () => {
        if (已关) return;
        已关 = true;
        clearTimeout(timer);
        this.开着.delete(关);
        try { ws.close(); } catch (e) { }
        败(new Error('双工还没就绪就关了'));   // 已经就绪的话这句不起作用
        喊('close');
      };
      const timer = setTimeout(() => {
        败(new Error('双工 15 秒没就绪: 核对网址、Key 和模型'));
        关();
      }, 15000);
      const api = {
        on(k, f) {
          (听[k] = 听[k] || []).push(f);
          return () => { 听[k] = 听[k].filter(x => x !== f); };
        },
        发音频: audio => 发({ type: 'input_audio_buffer.append', audio }),
        清音频: () => 发({ type: 'input_audio_buffer.clear' }),   // 攒着还没提交的不要了
        提交() {
          发({ type: 'input_audio_buffer.commit' });
          请答();
        },
        发文字(text) {
          const content = [{ type: 'input_text', text: String(text) }];
          发({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content } });
          请答();
        },
        回工具(id, out) {
          待.delete(id);
          const item = { type: 'function_call_output', call_id: id,
            output: typeof out === 'string' ? out : JSON.stringify(out) };
          发({ type: 'conversation.item.create', item });
          请答();
        },
        打断() {
          等答 = false;
          if (在答) 发({ type: 'response.cancel' });
        },
        关,
      };
      this.开着.add(关);
      if (a.signal) a.signal.addEventListener('abort', 关, { once: true });
      ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        const ty = m.type;
        if (ty === 'session.created')
          return 发({ type: 'session.update', session: ad.类型.realtime.会话(a, p, model) });
        if (ty === 'session.updated' && !就绪) {
          就绪 = true;
          clearTimeout(timer);
          return 成(api);
        }
        if (ty === 'error') {
          const 原话 = (m.error && (m.error.message || m.error.code)) || m.message || JSON.stringify(m);
          const e = new Error(`双工接口报错: ${原话}`);
          if (就绪) return 喊('error', e);
          败(e);
          return 关();
        }
        if (ty === 'response.created') 在答 = true;
        if (ty === 'response.done' || ty === 'response.cancelled') {
          在答 = false;
          if (m.response?.status === 'failed')
            喊('error', new Error(`这一段没答成: ${JSON.stringify(m.response.status_details)}`));
          喊('turnDone', m);
          if (等答) 请答();
          return;
        }
        if (ty === 'response.function_call_arguments.done' && !待.has(m.call_id))
          return 待.add(m.call_id), 喊('toolCall', { id: m.call_id, name: m.name, args: 协议适配.解参(m.arguments) });
        const k = /^response\.(output_)?audio\.delta$/.test(ty) ? 'audio'
          : /^response\.(output_)?(audio_transcript|text)\.delta$/.test(ty) ? 'text'
          : /input_audio_transcription\.completed$/.test(ty) ? 'heard' : '';
        if (k) 喊(k, m.delta !== undefined ? m.delta : m.transcript !== undefined ? m.transcript : m);
      };
      ws.onclose = e => {   // 选了不是双工的模型, 厂商多半直接关(关闭码 1006)
        败(new Error('双工没连上(关闭码 ' + e.code + '): ' + (厂商配置.像.realtime.test(model) ? '核对网址、Key 和模型'
          : `「${model}」看名字不像双工模型(一般带 realtime), 换一个`)));
        关();
      };
    });
  },
};
ctx.cleanup(() => 双工.开着.forEach(关 => 关()));
协议适配.加类('realtime', {   // 工具两种写法合一条: 有的厂商要嵌套的 function, OpenAI 要平铺的 name
  后缀: '/realtime', 音色: true, 能力: 'ai.realtime', 开: (p, a) => 双工.open(p, a),
  说明: '开一条双工语音会话(给界面代码用): 回 {on(事件, 回调), 发音频(base64 pcm16 24k), 提交(), 发文字(),'
    + ' 回工具(id, 结果), 打断(), 关()}; 事件 audio|text|heard|toolCall|turnDone|error|close; 断句自己做, 说完一句调 提交()',
  形状: { voice: 'string?', instructions: 'string?', tools: '[{name, description, parameters}]?' },
  会话: (a, p, model) => ({
    modalities: ['text', 'audio'], instructions: a.instructions,
    voice: a.voice || p.voiceOf?.realtime || 朗读.首(p, model),
    input_audio_format: 'pcm16', output_audio_format: 'pcm16',
    turn_detection: null,
    tools: a.tools?.length
      ? a.tools.map(t => Object.assign({ type: 'function', function: 协议适配.工具(t) }, 协议适配.工具(t))) : undefined,
  }),
});
// ✂ 双工 完
// ✂ 嵌入 · 要: 非文本
协议适配.加类('embedding', {
  后缀: '/embeddings', 测: { input: '你好' },
  请求: (a, model) => ({ model, input: a.input, dimensions: a.dimensions }),
  回复: 协议适配.取('向量', j => j.data?.length && { embeddings: j.data.map(x => x.embedding) }),
  能力: 'ai.embed', 说明: '文字变向量: 回 {embeddings}, 和 input 一一对应',
  形状: { input: 'string|string[]', dimensions: 'number?' },
});
// ✂ 嵌入 完
// ✂ 重排 · 要: 非文本
协议适配.加类('rerank', {
  后缀: '/rerank', 测: { query: '测试', documents: ['相关的文档', '无关的内容'] },
  请求: (a, model) => ({ model, query: a.query, documents: a.documents, top_n: a.topN }),
  回复: 协议适配.取('排序结果', j => j.results?.length
    && { results: j.results.map(x => ({ index: x.index, score: x.relevance_score })) }),
  说明: '按相关度给文档排序: 回 {results: [{index, score}]}',
  形状: { query: 'string', documents: 'string[]', topN: 'number?' },
});
// ✂ 重排 完
// ✂ 音乐 · 要: 非文本
协议适配.加类('music', {
  后缀: '/music/generations', 测: { prompt: '十秒轻快钢琴' }, 件: 'audio/mpeg',
  请求: (a, model) => ({ model, prompt: a.prompt, lyrics: a.lyrics }),
  // 别种写法: 先提交再查
  备: [{ path: '/audio/music/submit', body: { model: null, prompt: null, model_id: '{model}',
    task: 'text_to_music', caption: '{prompt}', response_format: 'mp3' },
    poll: { path: '/audio/music/query', body: { task_id: '{id}' } } }],
  说明: '文字生成音乐: 回 {mimeType, data(base64)} 或 {url}',
  形状: { prompt: 'string', lyrics: 'string?' },
});
// ✂ 音乐 完
// ═ 厂商配置 · 跟着: 模型调用, 协议适配 · 借用者: petri:agent, petri:code, petri:workflow ═
// 厂商记录住在 kv, 写入排队串行: 并发的读-改-写会互相丢更新
// 一条记录: {id, name, protocol, endpoint(版本前缀), apiKey, model(文本用的), modelOf{类: 模型}, models[拉来的],
//   hints{模型: 厂商给的类型}, passed{类: {model, at}}(测通记录), notes{模型: 标注}, voiceOf{类: 音色},
//   voices{模型: [{id, name}]}(拉来的音色), speed(语速), toolMode, concurrency, maxOut(单次最多写几 token),
//   adapt{类: {path, body, poll, 尾帧}}(和兼容协议不一样的地方), proxy(转发地址: 这家的请求全经它转)}
const 厂商配置 = {
  键: 'settings:ai.providers', 默认键: 'settings:ai.activeProviderId', 用键: 'settings:ai.use',
  队列: Promise.resolve(),
  通知() { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('ai:providers')); },
  async 列表() { return (await ctx.kv.get(this.键)) || []; },
  async 默认id() { return (await ctx.kv.get(this.默认键)) || null; },
  写(fn) {
    const job = this.队列.then(async () => {
      const list = await this.列表(), out = await fn(list);
      await ctx.kv.set(this.键, list);
      this.通知();
      return out;
    });
    this.队列 = job.catch(() => { });
    return job;
  },
  合(old, patch) {   // 小表只传要改的, 值 null 就删那一条; 网址存时就剥成版本前缀
    const p = Object.assign({}, old, patch, { id: old.id });
    ['modelOf', 'passed', 'notes', 'voiceOf', 'voices', 'adapt'].forEach(k => {
      if (!patch[k]) return;
      p[k] = Object.assign({}, old[k], patch[k]);
      Object.keys(p[k]).forEach(n => { if (p[k][n] == null) delete p[k][n]; });
    });
    const ad = 模型调用.适配(p);
    // 没写 http(s):// 的话浏览器会当成相对网址, 带着 Key 发给托管这个页面的服务器
    [['endpoint', 'API 网址', '。例: https://api.xxx.com/v1'], ['proxy', '转发地址', '']].forEach(([k, 名, 例]) => {
      if (p[k] && !(k === 'endpoint' && ad.自管端点) && !/^https?:\/\//i.test(String(p[k]).trim()))
        throw new Error(名 + '要以 http(s):// 开头, 收到: ' + p[k] + 例);
    });
    if (!p.endpoint && p.apiKey)   // 没网址会落到默认网址, Key 就发给了别家
      throw 厂商错(p, '填了 Key 就得填 API 网址, 不然这把 Key 不知道发给谁; 要换就填新的');
    p.endpoint = p.endpoint ? (ad.基址 ? ad.基址(p) : String(p.endpoint).trim()) : '';
    return p;
  },
  async 新增(p) {
    return this.写(async list => {
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const np = this.合({ id, protocol: 'openai-compatible', models: [] }, p);
      list.push(np);
      if (list.length === 1) await ctx.kv.set(this.默认键, np.id);
      return np;
    });
  },
  位(list, id) {
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('找不到这个厂商, 可能刚被删了');
    return i;
  },
  async 更新(id, patch) {
    return this.写(list => {
      const i = this.位(list, id);
      return list[i] = this.合(list[i], patch);
    });
  },
  async 拉模型(p) {
    return this.更新(p.id, await 模型调用.models(p));
  },
  async 找(ref) {
    const list = await this.列表();
    return list.find(x => x.id === ref) || list.find(x => x.name === ref) || null;
  },
  async 要(ref) {
    const p = await this.找(ref);
    if (p) return p;
    const 有 = (await this.列表()).map(x => x.name).join(', ');
    throw new Error((ref ? '找不到厂商「' + ref + '」' : '缺 provider(厂商名)') + '。已有: ' + (有 || '一个都还没配'));
  },
  async 选(a, 类) {   // 指定厂商 > (文本)有这个模型的厂商 / (别的类)选了这一类模型的厂商 > 默认厂商
    const list = await this.列表();
    if (!list.length) throw new Error('还没有配置 AI 厂商: 先在「AI 配置」里添加一个');
    if (a.provider) return this.要(a.provider);
    const did = await this.默认id(), active = list.find(x => x.id === did) || list[0];
    // ✂ 非文本
    if (类 && 类 !== 'chat') {
      const hit = a.model ? active : await this.用(类);
      if (hit) return hit;
      throw new Error(`还没有哪家厂商选了${this.表({})[类].名}模型: 在「AI 配置」里给某个厂商选一个`);
    }
    // ✂ 非文本 完
    if (!a.model) return active;
    const has = p => p.model === a.model || (p.models || []).includes(a.model);
    if (has(active)) return active;
    const hits = list.filter(has);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1)
      throw new Error(`模型「${a.model}」在多家都有(${hits.map(p => p.name).join(' / ')}), 要说清用哪一家`);
    if ((active.models || []).length)
      throw new Error(`模型「${a.model}」不在任何已配厂商的模型清单里: 检查拼写, 或先拉取模型清单`);
    return active;
  },
  async 用(类) {   // 这一类用哪家: 选模型里选过的('' = 不用) > 默认厂商选了这类的 > 按顺序第一家选了的
    const list = await this.列表(), u = ((await ctx.kv.get(this.用键)) || {})[类], did = await this.默认id();
    const 选的 = list.find(p => p.id === u);
    return 选的 || u === '' ? 选的 || null
      : list.filter(p => p.id === did).concat(list).find(p => p.modelOf?.[类]) || null;
  },
  // ✂ 非文本
  async 设用(类, id) {
    await ctx.kv.set(this.用键, Object.assign((await ctx.kv.get(this.用键)) || {}, { [类]: id }));
    this.通知();
  },
  // ✂ 非文本 完
  // 协议认不出(如提供它的块停用了)也不抛, 免得一条坏记录拖垮清单和界面; 真调用时才报错
  表: p => (协议适配[p.protocol] || 协议适配['openai-compatible']).类型,
  // 各类模型的名字像什么(只排候选用), 「这个模型像哪一类」全 Colony 只认这一处(工作流的下拉也是用它排过的清单)。
  // 不圈在各类的范围里: 只剪进来几类时, 别类的模型也认得出, 文本的候选才不混进别类的
  像: (() => {
    const 图 = /image|img|dall|flux|diffusion|画|图/i, 视 = /video|veo|sora|kling|hailuo|2v|视/i;
    return { image: 图, imageEdit: 图, video: 视, videoEdit: 视, stt: /asr|whisper|transcri|stt|语音识别/i,
      tts: /tts|speech|audio|音|声/i, realtime: /realtime|实时/i, embedding: /embed/i, rerank: /rerank/i,
      music: /music|song|suno/i };
  })(),
  候选(p, 类) {   // 拉来的模型里像这一类的(看名字和厂商标的类型); 都不像就给全量, 不让人没得选
    const all = p.models || [], 像 = (m, k) => !!厂商配置.像[k]?.test(`${m} ${p.hints?.[m] || ''}`);
    const hit = all.filter(m => 类 === 'chat' ? !Object.keys(厂商配置.像).some(k => 像(m, k)) : 像(m, 类));
    return hit.length ? hit : all;
  },
  文本(p) {   // 这家列哪些文本模型(新数组): 拉来的里像文本的, 用着的那个不在里面就排第一
    const ms = 厂商配置.候选(p, 'chat');
    return p.model && !ms.includes(p.model) ? [p.model].concat(ms) : ms.slice();
  },
  // ✂ 多家厂商 · 要: 厂商配置
  async 设默认(id) {
    await ctx.kv.set(this.默认键, id);
    this.通知();
  },
  async 删除(id) {
    await this.写(async list => {
      list.splice(this.位(list, id), 1);
      if ((await this.默认id()) === id) await ctx.kv.set(this.默认键, list[0] ? list[0].id : null);
    });
  },
  摘要(p, did) {   // 给外面看的: 不带 Key; 类型提示和音色表不小也不带(音色走 ai.voices)
    const o = Object.assign({ model: '', models: [], modelOf: {}, voiceOf: {}, passed: {}, notes: {},
      toolMode: 'native' }, p);
    ['apiKey', 'hints', 'voices'].forEach(k => delete o[k]);
    return Object.assign(o, { tested: !!o.passed.chat, default: p.id === did });
  },
  // ✂ 多家厂商 完
};
// ═ 界面样式 ═
// 三个颜色在 .ai-card 上各起短名(带兜底色, 没界面块也能看), 下面都用短名
const 界面样式 = `.ai-card{--m:var(--text-muted,#8a8a8a);--a:var(--accent,#B5FF00);
--l:var(--border,rgba(255,255,255,.08));padding:16px;color:var(--text,#fafafa);
font-family:var(--sans,-apple-system,"PingFang SC",sans-serif);font-size:13px}
.ai-hint,.ai-chip,.ai-add,.ai-label,.ai-btn,.ai-cap,.ai-sp,.ai-card summary,.ai-tab{color:var(--m)}
.ai-bar,.ai-chip,.ai-in,.ai-btn,.ai-cap,.ai-tab,.ai-sub-card{border:1px solid var(--l)}
.ai-card button,.ai-card summary{cursor:pointer}
.ai-bar,.ai-acts,.ai-check,.ai-sp,.ai-tabs,.ai-pw{display:flex;align-items:center;gap:8px}
.ai-tabs{gap:6px;margin-bottom:10px}.ai-tab{background:var(--bg-2,#131313);padding:6px 14px;border-radius:10px;font-size:12px}
.ai-tab.cur{color:var(--a);border-color:var(--a);background:rgba(181,255,0,.07)}
.ai-hint{font-size:11px;line-height:1.6;margin:0 0 12px}
.ai-bar{gap:6px;flex-wrap:wrap;padding:10px;background:var(--bg,#0a0a0a);border-radius:12px;
margin-bottom:10px}.ai-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;
border-radius:999px;background:var(--bg-2,#131313);font-size:12px}
.ai-chip .dot{width:6px;height:6px;border-radius:50%;background:#555}.ai-chip.tested .dot{background:var(--a)}
.ai-chip.cur{color:inherit;border-color:rgba(255,255,255,.3)}.ai-add{width:30px;height:30px;border-radius:8px;
border:1px dashed rgba(255,255,255,.3);background:transparent;font-size:15px}
.ai-label{display:block;font-size:10px;margin:12px 0 6px}.ai-in{width:100%;box-sizing:border-box;
background:var(--bg,#0a0a0a);color:var(--text,#fafafa);padding:9px 12px;border-radius:10px;font-size:13px;
font-family:inherit}.ai-in:focus{outline:none;border-color:var(--a)}
.ai-pw{gap:6px}.ai-pw .ai-in{flex:1;min-width:0}
.ai-ico{padding:7px 9px;min-width:34px;text-align:center}
.ai-row{display:flex;gap:8px;margin-top:6px;align-items:center}.ai-row .ai-in{flex:1}
.ai-row select.ai-in{flex:0 1 auto;width:auto;min-width:0}
.ai-btn{background:transparent;padding:8px 14px;border-radius:10px;font-size:12px;white-space:nowrap}
.ai-btn:hover{color:var(--a);border-color:var(--a)}.ai-btn.pri{background:var(--a);color:#0a0a0a;border-color:var(--a);font-weight:600}
.ai-btn:disabled{opacity:.5;cursor:default}.ai-result{margin-top:10px;padding:10px 14px;
border-radius:8px;font-size:12px;line-height:1.5;white-space:pre-wrap}
.ai-result.ok{background:rgba(181,255,0,.08);border:1px solid rgba(181,255,0,.3);color:var(--a)}
.ai-result.bad{background:rgba(255,87,87,.08);border:1px solid rgba(255,87,87,.3);color:#ff9292}
.ai-check{font-size:12px;margin-top:12px}.ai-acts{margin-top:12px;flex-wrap:wrap}
.ai-caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ai-cap{background:none;font-size:10px;padding:2px 8px;border-radius:999px}
.ai-cap.ok{border-color:var(--a);color:var(--a)}span.ai-cap{border-style:dashed}
.ai-cap.wait{border-color:#f5c542;color:#f5c542}
.ai-card details{margin-top:12px}.ai-card summary{font-size:12px}
.ai-btn.danger:hover,.ai-btn.warn{color:#ff6b6b;border-color:#ff6b6b}.ai-narrow{width:auto;flex:none}
.ai-sp{gap:6px;font-size:12px}.ai-sp .ai-in{flex:none;width:76px}
.ai-sub-card{border-radius:12px;padding:12px 14px;margin-top:10px;background:rgba(255,255,255,.02)}
.ai-sub-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ai-sub-hd .sp{flex:1}.ai-sub-code{font:700 16px/1.2 var(--mono,monospace);letter-spacing:2px;color:var(--a);
background:var(--bg,#0a0a0a);padding:4px 10px;border-radius:8px;border:1px solid var(--l)}
.ai-sub-box{margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.03);font-size:12px;line-height:1.6}
.ai-sub-box a{color:var(--a);word-break:break-all}
.ai-sub-ch{margin-top:8px;padding-top:8px;border-top:1px dashed var(--l)}
.ai-sub-ch .ai-btn{padding:5px 10px;font-size:11px}`;
// ═ 订阅与网关 · 跟着: 网络请求, 协议适配, 模型调用, 厂商配置 ═
// 本机聚合网关(:4135 私有 OpenRouter + 网页模型反桥)与纯插件 4 家 OAuth 订阅引擎
const 插件订阅 = (() => {
  const send = (op, req, ms) => 网络请求.插件发(op, req, ms), stream = (req, sg) => 网络请求.插件流(req, sg, false);
  const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pkce = async () => {
    const v = b64u(crypto.getRandomValues(new Uint8Array(32))), st = b64u(crypto.getRandomValues(new Uint8Array(18)));
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return { verifier: v, challenge: b64u(new Uint8Array(h)), state: st };
  };
  const jwt = t => { try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
  const pfetch = async (url, opt = {}) => {
    const r = await send('fetch', Object.assign({ url, method: 'GET', timeout: 30000 }, opt), (opt.timeout || 30000) + 2000);
    let json = null; try { json = r.text ? JSON.parse(r.text) : null; } catch {}
    return { ok: r.status >= 200 && r.status < 300, status: r.status || 0, text: r.text || '', json };
  };
  const AG_UA = 'antigravity/hub/2.34.0 (aidev_client; os_type=darwin; arch=arm64; cl=1026637980)';
  const S = {
    'grok-build': {
      name: 'Grok Build', providerName: '订阅 · Grok Build (插件)', desc: 'xAI 设备码 OAuth（免本机进程，手机/桌面装插件即用）',
      mode: 'device', clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
      scope: 'openid profile email offline_access grok-cli:access api:access',
      disc: 'https://auth.x.ai/.well-known/openid-configuration',
      apiBase: 'https://cli-chat-proxy.grok.com/v1', apiUrl: 'https://cli-chat-proxy.grok.com/v1/responses', modelsUrl: 'https://cli-chat-proxy.grok.com/v1/models', apiStyle: 'responses',
      dnr: { 'User-Agent': 'xai-grok-workspace/1.0.46' },
      extraHeaders: { 'X-XAI-Token-Auth': 'xai-grok-cli', 'x-grok-client-version': '1.0.46', 'x-grok-client-identifier': 'grok-shell' },
      extraModels: ['grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality', 'grok-imagine-video', 'grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite'],
      models: [
        'grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5',
        'grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-video', 'grok-imagine-video-1.5',
      ],
    },
    chatgpt: {
      name: 'ChatGPT', providerName: '订阅 · ChatGPT (插件)', desc: 'ChatGPT Codex OAuth（插件直截回调，免本机进程）',
      mode: 'pkce', clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
      authUrl: 'https://auth.openai.com/oauth/authorize', tokenUrl: 'https://auth.openai.com/oauth/token',
      redirect: 'http://localhost:1455/auth/callback', scope: 'openid profile email offline_access',
      extraAuth: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'codex_cli_rs' },
      apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
      modelsUrl: 'https://chatgpt.com/backend-api/codex/models?client_version=0.154.0', apiStyle: 'responses',
      dnr: { 'User-Agent': 'codex-tui/0.154.0 (Mac OS 26.5.2; arm64)' }, extraHeaders: { originator: 'codex-tui' },
      models: ['gpt-6.2-astra', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-mini'],
    },
    antigravity: {
      name: 'Antigravity', providerName: '订阅 · Antigravity (插件)', desc: 'Google OAuth（插件直截回调，支持 Gemini 4 与 Claude）',
      mode: 'pkce', clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      clientSecret: ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('-'),
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
      redirect: 'http://localhost:51121/oauth-callback',
      scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/aicode https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
      extraAuth: { access_type: 'offline', prompt: 'consent' },
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse', apiStyle: 'cloudcode',
      dnr: { 'User-Agent': AG_UA },
      models: ['gemini-4-neon-xhigh', 'gemini-4-hydrogen-xhigh', 'gemini-4-argon-high', 'gemini-4-carbon-high',
        'claude-opus-5-5-high', 'claude-sonnet-5-5-high', 'claude-opus-4-6-thinking', 'claude-sonnet-4-6',
        'gemini-3.8-flash-high', 'gemini-3.8-flash-tiered', 'gemini-3.5-flash-lite', 'gemini-3-flash',
        'gemini-3.1-flash-lite', 'gemini-3.1-flash-image', 'gpt-oss-120b-medium'],
    },
    claude: {
      name: 'Claude', providerName: '订阅 · Claude (插件)', desc: 'Claude Code OAuth（插件直截回调，免本机进程）',
      mode: 'pkce', clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      authUrl: 'https://claude.ai/oauth/authorize', tokenUrl: 'https://platform.claude.com/v1/oauth/token',
      redirect: 'http://localhost:54545/callback', jsonToken: true,
      scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
      extraAuth: { code: 'true' }, apiUrl: 'https://api.anthropic.com/v1/messages', modelsUrl: 'https://api.anthropic.com/v1/models',
      apiStyle: 'anthropic', dnr: { 'User-Agent': 'claude-code/2.1.0' },
      extraHeaders: { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' },
      models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    },
  };
  const pending = {}, okState = { available: false };
  const store = (action, id, value) => send('subStore', { action, id, value }, 5000).then(r => r.data);
  const pickPid = o => {
    for (const k of ['cloudaicompanionProject', 'projectId', 'project']) {
      const v = o?.[k]; if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v.id === 'string' && v.id.trim()) return v.id.trim();
    }
    return '';
  };
  const agProject = async tok => {
    const r = await pfetch('https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
      method: 'POST', dnrHeaders: S.antigravity.dnr,
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    }).catch(() => null);
    let pid = pickPid(r?.json);
    if (pid) return pid;
    const tier = (r?.json?.allowedTiers || []).find(t => t?.isDefault)?.id || r?.json?.currentTier?.id || 'free-tier';
    for (let i = 0; i < 4; i++) {
      const ob = await pfetch('https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser', {
        method: 'POST', dnrHeaders: { 'User-Agent': AG_UA + ' google-api-nodejs-client/10.3.0' },
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'X-Goog-Api-Client': 'gl-node/22.21.1' },
        body: JSON.stringify({ tier_id: tier, metadata: { ide_type: 'ANTIGRAVITY', ide_version: '2.34.0', ide_name: 'antigravity' } }),
      }).catch(() => null);
      if (ob?.json?.done) { pid = pickPid(ob.json.response); if (pid) return pid; break; }
      await new Promise(ok => setTimeout(ok, 1800));
    }
    return '';
  };
  const saveToken = async (id, j, old) => {
    const claims = jwt(j.id_token) || jwt(j.access_token) || {}, auth = claims['https://api.openai.com/auth'] || {};
    const rec = {
      accessToken: j.access_token, refreshToken: j.refresh_token || old?.refreshToken || '',
      expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      email: j.account?.email_address || claims.email || old?.email || '',
      accountId: auth.chatgpt_account_id || j.account?.uuid || old?.accountId || '',
      projectId: old?.projectId || '', models: old?.models || null,
    };
    if (id === 'antigravity') {
      if (!rec.email) {
        const u = await pfetch('https://www.googleapis.com/oauth2/v2/userinfo?alt=json', {
          dnrHeaders: S.antigravity.dnr, headers: { Authorization: 'Bearer ' + rec.accessToken },
        }).catch(() => null);
        if (u?.json?.email) rec.email = u.json.email;
      }
      if (!rec.projectId) rec.projectId = await agProject(rec.accessToken);
    }
    await store('set', id, rec);
    return rec;
  };
  const refreshFlight = new Map();
  const ensure = async (id, force) => {
    const c = await store('get', id), cfg = S[id];
    if (!c?.accessToken) throw new Error(`${cfg.name} 尚未登录（插件模式）`);
    if (!force && c.expiresAt && Date.now() < c.expiresAt - 120000 && (id !== 'antigravity' || c.projectId)) return c;
    if (refreshFlight.has(id)) return refreshFlight.get(id);
    const prevTok = c.accessToken;
    const job = (async () => {
      const latest = (await store('get', id)) || c;
      if (!force && latest.expiresAt && Date.now() < latest.expiresAt - 120000 && (id !== 'antigravity' || latest.projectId)) return latest;
      if (force && latest.accessToken && latest.accessToken !== prevTok) return latest;
      if (!latest.refreshToken) {
        if (id === 'antigravity' && !latest.projectId) {
          latest.projectId = await agProject(latest.accessToken);
          await store('set', id, latest);
          return latest;
        }
        throw new Error(`${cfg.name} 登录已过期，请重新登录`);
      }
      const tUrl = cfg.tokenUrl || (await pfetch(cfg.disc)).json?.token_endpoint;
      const params = { grant_type: 'refresh_token', refresh_token: latest.refreshToken, client_id: cfg.clientId };
      if (cfg.clientSecret) params.client_secret = cfg.clientSecret;
      if (id === 'claude') params.scope = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';
      const r = await pfetch(tUrl, {
        method: 'POST',
        headers: {
          'Content-Type': cfg.jsonToken ? 'application/json' : 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: cfg.jsonToken ? JSON.stringify(params) : new URLSearchParams(params).toString(),
      });
      if (!r.ok || !r.json?.access_token) throw new Error(`${cfg.name} Token 刷新失败(${r.status})`);
      return saveToken(id, r.json, latest);
    })().finally(() => refreshFlight.delete(id));
    refreshFlight.set(id, job);
    return job;
  };
  const DROP_SCHEMA_KEYS = [
    '$schema', '$id', '$ref', '$defs', 'definitions', 'additionalProperties', 'strict', 'default', 'title',
    'examples', 'exclusiveMinimum', 'exclusiveMaximum', 'propertyNames', 'patternProperties', 'const',
    'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems',
  ];
  const cleanSchema = (s, isClaude) => {
    if (!s || typeof s !== 'object') return { type: 'object', properties: {} };
    const walk = n => {
      if (!n || typeof n !== 'object') return n;
      if (Array.isArray(n)) return n.map(walk);
      const o = Object.assign({}, n);
      for (const uk of ['anyOf', 'oneOf']) {
        if (Array.isArray(o[uk])) {
          const nonNull = o[uk].filter(b => b && b.type !== 'null');
          if (isClaude || nonNull.length === 1) {
            const picked = nonNull[0] || o[uk][0] || { type: 'string' }, desc = o.description;
            delete o[uk]; Object.assign(o, picked);
            if (desc && !o.description) o.description = desc;
          }
        }
      }
      if (Array.isArray(o.type)) o.type = o.type.find(t => t !== 'null') || 'string';
      DROP_SCHEMA_KEYS.forEach(k => delete o[k]);
      if (o.properties) {
        const np = {}; Object.entries(o.properties).forEach(([k, v]) => { np[k] = walk(v); }); o.properties = np;
        if (Array.isArray(o.required)) { o.required = o.required.filter(r => r in np); if (!o.required.length) delete o.required; }
      }
      if (o.items) o.items = walk(o.items);
      if (o.type === 'object' && (!o.properties || !Object.keys(o.properties).length))
        o.properties = isClaude ? { _unused: { type: 'string', description: 'placeholder' } } : {};
      return o;
    };
    const out = walk(s);
    if (!out.type) out.type = 'object';
    if (out.type === 'object' && !out.properties) out.properties = {};
    return out;
  };
  const hashSid = (email, text) => {
    const str = `${email || ''}\0${text || ''}`;
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ ch, 0x85ebca6b) >>> 0;
    }
    return `-${h1}${h2}`;
  };
  const 建请求 = (id, c, a) => {
    const cfg = S[id], model = a.model || (c.models?.[0]) || cfg.models[0];
    const sys = a.messages.filter(m => m.role === 'system').map(m => 协议适配.文字(m.content)).filter(Boolean).join('\n\n');
    const msgs = a.messages.filter(m => m.role !== 'system');
    const headers = Object.assign({
      Authorization: 'Bearer ' + c.accessToken, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    }, cfg.extraHeaders);
    if (id === 'chatgpt' && c.accountId) headers['chatgpt-account-id'] = c.accountId;
    if (cfg.apiStyle === 'anthropic') {
      const mlist = [], push = (role, blocks) => {
        if (!blocks.length) return;
        const prev = mlist[mlist.length - 1];
        if (prev && prev.role === role) prev.content.push(...blocks);
        else mlist.push({ role, content: blocks });
      };
      for (const m of msgs) {
        if (m.role === 'tool') {
          push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId || 'c', content: 协议适配.文字(m.content) }]);
        } else if (m.role === 'assistant') {
          const blocks = [], t = 协议适配.文字(m.content);
          if (t) blocks.push({ type: 'text', text: t });
          (m.toolCalls || []).forEach(tc => blocks.push({ type: 'tool_use', id: tc.id || 'c', name: tc.name, input: tc.args || {} }));
          push('assistant', blocks.length ? blocks : [{ type: 'text', text: '' }]);
        } else {
          const blocks = [];
          if (Array.isArray(m.content)) m.content.forEach(x => {
            if (x?.type === 'text' && x.text) blocks.push({ type: 'text', text: x.text });
            else if (x?.type === 'image' && x.data) {
              blocks.push({ type: 'image', source: { type: 'base64', media_type: x.mimeType || 'image/png', data: x.data } });
            }
          });
          else if (m.content) blocks.push({ type: 'text', text: String(m.content) });
          push('user', blocks.length ? blocks : [{ type: 'text', text: '' }]);
        }
      }
      let maxTok = a.maxTokens || 8192;
      const body = { model, max_tokens: maxTok, stream: true, messages: mlist, ...(sys ? { system: sys } : {}) };
      if (a.think === 'on') {
        const budget = 8192;
        if (maxTok <= budget) body.max_tokens = budget + 4096;
        body.thinking = { type: 'enabled', budget_tokens: budget };
      }
      if (a.tools?.length) body.tools = a.tools.map(t => ({
        name: t.name, description: t.description || '', input_schema: t.parameters || { type: 'object', properties: {} },
      }));
      return { url: cfg.apiUrl, headers, dnrHeaders: cfg.dnr, body: JSON.stringify(body) };
    }
    if (cfg.apiStyle === 'cloudcode') {
      const isClaude = /claude/i.test(model), contents = [];
      const push = (role, parts) => {
        if (!parts.length) return;
        const prev = contents[contents.length - 1];
        if (prev && prev.role === role) prev.parts.push(...parts); else contents.push({ role, parts });
      };
      for (const m of msgs) {
        if (m.role === 'tool') {
          push('user', [{ functionResponse: { id: m.toolCallId || 'c', name: m.name || 'tool', response: { result: 协议适配.文字(m.content) } } }]);
        } else if (m.role === 'assistant') {
          const ps = [], t = 协议适配.文字(m.content); if (t) ps.push({ text: t });
          (m.toolCalls || []).forEach(tc => ps.push({
            functionCall: { id: tc.id || 'c', name: tc.name, args: tc.args || {} },
            thoughtSignature: 'skip_thought_signature_validator',
          }));
          push('model', ps);
        } else {
          const ps = [];
          if (Array.isArray(m.content)) m.content.forEach(x => {
            if (x?.type === 'text' && x.text) ps.push({ text: x.text });
            else if (x?.type === 'image' && x.data) ps.push({ inlineData: { mimeType: x.mimeType || 'image/png', data: x.data } });
          }); else if (m.content) ps.push({ text: String(m.content) });
          push('user', ps);
        }
      }
      if (!isClaude) {
        if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '' }] });
        if (contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', parts: [{ text: '' }] });
      }
      const firstText = contents.find(x => x.role === 'user')?.parts?.find(x => x.text)?.text || '';
      const reqObj = {
        contents, sessionId: hashSid(c.email, firstText),
        ...(sys ? { systemInstruction: { role: 'user', parts: [{ text: sys }] } } : {}),
      };
      if (a.think === 'on') reqObj.generationConfig = { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } };
      if (a.tools?.length) {
        reqObj.tools = [{ functionDeclarations: a.tools.map(t => ({
          name: t.name, description: t.description || '', parameters: cleanSchema(t.parameters, isClaude),
        })) }];
        if (isClaude) reqObj.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
      }
      return {
        url: cfg.apiUrl, headers, dnrHeaders: cfg.dnr,
        body: JSON.stringify({ project: c.projectId || '', model, userAgent: 'antigravity', requestType: 'agent', request: reqObj }),
      };
    }
    const input = [];
    for (const m of msgs) {
      if (m.role === 'tool') { input.push({ type: 'function_call_output', call_id: m.toolCallId || 'c', output: 协议适配.文字(m.content) }); continue; }
      const role = m.role === 'assistant' ? 'assistant' : 'user', tt = role === 'assistant' ? 'output_text' : 'input_text', cp = [];
      if (Array.isArray(m.content)) m.content.forEach(x => {
        if (x?.type === 'text' && x.text) cp.push({ type: tt, text: x.text });
        else if (x?.type === 'image' && x.data && role !== 'assistant') cp.push({ type: 'input_image', image_url: `data:${x.mimeType || 'image/png'};base64,${x.data}` });
      }); else if (m.content) cp.push({ type: tt, text: String(m.content) });
      if (cp.length) input.push({ type: 'message', role, content: cp });
      if (role === 'assistant' && m.toolCalls?.length) m.toolCalls.forEach(tc => input.push({
        type: 'function_call', call_id: tc.id || 'c', name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
      }));
    }
    const body = { model, input, store: false, stream: true, instructions: sys || '' };
    if (a.think === 'on') body.reasoning = { effort: 'medium', summary: 'auto' };
    if (a.tools?.length) body.tools = a.tools.map(t => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }));
    return { url: cfg.apiUrl, headers, dnrHeaders: cfg.dnr, body: JSON.stringify(body) };
  };
  const api = {
    表: S,
    async 探测() {
      try { const r = await send('ping', {}, 1500); okState.available = !!r?.ok; } catch { okState.available = false; }
      return okState.available;
    },
    get 可用() { return okState.available; },
    async 列表() {
      if (!await api.探测()) return [];
      const all = (await store('get')) || {};
      return Object.entries(S).map(([id, cfg]) => ({
        id, name: cfg.name, providerName: cfg.providerName, desc: cfg.desc,
        loggedIn: !!all[id]?.accessToken, account: all[id]?.email ? { email: all[id].email } : null,
        loginSession: pending[id] || null, models: all[id]?.models?.length ? all[id].models : cfg.models,
      }));
    },
    async 拉模型(id) {
      const cfg = S[id]; if (!cfg) throw new Error('未知纯插件订阅渠道: ' + id);
      const c = await ensure(id, false).catch(() => null);
      let list = [];
      if (c) {
        const headers = Object.assign({ Authorization: 'Bearer ' + c.accessToken, Accept: 'application/json' }, cfg.extraHeaders);
        if (id === 'chatgpt' && c.accountId) headers['chatgpt-account-id'] = c.accountId;
        if (cfg.modelsUrl) {
          const r = await pfetch(cfg.modelsUrl, { headers, dnrHeaders: cfg.dnr, timeout: 15000 }).catch(() => null);
          const arr = r?.ok ? (r.json?.data || r.json?.models || []) : [];
          list = arr.filter(x => x && x.visibility !== 'hide').map(x => typeof x === 'string' ? x : (x.slug || x.id || x.name)).filter(Boolean);
        } else if (id === 'antigravity') {
          const r = await pfetch('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), dnrHeaders: cfg.dnr,
            body: JSON.stringify({ project: c.projectId || '' }), timeout: 15000,
          }).catch(() => null);
          const raw = r?.ok ? r.json?.models : null;
          if (raw && typeof raw === 'object') {
            list = (Array.isArray(raw) ? raw.map(x => x?.id || x?.name) : Object.keys(raw))
              .filter(x => typeof x === 'string' && x.trim() && !/^tab_/i.test(x.trim()));
          }
        }
        if (list.length) {
          const uniq = [...new Set(list.concat(cfg.extraModels || []))];
          c.models = uniq; await store('set', id, c).catch(() => {});
          return { models: uniq, hints: {}, source: 'live' };
        }
      }
      return { models: (c?.models?.length ? c.models : cfg.models).slice(), hints: {}, source: 'fallback' };
    },
    async 登录(id) {
      const cfg = S[id]; if (!cfg) throw new Error('插件模式暂不支持: ' + id);
      if (cfg.mode === 'device') {
        const d = (await pfetch(cfg.disc)).json;
        const r = await pfetch(d.device_authorization_endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ client_id: cfg.clientId, scope: cfg.scope }).toString(),
        });
        if (!r.ok || !r.json?.device_code) throw new Error('设备码申请失败: ' + r.text.slice(0, 120));
        const dc = r.json, url = dc.verification_uri_complete || dc.verification_uri;
        pending[id] = { state: 'pending', userCode: dc.user_code, url, message: '请在打开的页面确认验证码' };
        (async () => {
          const until = Date.now() + (Number(dc.expires_in) || 600) * 1000;
          let wait = Math.max(5, Number(dc.interval) || 5) * 1000;
          while (pending[id]?.state === 'pending' && Date.now() < until) {
            await new Promise(ok => setTimeout(ok, wait));
            if (pending[id]?.state !== 'pending') return;
            const tr = await pfetch(d.token_endpoint, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
              body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: cfg.clientId }).toString(),
            });
            if (tr.ok && tr.json?.access_token) { await saveToken(id, tr.json); delete pending[id]; await api.同步(id).catch(() => {}); 厂商配置.通知(); return; }
            if (tr.json?.error === 'slow_down') wait += 3000;
            else if (tr.json?.error && tr.json.error !== 'authorization_pending') { delete pending[id]; 厂商配置.通知(); return; }
          }
          delete pending[id]; 厂商配置.通知();
        })();
        return pending[id];
      }
      const p = await pkce();
      const qs = new URLSearchParams(Object.assign({
        client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirect, scope: cfg.scope,
        state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256',
      }, cfg.extraAuth || {}));
      const authUrl = `${cfg.authUrl}?${qs}`;
      pending[id] = { state: 'pending', url: authUrl, message: '请在弹出的授权页完成登录，插件会自动截获回调' };
      (async () => {
        try {
          const got = await send('oauthIntercept', { authUrl, redirectPrefix: cfg.redirect }, 300000);
          const u = new URL(got.callbackUrl), code = u.searchParams.get('code');
          if (!code) throw new Error(u.searchParams.get('error_description') || '回调未带授权码');
          const params = { grant_type: 'authorization_code', code, redirect_uri: cfg.redirect, client_id: cfg.clientId, code_verifier: p.verifier };
          if (cfg.clientSecret) params.client_secret = cfg.clientSecret;
          if (cfg.jsonToken) params.state = p.state;
          const tr = await pfetch(cfg.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': cfg.jsonToken ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: cfg.jsonToken ? JSON.stringify(params) : new URLSearchParams(params).toString(),
          });
          if (!tr.ok || !tr.json?.access_token) throw new Error('换取 Token 失败(' + tr.status + ')');
          await saveToken(id, tr.json);
          delete pending[id];
          await api.同步(id).catch(() => {});
        } catch (e) { pending[id] = { state: 'error', message: e.message }; setTimeout(() => { if (pending[id]?.state === 'error') delete pending[id]; }, 8000); }
        厂商配置.通知();
      })();
      return pending[id];
    },
    async 取消(id) { delete pending[id]; },
    async 退出(id) {
      delete pending[id]; await store('del', id);
      const old = await 厂商配置.找(S[id]?.providerName);
      if (old) await 厂商配置.删除(old.id).catch(() => {});
    },
    async 同步(id) {
      const cfg = S[id], c = await store('get', id);
      if (!cfg || !c?.accessToken) throw new Error('该渠道尚未在插件模式下登录');
      const got = await api.拉模型(id), models = got.models;
      const old = await 厂商配置.找(cfg.providerName);
      const patch = { endpoint: 'plugin-sub://' + id, apiKey: '', protocol: 'plugin-sub', models, model: (old?.model && models.includes(old.model)) ? old.model : models[0], toolMode: 'native' };
      const p = old ? await 厂商配置.更新(old.id, patch) : await 厂商配置.新增(Object.assign({ name: cfg.providerName }, patch));
      return { ok: true, provider: p.name, models: models.length, source: got.source };
    },
    async *对话(p, a) {
      const id = String(p.endpoint || '').replace(/^plugin-sub:\/\//, ''), cfg = S[id];
      if (!cfg) throw new Error('未知纯插件订阅渠道: ' + id);
      const run = async force => {
        const c = await ensure(id, force), req = 建请求(id, c, a);
        return stream(req, a.signal).getReader();
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const reader = await run(attempt > 0), dec = new TextDecoder();
        let buf = '', full = '', tools = [], tMap = new Map(), usage = null;
        const slot = (k, cid, name) => {
          let t = tMap.get(k);
          if (!t) { t = { id: cid || ('call_' + tools.length), name: name || '', argsText: '' }; tMap.set(k, t); tools.push(t); }
          else { if (cid && !t.id) t.id = cid; if (name && !t.name) t.name = name; }
          return t;
        };
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true }); let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const j = 协议适配.读行(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (!j) continue;
              if (j.error || j.type === 'response.failed') throw new Error(j.error?.message || j.response?.error?.message || JSON.stringify(j.error || j));
              if (cfg.apiStyle === 'anthropic') {
                if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) { full += j.delta.text; yield { delta: j.delta.text }; }
                else if (j.type === 'content_block_delta' && j.delta?.type === 'thinking_delta' && j.delta.thinking) yield { reasoning: j.delta.thinking };
                else if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') slot(String(j.index ?? tools.length), j.content_block.id, j.content_block.name);
                else if (j.type === 'content_block_delta' && j.delta?.type === 'input_json_delta') slot(String(j.index ?? tools.length - 1)).argsText += j.delta.partial_json || '';
              } else if (cfg.apiStyle === 'cloudcode') {
                const r0 = j.response || j, um = r0?.usageMetadata;
                if (um) usage = { input: um.promptTokenCount || 0, output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), total: um.totalTokenCount || 0 };
                for (const x of (r0?.candidates?.[0]?.content?.parts || [])) {
                  if (x.text) { if (x.thought) yield { reasoning: x.text }; else { full += x.text; yield { delta: x.text }; } }
                  else if (x.functionCall?.name) tools.push({ id: x.functionCall.id || ('call_' + tools.length), name: x.functionCall.name, argsObj: x.functionCall.args || {} });
                }
              } else {
                if (j.type === 'response.output_text.delta' && j.delta) { full += j.delta; yield { delta: j.delta }; }
                else if ((j.type === 'response.reasoning_summary_text.delta' || j.type === 'response.reasoning_text.delta') && j.delta) yield { reasoning: j.delta };
                else if (j.type === 'response.output_item.added' && j.item?.type === 'function_call') slot(j.item.id || String(j.output_index ?? tools.length), j.item.call_id, j.item.name);
                else if (j.type === 'response.function_call_arguments.delta' && j.delta) slot(j.item_id || String(j.output_index ?? 0), j.call_id, j.name).argsText += j.delta;
                else if (j.type === 'response.output_item.done' && j.item?.type === 'function_call') {
                  const t = slot(j.item.id || String(j.output_index ?? 0), j.item.call_id, j.item.name);
                  if (!t.argsText && typeof j.item.arguments === 'string') t.argsText = j.item.arguments;
                } else if (j.type === 'response.output_item.done' && j.item?.type === 'message' && !full && Array.isArray(j.item.content)) {
                  for (const c of j.item.content) if (c.type === 'output_text' && c.text) { full += c.text; yield { delta: c.text }; }
                } else if ((j.type === 'response.completed' || j.type === 'response.done' || j.type === 'response.incomplete') && j.response) {
                  const u = j.response.usage;
                  if (u) usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, total: u.total_tokens || 0 };
                  if (!full && !tools.length && Array.isArray(j.response.output)) {
                    for (const it of j.response.output) {
                      if (it.type === 'message' && Array.isArray(it.content)) {
                        for (const c of it.content) if (c.type === 'output_text' && c.text) { full += c.text; yield { delta: c.text }; }
                      } else if (it.type === 'function_call') {
                        const t = slot(it.id || ('fc_' + tools.length), it.call_id, it.name);
                        if (!t.argsText) t.argsText = typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments || {});
                      }
                    }
                  }
                } else if (j.choices?.[0]?.delta?.content) { const d = j.choices[0].delta.content; full += d; yield { delta: d }; }
              }
            }
          }
          const toolCalls = tools.length ? tools.map(t => ({ id: t.id, name: t.name, args: t.argsObj || 协议适配.解参(t.argsText) })) : null;
          yield { done: true, content: full, stop: toolCalls ? 'tool_calls' : 'stop', usage, toolCalls };
          return;
        } catch (err) {
          Promise.resolve(reader.cancel()).catch(() => {});
          if (attempt === 0 && (err.status === 401 || /HTTP 401\b/.test(err.message || ''))) continue;
          throw err;
        } finally { Promise.resolve(reader.cancel()).catch(() => {}); }
      }
    },
    async 多模态(p, 类, a) {
      const id = String(p.endpoint || '').replace(/^plugin-sub:\/\//, ''), cfg = S[id], t = 协议适配['openai-compatible'].类型[类];
      if (!cfg) throw new Error('未知纯插件订阅渠道: ' + id);
      if (!t) throw new Error('不支持的模态类型: ' + 类);
      const u8ToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
      const toInline = x => {
        if (!x) return null;
        if (typeof x === 'object' && x.data) return { mimeType: x.mimeType || 'image/png', data: x.data };
        const m = String(x).match(/^data:([^;]+);base64,(.+)$/);
        return m ? { mimeType: m[1], data: m[2] } : { mimeType: 'image/png', data: String(x) };
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const c = await ensure(id, attempt > 0);
        const headers = Object.assign({ Authorization: 'Bearer ' + c.accessToken }, cfg.extraHeaders);
        if (id === 'chatgpt' && c.accountId) headers['chatgpt-account-id'] = c.accountId;
        if (cfg.apiStyle === 'cloudcode') {
          if (类 !== 'image' && 类 !== 'imageEdit') throw new Error(`${cfg.name} 纯插件通道暂不支持「${t.名}」模态`);
          const parts = [];
          const imgs = 类 === 'imageEdit' ? (Array.isArray(a.images) ? a.images : (a.image ? [a.image] : [])) : [];
          imgs.map(toInline).filter(Boolean).forEach(im => parts.push({ inlineData: im }));
          parts.push({ text: a.prompt || '' });
          const genCfg = { responseModalities: ['TEXT', 'IMAGE'] };
          if (a.ratio || a.size) genCfg.imageConfig = Object.assign({}, a.ratio ? { aspectRatio: a.ratio } : {}, a.size ? { imageSize: a.size } : {});
          const req = {
            url: cfg.apiUrl, dnrHeaders: cfg.dnr,
            headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }, headers),
            body: JSON.stringify({
              project: c.projectId || '', model: a.model, userAgent: 'antigravity',
              requestType: 'image_gen', requestId: 'image_gen/' + Date.now() + '/' + Math.random().toString(36).slice(2),
              request: { contents: [{ role: 'user', parts }], generationConfig: genCfg },
            }),
          };
          const reader = stream(req, a.signal).getReader(), dec = new TextDecoder();
          let buf = '', got = null, txt = '';
          try {
            while (true) {
              const { value, done } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true }); let nl;
              while ((nl = buf.indexOf('\n')) >= 0) {
                const j = 协议适配.读行(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (!j) continue;
                if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
                for (const x of ((j.response || j)?.candidates?.[0]?.content?.parts || [])) {
                  if (x.inlineData?.data && !x.thought) got = { mimeType: x.inlineData.mimeType || x.inlineData.mime_type || 'image/png', data: x.inlineData.data };
                  else if (x.text && !x.thought) txt += x.text;
                }
              }
            }
          } catch (err) {
            Promise.resolve(reader.cancel()).catch(() => {});
            if (attempt === 0 && (err.status === 401 || /HTTP 401\b/.test(err.message || ''))) continue;
            throw err;
          } finally { Promise.resolve(reader.cancel()).catch(() => {}); }
          if (got) return got;
          throw new Error(`${cfg.name} 未返回图片${txt ? ': ' + txt.slice(0, 140) : ''}`);
        }
        if (!cfg.apiBase) throw new Error(`${cfg.name} 纯插件通道暂不支持「${t.名}」模态`);
        const rawBody = t.请求(a, a.model, p), reqOpt = { method: 'POST', headers: Object.assign({}, headers), dnrHeaders: cfg.dnr, timeout: 180000 };
        if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
          const tmp = new Response(rawBody);
          reqOpt.headers['Content-Type'] = tmp.headers.get('content-type');
          reqOpt.bodyB64 = u8ToB64(new Uint8Array(await tmp.arrayBuffer()));
        } else {
          reqOpt.headers['Content-Type'] = 'application/json';
          reqOpt.body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
        }
        const r = await pfetch(cfg.apiBase + t.后缀, reqOpt);
        if (attempt === 0 && r.status === 401) continue;
        if (!r.ok) throw new Error(`${cfg.name} ${t.名}请求失败(${r.status}): ${(r.json?.error?.message || r.text || '').slice(0, 200)}`);
        if (t.查) {
          const tid = r.json?.request_id || r.json?.id || r.json?.task_id;
          if (!tid) throw new Error(`${t.名}未返回任务号: ${r.text.slice(0, 160)}`);
          for (let i = 0; i < 120; i++) {
            await new Promise(ok => setTimeout(ok, 5000));
            const pr = await pfetch(cfg.apiBase + t.查.replace('{id}', encodeURIComponent(tid)), { headers, dnrHeaders: cfg.dnr, timeout: 30000 });
            const out = pr.json && 协议适配.件(pr.json, t.件);
            if (out) return out;
            const st = String(pr.json?.status || pr.json?.state || '');
            if (/fail|error|cancel|expire|reject/i.test(st)) throw new Error(`${t.名}失败(${st}): ${pr.text.slice(0, 180)}`);
          }
          throw new Error(`${t.名}超时(任务 ${tid})`);
        }
        if (t.回复) return t.回复(new Response(r.text, { status: r.status }), p);
        const out = r.json && 协议适配.件(r.json, t.件);
        if (out) return out;
        throw new Error(`${cfg.name} 未返回可识别的${t.名}结果: ${r.text.slice(0, 180)}`);
      }
    },
  };
  return api;
})();

const 订阅网关 = {
  址键: 'settings:sub.url', 同步键: 'settings:sub.synced', 暴露键: 'settings:ai.gwExposeProviders',
  url: 'http://127.0.0.1:4135', ok: false, 状态: null, 错: '', 开Key: {}, 轮询: null, 桥: null, 桥取消: new Map(),
  async 读址() {
    const saved = await ctx.kv.get(this.址键);
    if (saved) this.url = String(saved).replace(/\/+$/, '');
    网络请求.本机代理 = this.url;
    return this.url;
  },
  async 设址(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return this.url;
    this.url = /^https?:\/\//i.test(u) ? u : 'http://' + u;
    网络请求.本机代理 = this.url;
    await ctx.kv.set(this.址键, this.url);
    return this.url;
  },
  async 请(path, opt = {}) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), opt.timeout || 15000);
    let r;
    try {
      const init = { method: opt.method || 'GET', signal: ac.signal };
      if (opt.body !== undefined) { init.method = opt.method || 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opt.body); }
      r = await fetch(this.url + path, init);
    } catch { throw Object.assign(new Error(ac.signal.aborted ? '请求超时' : '连不上本机网关 ' + this.url), { 断: true }); }
    finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({ error: { message: '响应不是 JSON (' + r.status + ')' } }));
    if (!r.ok || j?.error) throw new Error(typeof j?.error === 'string' ? j.error : (j?.error?.message || ('HTTP ' + r.status)));
    return j;
  },
  async 刷新() {
    await this.读址();
    try {
      this.状态 = await this.请('/admin/status', { timeout: 3500 });
      this.ok = true; this.错 = '';
      if (!this.桥) this.连网页桥();
    } catch (e) { this.ok = false; this.状态 = null; this.错 = e.message; }
    return this.状态;
  },
  触发协议() {
    if (typeof document !== 'undefined' && document.body) {
      const a = document.createElement('a'); a.href = 'colony://start'; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
    }
  },
  async 启动(已触发) {
    if (!已触发 && !this.ok) this.触发协议();
    await this.读址();
    if (await this.刷新()) return { ok: true, alreadyRunning: true, status: this.状态 };
    if (colony.has('local.connect')) await ctx.call('local.connect', { wake: true }).catch(() => {});
    else for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 400)); if (await this.刷新()) return { ok: true, started: true, status: this.状态 }; }
    if (await this.刷新()) return { ok: true, started: true, status: this.状态 };
    if (colony.has('local.restart')) {
      await ctx.call('local.restart', {}).catch(() => {});
      for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 350)); if (await this.刷新()) return { ok: true, started: true, status: this.状态 }; }
    }
    throw new Error('尚未连上本机服务：若浏览器顶部弹出打开应用询问请点「打开」，首次使用请先双击解压包里的「启动 Colony」');
  },
  async 设网关(patch) {
    const r = await this.请('/admin/gateway', { method: 'POST', body: patch, timeout: 6000 });
    if (patch.expose !== undefined) await new Promise(ok => setTimeout(ok, 220));
    await this.刷新();
    return r;
  },
  async 读暴露表() { return (await ctx.kv.get(this.暴露键)) || {}; },
  async 设厂商暴露(pid, on) {
    const map = Object.assign({}, await this.读暴露表(), { [pid]: !!on });
    await ctx.kv.set(this.暴露键, map);
    await this.推厂商();
    return map;
  },
  可聚厂商: list => list.filter(p => p.endpoint && p.protocol !== 'web-browser' && p.protocol !== 'plugin-sub'
    && !/^https?:\/\/(127\.0\.0\.1|localhost):4135\b/i.test(p.endpoint)),
  async 推厂商(force) {
    if (!this.ok && !await this.刷新()) return { ok: false, error: this.错 };
    const all = await 厂商配置.列表(), list = this.可聚厂商(all), map = await this.读暴露表();
    if (!force && !list.length && (this.状态?.syncedProviderCount || 0) > 0) return { ok: true, skippedEmpty: true };
    const providers = list.map(p => ({
      id: p.id, name: p.name, endpoint: p.endpoint, apiKey: p.apiKey || '',
      protocol: p.protocol || 'openai-compatible', models: p.models || [], defaultModel: p.model || '',
      exposed: map[p.id] !== false,
    }));
    const r = await this.请('/admin/providers', { method: 'POST', body: { providers }, timeout: 5000 });
    await this.推网页模型(all).catch(() => {});
    await this.刷新();
    return r;
  },
  async 推网页模型(all) {
    if (!this.ok) return;
    const models = [];
    for (const p of (all || await 厂商配置.列表())) {
      if (p.protocol !== 'web-browser') continue;
      const ms = p.models?.length ? p.models : (p.model ? [p.model] : []);
      for (const m of ms) models.push({ providerName: p.name, model: m });
    }
    await this.请('/admin/web-bridge/register', { method: 'POST', body: { models }, timeout: 4000 });
  },
  连网页桥() {
    if (typeof EventSource === 'undefined' || this.桥) return;
    const es = new EventSource(this.url + '/admin/web-bridge/events');
    this.桥 = es;
    es.addEventListener('ready', () => { this.ok = true; this.推网页模型().catch(() => {}); });
    es.addEventListener('cancel', ev => {
      try { const { reqId } = JSON.parse(ev.data); this.桥取消.get(reqId)?.abort(); this.桥取消.delete(reqId); } catch {}
    });
    es.addEventListener('chat', async ev => {
      let job; try { job = JSON.parse(ev.data); } catch { return; }
      const ac = new AbortController(); this.桥取消.set(job.reqId, ac);
      const reply = body => fetch(this.url + '/admin/web-bridge/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ reqId: job.reqId }, body)),
      }).catch(() => {});
      try {
        const p = await 厂商配置.找(job.providerName);
        if (!p) throw new Error('网页厂商未找到: ' + job.providerName);
        let full = '';
        const opt = { model: job.model, messages: job.messages, maxTokens: job.maxTokens, temperature: job.temperature, signal: ac.signal };
        if (job.stream) {
          for await (const ch of 模型调用.chatStream(p, opt)) {
            if (ch.delta) { full += ch.delta; await reply({ delta: ch.delta }); }
            if (ch.done) full = ch.content || full;
          }
        } else full = (await 模型调用.chat(p, opt))?.content || '';
        await reply({ done: true, content: full });
      } catch (e) { if (!ac.signal.aborted) await reply({ error: e.message || String(e) }); }
      finally { this.桥取消.delete(job.reqId); }
    });
    es.onerror = () => {
      try { es.close(); } catch {}
      if (this.桥 === es) this.桥 = null;
      setTimeout(() => { this.刷新().catch(() => {}); }, 5000);
    };
  },
  断网页桥() {
    if (this.桥) { try { this.桥.close(); } catch {} this.桥 = null; }
    this.桥取消.forEach(ac => ac.abort()); this.桥取消.clear();
  },
  async 同步订阅(driverId) {
    const st = await this.刷新();
    if (!st) throw new Error('本机网关未运行');
    const targets = (st.drivers || []).filter(d => d.loggedIn && (!driverId || d.id === driverId));
    if (!targets.length) throw new Error(driverId ? '该渠道尚未登录' : '还没有已登录的渠道可同步');
    const synced = (await ctx.kv.get(this.同步键)) || {}, results = [];
    for (const d of targets) {
      const name = d.providerName || ('订阅 · ' + d.name), old = await 厂商配置.找(name);
      const patch = { endpoint: d.endpoint, apiKey: '', protocol: 'openai-compatible', toolMode: 'native' };
      let p = old ? await 厂商配置.更新(old.id, patch) : await 厂商配置.新增(Object.assign({ name }, patch));
      let pulled = '';
      try { p = await 厂商配置.拉模型(p); pulled = `拉到 ${p.models.length} 个模型`; }
      catch (e) { pulled = '模型拉取失败: ' + e.message; }
      synced[d.id] = { providerName: p.name, providerId: p.id, endpoint: d.endpoint, at: Date.now() };
      results.push({ driver: d.id, provider: p.name, models: (p.models || []).length, pulled });
    }
    await ctx.kv.set(this.同步键, synced);
    return { ok: true, synced: results };
  },
  async 清理同步() {
    const synced = (await ctx.kv.get(this.同步键)) || {}, removed = [];
    for (const rec of Object.values(synced)) {
      const old = await 厂商配置.找(rec.providerName);
      if (old) { await 厂商配置.删除(old.id); removed.push(old.name); }
    }
    await ctx.kv.set(this.同步键, {});
    return { ok: true, removed };
  },
};
// ═ 订阅界面 · 跟着: 厂商配置, 选模型, 订阅与网关 ═
// 「🔑 订阅与网关」标签页: 本地聚合网关(:4135) + 统一渠道订阅卡(本机多方式与纯插件通道并列共存、互不干扰)
const 订阅界面 = {
  async 渲染(list, ui) {
    const { esc } = 选模型, { 密框, 钮, 标, 行 } = ui;
    const st = 订阅网关.状态, synced = (await ctx.kv.get(订阅网关.同步键)) || {}, expMap = await 订阅网关.读暴露表();
    const 可聚 = 订阅网关.可聚厂商(list), pList = await 插件订阅.列表();
    const 授权盒 = (ls, fb) => '<div class="ai-sub-box">' + esc(ls.message || fb)
      + (ls.userCode ? 行('<span class="ai-sub-code">' + esc(ls.userCode) + '</span>', 钮('copyVal', '📋 复制验证码', '', '', ls.userCode)) : '')
      + (ls.url ? '<div style="margin-top:4px"><a href="' + esc(ls.url) + '" target="_blank" rel="noopener">↗ 打开授权链接</a></div>' : '') + '</div>';
    let html = '<div class="ai-result" data-r hidden></div>'
      + '<div class="ai-sub-card"><div class="ai-sub-hd"><strong>🌐 本地聚合网关（私有 OpenRouter）</strong>'
      + '<span class="ai-cap ' + (订阅网关.ok ? 'ok' : '') + '">' + (订阅网关.ok ? (st.expose ? '局域网外放中' : '仅本机免密') : '未连接') + '</span>'
      + '<span class="sp"></span>' + 钮('gwRefresh', '🔄 刷新') + (订阅网关.ok ? '' : 钮('gwStart', '▶ 启动网关', 'pri')) + '</div>'
      + 标('网关地址（与 colony-local 同进程运行，默认 http://127.0.0.1:4135）')
      + 行('<input class="ai-in" data-gw="url" value="' + esc(订阅网关.url) + '" placeholder="http://127.0.0.1:4135">', 钮('gwSaveUrl', '保存并重连'));
    if (订阅网关.ok && st) {
      const lan = (st.lanEndpoints || [])[0] || '';
      html += 标('本机接入地址（OpenAI /v1 与 Anthropic /v1/messages 通用，本机免密）')
        + 行('<input class="ai-in" value="' + esc(st.localEndpoint) + '" readonly>', 钮('copyVal', '📋 复制', '', '', st.localEndpoint))
        + '<label class="ai-check"><input type="checkbox" data-gw="expose"' + (st.expose ? ' checked' : '')
        + '> 允许局域网外放（绑定 0.0.0.0，开启后外部请求须带下方外放密码）</label>'
        + (st.expose && lan ? 标('局域网接入地址') + 行('<input class="ai-in" value="' + esc(lan) + '" readonly>', 钮('copyVal', '📋 复制', '', '', lan)) : '')
        + 标('外放密码（开启局域网外放时校验，支持自定义）')
        + '<div class="ai-row" style="align-items:stretch"><div style="flex:1">' + 密框('gw-key', st.apiKey || '', '输入自定义外放密码', 'data-gw="apiKey"') + '</div>'
        + 钮('gwSaveKey', '保存密码') + 钮('gwRandKey', '🎲 随机') + '</div>';
      if (可聚.length) {
        html += 标('聚合进 4135 网关的常规 API 厂商（外部工具可经 4135 调它们，不暴露上游 Key）')
          + '<div class="ai-caps">' + 可聚.map(x => {
            const on = expMap[x.id] !== false;
            return '<button class="ai-cap ' + (on ? 'ok' : '') + '" data-act="gwTogProv" data-k="' + esc(x.id) + '">' + (on ? '✓ ' : '＋ ') + esc(x.name) + '</button>';
          }).join('') + 钮('gwPushProv', '同步厂商到网关') + '</div>';
      }
      const clis = (st.cliAgents || []).filter(c => c.available && c.enabled !== false);
      if (clis.length) {
        html += 标('本机自动发现的 CLI Agent（零端口直连 /cli/v1，已自动上线到 agent 桥接与 /v1 网关）')
          + '<div class="ai-caps">' + clis.map(c => '<span class="ai-cap ok">🖥 ' + esc(c.name) + ' · ' + esc(c.protocol) + '</span>').join('') + '</div>';
      }
    } else {
      html += '<p class="ai-hint" style="margin-top:8px">未连上本机网关 ' + esc(订阅网关.url)
        + (插件订阅.可用 ? '；下方渠道已自动启用 <strong>🧩 插件直连通道</strong>（免本机进程，手机/桌面可用，Cursor 需本机）。'
          : '。双击解压包里的「启动 Colony」可解锁本机订阅与 4135 网关；或装上 Colony Bridge 浏览器扩展免本机登 4 家订阅。') + '</p>';
    }
    html += '</div>';

    // 按渠道聚合本机与插件通道：同一张卡片并列所有登录方式，互不覆盖
    const lMap = Object.fromEntries((st?.drivers || []).map(d => [d.id, d]));
    const pMap = Object.fromEntries((插件订阅.可用 ? pList : []).map(d => [d.id, d]));
    const ids = [...new Set([...(st?.drivers || []).map(d => d.id), ...Object.keys(pMap)])];
    if (ids.length) {
      const lLogged = (st?.drivers || []).filter(d => d.loggedIn).length;
      const pLogged = Object.values(pMap).filter(d => d.loggedIn).length;
      const statTxt = [订阅网关.ok ? `本机 ${lLogged}/${(st?.drivers || []).length}` : '', 插件订阅.可用 ? `插件 ${pLogged}/${pList.length}` : ''].filter(Boolean).join(' · ');
      html += '<div class="ai-sub-hd" style="margin-top:12px"><strong>🔑 订阅渠道（' + statTxt + ' 已登录）</strong><span class="sp"></span>'
        + (订阅网关.ok ? 钮('subSyncAll', '同步全部本机订阅', 'pri') + 钮('subClean', '清理已同步') : '') + '</div>';
      for (const id of ids) {
        const ld = lMap[id], pd = pMap[id], title = ld?.name || pd?.name || id, desc = ld?.desc || pd?.desc || '';
        const anyOn = !!(ld?.loggedIn || pd?.loggedIn);
        html += '<div class="ai-sub-card"><div class="ai-sub-hd"><strong>' + esc(title) + '</strong>'
          + (anyOn ? '<span class="ai-cap ok">已接入</span>' : '<span class="ai-cap">未登录</span>')
          + (!pd ? '<span class="ai-cap">仅本机</span>' : '') + '</div>'
          + (desc ? '<p class="ai-hint" style="margin:4px 0 0">' + esc(desc) + '</p>' : '');
        if (ld) {
          const pend = ld.loginSession?.state === 'pending', syn = synced[id], modes = ld.authModes || [];
          const tagCls = ld.loggedIn ? 'ok' : (pend ? 'wait' : '');
          const tagTxt = ld.loggedIn ? ('已登录' + (ld.account?.plan ? ' · ' + ld.account.plan : '')) : (pend ? '等待授权…' : '未登录');
          html += '<div class="ai-sub-ch"><div class="ai-sub-hd"><span class="ai-hint" style="margin:0">💻 本机通道</span>'
            + '<span class="ai-cap ' + tagCls + '">' + esc(tagTxt) + '</span>'
            + (syn ? '<span class="ai-cap ok">已同步</span>' : '')
            + (ld.account?.email ? '<span class="ai-hint" style="margin:0">' + esc(ld.account.email) + '</span>' : '')
            + '<span class="sp"></span>';
          if (pend) html += 钮('subCancel', '取消登录', '', '', id);
          else {
            if (modes.includes('codex')) html += 钮('subLogin', 'Codex 登录', !ld.loggedIn ? 'pri' : '', '', id + ':codex');
            if (modes.includes('browser')) html += 钮('subLogin', id === 'chatgpt' ? '官网 SIWC 登录' : (ld.loggedIn ? '重新登录' : '浏览器登录'), (!ld.loggedIn && !modes.includes('codex')) ? 'pri' : '', '', id + ':browser');
            if (modes.includes('device')) html += 钮('subLogin', ld.loggedIn ? '重新登录' : '设备码登录', !ld.loggedIn ? 'pri' : '', '', id + ':device');
            if (modes.includes('apiKey')) html += 钮('subTogKey', '粘贴 Key', '', '', id);
            if (ld.loggedIn) html += 钮('subSync', '同步模型', '', '', id) + 钮('subLogout', '退出', 'danger', '', id);
          }
          html += '</div>' + (pend ? 授权盒(ld.loginSession, '请在浏览器中完成授权') : '');
          if (订阅网关.开Key[id]) {
            html += '<div class="ai-row" style="margin-top:8px"><div style="flex:1">'
              + 密框('subk-' + id, '', '粘贴 ' + title + ' API Key', 'data-subk="' + esc(id) + '"') + '</div>'
              + 钮('subSubmitKey', '验证登录', 'pri', '', id) + '</div>';
          }
          html += '</div>';
        }
        if (pd) {
          const pend = pd.loginSession?.state === 'pending';
          const tagCls = pd.loggedIn ? 'ok' : (pend ? 'wait' : '');
          const tagTxt = pd.loggedIn ? ('已登录 · ' + (pd.models?.length || 0) + ' 模型') : (pend ? '等待授权…' : '未登录');
          html += '<div class="ai-sub-ch"><div class="ai-sub-hd"><span class="ai-hint" style="margin:0">🧩 插件通道</span>'
            + '<span class="ai-cap ' + tagCls + '">' + esc(tagTxt) + '</span>'
            + (pd.account?.email ? '<span class="ai-hint" style="margin:0">' + esc(pd.account.email) + '</span>' : '')
            + '<span class="sp"></span>';
          if (pend) html += 钮('psubCancel', '取消', '', '', id);
          else {
            html += 钮('psubLogin', pd.loggedIn ? '重新登录' : '插件登录', (!pd.loggedIn && !ld?.loggedIn) ? 'pri' : '', '', id);
            if (pd.loggedIn) html += 钮('psubSync', '拉模型并同步', '', '', id) + 钮('psubLogout', '退出', 'danger', '', id);
          }
          html += '</div>' + (pend ? 授权盒(pd.loginSession, '请在授权页完成确认') : '')
            + (pd.loginSession?.state === 'error' ? '<div class="ai-sub-box">✗ ' + esc(pd.loginSession.message) + '</div>' : '') + '</div>';
        }
        html += '</div>';
      }
    }
    return html;
  },
  同步轮询(S, host) {
    const hasPending = S.tab === 'sub' && (订阅网关.状态?.drivers || []).some(d => d.loginSession?.state === 'pending');
    if (hasPending && !订阅网关.轮询) {
      订阅网关.轮询 = setInterval(async () => {
        const before = (订阅网关.状态?.drivers || []).filter(d => d.loginSession?.state === 'pending').map(d => d.id);
        await 订阅网关.刷新();
        const done = (订阅网关.状态?.drivers || []).filter(d => before.includes(d.id) && d.loggedIn);
        for (const d of done) {
          const r = await 订阅网关.同步订阅(d.id).catch(() => null);
          S.说 = { text: `✓ ${d.name} 登录成功${r ? `，已同步 ${r.synced[0]?.models || 0} 个模型` : ''}` };
        }
        await S.渲染(host);
      }, 2200);
    } else if (!hasPending && 订阅网关.轮询) { clearInterval(订阅网关.轮询); 订阅网关.轮询 = null; }
  },
  async 动作(act, k, host, S, say) {
    if (act === 'copyVal') { await navigator.clipboard.writeText(k || '').catch(() => {}); say('✓ 已复制: ' + k); return true; }
    if (act === 'gwRefresh') { await 订阅网关.刷新(); S.说 = 订阅网关.ok ? { text: '✓ 本机网关在线' } : { text: '✗ ' + 订阅网关.错, bad: true }; }
    else if (act === 'gwStart') { say('⋯ 正在启动本机网关'); await 订阅网关.启动(); S.说 = { text: '✓ 本机网关已启动' }; }
    else if (act === 'gwSaveUrl') { await 订阅网关.设址(host.querySelector('[data-gw="url"]')?.value); await 订阅网关.刷新(); S.说 = 订阅网关.ok ? { text: '✓ 已连上 ' + 订阅网关.url } : { text: '✗ ' + 订阅网关.错, bad: true }; }
    else if (act === 'gwSaveKey') { const apiKey = (host.querySelector('[data-gw="apiKey"]')?.value || '').trim(); if (!apiKey) throw new Error('外放密码不能为空'); await 订阅网关.设网关({ apiKey }); S.说 = { text: '✓ 已保存自定义外放密码' }; }
    else if (act === 'gwRandKey') { await 订阅网关.设网关({ regenerateKey: true }); S.说 = { text: '✓ 已重新生成随机外放密码' }; }
    else if (act === 'gwTogProv') { const map = await 订阅网关.读暴露表(); await 订阅网关.设厂商暴露(k, !(map[k] !== false)); S.说 = { text: '✓ 已更新网关聚合厂商' }; }
    else if (act === 'gwPushProv') { const r = await 订阅网关.推厂商(true); S.说 = { text: `✓ 已同步 ${r.exposedCount || 0} 家常规厂商到 4135 网关` }; }
    else if (act === 'subLogin') {
      const [drv, mode] = String(k || '').split(':');
      const r = await 订阅网关.请('/admin/login/' + encodeURIComponent(drv), { body: { mode: mode || 'browser' } });
      await 订阅网关.刷新(); if (r.url) window.open(r.url, '_blank', 'noopener');
      S.说 = { text: r.message || '已打开浏览器授权页，完成后自动同步' };
    }
    else if (act === 'subCancel') { await 订阅网关.请('/admin/cancel-login/' + encodeURIComponent(k), { method: 'POST' }); await 订阅网关.刷新(); S.说 = { text: '已取消登录' }; }
    else if (act === 'subTogKey') { 订阅网关.开Key[k] = !订阅网关.开Key[k]; }
    else if (act === 'subSubmitKey') {
      const apiKey = (host.querySelector(`[data-subk="${CSS.escape(k)}"]`)?.value || '').trim();
      if (!apiKey) throw new Error('请先输入 API Key');
      await 订阅网关.请('/admin/login/' + encodeURIComponent(k), { body: { mode: 'apiKey', apiKey }, timeout: 25000 });
      订阅网关.开Key[k] = false;
      const syn = await 订阅网关.同步订阅(k);
      S.说 = { text: '✓ 登录成功，已同步 ' + (syn.synced[0]?.models || 0) + ' 个模型' };
    }
    else if (act === 'subSync') { const r = await 订阅网关.同步订阅(k); S.说 = { text: `✓ 已同步 ${r.synced[0]?.provider}（${r.synced[0]?.models} 个模型）` }; }
    else if (act === 'subSyncAll') { const r = await 订阅网关.同步订阅(); S.说 = { text: '✓ 已同步 ' + r.synced.map(x => `${x.provider}(${x.models})`).join('、') }; }
    else if (act === 'subLogout') { await 订阅网关.请('/admin/logout/' + encodeURIComponent(k), { method: 'POST' }); await 订阅网关.刷新(); S.说 = { text: '已退出该订阅渠道' }; }
    else if (act === 'subClean') { const r = await 订阅网关.清理同步(); S.说 = { text: r.removed.length ? ('已清理：' + r.removed.join('、')) : '没有可清理的同步厂商' }; }
    else if (act === 'psubLogin') { const r = await 插件订阅.登录(k); if (r.url && 插件订阅.表[k]?.mode === 'device') window.open(r.url, '_blank', 'noopener'); S.说 = { text: r.message || '请在打开的授权页完成登录' }; }
    else if (act === 'psubCancel') { await 插件订阅.取消(k); S.说 = { text: '已取消插件登录' }; }
    else if (act === 'psubSync') { say('⋯ 正在拉取模型并同步'); const r = await 插件订阅.同步(k); S.说 = { text: `✓ 已同步 ${r.provider}（${r.models} 个模型 · ${r.source === 'live' ? '实时拉取' : '兜底表'}）` }; }
    else if (act === 'psubLogout') { await 插件订阅.退出(k); S.说 = { text: '已退出该纯插件订阅' }; }
    else return false;
    await S.渲染(host);
    return true;
  },
};
// ═ 设置界面 · 跟着: 厂商配置, 测通, 打包, 界面样式, 选模型, 协议适配, 各类模型, 网络请求, 订阅与网关, 订阅界面 ═
// 主骨架与常规厂商配置界面(订阅与网关页由「订阅界面」段独立承担)
const 设置界面 = {
  curId: null, 说: null, 手填: {}, 加: {}, 开: false, tab: 'providers', 显密: {},
  async 渲染(host) {
    const list = await 厂商配置.列表(), did = await 厂商配置.默认id(), S = 设置界面;
    if (!list.some(p => p.id === S.curId)) S.curId = did || (list[0] && list[0].id) || null;
    const p = list.find(x => x.id === S.curId), { esc, 下拉 } = 选模型, 选 = '<select class="ai-in" data-f="';
    const 框 = (f, v, ph, more) => '<input class="ai-in" data-f="' + esc(f) + '" value="' + esc(v) + '" placeholder="' + esc(ph) + '"' + (more || '') + '>';
    const 密框 = (id, v, ph, dataAttr) => {
      const show = !!S.显密[id];
      return '<div class="ai-pw"><input class="ai-in" ' + dataAttr + ' data-pwid="' + esc(id) + '" type="'
        + (show ? 'text' : 'password') + '" value="' + esc(v) + '" placeholder="' + esc(ph) + '">'
        + '<button type="button" class="ai-btn ai-ico" data-pw="toggle" data-pwid="' + esc(id) + '" title="' + (show ? '隐藏' : '显示') + '">' + (show ? '🙈' : '👁') + '</button>'
        + '<button type="button" class="ai-btn ai-ico" data-pw="copy" data-pwid="' + esc(id) + '" title="复制">📋</button></div>';
    };
    const 选框 = (f, v, 候选, ph) => !候选.length || S.手填[f] ? 框(f, v, `${ph}: 手填`)
      : 下拉(f, v, [['', `(${ph})`]].concat(候选, [['✎', '✎ 手填…']]), 选);
    const 钮 = (act, text, cls, 警告, k) => '<button class="ai-btn ' + (cls || '') + '" data-act="' + act + '"'
      + (k ? ` data-k="${esc(k)}"` : '') + (警告 ? ` data-warn="${esc(警告)}"` : '') + '>' + text + '</button>';
    const 标 = text => `<label class="ai-label">${text}</label>`;
    const 行 = (...x) => `<div class="ai-row">${x.join('')}</div>`;
    let html = '<div class="ai-tabs">'
      + '<button class="ai-tab' + (S.tab === 'providers' ? ' cur' : '') + '" data-tab="providers">🧠 厂商配置</button>'
      + '<button class="ai-tab' + (S.tab === 'sub' ? ' cur' : '') + '" data-tab="sub">🔑 订阅与网关' + (订阅网关.ok ? ' · 在线' : '') + '</button></div>';
    if (S.tab === 'sub') {
      html += await 订阅界面.渲染(list, { 密框, 钮, 标, 行 });
    } else {
      html += '<div class="ai-bar">' + list.map(x => '<button class="ai-chip' + (x.passed?.chat ? ' tested' : '') + (x.id === S.curId ? ' cur' : '')
        + '" data-pid="' + esc(x.id) + '"><span class="dot"></span>' + esc(x.name || '(未命名)') + (x.id === did ? ' · 默认' : '')
        + '</button>').join('') + '<button class="ai-add" data-act="add" title="添加厂商">+</button></div>';
      if (!p) html += '<p class="ai-hint">点 + 添加一个 AI 厂商(各家大模型、中转站、本机跑的模型都行), 或切到上方「🔑 订阅与网关」登录订阅账号</p>';
      else {
        const 表 = 厂商配置.表(p), 认得 = (协议适配[p.protocol] || {}).对话请求, 类们 = Object.keys(表), 过 = p.passed || {};
        const 协议们 = Object.keys(协议适配).filter(k => 协议适配[k].对话请求), 音 = p.voices || {};
        const 用 = 类们.filter(k => k === 'chat' || p.modelOf?.[k] || S.加[k]);
        const 源 = (() => { try { return p.endpoint ? new URL(p.endpoint).origin : ''; } catch { return ''; } })();
        const 通路 = p.proxy ? '经转发' : ({ plugin: '经插件免跨域', local: '经本机免跨域' }[网络请求.通道.get(源)] || '');
        const 模型框 = k => {
          const t = 表[k], m = k === 'chat' ? p.model : p.modelOf?.[k], vs = 音[m] || [];
          const 二 = (t.音色 ? 选框(`voiceOf.${k}`, p.voiceOf?.[k], vs.map(v => [v.id, v.name + (v.name === v.id ? '' : ` · ${v.id}`)]), '选音色')
            + 钮('voices', '🎤 拉音色', '', '', k) : '')
            + (t.语速 ? '<label class="ai-sp">语速' + 框('speed', p.speed || 1, '1', ' type="number" step="0.1" min="0.25"') + '</label>' : '')
            + (t.尾帧 ? 框(`尾帧.${k}`, p.adapt?.[k]?.尾帧, '尾帧字段(默认 last_image)', ' title="尾帧字段"') : '');
          return 标(`${t.名}模型`) + 行(选框(k === 'chat' ? 'model' : `modelOf.${k}`, m, 厂商配置.候选(p, k).map(x => [x, x]), '选模型'), 钮('test', '⚡ 测试', '', '', k)) + (二 && 行(二));
        };
        const 窄 = '<select class="ai-in ai-narrow" data-', 模型名框 = (p.models || []).length
          ? 下拉('m', '', [''].concat(p.models).map(m => [m, m]), 窄 + 'new="') : '<input class="ai-in ai-narrow" data-new="m" placeholder="模型名">';
        const 亮 = k => 过[k] && 过[k].model === (k === 'chat' ? p.model : p.modelOf?.[k]);
        const 章 = k => 亮(k) ? '<button class="ai-cap ok" data-act="off" data-k="' + k + '" title="' + esc('测通: ' + 过[k].model + ' · ' + new Date(过[k].at).toLocaleString() + '; 点一下熄灭') + '">✓ ' + 表[k].名 + '</button>'
          : `<span class="ai-cap" data-k="${k}" title="还没测通: 点这一类模型右边的 ⚡ 测试">${表[k].名}</span>`;
        html += 标('显示名称') + 行(框('name', p.name, ''), 钮('del', '🗑', 'danger', '确定删? Key 一起删'))
          + 标('亮 = 选的模型测通了(测试键在各模型右边); 点亮的熄灭' + (通路 ? ` · 当前通道: ${通路}` : '')) + '<div class="ai-caps">'
          + 用.map(章).join('') + '</div><div class="ai-result" data-r hidden></div>' + 标('API 网址(只填到版本前缀)')
          + 行(框('endpoint', p.endpoint || (!p.apiKey ? '\u200b' : ''), 'https://api.xxx.com/v1 · 本地 http://127.0.0.1:4135/v1',
            ' onmousedown="if(this.value===\'\\u200b\')this.value=\'\'" onfocus="if(this.value===\'\\u200b\')this.value=\'\'"'),
            钮('models', '📥 拉取全部模型'))
          + 标('API Key') + 密框('ak-' + p.id, p.apiKey, '本地模型 / 本机订阅 / 网页模型留空', 'data-f="apiKey"')
          + 用.map(模型框).join('')
          + (用.length < 类们.length ? 行(下拉('加', '', [['', '＋ 加一类']].concat(类们.filter(k => !用.includes(k)).map(k => [k, 表[k].名])), 窄 + 'f="')) : '')
          + '<details data-adv' + (S.开 || !认得 ? ' open' : '') + '><summary>⚙ 高级</summary>'
          + (认得 && 协议们.length < 2 ? '' : 标('协议') + 下拉('protocol', p.protocol, (认得 ? []
            : [[p.protocol, `${p.protocol} (现在没有这个协议了, 请重选; 本地模型选 OpenAI 兼容)`, 1]]).concat(协议们.map(k => [k, 协议适配[k].名称])), 选))
          + 标('转发地址(有插件或本机时自动免跨域; 纯手机无插件无本机时可在这填自建反代)')
          + 框('proxy', p.proxy, 'https://…/?url={url}  ({url} 换成原网址, 不写就接在末尾)')
          + 标('同时最多几个请求') + 框('concurrency', p.concurrency, '默认 8', ' type="number" min="1"')
          + 标('单次最多写几 token(写大段代码被截断时调大)') + 框('maxOut', p.maxOut, '不填由厂商定', ' type="number" min="1"')
          + 标('接口改法(JSON): 各类的路径、请求体、怎么查结果; 自动试通的写法也记在这')
          + '<textarea class="ai-in" data-f="adapt" rows="3" placeholder=\'{"music": {"path": "/xx/submit", "body": {"caption": "{prompt}"}}}\'>'
          + esc(Object.keys(p.adapt || {}).length ? JSON.stringify(p.adapt) : '') + '</textarea>'
          + 标('📝 模型标注(如「长文会截断」, 你和 agent 都看得到; 清空即删)')
          + Object.keys(p.notes || {}).map(m => 行('<input class="ai-in ai-narrow" value="' + esc(m) + '" disabled>', 框(`notes.${m}`, p.notes[m], ''))).join('')
          + 行(模型名框, '<input class="ai-in" data-new="t" placeholder="一句话标注">', 钮('note', '＋ 添加'))
          + '<label class="ai-check"><input type="checkbox" data-f="toolMode"' + (p.toolMode === 'text' ? ' checked' : '') + '> 模型不支持原生工具调用(用文字围栏)</label></details>'
          + '<div class="ai-acts">' + (p.id === did ? '<span class="ai-hint" title="没指定厂商的调用都用这一家">✓ 这是默认厂商</span>' : 钮('default', '设为默认'))
          + 钮('pack', '💾 打包配置版', '', '含全部明文 Key, 再点导出') + '</div>';
      }
    }
    const a = typeof document !== 'undefined' && document.activeElement;
    const 同 = x => x.dataset.f === a.dataset.f && x.dataset.new === a.dataset.new && x.dataset.gw === a.dataset.gw;
    const 焦 = a && host.contains(a) && (a.dataset.f || a.dataset.new || a.dataset.gw) && a;
    host.innerHTML = html;
    setTimeout(() => { const ep = host.querySelector('[data-f="endpoint"]'); if (ep && ep.value === '\u200b') ep.value = ''; }, 800);
    const 回 = 焦 && [...host.querySelectorAll('[data-f],[data-new],[data-gw]')].find(同);
    if (回) {
      if (回.tagName === 焦.tagName && !/^(select|checkbox)/.test(回.type) && 回.value !== 焦.value) { 回.value = 焦.value; 回.dataset.改 = 1; }
      回.focus();
      try { 回.setSelectionRange(焦.selectionStart, 焦.selectionEnd); } catch (e) {}
    }
    host.onfocusout = e => { if (e.target.dataset.改) e.target.dispatchEvent(new Event('change', { bubbles: true })); };
    const adv = host.querySelector('[data-adv]');
    if (adv) adv.ontoggle = () => { S.开 = adv.open; };
    const say = (text, bad) => {
      S.说 = { text, bad };
      const r = host.querySelector('[data-r]'); if (!r) return;
      r.hidden = false; r.className = `ai-result ${bad ? 'bad' : 'ok'}`; r.textContent = text;
      if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    };
    订阅界面.同步轮询(S, host);
    // ✂ 语音
    const 拉音色 = async (q, k) => {
      const got = await 朗读.音色(q, k), m = q.modelOf?.[k];
      await 厂商配置.更新(q.id, { voices: { [m]: got } });
      say(`✓ 拉到 ${got.length} 个音色`);
    };
    // ✂ 语音 完
    if (S.说) say(S.说.text, S.说.bad);
    host.onchange = async e => {
      const el = e.target;
      if (el.dataset.gw === 'expose') {
        const on = el.checked, apiKey = host.querySelector('[data-gw="apiKey"]')?.value.trim() || '';
        try {
          if (on && !apiKey) throw new Error('开启局域网外放前请先填写非空的外放密码');
          await 订阅网关.设网关({ expose: on, apiKey });
          say(on ? '✓ 已开启局域网外放（0.0.0.0），外部请求须携带外放密码' : '✓ 已关闭局域网外放，切回仅本机免密');
        } catch (err) { say(`✗ ${err.message}`, true); }
        return await S.渲染(host);
      }
      const f = el.dataset.f, v = el.type === 'checkbox' ? el.checked : el.value.replace(/\u200b/g, '').trim();
      if (!f || !p) return;
      delete el.dataset.改; S.说 = null;
      if (f === '加') return v && (S.加[v] = true, S.渲染(host));
      const 存 = patch => 厂商配置.更新(p.id, patch), [表名, 键] = f.split(/\.(.*)/);
      try {
        if (v === '✎') { S.手填[f] = true; await S.渲染(host); }
        else if (f === 'toolMode') await 存({ toolMode: v ? 'text' : 'native' });
        else if (f === 'protocol') await 存({ protocol: v, endpoint: (协议适配[p.protocol] || {}).对话请求 ? 协议适配[v].默认端点 : p.endpoint });
        else if (/^(concurrency|speed|maxOut)$/.test(f)) await 存({ [f]: Number(v) || undefined });
        else if (f === 'adapt') await 存({ adapt: Object.assign(Object.fromEntries(Object.keys(p.adapt || {}).map(k => [k, null])), v ? JSON.parse(v) : {}) });
        else if (表名 === '尾帧') await 存({ adapt: { [键]: 厂商配置.表(p)[键].尾帧(p.adapt?.[键], v) } });
        else if (!f.includes('.')) await 存({ [f]: v });
        else {
          const q = await 存({ [表名]: { [键]: v || null } });
          if (表名 === 'modelOf' && v && 厂商配置.表(p)[键].音色) await 拉音色(q, 键).catch(e => say(e.message));
        }
      } catch (err) { say(`✗ ${err.message}`, true); }
    };
    host.onclick = async e => {
      const pwBtn = e.target.closest('[data-pw]');
      if (pwBtn) {
        const id = pwBtn.dataset.pwid, inp = host.querySelector(`input[data-pwid="${CSS.escape(id)}"]`);
        if (pwBtn.dataset.pw === 'toggle') {
          S.显密[id] = !S.显密[id]; if (inp) inp.type = S.显密[id] ? 'text' : 'password';
          pwBtn.textContent = S.显密[id] ? '🙈' : '👁'; pwBtn.title = S.显密[id] ? '隐藏' : '显示';
        } else if (pwBtn.dataset.pw === 'copy' && inp) {
          if (!inp.value) return say('当前密码为空，无可复制内容', true);
          await navigator.clipboard.writeText(inp.value).catch(() => {}); say('✓ 已复制到剪贴板');
        }
        return;
      }
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { S.tab = tabBtn.dataset.tab; S.说 = null; if (S.tab === 'sub') await 订阅网关.刷新(); return await S.渲染(host); }
      const b = e.target.closest('[data-act],[data-pid]'); if (!b) return;
      if (b.dataset.warn && !b.dataset.sure) {
        b.dataset.t = b.textContent; b.textContent = b.dataset.warn; b.classList.add('warn');
        b.dataset.sure = setTimeout(() => S.复原(b), 3000); return;
      }
      if (b.dataset.sure) S.复原(b);
      const act = b.dataset.act, k = b.dataset.k; S.说 = null;
      try {
        if (act && await 订阅界面.动作(act, k, host, S, say)) return;
        await 厂商配置.队列;
        const p = await 厂商配置.找(S.curId), 存 = patch => 厂商配置.更新(p.id, patch);
        if (b.dataset.pid) Object.assign(S, { curId: b.dataset.pid, 手填: {}, 加: {} });
        else if (act === 'add') S.curId = (await 厂商配置.新增({ name: '新厂商' })).id;
        else if (act === 'del') return await 厂商配置.删除(p.id);
        else if (act === 'default') return await 厂商配置.设默认(p.id);
        else if (act === 'voices') return await 拉音色(p, k);
        else if (act === 'off') return await 存({ passed: { [k]: null } });
        else if (act === 'note') {
          const 新 = x => host.querySelector(`[data-new="${x}"]`).value.trim(), m = 新('m'), t = 新('t');
          if (!m || !t) return say(`先${m ? '写标注' : '选要标注的模型'}再点 ＋ 添加`, true);
          return await 存({ notes: { [m]: t } });
        } else if (act === 'models') { say('⋯ 拉取中'); return say(`✓ 拉到 ${(await 厂商配置.拉模型(p)).models.length} 个模型, 给每类选一个再测试`); }
        else if (act === 'test') { say(`⋯ 测试中${/video|music/.test(k) ? '(要等一两分钟)' : ''}`); const r = await 测通(p.id, k); return say(`✓ ${厂商配置.表(p)[k].名}测通 (模型 ${r.model}): ${r.sample}`); }
        else if (act === 'pack') return await S.打包();
        await S.渲染(host);
      } catch (err) { say(`✗ ${err.message}`, true); }
    };
  },
  挂(card) {
    const 重画 = () => card.matches(':active') ? document.addEventListener('pointerup', () => setTimeout(重画), { once: true }) : 设置界面.渲染(card);
    card.className = 'ai-card';
    card.insertAdjacentHTML('beforebegin', `<style>${界面样式}</style>`);
    const 别处 = e => card.querySelectorAll('[data-sure]').forEach(x => x.contains(e.target) || 设置界面.复原(x));
    document.addEventListener('ai:providers', 重画); document.addEventListener('pointerdown', 别处, true); 重画();
    return () => {
      document.removeEventListener('ai:providers', 重画); document.removeEventListener('pointerdown', 别处, true);
      if (订阅网关.轮询) { clearInterval(订阅网关.轮询); 订阅网关.轮询 = null; }
    };
  },
  复原(x) { clearTimeout(+x.dataset.sure); delete x.dataset.sure; x.textContent = x.dataset.t; x.classList.remove('warn'); },
  async 打包() {
    try {
      const html = await 打包.出(), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      a.download = 'petri-ai-配置版.html'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 800);
      设置界面.说 = { text: `✓ 已导出 ${a.download}, 对方在 Colony 里「导入 Petri」并启用就能用` };
    } catch (err) { 设置界面.说 = { text: `✗ 打包没成: ${err.message}`, bad: true }; }
    厂商配置.通知();
  },
};
// ═ 测通 · 跟着: 厂商配置, 协议适配, 模型调用, 多模态, 各类模型 ═
// 每类一次最小的真调用, 通了点亮这一类并记下用的模型; 界面点徽章和 ai.test 走同一条
// 回的是声音(语音、音乐)就直接放出来: 测语音 = 试听
async function 测通(ref, 类, model, source) {
  类 = 类 || 'chat';
  const p = await 厂商配置.要(ref), 表 = 模型调用.适配(p).类型;
  if (!表[类]) throw new Error(`不认识的类型: ${类}。可选: ${Object.keys(表).join(', ')}`);
  return 测一次(p, 表[类], 类, model, source).catch(async e => {   // 没测通就熄灭
    await 厂商配置.更新(p.id, { passed: { [类]: null } });
    throw e;
  });
}
async function 测一次(p, t, 类, model, source) {
  const use = model || (类 === 'chat' ? p.model : p.modelOf?.[类]);
  let r, 没放 = '';
  if (类 === 'chat') {
    const messages = [{ role: 'user', content: 'hi' }];
    const got = await 模型调用.chat(p, { messages, model: use });
    if (!got.content && !got.toolCalls)   // 回了 200 却一个字没有, 不算通
      throw 厂商错(p, `回了 200 但没有内容: ${JSON.stringify(got.raw).slice(0, 200)}`);
    r = { text: got.content };
  }
  // ✂ 双工
  else if (类 === 'realtime') {
    (await 双工.open(p, { model: use })).关();   // 会话就绪就算通, 连上就挂断
    r = { text: '连上了, 会话就绪' };
  }
  // ✂ 双工 完
  // ✂ 非文本
  else {
    let 料 = typeof t.测 === 'function' ? t.测(source) : t.测, 念;
    if (类 === 'stt' && use) {   // 空录音有的厂商会拒(说没人声、太短): 有语音模型就真念一句当素材
      const text = '你好, 现在测试一下语音转文字。';
      念 = await 厂商配置.选({}, 'tts').then(q => 多模态.调(q, 'tts', { text, format: 'wav' })).catch(() => null);
      if (念?.data) 料 = { audio: 念.data, mimeType: 念.mimeType };
    }
    r = await 多模态.调(p, 类, Object.assign({ model: use }, 料)).catch(e => {
      if (类 === 'stt' && !念?.data && e.status !== 404)   // 404 是接口不在, 和用什么录音没关系
        e.message += ' ← 测转录用的是一段空录音, 有的厂商会拒收: 先给语音那一类选好模型和音色, 再测就会真念一句';
      throw e;
    });
    if (r.data && /^audio/.test(r.mimeType) && typeof Audio !== 'undefined')
      await new Audio(`data:${r.mimeType};base64,${r.data}`).play()
        .catch(e => { 没放 = ` (浏览器没让放出声: ${e.message})`; });
    r.text ??= r.url || (r.data ? `拿到 ${Math.ceil(r.data.length * 3 / 4096)} KB`
      : r.embeddings ? `${r.embeddings[0].length} 维` : `${r.results.length} 条`);
  }
  // ✂ 非文本 完
  const 记 = { passed: { [类]: { model: use, at: Date.now() } } };
  await 厂商配置.更新(p.id, Object.assign(记, 类 === 'chat' ? { model: use } : { modelOf: { [类]: use } }));
  return { ok: true, provider: p.name, type: 类, model: use, sample: String(r.text).slice(0, 80) + 没放 };
}
// ═ 选模型 · 跟着: 厂商配置, 测通 · 借用者: petri:agent, petri:code, petri:workflow ═
// 按类选用哪家哪个模型的小表, 给别的块借: 挂(el, {类, 空, 厂商}) 画进 el, 回摘掉的函数; 样子借用方定
// 一类两行: 厂商 · 模型 · ⚡ / 音色 · 语速 · 尾帧字段(标了才有); 别的类按需加。空: 厂商第一项的字; 厂商: 顶上多网址、Key、文本模型
const 选模型 = {
  esc: s => String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`),
  // 项 = [[值, 显示的字, 灰?]], 现在的值不在里面就补在第一项后面; 头 = 开标签写到 data-xx=" 为止(样子由用的人定)
  下拉(f, v, 项, 头 = '<select data-f="') {
    const esc = 选模型.esc;
    if (v && !项.some(x => x[0] === v)) 项.splice(1, 0, [v, v]);
    return 头 + esc(f) + '">' + 项.map(([k, t, 灰]) => '<option value="' + esc(k) + '"'
      + (k === (v || '') ? ' selected' : '') + (灰 ? ' disabled' : '') + '>' + esc(t) + '</option>').join('')
      + '</select>';
  },
  async 画(el, o) {
    const list = await 厂商配置.列表(), p0 = list[0] || {}, 表 = 厂商配置.表(p0), { esc, 下拉 } = 选模型;
    const 模 = (p, k, f, m) => 下拉(f, m, [['', '(选模型)']]   // 现在选的排最前
      .concat(厂商配置.候选(p, k).filter(x => x !== m).map(x => [x, x])));
    const 钮 = (k, t) => `<button data-t="${k}">${t || '⚡'}</button>`;
    let h = o.厂商 ? '<label>网址</label><input data-f="endpoint" value="' + esc(p0.endpoint || '')
      + '" placeholder="https://api.xxx.com/v1"><label>Key</label>'
      + '<input type="password" data-f="apiKey" value="' + esc(p0.apiKey || '') + '"><label>文本模型</label><div>'
      + 模(p0, 'chat', 'model', p0.model) + 钮('models', '📥') + 钮('chat') + '</div>' : '';
    // ✂ 非文本
    const 类们 = [...new Set(o.类.concat(Object.keys((await ctx.kv.get(厂商配置.用键)) || {}), o.加 || []))]
      .filter(k => 表[k] && k !== 'chat'), 余 = Object.keys(表).filter(k => k !== 'chat' && !类们.includes(k));
    for (const k of 类们) {
      const p = await 厂商配置.用(k), t = 表[k], m = p?.modelOf?.[k], 音 = p?.voiceOf?.[k];
      const vs = p?.voices?.[m] || [];
      h += '<label>' + esc(t.名) + '</label><div>' + 下拉(`p.${k}`, p?.id, [['', o.空?.[k] || '(不用)']]
        .concat(list.map(x => [x.id, x.name]))) + (p ? 模(p, k, `m.${k}`, m) + 钮(k) : '') + '</div>';
      if (p && (t.音色 || t.语速 || t.尾帧)) h += '<div>'
        + (t.音色 ? 下拉(`v.${k}`, 音, [['', '(默认音色)']].concat(vs.map(v => [v.id, v.name]))) : '')
        + (t.语速 ? `<input data-f="s.${k}" type="number" step="0.1" value="${p.speed || 1}">` : '')
        + (t.尾帧 ? `<input data-f="w.${k}" value="${esc(p.adapt?.[k]?.尾帧)}" title="尾帧字段"`
          + ' placeholder="尾帧字段(默认 last_image)">' : '') + '</div>';
    }
    if (余.length) h += '<div>' + 下拉('加', '', [['', '＋ 加一类']].concat(余.map(k => [k, 表[k].名]))) + '</div>';
    // ✂ 非文本 完
    el.innerHTML = h + '<p>' + esc(o.话) + '</p>';
  },
  挂(el, o) {
    const 画 = () => 选模型.画(el, o), 说 = t => { o.话 = t; return 画(); };
    el.onchange = async e => {
      const f = e.target.dataset.f, v = e.target.value.trim(), [a, k] = f.split('.');
      try {
        // ✂ 非文本
        if (a === '加') return (o.加 = (o.加 || []).concat(v)), 画();
        if (a === 'p') return await 厂商配置.设用(k, v);   // 存了会通知重画
        if (k) {   // 各类的格; 换了带音色那类的模型, 顺手拉它的音色
          const p = await 厂商配置.用(k);
          await 厂商配置.更新(p.id, a === 'm' ? { modelOf: { [k]: v || null } }
            : a === 'v' ? { voiceOf: { [k]: v || null } } : a === 's' ? { speed: Number(v) || undefined }
            : { adapt: { [k]: 厂商配置.表(p)[k].尾帧(p.adapt?.[k], v) } });
          return a === 'm' && v && 厂商配置.表(p)[k].音色
            && await ctx.call('ai.voices', { provider: p.id, type: k }).catch(() => { });
        }
        // ✂ 非文本 完
        const p = (await 厂商配置.列表())[0] || await 厂商配置.新增({ name: '默认' });
        await 厂商配置.更新(p.id, { [f]: v });
      } catch (err) {
        说(`✗ ${err.message}`);
      }
    };
    el.onclick = async e => {   // ⚡ 测这一类(文本测第一家); 📥 拉第一家的模型清单
      const k = e.target.dataset.t;
      if (!k) return;
      说('⋯ 测试中');
      try {
        await 厂商配置.队列;
        const p = /^(chat|models)$/.test(k) ? (await 厂商配置.列表())[0] : await 厂商配置.用(k);
        if (!p) throw new Error(/^(chat|models)$/.test(k) ? '先在上面填网址和 Key' : '先给这一类选一家厂商');
        if (k !== 'models') return 说(`✓ 测通: ${(await 测通(p.id, k)).sample}`);
        说(`✓ 拉到 ${(await 厂商配置.拉模型(p)).models.length} 个模型`);
      } catch (err) {
        说(`✗ ${err.message}`);
      }
    };
    document.addEventListener('ai:providers', 画);
    画();
    return () => document.removeEventListener('ai:providers', 画);
  },
};
// ═ 配置种子 ═
// 出厂是空。「打包配置版」导出时这一段换成全部厂商配置(含明文 Key); 别人导入启用后由 打包.播种() 并进他的库
const 配置种子 = null;
// ═ 打包 · 跟着: 厂商配置, 配置种子 ═
// 出: 单独导出本块, 导出件里「配置种子」段换成种子(stem.molt 的 swap); 本机代码、记录不动, 以后导出不带 Key。
//   借了 Stem 的「换段」, 所以单独导出的文件、打出来的包里也能再打包
// 播种: 同名又同网址才算同一家, 否则另起一条(不把对方的 Key 配到种子的网址上); 不删对方已有的, 不动他的默认厂商;
//   播完把种子从正在用的这一版里拿掉(里面是别人的明文 Key), 播过的记着, 不重播
const 打包 = {
  已播键: 'settings:ai.seedAt',
  async 播过(at, 记) {   // 只记最后一份的话, 对方自己打包一次就把导入那份挤掉, 它会被重播
    const 已 = [].concat((await ctx.kv.get(this.已播键)) || []);
    if (记 && !已.includes(at)) await ctx.kv.set(this.已播键, 已.concat(at));
    return 已.includes(at);
  },
  种子段: json => '// ═ 配置种子 ═\n// 打包进来的配置; 播完会被拿掉\nconst 配置种子 = ' + json + ';',   // 整段自己写, 单独文件里没有读段的能力也能打包
  async 出() {
    const list = await 厂商配置.列表(), did = await 厂商配置.默认id();
    if (!list.length) throw new Error('还没有配置任何厂商, 没东西可打包');
    // 不跟着走的: id(对方按厂商名合并, 所以默认厂商也按厂商名记)、测通记录(在对方机器上通不通得他自己测)
    const providers = list.map(p => Object.assign({}, p, { id: undefined, passed: undefined }));
    const seed = { at: Date.now(), default: (list.find(p => p.id === did) || {}).name, providers };
    await this.播过(seed.at, true);   // 先记下: 这份包以后导回自己这里时, 不用把自己的配置再播一遍
    // 要进 script 标签里的源码, 尖括号得转义, 不然 Stem 拒收
    const text = this.种子段(JSON.stringify(seed).replace(/</g, '\\u003c'));
    const swap = { id: ctx.id, name: '配置种子', text };
    return await ctx.call('stem.molt', { ids: [ctx.id], stem: false, swap });
  },
  async 播种() {
    const s = 配置种子;
    if (!s || !Array.isArray(s.providers)) return;
    if (!(await this.播过(s.at))) {
      const 原有 = (await 厂商配置.列表()).length;
      for (const rawSp of s.providers) {
        try {
          const sp = JSON.parse(JSON.stringify(rawSp));
          if (sp.adapt && typeof sp.adapt === 'object') Object.values(sp.adapt).forEach(x => { if (x && typeof x === 'object' && 'code' in x) { delete x.code; console.warn('[ai] 导入包里的 adapt.code 已按安全策略跳过'); } });
          const list = await 厂商配置.列表(), 另名 = `${sp.name} (导入)`;
          const old = list.find(x => x.endpoint === sp.endpoint && (x.name === sp.name || x.name === 另名));
          if (old) await 厂商配置.更新(old.id, Object.assign({}, sp, { name: old.name }));
          else await 厂商配置.新增(list.some(x => x.name === sp.name) ? Object.assign({}, sp, { name: 另名 }) : sp);
        } catch (e) { // 认不出的协议(如这边没有桥接块时的 gateway)跳过, 别的照播
          console.warn(`[ai] 种子里的厂商「${sp.name}」没播进来: ${e.message}`);
        }
      }
      const d = !原有 && s.default && await 厂商配置.找(s.default);
      if (d) await 厂商配置.设默认(d.id);
      await this.播过(s.at, true);
    }
    // 播过的也拿(配置版点了恢复原版, 种子会复活); 本块因此重启一次
    await ctx.call('stem.setBlock', { id: ctx.id, segment: { name: '配置种子', text: this.种子段('null') } });
  },
};
// ═ 自报 ═
// 统一管厂商(含异构改法)、订阅与 :4135 网关, 供各块和外部工具调
// 数据 {"prefix": "settings:ai.", "label": "厂商、订阅与网关配置", "kind": "config", "edit": "ai.configure"}
// 现在 ai.providers
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【接厂商】给 Key 或接新厂商/本地模型时: 常规 OpenAI 兼容站直接 ai.configure {name, endpoint, apiKey}(免填 protocol) + ai.test。
//   本地 endpoint 填 http://127.0.0.1:11434/v1(Ollama) / 1234(LM Studio) / 4135(聚合网关), apiKey 留空。
//   跨域会自动回退插件或本机 4135/proxy; 纯手机无插件无本机才填 proxy({url} 替原网址)。
//   若遇非兼容原生接口(如 Gemini 官方 AIza/AQ.、Anthropic sk-ant-、Azure、私有异步接口), 别改源码, 先读「接口改法」用 adapt 接。
// 【各类模型】给非文本模态(图片、改图、视频、语音、转录、嵌入、重排、音乐、双工)选模型或音色时:
//   先看 ai.providers 的 models, 用 ai.configure {name, modelOf:{image, imageEdit, video, tts, stt, embedding, ...}} 设好并逐类 ai.test;
//   tts / realtime 先调 ai.voices 拉音色再设 voiceOf。
// 【接口改法】厂商鉴权头、路径、请求/响应结构或异步轮询与 OpenAI 不同时: 一律用 ai.configure {name, adapt} 零改源码打通:
//   1) 纯 JSON 声明(覆盖 90% 异构接口; 设 null 删默认头/字段; 支持 {apiKey} {model} {prompt} {image} {id} 模板):
//      · 全局鉴权/参数: _:{headers:{Authorization:null, "x-api-key":"{apiKey}"}, query:{key:"{apiKey}"}}
//      · 模型清单: models:{path:"/models", query:{pageSize:"100"}, pick:"models[].name"} (path:false 则不拉清单手填模型)
//      · 对话与流式: chat:{path:"/deployments/{model}/chat/completions", streamPath:"...", body:{...}, pick:{content:"...", delta:"...", reasoning:"..."}}
//      · 多模态与轮询: video:{path:"/...", body:{input:{prompt:"{prompt}", img_url:"{image}"}}, pick:"output.video_url",
//          poll:{method:"GET", path:"/tasks/{id}", id:"output.task_id", status:"output.task_status", done:"SUCCEEDED", fail:"FAILED", pick:"output.video_url"}}
//   2) code 微转换器(覆盖消息结构彻底不同的原生接口): 在 adapt[类].code 填 JS 字符串 "{ req(a,p,base){...}, res(j,p){...}, chunk(j,line,p){...} }":
//      · req 回 {url,method,headers,body}; chat 的 res 回 {content,toolCalls,usage,stop}, chunk 回 {delta,reasoning,toolDelta,stop};
//        image/video/audio 的 res 回 {url} 或 {mimeType,data}; embedding 的 res 回 {embeddings:[[...]]}。
//      · 实战避坑: ① Gemini 官方 Key(AIza/AQ.)走 generativelanguage.googleapis.com/v1beta(头 x-goog-api-key + Authorization:null, 勿发 Vertex aiplatform),
//        工具声明需删 $schema/additionalProperties, 且 2.5/3.x 多轮工具强制回传 thoughtSignature——可在 code 外包 IIFE 闭包 Map 按 toolCall.id 缓存回传;
//        ② Anthropic(sk-ant-)走头 x-api-key + anthropic-version:"2023-06-01" + Authorization:null;
//        ③ 仅非 HTTP 私有二进制协议连 code 也表达不了时, 才改「装配」段挂新协议。
// 【订阅网关】登录订阅账号或管理 :4135 本地聚合网关时:
//   · 订阅(ai.sub): action 传 status | start | login({driver, mode, apiKey}) | logout({driver}) | sync({driver}) | clean;
//     本机守护进程在线时走本机驱动, 纯浏览器装了插件也可直接登 Cursor / Grok Build / Antigravity / ChatGPT(protocol:"plugin-sub")。
//   · 聚合网关(ai.gateway): :4135 把已登订阅、同步的 API 厂商和网页反桥模型聚成单一 OpenAI/Anthropic 兼容入口供外部工具(Claude Code/Cursor 等)调;
//     action 传 status | start | set({expose, apiKey, regenerateKey}) | push, 开局域网 expose:true 时务必配网关 apiKey。
// ═ 装配 · 跟着: 并发闸, 厂商配置, 模型调用, 协议适配, 多模态, 测通, 打包, 订阅与网关, 设置界面 ═
// 能力都带参数形状; 改配置的不接隔离窗, 调模型的小应用也能用(Key 不出本块, 它只拿得到结果); 每次调模型都过并发闸
// 登记能力不要流式、工具、思考, 借用方自己在借用行里点(agent 点了, 工作流用不上)
// 借了它的块单独打开、或本块停用了时, 这几行剪进借用方: ai.* 不是借用方的前缀, 登记了只给它自己用, 别人调说本块停用了
// ✂ 登记能力 · 要: 厂商配置, 模型调用, 各类模型, 并发闸, 测通, 多家厂商, 转发
async function* 限流(p, it) {   // 流式的也占一个并发位, 流完(或被掐断)才放
  const 放 = await 并发闸.占(p);
  let 错;
  try { yield* it; } catch (e) { throw 错 = e; } finally { 放(错); }
}
const 对话 = async a => {
  if (!Array.isArray(a.messages) || !a.messages.length) throw new Error('要 messages 数组: [{role, content}]');
  const p = await 厂商配置.选(a);
  return a.stream ? 限流(p, 模型调用.chatStream(p, a)) : 并发闸.跑(p, () => 模型调用.chat(p, a));
};
ctx.provide('ai.chat', 对话, {
  desc: '对话, 可带工具: 回 {content, toolCalls:[{id,name,args}]|null, usage}; stream:true 回异步迭代器, 文字逐片 {delta}, '
    + '思考 {reasoning}, 写工具参数时 {tool, chars}, 最后一片 {done, content, toolCalls, usage}; '
    + '工具结果放回 messages 时用 {role:"tool", toolCallId, name, content}',
  schema: {
    messages: '[{role: system|user|assistant|tool, content: 文字或 '
      + '[{type:text,text}|{type:image,mimeType,data}], toolCalls?: [{id,name,args}], toolCallId?}]',
    tools: '[{name, description, parameters: JSON Schema}]?', model: 'string?', provider: 'string?',
    temperature: 'number?', maxTokens: 'number?', stream: 'boolean?', think: 'on|off?' },
});
const 类型表 = 协议适配['openai-compatible'].类型, 类型名单 = Object.keys(类型表).join('|');
Object.keys(类型表).forEach(类 => {   // 表里有哪类就登记哪类: 剪掉哪个范围就少哪个能力
  const t = 类型表[类];
  (t.另 || []).forEach(x => ctx.provide(...x));
  if (!t.说明 && !t.能力) return;
  ctx.provide(t.能力 || `ai.${类}`, async a => {   // 形状里不带 ? 的是必填, Stem 调之前就查了
    const p = await 厂商配置.选(a, 类);
    return t.开 ? t.开(p, a) : 并发闸.跑(p, () => 多模态.调(p, 类, a));
  }, { desc: t.说明, frames: !t.开,   // 开出来的是活对象(双工会话), 过不了隔离窗
    schema: Object.assign({}, t.形状, { model: 'string?', provider: 'string?(不给就找选了这一类模型的厂商)' }) });
});
ctx.provide('ai.models', async a => {
  const 类 = a.type || 'chat', list = await 厂商配置.列表(), did = await 厂商配置.默认id(), out = [];
  if (!类型表[类]) throw new Error(`不认识的类型: ${类}。可选: ${Object.keys(类型表).join(', ')}`);
  list.forEach(p => {
    const 过 = p.passed?.[类], 选的 = p.modelOf?.[类], 注 = p.notes || {};
    const 行 = (m, more) => out.push(Object.assign({ model: m, provider: p.name, providerId: p.id,
      protocol: p.protocol, type: 类 }, more, 注[m] && { note: 注[m] }));
    if (类 !== 'chat') return 选的 && 行(选的, { tested: !!过 && 过.model === 选的 });
    if (!过 && !a.all) return;
    const ms = 厂商配置.文本(p);
    if (!ms.length && a.all) ms.push('');   // 全都列: 一个模型都没拉到的那家也留一行, 模型空着
    ms.forEach(m => 行(m, { tested: !!过, default: p.id === did && m === p.model }));
  });
  return out;
}, { desc: '模型清单, 带标注(note)、测没测通(tested)。默认列测通过的厂商的文本模型(default = 用户的默认); 给 type 列每家为'
    + '这一类选的模型; all: 文本也列没测通的厂商(一个模型都没有的那家 model 是空的)',
  schema: { type: `${类型名单}?`, all: 'boolean?' } });
const 厂商摘要 = async p => 厂商配置.摘要(p, await 厂商配置.默认id());
ctx.provide('ai.providers', async () => Promise.all((await 厂商配置.列表()).map(厂商摘要)), {
  desc: '已配厂商(不含 Key): 每类选的模型 modelOf 和音色 voiceOf、测通记录 passed、标注 notes、拉来的 models',
  schema: {},
});
const 配置形状 = { name: 'string', endpoint: 'string?(只填到版本前缀, 如 https://api.xxx.com/v1)',
  apiKey: 'string?(本地模型留空)', protocol: 'string?', model: 'string?(文本用的)',
  modelOf: 'object?({类型: 模型}, null 清掉)', notes: 'object?({模型: 一句标注}, null 删除)',
  voiceOf: 'object?({tts|realtime: 音色 id})', speed: 'number?(语速)', default: 'boolean?',
  concurrency: 'number?(默认 8)', maxOut: 'number?(单次最多写几 token, 不给由厂商定)',
  toolMode: 'native|text?(text = 不支持原生工具调用, 用文字围栏)', think: 'effort|type|enable?(思考开关写法, 默认 effort)',
  adapt: 'object?(各类和兼容协议不一样的地方, 写法见「技能」段)',
  proxy: 'string?(转发地址: 浏览器不让直连这家时, 这家的请求全经它转; {url} 换成原网址, 空串清掉)' };
ctx.provide('ai.configure', async a => {
  if (!a.name) throw new Error('缺 name(厂商显示名; 同名=更新, 新名=新增)');
  const patch = {};
  Object.keys(配置形状).forEach(k => { if (a[k] !== undefined && !/^(name|default)$/.test(k)) patch[k] = a[k]; });
  const old = await 厂商配置.找(a.name);
  let p = old ? await 厂商配置.更新(old.id, patch) : await 厂商配置.新增(Object.assign({ name: a.name }, patch));
  if (a.default) await 厂商配置.设默认(p.id);
  let pulled = '';
  if (!old || patch.apiKey || patch.endpoint || patch.protocol) {
    try {
      p = await 厂商配置.拉模型(p);
      pulled = `拉到 ${p.models.length} 个模型`;
    } catch (e) {
      pulled = `模型清单拉取失败: ${String(e.message).slice(0, 100)}`;
    }
  }
  return Object.assign(await 厂商摘要(p), pulled ? { pulled } : {});
}, {
  desc: '新增或更新厂商(同名即更新), 顺带拉模型清单(结果在 pulled)。细节读本块的「技能」段(接厂商 / 各类模型 / 接口改法 / 订阅网关)',
  schema: 配置形状, frames: false,
});
ctx.provide('ai.test', a => 测通(a.provider, a.type, a.model, a.source), {
  desc: '测试一类模型: 做一次最小的真调用, 通了记下来', frames: false,
  schema: { provider: 'string', type: `${类型名单}?`, model: 'string?', source: 'string?(videoEdit 要的 mp4 网址)' },
});
// ✂ 任意接口 · 要: 登记能力
ctx.provide('ai.fetch', async a => {   // 只发往这家的版本前缀下面
  const p = await 厂商配置.要(a.provider), ad = 模型调用.适配(p);
  if (!/^\//.test(a.path)) throw new Error('path 要以 / 开头(接在版本前缀后面)');
  const 有 = a.body !== undefined, res = await 并发闸.跑(p, () => 模型调用.发(p, ad.基(p) + a.path, Object.assign(
    { headers: ad.头(p, 有), timeout: 180000, retries: 0 },
    有 && { method: 'POST', body: JSON.stringify(a.body) })));
  if (!res.ok) throw await 模型调用.错误(res, p);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  return /json/.test(type) ? 协议适配.读(res, p) : /^text\//.test(type) ? { text: await res.text() }
    : { mimeType: type || 'application/octet-stream', data: 协议适配.成base64(await res.arrayBuffer()) };
}, {
  desc: '类型表里没有的接口: 给 body 就 POST JSON, 不给 GET; 回 JSON、{text} 或 {mimeType, data}',
  schema: { provider: 'string', path: 'string(以 / 开头)', body: 'object?' }, frames: false,
});
// ✂ 任意接口 完
ctx.provide('ai.remove', async a => {
  const p = await 厂商配置.要(a.provider);
  await 厂商配置.删除(p.id);
  return { removed: p.name };
}, { desc: '删除厂商', schema: { provider: 'string' }, frames: false });
// ✂ 登记能力 完
ctx.provide('ai.gateway', async a => {
  const act = a.action || 'status';
  if (act === 'start') return 订阅网关.启动();
  if (act === 'set') return 订阅网关.设网关({ expose: a.expose, apiKey: a.apiKey, regenerateKey: a.regenerateKey });
  if (act === 'push') return 订阅网关.推厂商();
  const st = await 订阅网关.刷新();
  return st ? Object.assign({ online: true, url: 订阅网关.url }, st) : { online: false, url: 订阅网关.url, error: 订阅网关.错 };
}, {
  desc: '查或改本机聚合网关(:4135, 私有 OpenRouter / CLIProxyAPI): status|start|set(expose/apiKey/regenerateKey)|push(同步常规厂商到网关)',
  schema: { action: 'status|start|set|push?', expose: 'boolean?', apiKey: 'string?', regenerateKey: 'boolean?' },
  frames: false,
});
ctx.provide('ai.sub', async a => {
  const act = a.action || 'status';
  if (a.via === 'plugin') {
    if (act === 'status') return { via: 'plugin', available: await 插件订阅.探测(), drivers: await 插件订阅.列表() };
    if (act === 'login') return 插件订阅.登录(a.driver);
    if (act === 'cancel') return 插件订阅.取消(a.driver).then(() => ({ ok: true }));
    if (act === 'logout') return 插件订阅.退出(a.driver).then(() => ({ ok: true }));
    if (act === 'sync') return 插件订阅.同步(a.driver);
    if (act === 'models') return 插件订阅.拉模型(a.driver);
    throw new Error('纯插件模式不支持 action: ' + act);
  }
  if (act === 'status') {
    const [st, pDrivers] = await Promise.all([订阅网关.刷新(), 插件订阅.列表().catch(() => [])]);
    return st ? Object.assign({ online: true, url: 订阅网关.url, pluginDrivers: pDrivers }, st)
      : { online: false, url: 订阅网关.url, error: 订阅网关.错, pluginDrivers: pDrivers };
  }
  if (act === 'start') return 订阅网关.启动();
  if (act === 'login') {
    if (!订阅网关.ok && !await 订阅网关.刷新()) await 订阅网关.启动();
    const r = await 订阅网关.请('/admin/login/' + encodeURIComponent(a.driver), { body: { mode: a.mode, apiKey: a.apiKey }, timeout: 25000 });
    await 订阅网关.刷新();
    return r;
  }
  if (act === 'logout') {
    const r = await 订阅网关.请('/admin/logout/' + encodeURIComponent(a.driver), { method: 'POST' });
    await 订阅网关.刷新();
    return r;
  }
  if (act === 'sync') return 订阅网关.同步订阅(a.driver);
  if (act === 'clean') return 订阅网关.清理同步();
  throw new Error('未知 action: ' + act);
}, {
  desc: '订阅账号管理(本机或纯插件 via:"plugin"): action=status|start|login|cancel|logout|sync|clean|models',
  schema: { action: 'status|start|login|cancel|logout|sync|clean|models?', driver: 'string?', via: 'local|plugin?', mode: 'string?', apiKey: 'string?' },
  frames: false,
});
// 注册纯插件 OAuth 订阅协议(无本机进程、手机浏览器装扩展时直连 4 家订阅)
协议适配['plugin-sub'] = {
  名称: '纯插件 OAuth 订阅 (免本机进程)',
  自管端点: true,
  默认端点: 'plugin-sub://grok-build',
  基址: p => String(p.endpoint || '').trim(),
  类型: 协议适配['openai-compatible'].类型,
  对话请求: () => ({}),
  执行对话: (p, a) => 插件订阅.对话(p, a),
  执行多模态: (p, 类, a) => 插件订阅.多模态(p, 类, a),
  拉模型: p => 插件订阅.拉模型(String(p.endpoint || '').replace(/^plugin-sub:\/\//, '')),
};
打包.播种().catch(e => console.warn('[ai] 配置种子没播成:', e.message));
订阅网关.刷新().then(st => { if (st) { 订阅网关.连网页桥(); 订阅网关.推厂商().catch(() => {}); } }).catch(() => {});
if (typeof document !== 'undefined') {
  const 推防抖 = (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => { if (订阅网关.ok) 订阅网关.推厂商().catch(() => {}); }, 600); }; })();
  document.addEventListener('ai:providers', 推防抖);
  ctx.cleanup(() => { document.removeEventListener('ai:providers', 推防抖); 订阅网关.断网页桥(); });
}
if (typeof document !== 'undefined' && ctx.root) {
  const card = document.createElement('div');
  ctx.root.append(card);
  ctx.cleanup(设置界面.挂(card));
}
return {};
'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 stem 的 换段
// ═ 网络请求 · 借用者: petri:porter ═
// 超时与重试的唯一入口, 免得每家各写一套
async function 网络请求(url, opt = {}) {
  const { retries = 1, timeout = 60000, signal: sg } = opt;
  let 真 = url, 经 = '', last;
  // ✂ 转发 · 要: 网络请求
  // 转发: 填了就经它转(浏览器不让网页直连时用), {url} 换成编码后的原网址, 没写 {url} 就接在末尾
  const 转 = opt.转发;
  if (转) [真, 经] = [(转.includes('{url}') ? 转 : 转 + '{url}').replace('{url}', encodeURIComponent(url)),
    `(经转发地址 ${转})`];
  // ✂ 转发 完
  for (let i = 0; i <= retries; i++) {
    if (i) await new Promise(r => setTimeout(r, 800));
    const ctrl = new AbortController(), onAbort = () => ctrl.abort(), timer = setTimeout(onAbort, timeout);
    // 已取消的信号不再发事件, 得先看一眼, 不然请求照发
    if (sg) sg.aborted ? onAbort() : sg.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(真, Object.assign({}, opt, { signal: ctrl.signal }));
      clearTimeout(timer);
      if (res.status < 500 || i >= retries) return res;   // 429 不在这重发: 上层按厂商说的时间等
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      clearTimeout(timer); last = e;
      if (sg?.aborted) throw e;
      if (ctrl.signal.aborted) break;   // 超时不重发: 厂商可能已在算, 再发扣两次钱
    }
  }
  if (last?.name === 'TypeError')   // retry: 调用方可隔会再试
    throw Object.assign(new Error('连不上 ' + url + 经 + ': 网络不通, 或浏览器不让网页直接连它'), { retry: true });
  if (last?.name === 'AbortError')
    throw new Error(`请求 ${url} 超过 ${Math.round(timeout / 1000)} 秒没回应`);
  throw last;
}

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
// ═ 协议适配 · 借用者: petri:agent ═
// 一种协议 = 一个对象: 对话怎么发怎么读 + 一张类型表(每类模型一行); 不碰网络和配置
// 网址 = 用户填的版本前缀(如 https://api.xxx.com/v1) + 这一类的后缀。本段只有文本那一行和公用小工具,
// 别的类在「各类模型」段用 加类 加进表; 加协议见「技能」
// 一行: 后缀、请求、回复、测(测通用的最小参数)、说明/形状/能力(写了说明或能力就登记成能力,
//   能力不写就是 ai.键; 有「开」就回它开出来的; 另: 这一类另外登记的能力)、音色 / 语速 / 尾帧(界面多画一个框)、
//   查(要轮询的任务怎么查)
// 消息统一形状: {role, content: 文字或 parts, toolCalls?: [{id, name, args}], toolCallId?};
//   工具: {name, description, parameters}
// 结果统一形状: 图片/视频/语音/音乐 {mimeType, data} 或 {url}; 转录 {text}; 嵌入 {embeddings}; 重排 {results: [{index, score}]}
const 厂商错 = (p, 话) => new Error(`厂商「${p.name}」${话}`);
const 协议适配 = (() => {
  const 文字 = c => Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n')
    : String(c ?? '');
  const 读行 = l => {   // 事件流的一行 → JSON, 不是数据行回 null
    const s = l.trim().startsWith('data:') ? l.trim().slice(5).trim() : '';
    if (!s || s === '[DONE]') return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  };
  // 回复读成 JSON, 事件流取最后一条; 不是 JSON(多半网址填错)、200 但正文是报错(不少中转站这样), 都在这挑出来, 不当成空结果
  const 读 = async (x, p) => {
    const t = typeof x === 'string' ? x : await x.text();
    let j;
    try {
      j = /^\s*data:/.test(t) ? t.split('\n').map(读行).filter(Boolean).pop() || {} : JSON.parse(t);
    } catch (e) {
      throw 厂商错(p, `回的不是 JSON(网址可能填错了): ${t.slice(0, 120)}`);
    }
    const 错 = j && (j.error || j.type === 'error' && j);
    if (错) throw 厂商错(p, `报错: ${错.message || JSON.stringify(错)}`);
    return j;
  };
  // 图片音频一律 base64 进出(能力边界只传得动 JSON); 进来的可以是纯 base64、data: 网址, 或 {data, mimeType}
  const 类型名 = (v, 默认) => v?.mimeType
    || (/^data:([^;,]+)/.exec(typeof v === 'string' ? v : v.data) || [])[1] || 默认;
  const 网址 = (v, 默认) => {
    const s = typeof v === 'string' ? v : v.data;
    return /^(https?:|data:)/.test(s) ? s : `data:${类型名(v, 默认)};base64,${s}`;
  };
  const 类型 = { chat: { 名: '文本', 后缀: '/chat/completions' } };
  // 各类的名(= 范围名): 不圈在范围里, 只剪进来几类时也认得全
  const 类名 = { image: '图片', imageEdit: '图片编辑', video: '视频', videoEdit: '视频编辑', stt: '转录', tts: '语音',
    realtime: '双工', embedding: '嵌入', rerank: '重排', music: '音乐' };
  const 兼容 = {
    名称: 'OpenAI 兼容 (绝大多数厂商、中转站、本地模型)', 默认端点: 'https://api.openai.com/v1', 类型,
    头: (p, json) => Object.assign({}, json && { 'Content-Type': 'application/json' },
      p.apiKey && { Authorization: `Bearer ${p.apiKey}` }),
    基址(p) {   // 用户填的网址剥掉误带的后缀, 剩版本前缀
      let u = String(p.endpoint || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
      Object.values(this.类型).map(t => t.后缀).concat('/models')
        .forEach(s => { if (u.endsWith(s)) u = u.slice(0, -s.length); });
      return u;
    },
    基(p) { // 没网址就不拼: 拼出来的是相对网址, 浏览器会带着 Key 发给托管这个页面的服务器
      const b = this.基址(p);
      if (!b) throw 厂商错(p, '没填 API 网址');
      return b;
    },
    端点(p, 类) { return this.基(p) + ((p.adapt?.[类] || {}).path || this.类型[类].后缀); },
    消息(m) {
      // ✂ 工具 · 要: 模型调用
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: 文字(m.content) };
      if (m.role === 'assistant') {
        const o = { role: 'assistant', content: 文字(m.content) };
        if (m.toolCalls?.length) o.tool_calls = m.toolCalls.map(c => ({ id: c.id,
          type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        return o;
      }
      // ✂ 工具 完
      if (!Array.isArray(m.content)) return { role: m.role, content: 文字(m.content) };
      return { role: m.role, content: m.content.map(p => p.type === 'image'
        ? { type: 'image_url', image_url: { url: 网址(p, 'image/png') } }
        : { type: 'text', text: String(p.text ?? '') }) };
    },
    对话请求(p, a) {
      const mt = a.maxTokens || p.maxOut;   // 没传就用厂商记的单次最多输出, 都没有由厂商定
      const o = { model: a.model || p.model, messages: a.messages.map(兼容.消息), stream: !!a.stream };
      if (a.temperature != null) o.temperature = a.temperature;
      if (mt) o.max_tokens = mt;
      // ✂ 思考 · 要: 模型调用
      // 思考开关 p.think: effort = reasoning_effort(OpenAI 系, 默认);
      // type = thinking{type}(DeepSeek/智谱/Kimi); enable = enable_thinking(通义)
      const on = a.think === 'on';
      if (/^(on|off)$/.test(a.think)) Object.assign(o, p.think === 'type'
        ? { thinking: { type: on ? 'enabled' : 'disabled' } } : p.think === 'enable' ? { enable_thinking: on }
        : { reasoning_effort: on ? 'high' : 'none' });
      // ✂ 思考 完
      // ✂ 工具
      if (a.tools?.length) o.tools = a.tools.map(t => ({ type: 'function', function: 工具(t) }));
      // ✂ 工具 完
      return { url: this.端点(p, 'chat'), headers: this.头(p, true), body: JSON.stringify(o) };
    },
    解析回复: j => {
      if (!j.choices) throw new Error(`回的不是对话结果: ${JSON.stringify(j).slice(0, 200)}`);
      const c = j.choices[0] || {}, m = c.message || {};
      const o = { content: m.content || m.reasoning_content || '', toolCalls: null, usage: j.usage || null,
        stop: c.finish_reason || null, raw: j };
      // ✂ 工具
      if (m.tool_calls?.length) o.toolCalls = m.tool_calls.map(x => ({ id: x.id, name: x.function?.name,
        args: 解参(x.function?.arguments) }));
      // ✂ 工具 完
      return o;
    },
    解析流片: j => {
      const ch = j.choices?.[0], d = ch?.delta;
      if (!d) return null;
      const o = { delta: d.content || '', reasoning: d.reasoning_content || d.reasoning || '',
        stop: ch.finish_reason || null };
      // ✂ 工具
      if (d.tool_calls) o.toolDelta = d.tool_calls.map(x => ({ index: x.index, id: x.id,
        name: x.function?.name, argsText: x.function?.arguments || '' }));
      // ✂ 工具 完
      return o;
    },
    模型请求(p) { return { url: `${this.基(p)}/models`, headers: this.头(p) }; },
    解析模型: j => {   // 厂商标的模型类型一并记下, 排候选用
      const list = j.data || j.models || [], hints = {};
      list.forEach(x => {
        if (x?.id && (x.model_type || x.type)) hints[x.id] = String(x.model_type || x.type);
      });
      return { models: list.map(x => x.id || x.name || x).filter(x => typeof x === 'string').sort(), hints };
    },
  };
  const 出 = { 'openai-compatible': 兼容, 文字, 读行, 读, 网址, 类名 };
  // ✂ 工具
  const 工具 = t => ({ name: t.name, description: t.description || '',
    parameters: t.parameters || { type: 'object', properties: {} } });
  const 解参 = s => {
    if (s && typeof s === 'object') return s;
    try { return JSON.parse(s || '{}'); } catch (e) { return { raw: String(s) }; }
  };
  Object.assign(出, { 工具, 解参 });
  // ✂ 工具 完
  // ✂ 非文本 · 要: 选模型
  const 没给 = (p, 什么, j) => {
    throw 厂商错(p, `没返回${什么}: ${JSON.stringify(j).slice(0, 200)}`);
  };
  const 字节 = s => Uint8Array.from(atob(String(s).replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0));
  const 成base64 = buf => {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const 扩展名 = t => {
    const x = t.split(/[/;]/)[1];
    return { mpeg: 'mp3', 'x-wav': 'wav' }[x] || x;
  };
  const 表单 = (o, 默认) => {
    const fd = new FormData();
    Object.keys(o).forEach(k => {
      const vs = [].concat(o[k] == null ? [] : o[k]);
      vs.forEach(v => {
        const name = k + (vs.length > 1 ? '[]' : '');
        if (!/^(image|mask|file)$/.test(k)) return fd.append(name, String(v));
        const type = 类型名(v, 默认);
        fd.append(name, new Blob([字节(typeof v === 'string' ? v : v.data)], { type }), `${k}.${扩展名(type)}`);
      });
    });
    return fd;
  };
  const 取 = (什么, f) => async (res, p) => {
    const j = await 读(res, p);
    return f(j) || 没给(p, 什么, j);
  };
  const 件 = (j, mimeType) => {   // 各家放成品的字段名不一, 常见几处都看
    const d = (j.data || [])[0] || j.video || j, data = d.b64_json || d.audio_base64 || d.audio,
      url = d.url || d.audio_url;
    return typeof data === 'string' && data ? { mimeType, data } : url ? { url } : null;
  };
  // 改法里的占位: 整格 "{名}" 换成值(没给就不带; 给的是 {data, mimeType} 就换成 data: 网址), 夹在字里换成字
  const 媒 = x => x?.data ? 网址(x) : x;
  const 填 = (t, v) => typeof t === 'string' ? (/^\{\w+\}$/.test(t) ? 媒(v[t.slice(1, -1)])
    : t.replace(/\{(\w+)\}/g, (m, k) => v[k] == null ? '' : v[k])) : Array.isArray(t) ? t.map(x => 填(x, v))
    : t && typeof t === 'object' ? Object.fromEntries(Object.entries(t).map(([k, x]) => [k, 填(x, v)])) : t;
  Object.assign(出, { 没给, 取, 成base64, 表单, 件, 填 });
  // 文本以外的各类模型一类一行, 在「各类模型」段用 加类 加进类型表; 界面、测试徽章、ai.* 能力都照表出。
  // 一类一个范围, 名字就是它的「名」(照 类名 填)。加进每种协议的类型表(多半是同一张); 协议自己写了的那一行不动
  出.加类 = (键, 行) => {
    行.名 = 类名[键];
    Object.values(出).forEach(ad => { if (ad.类型 && !ad.类型[键]) ad.类型[键] = 行; });
    return 行;
  };
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
    const text = !!模型调用.文字化 && p.toolMode === 'text' && !!a.tools?.length, 发 = x => {
      const r = ad.对话请求(p, Object.assign({}, text ? 模型调用.文字化(x) : x, { stream }));
      return 模型调用.发(p, r.url, { method: 'POST', headers: r.headers, body: r.body, timeout: 模型调用.超时(p),
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
      if (j.error) // HTTP 是 200, 错在事件里, 不挑出来就成了空回答
        throw 厂商错(p, `流里报错: ${j.error.message || JSON.stringify(j.error)}`);
      if (j.usage) usage = j.usage;
      const c = ad.解析流片(j); if (!c) return;
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
      const out = 流 ? { content: full, usage, stop, toolCalls: null } : ad.解析回复(await 协议适配.读(原文, p));
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
    const ad = 模型调用.适配(p), r = ad.模型请求(p), got = ad.解析模型(await 模型调用.拉(p, r.url, r.headers));
    if (!got.models.length) throw 厂商错(p, '没返回任何模型');
    return got; // {models, hints}
  },
};
// ═ 多模态 · 跟着: 协议适配, 模型调用, 厂商配置 ═
const 多模态 = {   // 空壳总在(登记能力里会碰到这个名字), 里面的才圈非文本
  // ✂ 非文本
  // 文本之外各类共用一副骨架: 查类型表那一行 → 拼请求 → 发 → 读回复; 要等的任务隔一会儿查一次, 直到做好
  // 可借: 厂商记录由参数传进来; 试通了别种写法会写回厂商记录
  间隔: 5000,   // 查任务的间隔(毫秒)
  模型(p, 类, a) {
    return a.model || p.modelOf?.[类] || 模型调用.没选(p, 模型调用.适配(p).类型[类].名);
  },
  // 记下的写法 → 标准写法 → 那一行的「备」, 404/400 才试下一种。试通了别种写法, 只在还没记过写法、
  // 或记下的那条 404(接口没了)时写回: 记下的回 400 多半是这次的内容被拒, 不能拿字段更少的备用写法盖掉它
  // (阶跃 tts 就这样两次丢了 roles, 男女角色念成一个声音)
  async 调(p, 类, a) {
    const 记 = p.adapt?.[类], 串 = JSON.stringify, 法们 = [记 || {}, {}].concat(模型调用.适配(p).类型[类].备 || [])
      .filter((x, i, all) => all.findIndex(y => 串(y) === 串(x)) === i);
    let 错;
    for (const 法 of 法们) {
      try {
        const r = await this.发(p, 类, a, 法);
        if (法 !== 法们[0] && (!记 || 错.status === 404))
          await 厂商配置.更新(p.id, { adapt: { [类]: Object.keys(法).length ? 法 : null } });
        return r;
      } catch (e) {
        错 = 错 || e;
        if (e.status !== 400 && e.status !== 404) throw e;
      }
    }
    throw 错;
  },
  async 发(p, 类, a, 改) {   // 改: 这次试的写法, 拼请求时当成这家这一类的改法
    const ad = 模型调用.适配(p), t = ad.类型[类], model = this.模型(p, 类, a);
    const q = Object.assign({}, p, { adapt: { [类]: 改 } }), url = ad.端点(q, 类);
    const 加 = 协议适配.填(改.body || {}, Object.assign({ model }, a));
    let body = t.请求(a, model, q), 是表单 = typeof FormData !== 'undefined' && body instanceof FormData;
    // 表单装不下嵌套的, 改发 JSON
    if (是表单 && Object.values(加).some(v => v && typeof v === 'object')) [body, 是表单] = [{}, false];
    Object.entries(加).forEach(([k, v]) => v == null
      ? 是表单 ? body.delete(k) : delete body[k] : 是表单 ? body.set(k, v) : body[k] = v);
    const res = await 模型调用.发(p, url, {
      method: 'POST', headers: ad.头(p, !是表单), body: 是表单 ? body : JSON.stringify(body),
      timeout: 180000, signal: a.signal, retries: 0,   // 重发一次就多扣一次钱
    });
    if (!res.ok) {
      const e = await 模型调用.错误(res, p);   // 404 留着原话(可能是"模型不存在"), 再补另一种可能
      if (res.status === 404)   // 有的厂商几个入口开的接口不同, 换它的主入口就有
        e.message += ` ← 也可能是这家(或它的这个入口)没有${t.名}这一类, 或路径和兼容协议不一样: ${url}`;
      throw e;
    }
    const 查 = 改.poll || t.查 && { path: t.查 };
    return 查 ? this.等(p, ad, t, 查, await 协议适配.读(res, p), a)
      : (t.回复 || 协议适配.取(t.名, j => 协议适配.件(j, t.件)))(res, p);
  },
  async 等(p, ad, t, 查, j, a) {   // 任务号各家叫法不一, 常见的几种都认
    const id = j.request_id || j.id || j.task_id, 填 = x => 协议适配.填(x, { id });
    if (!id) throw new Error(`${t.名}发起了但没拿到任务号: ${JSON.stringify(j).slice(0, 200)}`);
    for (let i = 0; i < 600000 / this.间隔; i++) {
      await new Promise(r => setTimeout(r, this.间隔));
      const s = await 模型调用.拉(p, ad.基(p) + 填(查.path), ad.头(p, !!查.body), a.signal, 查.body && 填(查.body));
      const got = 协议适配.件(s, t.件);
      if (got) return got;
      if (/fail|expire|cancel|done|succe|complete/i.test(s.status))
        throw new Error(`${t.名}没做成(状态 ${s.status}): ${JSON.stringify(s.error || s).slice(0, 200)}`);
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
      if (p[k] && !/^https?:\/\//i.test(String(p[k]).trim()))
        throw new Error(名 + '要以 http(s):// 开头, 收到: ' + p[k] + 例);
    });
    if (!p.endpoint && p.apiKey)   // 没网址会落到默认网址, Key 就发给了别家
      throw 厂商错(p, '填了 Key 就得填 API 网址, 不然这把 Key 不知道发给谁; 要换就填新的');
    p.endpoint = p.endpoint ? ad.基址(p) : '';   // 不替人填默认网址: 填了, 之后填的 Key 就发去了那家
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
.ai-hint,.ai-chip,.ai-add,.ai-label,.ai-btn,.ai-cap,.ai-sp,.ai-card summary{color:var(--m)}
.ai-bar,.ai-chip,.ai-in,.ai-btn,.ai-cap{border:1px solid var(--l)}
.ai-card button,.ai-card summary{cursor:pointer}
.ai-bar,.ai-acts,.ai-check,.ai-sp{display:flex;align-items:center;gap:8px}
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
.ai-row{display:flex;gap:8px;margin-top:6px}.ai-row .ai-in{flex:1}
.ai-row select.ai-in{flex:0 1 auto;width:auto;min-width:0}
.ai-btn{background:transparent;padding:8px 14px;border-radius:10px;font-size:12px;white-space:nowrap}
.ai-btn:hover{color:var(--a);border-color:var(--a)}.ai-result{margin-top:10px;padding:10px 14px;
border-radius:8px;font-size:12px;line-height:1.5;white-space:pre-wrap}
.ai-result.ok{background:rgba(181,255,0,.08);border:1px solid rgba(181,255,0,.3);color:var(--a)}
.ai-result.bad{background:rgba(255,87,87,.08);border:1px solid rgba(255,87,87,.3);color:#ff9292}
.ai-check{font-size:12px;margin-top:12px}.ai-acts{margin-top:12px;flex-wrap:wrap}
.ai-caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ai-cap{background:none;font-size:10px;padding:2px 8px;border-radius:999px}
.ai-cap.ok{border-color:var(--a);color:var(--a)}span.ai-cap{border-style:dashed}
.ai-card details{margin-top:12px}.ai-card summary{font-size:12px}
.ai-btn.danger:hover,.ai-btn.warn{color:#ff6b6b;border-color:#ff6b6b}.ai-narrow{width:auto;flex:none}
.ai-sp{gap:6px;font-size:12px}.ai-sp .ai-in{flex:none;width:76px}`;
// ═ 设置界面 · 跟着: 厂商配置, 测通, 打包, 界面样式, 选模型, 协议适配, 各类模型 ═
// 一排按钮选厂商, 字段改完即存; 文本和选了模型的类各一行, 别的从「加一类」加; 测通了徽章亮
// 删厂商、打包要点两下: 第一下变成警告, 3 秒不点或点了别处就复原(只记在按钮上, 关窗再开不带着); 不用浏览器弹窗
const 设置界面 = {
  curId: null, 说: null, 手填: {}, 加: {}, 开: false,
  async 渲染(host) {
    const list = await 厂商配置.列表(), did = await 厂商配置.默认id(), S = 设置界面;
    if (!list.some(p => p.id === S.curId)) S.curId = did || (list[0] && list[0].id) || null;
    const p = list.find(x => x.id === S.curId), { esc, 下拉 } = 选模型, 选 = '<select class="ai-in" data-f="';
    const 框 = (f, v, ph, more) => '<input class="ai-in" data-f="' + esc(f) + '" value="' + esc(v)
      + '" placeholder="' + esc(ph) + '"' + (more || '') + '>';
    // 下拉用 select 不用 datalist(白底, 还按已填的字过滤, 选过就看不到别的);
    // 没候选或点过「手填」的格给输入框。候选 = [[值, 显示的字]]
    const 选框 = (f, v, 候选, ph) => !候选.length || S.手填[f] ? 框(f, v, `${ph}: 手填`)
      : 下拉(f, v, [['', `(${ph})`]].concat(候选, [['✎', '✎ 手填…']]), 选);
    const 钮 = (act, text, cls, 警告, k) => '<button class="ai-btn ' + (cls || '') + '" data-act="' + act + '"'
      + (k ? ` data-k="${k}"` : '') + (警告 ? ` data-warn="${esc(警告)}"` : '')   // 有警告的要点两下
      + '>' + text + '</button>';
    const 标 = text => `<label class="ai-label">${text}</label>`;
    const 行 = (...x) => `<div class="ai-row">${x.join('')}</div>`;
    let html = '<div class="ai-bar">' + list.map(x => '<button class="ai-chip'
      + (x.passed?.chat ? ' tested' : '') + (x.id === S.curId ? ' cur' : '') + '" data-pid="'
      + esc(x.id) + '"><span class="dot"></span>' + esc(x.name || '(未命名)') + (x.id === did ? ' · 默认' : '')
      + '</button>').join('') + '<button class="ai-add" data-act="add" title="添加厂商">+</button></div>';
    if (!p) html += '<p class="ai-hint">点 + 添加一个 AI 厂商(各家大模型、中转站、本机跑的模型都行)</p>';
    else {
      const 表 = 厂商配置.表(p), 认得 = (协议适配[p.protocol] || {}).对话请求, 类们 = Object.keys(表), 过 = p.passed || {};
      const 协议们 = Object.keys(协议适配).filter(k => 协议适配[k].对话请求), 音 = p.voices || {};
      const 用 = 类们.filter(k => k === 'chat' || p.modelOf?.[k] || S.加[k]);
      const 模型框 = k => {
        const t = 表[k], m = k === 'chat' ? p.model : p.modelOf?.[k];
        const vs = 音[m] || [];
        const 二 = (t.音色 ? 选框(`voiceOf.${k}`, p.voiceOf?.[k],
          vs.map(v => [v.id, v.name + (v.name === v.id ? '' : ` · ${v.id}`)]), '选音色')
          + 钮('voices', '🎤 拉音色', '', '', k) : '')
          + (t.语速 ? '<label class="ai-sp">语速'
            + 框('speed', p.speed || 1, '1', ' type="number" step="0.1" min="0.25"') + '</label>' : '')
          + (t.尾帧 ? 框(`尾帧.${k}`, p.adapt?.[k]?.尾帧, '尾帧字段(默认 last_image)', ' title="尾帧字段"') : '');
        return 标(`${t.名}模型`) + 行(选框(k === 'chat' ? 'model' : `modelOf.${k}`, m,
          厂商配置.候选(p, k).map(x => [x, x]), '选模型'), 钮('test', '⚡ 测试', '', '', k)) + (二 && 行(二));
      };
      const 窄 = '<select class="ai-in ai-narrow" data-', 模型名框 = (p.models || []).length
        ? 下拉('m', '', [''].concat(p.models).map(m => [m, m]), 窄 + 'new="')
        : '<input class="ai-in ai-narrow" data-new="m" placeholder="模型名">';
      const 亮 = k => 过[k] && 过[k].model === (k === 'chat' ? p.model : p.modelOf?.[k]);   // 测通的就是现在选的这个
      // 亮的是按钮(点了熄灭); 暗的只是个标记, 不做成按钮, 免得看着能点
      const 章 = k => 亮(k) ? '<button class="ai-cap ok" data-act="off" data-k="' + k + '" title="' + esc('测通: '
        + 过[k].model + ' · ' + new Date(过[k].at).toLocaleString() + '; 点一下熄灭') + '">✓ ' + 表[k].名 + '</button>'
        : `<span class="ai-cap" data-k="${k}" title="还没测通: 点这一类模型右边的 ⚡ 测试">${表[k].名}</span>`;
      html += 标('显示名称') + 行(框('name', p.name, ''), 钮('del', '🗑', 'danger', '确定删? Key 一起删'))
        + 标('亮 = 选的模型测通了(测试键在各模型右边); 点亮的熄灭') + '<div class="ai-caps">'
        + 用.map(章).join('') + '</div><div class="ai-result" data-r hidden></div>' + 标('API 网址(只填到版本前缀)')
        + 行(框('endpoint', p.endpoint, 'https://api.xxx.com/v1 · 本地 http://127.0.0.1:11434/v1'),
          钮('models', '📥 拉取全部模型'))
        + 标('API Key') + 框('apiKey', p.apiKey, '本地模型留空', ' type="password"') + 用.map(模型框).join('')
        + (用.length < 类们.length ? 行(下拉('加', '', [['', '＋ 加一类']]
          .concat(类们.filter(k => !用.includes(k)).map(k => [k, 表[k].名])), 窄 + 'f="')) : '')
        + '<details data-adv' + (S.开 || !认得 ? ' open' : '') + '><summary>⚙ 高级</summary>'
        + (认得 && 协议们.length < 2 ? '' : 标('协议') + 下拉('protocol', p.protocol, (认得 ? []
          : [[p.protocol, `${p.protocol} (现在没有这个协议了, 请重选; 本地模型选 OpenAI 兼容)`, 1]])
          .concat(协议们.map(k => [k, 协议适配[k].名称])), 选))
        + 标('转发地址(浏览器不让直连这家时填; 这家的请求全经它转, 它看得到 Key, 只填信得过的)')
        + 框('proxy', p.proxy, 'https://…/?url={url}  ({url} 换成原网址, 不写就接在末尾)')
        + 标('同时最多几个请求') + 框('concurrency', p.concurrency, '默认 8', ' type="number" min="1"')
        + 标('单次最多写几 token(写大段代码被截断时调大)') + 框('maxOut', p.maxOut, '不填由厂商定', ' type="number" min="1"')
        + 标('接口改法(JSON): 各类的路径、请求体、怎么查结果; 自动试通的写法也记在这')
        + '<textarea class="ai-in" data-f="adapt" rows="3"'
        + ' placeholder=\'{"music": {"path": "/xx/submit", "body": {"caption": "{prompt}"}}}\'>'
        + esc(Object.keys(p.adapt || {}).length ? JSON.stringify(p.adapt) : '') + '</textarea>'
        + 标('📝 模型标注(如「长文会截断」, 你和 agent 都看得到; 清空即删)')
        + Object.keys(p.notes || {}).map(m => 行('<input class="ai-in ai-narrow" value="' + esc(m)
          + '" disabled>', 框(`notes.${m}`, p.notes[m], ''))).join('')
        + 行(模型名框, '<input class="ai-in" data-new="t" placeholder="一句话标注">', 钮('note', '＋ 添加'))
        + '<label class="ai-check"><input type="checkbox" data-f="toolMode"'
        + (p.toolMode === 'text' ? ' checked' : '') + '> 模型不支持原生工具调用(用文字围栏)</label></details>'
        + '<div class="ai-acts">' + (p.id === did ? '<span class="ai-hint" title="没指定厂商的调用都用这一家">✓ 这是默认厂商'
          + '</span>' : 钮('default', '设为默认'))   // 已经是默认就不再画成能点的键
        + 钮('pack', '💾 打包配置版', '', '含全部明文 Key, 再点导出') + '</div>';   // 没厂商就没东西可打包, 不给这个键
    }
    // 存一格就整张重画: 正在打字的那一格连同没存的字、光标放回去, 不然点了下一格接着打的字就丢了
    const a = typeof document !== 'undefined' && document.activeElement, 同 = x => x.dataset.f === a.dataset.f
      && x.dataset.new === a.dataset.new, 焦 = a && host.contains(a) && (a.dataset.f || a.dataset.new) && a;
    host.innerHTML = html;
    const 回 = 焦 && [...host.querySelectorAll('[data-f],[data-new]')].find(同);
    if (回) {
      if (回.tagName === 焦.tagName && !/^(select|checkbox)/.test(回.type) && 回.value !== 焦.value) {
        回.value = 焦.value;
        回.dataset.改 = 1;   // 没存的字: 离开这一格时补一次存(浏览器只在人打了字时才发 change)
      }
      回.focus();
      try { 回.setSelectionRange(焦.selectionStart, 焦.selectionEnd); } catch (e) { }
    }
    host.onfocusout = e => {
      if (e.target.dataset.改) e.target.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const adv = host.querySelector('[data-adv]');   // 存盘会整张重画, 得记住「高级」开着没
    if (adv) adv.ontoggle = () => { S.开 = adv.open; };
    const say = (text, bad) => {   // 记在 S.说: 存盘会重画, 重画后这句还得在; 用户下次动手才清
      S.说 = { text, bad };
      const r = host.querySelector('[data-r]');
      if (!r) return;
      r.hidden = false;
      r.className = `ai-result ${bad ? 'bad' : 'ok'}`;
      r.textContent = text;
      if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });   // 点的键在下面时, 上面的这句也得看得到
    };
    // ✂ 语音
    const 拉音色 = async (q, k) => {
      const got = await 朗读.音色(q, k, {}), m = got.model, 借 = got.asked.find(x => /^借 /.test(x));
      say(got.voices.length ? '✓ 「' + m + '」' + (借 ? `自己拉不到音色, ${借}` : '拉到') + ' ' + got.voices.length
        + ' 个音色, 在音色框里选'
        : `没拉到「${m}」的音色(${got.asked.join('; ')}): 照厂商文档手填`);
    };
    // ✂ 语音 完
    if (S.说) say(S.说.text, S.说.bad);
    host.onchange = async e => {
      const el = e.target, f = el.dataset.f, v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (!f) return;
      delete el.dataset.改;
      S.说 = null;
      if (f === '加') return v && (S.加[v] = true, S.渲染(host));
      const 存 = patch => 厂商配置.更新(p.id, patch), [表名, 键] = f.split(/\.(.*)/);
      try {
        if (v === '✎') {   // 选了「手填」: 换输入框, 值不动
          S.手填[f] = true;
          await S.渲染(host);
        } else if (f === 'toolMode') await 存({ toolMode: v ? 'text' : 'native' });
        // 原协议认不出时重选协议留着原网址, 这样的记录重选一下就能用
        else if (f === 'protocol')
          await 存({ protocol: v, endpoint: (协议适配[p.protocol] || {}).对话请求 ? 协议适配[v].默认端点 : p.endpoint });
        else if (/^(concurrency|speed|maxOut)$/.test(f)) await 存({ [f]: Number(v) || undefined });
        else if (f === 'adapt')   // 删掉的类要写 null 才删得掉
          await 存({ adapt: Object.assign(Object.fromEntries(Object.keys(p.adapt || {}).map(k => [k, null])),
            v ? JSON.parse(v) : {}) });
        else if (表名 === '尾帧') await 存({ adapt: { [键]: 厂商配置.表(p)[键].尾帧(p.adapt?.[键], v) } });
        else if (!f.includes('.')) await 存({ [f]: v });
        else {   // modelOf.类 / voiceOf.类 / notes.模型; 换了带音色那类的模型就顺手拉音色
          const q = await 存({ [表名]: { [键]: v || null } });
          if (表名 === 'modelOf' && v && 厂商配置.表(p)[键].音色)
            await 拉音色(q, 键).catch(e => say(e.message));   // 顺手拉的, 没拉到只是说一声, 不算出错
        }
      } catch (err) {
        say(`✗ ${err.message}`, true);
      }
    };
    host.onclick = async e => {
      const b = e.target.closest('[data-act],[data-pid]');
      if (!b) return;
      if (b.dataset.warn && !b.dataset.sure) {   // 第一下只变成警告
        b.dataset.t = b.textContent;
        b.textContent = b.dataset.warn;
        b.classList.add('warn');
        b.dataset.sure = setTimeout(() => S.复原(b), 3000);
        return;
      }
      if (b.dataset.sure) S.复原(b);   // 第二下: 按钮先复原再做, 做砸了也不会一直停在警告上
      const act = b.dataset.act;
      S.说 = null;
      try {
        await 厂商配置.队列;   // 刚改的字段可能还在存: 等存完再按现在的记录办, 不然用的是画界面时的旧 Key
        const p = await 厂商配置.找(S.curId), 存 = patch => 厂商配置.更新(p.id, patch);
        if (b.dataset.pid) {
          Object.assign(S, { curId: b.dataset.pid, 手填: {}, 加: {} });
        } else if (act === 'add') S.curId = (await 厂商配置.新增({ name: '新厂商' })).id;
        else if (act === 'del') return await 厂商配置.删除(p.id);
        else if (act === 'default') return await 厂商配置.设默认(p.id);
        else if (act === 'voices') return await 拉音色(p, b.dataset.k);
        else if (act === 'off') return await 存({ passed: { [b.dataset.k]: null } });
        else if (act === 'note') {
          const 新 = k => host.querySelector(`[data-new="${k}"]`).value.trim(), m = 新('m'), t = 新('t');
          // 缺一样就说缺什么, 不重画(重画会把已经写的那句清掉)
          if (!m || !t) return say(`先${m ? '写标注' : '选要标注的模型'}再点 ＋ 添加`, true);
          return await 存({ notes: { [m]: t } });
        } else if (act === 'models') {
          say('⋯ 拉取中');
          return say(`✓ 拉到 ${(await 厂商配置.拉模型(p)).models.length} 个模型, 给每类选一个再测试`);
        } else if (act === 'test') {
          const k = b.dataset.k;
          say(`⋯ 测试中${/video|music/.test(k) ? '(要等一两分钟)' : ''}`);
          const r = await 测通(p.id, k);
          return say(`✓ ${厂商配置.表(p)[k].名}测通 (模型 ${r.model}): ${r.sample}`);
        } else if (act === 'pack') return await S.打包();
        await S.渲染(host);
      } catch (err) {
        say(`✗ ${err.message}`, true);
      }
    };
  },
  挂(card) {   // 画进 card, 厂商一变就重画, 回摘掉的函数。按着鼠标时换掉按钮浏览器就不发 click, 等松开再画
    const 重画 = () => card.matches(':active')
      ? document.addEventListener('pointerup', () => setTimeout(重画), { once: true }) : 设置界面.渲染(card);
    card.className = 'ai-card';
    card.insertAdjacentHTML('beforebegin', `<style>${界面样式}</style>`);
    // 点了别处(包括关窗的 ✕): 等着确认的那个复原
    const 别处 = e => card.querySelectorAll('[data-sure]').forEach(x => x.contains(e.target) || 设置界面.复原(x));
    document.addEventListener('ai:providers', 重画);
    document.addEventListener('pointerdown', 别处, true);
    重画();
    return () => {
      document.removeEventListener('ai:providers', 重画);
      document.removeEventListener('pointerdown', 别处, true);
    };
  },
  复原(x) {   // 待确认的按钮变回原样
    clearTimeout(+x.dataset.sure);
    delete x.dataset.sure;
    x.textContent = x.dataset.t;
    x.classList.remove('warn');
  },
  async 打包() {
    try {
      const html = await 打包.出(), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      a.download = 'petri-ai-配置版.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 800);
      设置界面.说 = { text: `✓ 已导出 ${a.download}, 对方在 Colony 里「导入 Petri」并启用就能用` };
    } catch (err) {
      设置界面.说 = { text: `✗ 打包没成: ${err.message}`, bad: true };
    }
    厂商配置.通知();   // 触发重画, 显示上面这句
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
      for (const sp of s.providers) {
        try {
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
// 一处配好厂商和模型, 各块和小应用的对话、出图、语音、视频、音乐都从这里调
// 数据 {"prefix": "settings:ai.", "label": "厂商与模型", "kind": "config", "edit": "ai.configure"}
// 现在 ai.providers
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【接厂商】用户给了 API Key、要接新厂商或本地模型、要验证能不能用时: 绝大多数厂商和中转站都是 OpenAI 兼容,
//   用 ai.configure 接, protocol 不用给。本地模型也一样: endpoint 填 http://127.0.0.1:11434/v1(Ollama) /
//   1234(LM Studio) / 8000(vLLM), apiKey 留空; 浏览器报跨域就让用户给本地服务开跨域(Ollama: OLLAMA_ORIGINS=*)。
//   接完用 ai.test 测, 通了会把 model 记成这一类用的模型。
//   网上的厂商报"连不上"(浏览器不让网页直连它): 问用户要一个转发地址, ai.configure {name, proxy}, 这家的请求就全经它转。
// 【各类模型】给文本以外的类(图片、视频、语音、转录、嵌入、重排、音乐、双工)选模型或音色时: 每类用哪个模型用
//   ai.configure {name, modelOf: {tts: "模型名"}}, 类型名见 ai.test 的 type。拿不准哪个模型属于哪类,
//   就 ai.test {provider, type, model} 试, 通了自动记下; video / music 要等一两分钟。
//   语音(tts)和双工(realtime)各有各的音色: ai.voices {provider, type} 按这一类现在选的模型问厂商要, 回 [{id, name}];
//   拉不到就查它的文档。存: ai.configure {name, voiceOf: {tts: "音色 id"}}, 语速 speed。
//   不带 provider 调用时: 用户在「选模型」小表里给这一类选过哪家就用哪家; 没选过就默认厂商(它选了这一类的模型的话),
//   否则按顺序找选了的那一家。别的块要让用户按类选模型, 借本块的「选模型」段, 选模型.挂(el, {类: ['tts']})。
//   某个模型有毛病(如"长文会截断")就记一句: ai.configure {name, notes: {"模型名": "一句话"}}, 用户在界面上也看得到。
// 【接口改法】某家某一类的路径、字段名和兼容协议不一样, 或要等任务时: 写改法, 是数据不改代码:
//   ai.configure {name, adapt: {类: {path, body, poll: {path, body}} 或 null}}。body 并进默认请求体: 整格 "{参数名}" 换成
//   调用给的值(没给就不带), {model} 是选的模型, null 去掉默认字段; poll 按发起回的 {id} 查, 有 body 就 POST。
//   表单那几类(转录、图片编辑)的 body 里有嵌套对象, 就整个改发 JSON; 回的是事件流(一行行 data:)取最后一条。
//   标准写法回 404 或 400 时会自己试这一类常见的别种写法(类型表那一行的「备」), 试通了自动记进改法; 都不行才要手写。
//   改完 ai.test 测。类型表里没有的接口用 ai.fetch {provider, path, body}。
// 【加新协议】改法也表达不了(回复形状完全不同、连对话都不一样)才写代码: 先读厂商文档确认(不少厂商有好几个入口,
//   先试它的主入口), 再读本块的「协议适配」段, 各类模型那一行的写法看「各类模型」段。
//   只是某一类不同, 就在「装配」段的开头(那时各类的行都已经在表里)照协议适配段头说明里那一行的写法加一个协议:
//   拿兼容协议当底, 类型表里只换那一行 {后缀, 请求(a, model, p) → JSON 对象或表单, 回复(res, p) → 统一形状},
//   一样的类型沿用不重写; 连对话都不一样才重写 对话请求 / 解析回复 / 解析流片。
//   用 stem.setBlock {id: "petri:ai", segment: {name: "装配", text}} 提交,
//   再 ai.configure {name, protocol: "新协议的键"}, 逐类 ai.test。
// ═ 装配 · 跟着: 并发闸, 厂商配置, 模型调用, 协议适配, 多模态, 测通, 打包, 设置界面 ═
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
  desc: '新增或更新厂商(同名即更新), 顺带拉模型清单(结果在 pulled)。细节读本块的「技能」段(接厂商 / 各类模型 / 加协议)',
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
打包.播种().catch(e => console.warn('[ai] 配置种子没播成:', e.message));
if (typeof document !== 'undefined' && ctx.root) {
  const card = document.createElement('div');
  ctx.root.append(card);
  ctx.cleanup(设置界面.挂(card));
}
return {};
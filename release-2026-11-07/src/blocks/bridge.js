'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 petri:agent 的 协议适配
// ↦ 借 petri:ui 的 设计变量
// ↦ 借 petri:ui 的 框样式
// ↦ 借 petri:ui 的 对话框
// ↦ 借 petri:agent 的 轻md
// ═ 送达游标 ═
// 外部 agent(命令行 agent、hermes、openclaw…)有自己的记忆: 同一个会话只该收到它没见过的话, 不然它看到的全是重复。
// 游标按「会话 × 厂商」记: 上次发到的最后一条的指纹、这段开头前一条的指纹(没送到又重发时找回上次那段)、系统提示的指纹。
// 认指纹不认条数: 全能 agent 压缩、改写了前面的记录, 只要上次那条还在就接得上; 找不到才退成「最近几条 + 一句接续说明」
const 游标 = {
  键: 'bridge.cursors',
  表: {},
  最近: 6,
  留: 300,   // 最多记几个会话, 多了丢最久没用的
  指纹(m) {
    const s = (m.role || '') + '\u0001' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '.' + s.length.toString(36);
  },
  存: (() => {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const ks = Object.keys(游标.表).sort((a, b) => 游标.表[b].at - 游标.表[a].at);
        ks.slice(游标.留).forEach(k => delete 游标.表[k]);
        ctx.kv.set(游标.键, 游标.表).catch(() => { });
      }, 400);
    };
  })(),
  // 这一次该发哪些: 回新的 messages, 系统提示照样排最前(只在头一回、变了、接不上时带)
  裁(键, msgs) {
    const sysM = msgs.filter(m => m.role === 'system'), body = msgs.filter(m => m.role !== 'system');
    if (!body.length) return msgs;
    const sys = sysM.map(游标.指纹).join(','), fps = body.map(游标.指纹), r = 游标.表[键];
    let from = 0, 断 = false, 重 = false;
    if (r) {
      const i = fps.lastIndexOf(r.fp);
      if (i < 0) { 断 = true; from = Math.max(0, body.length - 游标.最近); }
      else if (i + 1 < body.length) {
        from = i + 1;
        // 紧跟在游标后的 assistant 是它自己上次的回答, 它记得
        if (body[from].role === 'assistant' && from + 1 < body.length) from++;
      } else { 重 = true; from = r.pfp ? fps.lastIndexOf(r.pfp) + 1 : 0; }   // 一条新的都没有: 上次没送到, 原样再发
    }
    const 带系统 = 重 ? !!r.带系统 : !r || 断 || r.sys !== sys;
    游标.表[键] = { fp: fps[fps.length - 1], pfp: from > 0 ? fps[from - 1] : null, sys, 带系统, at: Date.now() };
    游标.存();
    let 发 = body.slice(from);
    if (断) 发 = [{ role: 'user', content: '[接续] 这边的对话记录被整理过, 接不上你上次看到的地方; 下面是最近 '
      + 发.length + ' 条, 前面有些你可能见过。' }].concat(发);
    return (带系统 ? sysM : []).concat(发);
  },
};
ctx.kv.get(游标.键).then(t => { 游标.表 = Object.assign(t || {}, 游标.表); }).catch(() => { });
// ═ 插件转发 ═
// 本机端点(hermes / openclaw / 网关)多半不开跨域, 网页直连会被浏览器拦; Colony Bridge 插件能代发, 还会按端口带上存在插件里的 Key。
// 走法: 网关协议把本机地址换成 colony-relay: 开头, 这里包一层 fetch 只认这个开头, 经插件的内容脚本(postMessage)发出去,
// 收回来拼成标准 Response, AI 配置块的读流照常读。插件不在就去掉前缀直连。别的请求原样放过
const 转发 = {
  头: 'colony-relay:',
  在: false, 号: 0, 等: new Map(),
  听(e) {
    if (e.source !== window || !e.data) return;
    const d = e.data;
    if (d.__colonyRelayReady) 转发.在 = true;
    const m = d.__colonyRelayChunk || d.__colonyRelayResult;
    if (m && 转发.等.has(m.id)) 转发.等.get(m.id)(m);
  },
  发(op, req, 收) {
    const id = 'br' + Date.now().toString(36) + (++转发.号);
    转发.等.set(id, 收);
    // 插件的 ep* 名单操作从消息顶层读字段(m.base / m.id / m.name), 别的 op 读 m.req: 两处都放
    // 回包里的 id 字段(epRemove / epRename 回 {ok, id: 端点 id})会盖掉请求号, 旧版 cs.js 是这样拼的: 所以等的是「请求号」或「端点 id」都认
    const top = /^ep/.test(op) && req && typeof req === 'object' ? req : {};
    if (top.id) 转发.等.set(top.id, 收);
    window.postMessage({ __colonyRelay: Object.assign({}, top, { id: top.id ? top.id : id, op, req }) }, '*');
    if (top.id) { 转发.等.delete(id); return top.id; }
    return id;
  },
  async 有() { // 插件广播过就绪才算在; 还没听到就问一声, 等一会儿
    if (转发.在) return true;
    window.postMessage({ __colonyRelayHello: 1 }, '*');
    for (let i = 0; i < 8 && !转发.在; i++) await new Promise(r => setTimeout(r, 100));
    return 转发.在;
  },
  本机: u => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(u || ''),
  头表(h) {
    const o = {};
    if (h instanceof Headers) h.forEach((v, k) => { o[k] = v; });
    else Object.assign(o, h || {});
    // 本机端点的 Key 存在插件里, 按端口注入; 厂商记录里的占位 Key(local)会挡住它, 去掉
    Object.keys(o).forEach(k => { if (k.toLowerCase() === 'authorization' && /^Bearer\s*(local)?$/i.test(o[k])) delete o[k]; });
    return o;
  },
  // 拿一次(模型清单这类): 回插件的 {status, text}
  取: (url, opt = {}) => new Promise((ok, no) => {
    const id = 转发.发('fetch', { url, method: opt.method || 'GET', headers: 转发.头表(opt.headers), body: opt.body,
      timeout: opt.timeout || 30000 }, m => { 转发.等.delete(id); m.error && !m.status ? no(new Error(m.error)) : ok(m); });
  }),
  // 对话: 逐块拿, 拼成流式 Response; 插件每 20 秒的保活变成一个空行, 免得读流的看门狗以为断了
  流(url, opt = {}) {
    return new Promise((ok, no) => {
      const enc = new TextEncoder(), 停 = () => window.postMessage({ __colonyRelay: { id, op: 'cancel' } }, '*');
      let ctl, 开 = false, id;
      const body = new ReadableStream({ start: c => { ctl = c; }, cancel: () => { 转发.等.delete(id); 停(); } });
      const 起 = () => { if (!开) { 开 = true; ok(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })); } };
      id = 转发.发('stream', { url, method: opt.method || 'POST', headers: 转发.头表(opt.headers), body: opt.body }, m => {
        if (m.keepalive) { 起(); try { ctl.enqueue(enc.encode('\n')); } catch (e) { } return; }
        if (m.delta) { 起(); ctl.enqueue(enc.encode(m.delta)); }
        if (m.error) {
          转发.等.delete(id);
          if (!开 && m.status) { 开 = true; return ok(new Response(String(m.error).replace(/^HTTP \d+ /, ''), { status: m.status })); }
          if (!开) return no(new TypeError(m.error));
          try { ctl.error(new Error(m.error)); } catch (e) { }
          return;
        }
        if (m.done) { 转发.等.delete(id); 起(); try { ctl.close(); } catch (e) { } }
      });
      const sg = opt.signal;
      if (sg) {
        const 断 = () => {
          转发.等.delete(id); 停();
          const e = new DOMException('aborted', 'AbortError');
          if (开) { try { ctl.error(e); } catch (x) { } } else no(e);
        };
        sg.aborted ? 断() : sg.addEventListener('abort', 断, { once: true });
      }
    });
  },
};
if (typeof window !== 'undefined' && window.postMessage) {
  window.addEventListener('message', 转发.听);
  window.postMessage({ __colonyRelayHello: 1 }, '*');
  const 原 = window.fetch, 我 = function (u, o) {
    const s = typeof u === 'string' ? u : u && u.url;
    if (我.退 || !s || !s.startsWith(转发.头)) return 原.apply(this, arguments);
    const 真 = s.slice(转发.头.length);
    return 转发.有().then(在 => 在 ? 转发.流(真, o) : 原.call(window, 真, o));
  };
  window.fetch = 我;
  ctx.cleanup(() => {
    window.removeEventListener('message', 转发.听);
    if (window.fetch === 我) window.fetch = 原; else 我.退 = true;   // 后来又有人包了一层: 拆不下来就让自己只放行
  });
}
// ═ 网关协议 · 跟着: 协议适配, 送达游标, 插件转发 ═
// 外部 agent(claude / grok / cursor 这类命令行 agent 经网关包成 OpenAI 兼容端点, 或 hermes / openclaw 自己开的口)
// 和普通厂商差两样: 请求带 Colony 的会话 id(对方一个会话对一个大脑), 同一会话只发增量(见送达游标)。
// 协议表借全能 agent 的: 有 AI 配置块时它就是 AI 配置块那张表(加一个键, 协议下拉和 ai.configure 就都认了);
// 没有时是全能 agent 自己剪来的那份, 它的大脑照样认得 gateway, 桥就顶了 AI 配置的位置
const 网关端点 = 'http://127.0.0.1:4123/v1';
const 本 = {};   // 这次跑的记号: 桥自己重启后表上那个旧键要换成新的(旧的还闭着旧游标)
const 挂 = () => {   // AI 配置块一热替换(改它的段、点打包配置版都会), 协议表就是一张新的, 这个键得重新加
  if (协议适配.gateway?.出自 === 本) return;
  const 兼容 = 协议适配['openai-compatible'];
  if (!兼容) return;
  协议适配.gateway = Object.assign({}, 兼容, {
    出自: 本,
    名称: '外部 agent 网关 (claude / grok / cursor 命令行, hermes, openclaw)',
    默认端点: 网关端点,
    对话请求(p, a) {
      if (!a.session) {   // 没会话 id: 当无状态的模型, 照原样全发
        const r = 兼容.对话请求(p, a);
        if (转发.本机(r.url)) r.url = 转发.头 + r.url;
        return r;
      }
      const m = 游标.裁(a.session + '@' + (p.id || p.name || p.endpoint), a.messages);
      const r = 兼容.对话请求(p, Object.assign({}, a, { messages: m }));
      r.headers['X-Hermes-Session-Id'] = r.headers['x-openclaw-session-key'] = String(a.session);   // hermes / openclaw 各认一个
      if (转发.本机(r.url)) r.url = 转发.头 + r.url;
      return r;
    },
  });
};
挂();
if (typeof document !== 'undefined') {
  document.addEventListener('colony:blocks', 挂);
  ctx.cleanup(() => document.removeEventListener('colony:blocks', 挂));
}
// ═ 厂商记录 ═
// 有 AI 配置块就交给它(ai.configure 管记录、Key、模型清单); 没有时桥直接写同一份记录(kv 全库共享, 键和形状照 AI 配置块),
// 全能 agent 剪来的厂商配置读的就是它, 大脑一行就能选
const 厂商记录 = {
  键: 'settings:ai.providers', 默认键: 'settings:ai.activeProviderId',
  async 拉模型(ep) { // 本机的经插件拿(跨域、Key 都由插件管), 别的直连
    try {
      const j = 转发.本机(ep + '/') && await 转发.有()
        ? JSON.parse((await 转发.取(ep + '/models')).text || '{}')
        : await (await fetch(ep + '/models', { headers: { Authorization: 'Bearer local' } })).json();
      return (j.data || []).map(x => x.id).filter(Boolean);
    } catch (e) { return []; }
  },
  async 直写(a) {
    const ep = String(a.endpoint || 网关端点).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(ep)) throw new Error('endpoint 要以 http(s):// 开头, 收到: ' + ep);
    const models = await 厂商记录.拉模型(ep), list = (await ctx.kv.get(厂商记录.键)) || [];
    let p = list.find(x => x.name === a.name);
    if (p && p.protocol !== 'gateway') throw new Error('已有叫「' + a.name + '」的厂商(协议 ' + p.protocol + '), 换个名字');
    if (!p) list.push(p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: a.name,
      protocol: 'gateway', models: [], modelOf: {}, passed: {}, notes: {} });
    Object.assign(p, { endpoint: ep, apiKey: 'local', toolMode: 'text', models: models.length ? models : p.models || [] });
    p.model = a.model || p.model || (p.models.length === 1 ? p.models[0] : '');
    await ctx.kv.set(厂商记录.键, list);
    const 默认 = a.default || list.length === 1 || !(await ctx.kv.get(厂商记录.默认键));
    if (默认) await ctx.kv.set(厂商记录.默认键, p.id);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('ai:providers'));
    return { id: p.id, name: p.name, protocol: p.protocol, endpoint: p.endpoint, model: p.model, models: p.models,
      toolMode: p.toolMode, default: !!默认, 经: '桥直接写(没有 AI 配置块)' };
  },
};
// ═ 成员 · 跟着: 插件转发, 送达游标, 附件 ═
// 通讯录 = 几种「投递」各自列出的成员拼起来; 一个成员 {id, raw, name, kind: agent|model|human, memory, online, 备注?, model?, persona?}。
// 投递按 id 前缀分: ep: 本机 agent(插件名单, 经插件发到它的端点) | ai: AI 配置里的厂商(ai.chat) | cl: 云端 agent(云端桥) | h: 真人好友(好友段)。
// 每种投递实现同一组: 列() 成员, 问(m, a) 问一轮, 删(m), 改名(m, 名)?, 模型(m)?(能换的模型)。会话、ask、界面只认这一组, 不再按种类分支。
// 成员设置(备注名、人设、换模型)存 bridge.members.cfg {id: {name?, persona?, model?}}, 拉名单后盖上去; 本机 agent 改名直接写插件名单。
// 问一轮的规矩(各投递共用): 人设排在系统提示最前; 有记忆的只发它没见过的(送达游标), 调用方已裁过(会话)或本来就只给新话(ask)就不再裁;
// 普通模型桥替它记最近 30 条。回 {content} 或 {content: '', queued: true}(对方不在, 已留言)
// 读 OpenAI 式回复: 流(SSE)或一整个 JSON 都认; 对方报的错、看不懂的回复照实抛出(不当成空回复吞掉)。
// 过程: 动(x) 收 {think: 到此为止的思考} (delta 里的 reasoning_content / reasoning / thinking) 和 {tool: {id, name, label, emoji, status}}
// (hermes 用 event: hermes.tool.progress 报工具步骤); 不给 动 就只要字
// 卡住: 60 秒(或 闲 的一半)没有新的 data 行就在打字处提示一句(还在等, 可点「停」), 闲 秒(默认 600)还没有就断开报错。
// 插件每 20 秒的保活空行和上游的「: ping」注释行不算: 只说明连接还在, 不说明 agent 在干活
const 读流 = async (res, on, 名 = '对方', 闲 = 600, 动) => {
  if (!/event-stream/.test(res.headers.get('content-type') || '')) { // 不是流: 当一整个 JSON
    const t = await res.text(); let j; try { j = JSON.parse(t); } catch (e) { throw new Error(名 + ' 回的不是对话格式: ' + t.slice(0, 160)); }
    if (j.error) throw new Error(名 + ' 报错: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 300));
    const out = j.choices?.[0]?.message?.content; if (typeof out !== 'string') throw new Error(名 + ' 回的 JSON 里没有 choices[0].message.content: ' + t.slice(0, 160));
    on && on(out); return out;
  }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', out = '', 怪 = '', 想 = '', 事件 = '', 刻 = Date.now(), 提 = false;
  const 看 = setInterval(() => { const 秒 = (Date.now() - 刻) / 1000 | 0;
    if (秒 >= 闲) rd.cancel(new Error('闲')).catch(() => { });
    else if (秒 >= Math.min(60, 闲 / 2) && !提) { 提 = true; on && on(out + (out ? '\n\n' : '') + '⏳ ' + 名 + ' 已 ' + 秒 + ' 秒没有新输出, 还在等(卡住了可点「停」)'); } }, 5000);
  try {
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (l.startsWith('event:')) { 事件 = l.slice(6).trim(); continue; }
        if (!l.startsWith('data:')) { if (!l) 事件 = ''; continue; }
        刻 = Date.now(); if (提) { 提 = false; on && on(out); }
        if (/tool\.progress/.test(事件)) { 事件 = ''; try { const p = JSON.parse(l.slice(5)); 动 && 动({ tool: { id: p.toolCallId || p.tool, name: p.tool, label: p.label || '', emoji: p.emoji || '', status: p.status || 'running' } }); } catch (e) { } continue; }
        if (l === 'data: [DONE]') continue;
        let j; try { j = JSON.parse(l.slice(5)); } catch (e) { 怪 = 怪 || l; continue; }
        if (j.error) throw new Error(名 + ' 报错: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 300));
        const d = j.choices?.[0]?.delta || {}, r = d.reasoning_content || d.reasoning || d.thinking || '';
        if (r) { 想 += r; 动 && 动({ think: 想 }); }
        const t = d.content || ''; if (t) { out += t; on && on(out); }
      }
    }
  } finally { clearInterval(看); }
  if ((Date.now() - 刻) / 1000 >= 闲) throw new Error(名 + ' ' + 闲 + ' 秒没有任何输出, 已断开(它的进程可能卡住了: 在插件里看它的状态, 或重启它)' + (out ? '; 已收到的: ' + out.slice(0, 200) : ''));
  if (!out.trim() && 怪) throw new Error(名 + ' 的回复看不懂: ' + 怪.slice(0, 160));
  return out;
};
const 并 = body => { // 几条 user 并成一条: 都是字用空行连, 有 parts 就接起来
  if (body.length < 2) return body;
  if (body.every(x => typeof x.content === 'string')) return [{ role: 'user', content: body.map(x => x.content).join('\n\n') }];
  return [{ role: 'user', content: body.flatMap(x => typeof x.content === 'string' ? [{ type: 'text', text: x.content }] : x.content) }];
};
// 有记忆的成员这一轮该发哪些: 已裁(会话给的就是新的) / 增量(ask: 只有新话, 系统提示头一回或变了才带) / 否则过游标
const 增量 = (键, sys, a) => {
  if (a.已裁) return sys.concat(a.messages);
  if (a.增量) { const r = 游标.表[键]; return (!r || r.sys !== a.system ? sys : []).concat(a.messages); }
  return 游标.裁(键, sys.concat(a.messages));
};
const 记 = (键, a) => { if (a.增量) { 游标.表[键] = { sys: a.system, at: Date.now() }; 游标.存(); } };
const 投递 = {
  ep: {
    async 列() {
      if (!(await 转发.有())) return [];
      const r = await 成员.一次('epRoster', {});
      return (r.roster || []).map(e => ({ id: 'ep:' + e.id, raw: e.id, name: e.renamedTo || e.name || e.id, kind: 'agent', memory: (e.memory || 'stateful') !== 'stateless',
        online: !!e.online && !e.needsKey, base: String(e.base || '').replace(/\/+$/, ''), model: e.model || '',
        备注: e.needsKey ? '要 Key(在插件里填)' : e.online ? '' : '没接上' }));
    },
    async 问(m, a, 键, sys) {
      if (!m.online) throw new Error('「' + m.name + '」' + (m.备注 || '没接上') + '(插件里看它的状态)');
      const msgs = 增量(键, sys, a), s = msgs.filter(x => x.role === 'system'), body = msgs.filter(x => x.role !== 'system');
      const res = await fetch(转发.头 + m.base + '/v1/chat/completions', { method: 'POST', signal: a.signal,
        headers: { 'Content-Type': 'application/json', 'X-Hermes-Session-Id': a.session, 'x-openclaw-session-key': a.session },
        body: JSON.stringify({ model: m.model || 'default', messages: s.concat(并(body)), stream: true }) })
        .catch(e => { if (a.signal && a.signal.aborted) throw e; throw new Error('「' + m.name + '」连不上(' + m.base + '): 它的进程可能没在跑, 在插件里看它的状态'); });
      if (!res.ok) { const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
        throw new Error('「' + m.name + '」回 ' + res.status + ': ' + ((j && j.error && (j.error.message || j.error)) || t).toString().slice(0, 200)); }
      let 想 = ''; const out = (await 读流(res, a.on, '「' + m.name + '」', 600, a.动 && (x => { if (x.think) 想 = x.think; a.动(x); }))).trim(); 记(键, a);
      return { content: out, ...(想 ? { think: 想 } : {}) };
    },
    async 删(m) { const r = await 成员.一次('epRemove', { id: m.raw }); if (r.error) throw new Error('插件没删成: ' + r.error); },
    async 改名(m, n) { const r = await 成员.一次('epRename', { id: m.raw, name: n || m.name }); if (r.error) throw new Error('插件没改成: ' + r.error); return true; },
    async 模型(m) { const r = await 转发.取(m.base + '/v1/models').catch(() => null); try { return (JSON.parse(r.text).data || []).map(x => x.id); } catch (e) { return []; } },
  },
  ai: {
    async 列(本机) {
      if (!colony.has('ai.providers')) return [];
      const ps = await ctx.call('ai.providers').catch(() => []);
      return ps.filter(p => p.protocol !== 'gateway' || !本机.some(e => e.base && String(p.endpoint || '').startsWith(e.base)))   // 插件里已有的网关不重复列
        .map(p => ({ id: 'ai:' + p.id, raw: p.id, name: p.name, kind: 'model', memory: p.protocol === 'gateway', online: true, provider: p.name, model: p.model || '' }));
    },
    史: new Map(),   // 增量会话 × 普通模型 → 最近 30 条
    async 问(m, a, 键, sys) {
      if (!colony.has('ai.chat')) throw new Error('「' + m.name + '」是 AI 配置里的模型, 这里没有 AI 配置块');
      const ms = a.增量 ? (投递.ai.史.get(键) || []).concat(a.messages) : a.messages;
      const 参 = { provider: m.provider, model: m.model || undefined, signal: a.signal, session: m.memory ? a.session : undefined, ...(a.think ? { think: a.think } : {}),
        messages: sys.concat(ms.slice(-30)).map(x => ({ role: x.role, content: 附件.统一(x.content) })) };
      let r, 想 = '';
      if (a.on || a.动) { // 流着拿: 字给 on, 思考给 动; 最后一项 done 带整段
        let 字 = ''; r = {};
        for await (const x of await ctx.call('ai.chat', Object.assign(参, { stream: true }))) {
          if (x.reasoning) { 想 += x.reasoning; a.动 && a.动({ think: 想 }); }
          if (x.delta) { 字 += x.delta; a.on && a.on(字); }
          if (x.done) r = x;
        }
        if (r.content == null) r.content = 字;
      } else r = await ctx.call('ai.chat', 参);
      const out = String(r.content || '').trim();
      if (a.增量) 投递.ai.史.set(键, ms.concat([{ role: 'assistant', content: out }]).slice(-30));
      a.on && a.on(out);
      return { content: out, ...(想 ? { think: 想 } : {}) };
    },
    async 删() { throw new Error('AI 配置里的厂商到 AI 配置里删'); },
    async 模型(m) { const l = colony.has('ai.models') ? await ctx.call('ai.models', { all: true }).catch(() => []) : []; return l.filter(x => x.providerId === m.raw || x.provider === m.provider).map(x => x.model); },
  },
  cl: {
    列: () => typeof 云端 === 'undefined' ? [] : 云端.成员(),
    async 问(m, a, 键, sys) { // 新话拼成一段字发过去(它自己记着), 离线就留言
      const 字 = 增量(键, sys, a).map(x => typeof x.content === 'string' ? x.content
        : x.content.map(p => p.type === 'text' ? p.text : p.type === 'image_url' ? '[图片]' : '[附件]').join('\n')).join('\n\n');
      const r = await 云端.问(m, 字, { chat: a.chat, signal: a.signal, on: a.on }); 记(键, a);
      return r;
    },
    删: m => 云端.管(m.id, 'remove'),
  },
  h: {
    列: () => typeof 好友 === 'undefined' || !好友.我 ? [] : 好友.成员(),
    async 问(m) { throw new Error('「' + m.name + '」是真人, 拉进会话里聊(bridge.open / bridge.say), 不能 ask'); },
    删: m => 好友.删(m.raw),
  },
  of: m => 投递[String(m.id).split(':')[0]],
  async 问(m, a) { // a: {session, system?, messages, 增量?, 已裁?, chat?, on?, signal?}
    const 系 = [m.persona && '【你的人设】' + m.persona, a.system].filter(Boolean).join('\n\n');
    a = Object.assign({}, a, { system: 系 || undefined });
    return 投递.of(m).问(m, a, a.session + '@' + m.id, 系 ? [{ role: 'system', content: 系 }] : []);
  },
  删: async m => { await 投递.of(m).删(m); delete 成员.设[m.id]; await ctx.kv.set(成员.设键, 成员.设); await 成员.拉(true); },
};
const 成员 = {
  表: [], 拉过: 0, 听者: new Set(), 设: {}, 设键: 'bridge.members.cfg',
  变: () => 成员.听者.forEach(f => { try { f(); } catch (e) { } }),
  一次: (op, req) => new Promise(ok => {
    const id = 转发.发(op, req, m => { 转发.等.delete(id); ok(m); });
    setTimeout(() => { if (转发.等.delete(id)) ok({ error: '插件 15 秒没回' }); }, 15000);
  }),
  async 拉(强) {
    if (!强 && Date.now() - 成员.拉过 < 4000 && 成员.表.length) return 成员.表;
    const 本机 = await 投递.ep.列();
    const 新 = 本机.concat(await 投递.ai.列(本机), 投递.cl.列(), 投递.h.列());
    新.forEach(m => { const c = 成员.设[m.id] || {}; if (c.name) m.name = c.name; if (c.persona) m.persona = c.persona; if (c.model) { m.默认模型 = m.model; m.model = c.model; } });
    成员.表 = 新; 成员.拉过 = Date.now(); 成员.变();
    return 新;
  },
  async 找(id) {
    let m = 成员.表.find(x => x.id === id || x.name === id);
    if (!m) m = (await 成员.拉(true)).find(x => x.id === id || x.name === id);
    if (!m) throw new Error('通讯录里没有「' + id + '」; bridge.contacts 看有谁');
    return m;
  },
  async 改(id, a) { // 备注名 / 人设 / 模型; 空串 = 取消
    const m = await 成员.找(id), c = Object.assign({}, 成员.设[m.id]), 投 = 投递.of(m);
    if (a.name != null) { const n = String(a.name).trim().slice(0, 30);
      if (投.改名 && await 投.改名(m, n)) delete c.name; else if (n) c.name = n; else delete c.name; }
    if (a.persona != null) { const p = String(a.persona).trim().slice(0, 4000); if (p) c.persona = p; else delete c.persona; }
    if (a.model != null) { const md = String(a.model).trim(); if (md) c.model = md; else delete c.model; }
    if (Object.keys(c).length) 成员.设[m.id] = c; else delete 成员.设[m.id];
    await ctx.kv.set(成员.设键, 成员.设); await 成员.拉(true);
    return 成员.公开(成员.表.find(x => x.id === m.id) || m);
  },
  模型: async m => 投递.of(m).模型 ? 投递.of(m).模型(m) : [],
  公开: m => ({ id: m.id, name: m.name, kind: m.kind, memory: m.memory, online: m.online, model: m.model || undefined,
    note: m.备注 || undefined, cloud: m.cloud ? true : undefined, persona: m.persona || undefined }),
};
ctx.kv.get(成员.设键).then(v => { 成员.设 = v || {}; 成员.拉(true).catch(() => { }); });
if (typeof window !== 'undefined') {
  const 名单变 = e => { if (e.source === window && e.data && e.data.__colonyRelayEvent) 成员.拉(true).catch(() => { }); };
  const 厂商变 = () => 成员.拉(true).catch(() => { });
  window.addEventListener('message', 名单变); document.addEventListener('ai:providers', 厂商变);
  ctx.cleanup(() => { window.removeEventListener('message', 名单变); document.removeEventListener('ai:providers', 厂商变); });
}
// ═ 附件 · 跟着: 成员 ═
// 聊天框和全能 agent 一样: 粘贴、拖进来、📎 选的文件都能发。图片、视频、音频、文件读成 data 网址存库(bridge.file.<键>),
// 记录里只留 {key, name, mime, size}; 发给成员时再取出来, 拼成 OpenAI 的 content parts:
// 图片 image_url(多模态模型和 agent 都认); 音频 input_audio(wav/mp3); 视频和别的文件 file(file_data) + 一行文字说明,
// 文本文件直接读成字塞进去。太大的(> 20 MB)只发名字和大小, 不发内容。
// 归属: 进了会话记录的跟着会话(清空、删会话一起删); 没进记录的(ask 取回的、bridge.file 存的、输入框里没发出去的)记在 bridge.files.loose {键: 存的时刻},
// 启动时和每小时扫一次: loose 里超过 24 小时的删, 库里没人认领(不在任何记录、也不在 loose)的也删
const 附件 = {
  前缀: 'bridge.file.', 大: 20 * 1024 * 1024, 字长: 60000,
  文本: /\.(txt|md|json|csv|tsv|js|mjs|ts|tsx|jsx|py|html?|css|xml|ya?ml|log|java|go|rs|rb|php|sh|sql|toml|ini|c|cc|cpp|h|hpp|kt|swift|vue|svelte)$/i,
  类: f => /^image\//.test(f.mime) ? 'image' : /^video\//.test(f.mime) ? 'video' : /^audio\//.test(f.mime) ? 'audio'
    : (/^text\//.test(f.mime) || 附件.文本.test(f.name || '')) ? 'text' : 'file',
  读: f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(f); }),
  号: () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  松键: 'bridge.files.loose', 松: null,
  async 松开(k) { if (!附件.松) 附件.松 = (await ctx.kv.get(附件.松键)) || {}; 附件.松[k] = Date.now(); await ctx.kv.set(附件.松键, 附件.松); },
  async 认领(files) { // 进了会话记录: 不再算散的
    if (!files || !files.length) return; if (!附件.松) 附件.松 = (await ctx.kv.get(附件.松键)) || {};
    let 变 = false; files.forEach(f => { if (附件.松[f.key]) { delete 附件.松[f.key]; 变 = true; } }); if (变) await ctx.kv.set(附件.松键, 附件.松);
  },
  async 存(v, name, mime, 散) { // 一份内容(data 网址或字) → 附件记录; 散 = 还没进会话记录
    const rec = { key: 附件.号(), name: name || '文件', mime: mime || (/^data:([^;,]+)/.exec(v) || [])[1] || 'text/plain', size: /^data:/.test(v) ? Math.round((v.length - v.indexOf(',') - 1) * 3 / 4) : v.length };
    if (rec.size > 附件.大) rec.big = true; else await ctx.kv.set(附件.前缀 + rec.key, v);
    if (散 && !rec.big) await 附件.松开(rec.key);
    return rec;
  },
  async 收(f) { // 输入框里的 File → 附件记录(发出去前算散的)
    const rec = { name: f.name || '粘贴的' + (f.type.split('/')[0] || '文件'), mime: f.type || 'application/octet-stream' };
    if (f.size > 附件.大) return Object.assign(rec, { key: 附件.号(), size: f.size, big: true });
    return Object.assign(await 附件.存(附件.类(rec) === 'text' ? await f.text() : await 附件.读(f), rec.name, rec.mime, true), { size: f.size });
  },
  async 扫() { // 散的超过 24 小时删; 库里没人认领的也删(会话记录里的不碰)
    const 有 = new Set(); for (const c of await 会话.列()) ((会话.记录.get(c.id) || (await ctx.kv.get(会话.记录键(c.id))) || [])).forEach(e => (e.files || []).forEach(f => 有.add(f.key)));
    附件.松 = (await ctx.kv.get(附件.松键)) || {}; const 旧 = Date.now() - 864e5;
    let n = 0;
    for (const x of await ctx.kv.list(附件.前缀).catch(() => [])) {   // list 回 {key, value}
      const key = String(x.key).slice(附件.前缀.length);
      if (有.has(key) || (附件.松[key] && 附件.松[key] > 旧)) continue;
      await ctx.kv.del(附件.前缀 + key).catch(() => { }); delete 附件.松[key]; n++;
    }
    Object.keys(附件.松).forEach(k => { if (附件.松[k] <= 旧) delete 附件.松[k]; });
    await ctx.kv.set(附件.松键, 附件.松); return n;
  },
  取: rec => rec.big ? Promise.resolve(null) : ctx.kv.get(附件.前缀 + rec.key).catch(() => null),
  尺: n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B',
  // 一条消息的文字 + 附件 → content(没附件就是字符串)
  async 拼(text, files) {
    if (!files || !files.length) return text;
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    for (const f of files) {
      const v = await 附件.取(f), 类 = 附件.类(f), 说 = '[附件 ' + f.name + ' · ' + f.mime + ' · ' + 附件.尺(f.size) + ']';
      if (!v) { parts.push({ type: 'text', text: 说 + ' (太大或没存下, 只有名字)' }); continue; }
      if (类 === 'image') parts.push({ type: 'image_url', image_url: { url: v } });
      else if (类 === 'text') parts.push({ type: 'text', text: 说 + '\n' + String(v).slice(0, 附件.字长) });
      else if (类 === 'audio' && /wav|mpeg|mp3/.test(f.mime)) {
        parts.push({ type: 'text', text: 说 });
        parts.push({ type: 'input_audio', input_audio: { data: String(v).split(',')[1], format: /wav/.test(f.mime) ? 'wav' : 'mp3' } });
      } else {
        parts.push({ type: 'text', text: 说 });
        parts.push({ type: 'file', file: { filename: f.name, file_data: v } });
      }
    }
    return parts;
  },
  // 给 ai.chat(AI 配置的统一形状只认 text / image): 图片换成 {type:image, mimeType, data}, 别的变成文字说明
  统一(content) {
    if (typeof content === 'string') return content;
    return content.map(p => p.type === 'image_url'
      ? { type: 'image', mimeType: (/^data:([^;]+)/.exec(p.image_url.url) || [])[1] || 'image/png', data: p.image_url.url.split(',')[1] }
      : p.type === 'text' ? p : { type: 'text', text: p.type === 'file' ? '(附件 ' + p.file.filename + ', 这个模型收不了文件, 只给名字)' : '(一段音频, 这个模型收不了)' });
  },
  删: rec => ctx.kv.del(附件.前缀 + rec.key).catch(() => { }),
};
{ const t = setInterval(() => 附件.扫().catch(() => { }), 36e5); ctx.cleanup(() => clearInterval(t)); }
// ═ 媒体 · 跟着: 附件, 成员 ═
// agent 回的图片、视频、音频、文件, 变成记录里的附件(直接显示), 不是一行链接。认这几种写法(实测 hermes 用 MEDIA:本机路径):
//   MEDIA:<路径或网址>   ![说明](网址或路径)   [名字.mp4](网址)   单独一行的网址或本机路径(带媒体扩展名)   data:image/…;base64,…
// 本机路径经插件 localFile 读(插件要开「允许访问文件网址」), 网址经插件转发取(带不了就留链接)。认出来的那行从字里拿掉, 取不回的留原样
const 媒体 = {
  扩: /\.(png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v|mkv|mp3|wav|ogg|oga|m4a|aac|flac|opus|pdf|txt|md|csv|json|docx?|xlsx?|pptx?|zip)(\?[^\s)]*)?$/i,
  型: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
    csv: 'text/csv', json: 'application/json', zip: 'application/zip' },
  mime(p) { const e = (/\.([a-z0-9]+)(\?|$)/i.exec(p) || [])[1]; return 媒体.型[String(e).toLowerCase()] || 'application/octet-stream'; },
  本机: p => /^(?:[a-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt|opt)\/|~\/|file:\/\/)/i.test(p),
  // 从一段回复里找: 回 [{raw(要从字里拿掉的), src, name?}]
  找(t) {
    const 出 = [], 见 = new Set(), 加 = (raw, src, name) => { src = String(src || '').trim().replace(/^<|>$/g, '').replace(/^["'\x60]|["'\x60]$/g, '');
      if (!src || 见.has(src)) return; 见.add(src); 出.push({ raw, src, name }); };
    String(t || '').replace(/^[ \t]*MEDIA:[ \t]*(.+?)[ \t]*$/gim, (raw, p) => { 加(raw, p); return raw; });
    String(t || '').replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (raw, alt, u) => { 加(raw, u, alt); return raw; });
    String(t || '').replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (raw, n, u) => { if (媒体.扩.test(u.split('#')[0])) 加(raw, u, n); return raw; });
    String(t || '').replace(/^[ \t]*(?:[-*][ \t]+)?\x60?((?:https?:\/\/|file:\/\/|[a-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt|opt)\/)[^\s\x60]+)\x60?[ \t]*$/gim,
      (raw, u) => { if (媒体.扩.test(u)) 加(raw, u); return raw; });
    String(t || '').replace(/data:([a-z]+\/[\w.+-]+);base64,[A-Za-z0-9+/=]{200,}/g, raw => { 加(raw, raw); return raw; });
    return 出;
  },
  async 取(src) { // → {data(data 网址), mime, size} 或抛错
    if (/^data:/.test(src)) { const m = /^data:([^;,]+)/.exec(src); return { data: src, mime: m[1], size: Math.round((src.length - src.indexOf(',') - 1) * 3 / 4) }; }
    if (媒体.本机(src)) {
      const r = await 成员.一次('localFile', { path: src.replace(/^~\//, '') });
      if (!r.ok) throw new Error(r.error + (r.fix ? '; ' + r.fix : ''));
      const mime = 媒体.mime(src); return { data: 'data:' + mime + ';base64,' + r.base64, mime, size: r.bytes };
    }
    if (/^https?:\/\//i.test(src)) {
      let r;
      if (await 转发.有()) { r = await 成员.一次('fetch', { url: src, binary: true, timeout: 60000 }); if (r.error && !r.status) throw new Error(r.error); }
      else { const res = await fetch(src); const buf = new Uint8Array(await res.arrayBuffer()); let b = '';
        for (let i = 0; i < buf.length; i += 0x8000) b += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        r = { status: res.status, contentType: res.headers.get('content-type'), base64: btoa(b), bytes: buf.length }; }
      if (r.status && r.status >= 400) throw new Error('取不回 ' + r.status);
      const mime = (r.contentType || '').split(';')[0] || 媒体.mime(src);
      if (r.base64) return { data: 'data:' + mime + ';base64,' + r.base64, mime, size: r.bytes };
      if (r.text != null && /^text\/|json/.test(mime)) return { data: r.text, mime, size: r.text.length };
      throw new Error('不是文件');
    }
    throw new Error('认不出: ' + src);
  },
  // 一条回复 → {text(拿掉认出的行), files[]}
  async 收(text, 散) { // 散: 取回的先算散的(ask 用), 会话里的随后进记录
    const 找到 = 媒体.找(text);
    if (!找到.length) return { text, files: [] };
    let t = text; const files = [];
    for (const x of 找到.slice(0, 12)) {
      try {
        const got = await 媒体.取(x.src);
        const name = (x.name && /\.\w+$/.test(x.name) ? x.name : '') || decodeURIComponent((/^data:/.test(x.src) ? 'image.' + got.mime.split('/')[1] : x.src.split(/[\\/]/).pop().split('?')[0]) || '文件');
        const rec = got.size > 附件.大 ? { key: 附件.号(), name, mime: got.mime, size: got.size, big: true } : await 附件.存(got.data, name, got.mime, 散);
        rec.size = got.size; rec.from = x.src.slice(0, 300);
        files.push(rec);
        t = t.replace(x.raw, '');
      } catch (e) { /* 取不回: 那行留着, 至少有链接 */ }
    }
    return { text: t.replace(/\n{3,}/g, '\n\n').trim(), files };
  },
};
// ═ 会话 · 跟着: 成员, 附件 ═
// 一个会话 = 几个成员 + 一份记录; 一个人就是单聊, 几个人就是群。目录存 bridge.chats, 记录存 bridge.chat.<id>
// 谁来回: 点了名(@名字 / to)就是那几个; @所有人 或 to: 'all' 按顺序都回, 后回的看得到先回的; 群里没点名默认都回;
// 接力(relay: n): 都回完再轮着来, 最多 n 轮(1-20), 一轮都不说话就停。成员回 PASS(或空)就是不说话, 不留气泡
// 消息可带附件 files [{key, name, mime, size}](见附件段), 发给成员时拼成 content parts
// 发给成员的: 头一回带一段介绍(你叫什么、群里有谁、怎么不说话), 之后只是新话「名字: 内容」; 它自己说过的、报错不发给它
// 群里可以有真人(h:<gid>, 见房间段): 不点他们; 真人说话只有 @ 到的 agent 回。进别人的群(c.remote)时这边只是镜子, 说话交给房主
const 会话 = {
  目录键: 'bridge.chats', 记录键: id => 'bridge.chat.' + id,
  目录: null, 记录: new Map(), 听者: new Set(), 跑: new Map(),
  变: (id, x) => 会话.听者.forEach(f => { try { f(id, x); } catch (e) { } }),
  async 列() { if (!会话.目录) 会话.目录 = (await ctx.kv.get(会话.目录键)) || []; return 会话.目录; },
  存目录: () => ctx.kv.set(会话.目录键, 会话.目录),
  async 取(id) {
    const c = (await 会话.列()).find(x => x.id === id);
    if (!c) throw new Error('没有这个会话: ' + id + '; bridge.chats 看有哪些');
    if (!会话.记录.has(id)) 会话.记录.set(id, (await ctx.kv.get(会话.记录键(id))) || []);
    return c;
  },
  存记录: id => ctx.kv.set(会话.记录键(id), 会话.记录.get(id) || []),
  async 开(a) {
    const ids = [...new Set((a.with || []).map(String))];
    if (!ids.length) throw new Error('with 至少给一个成员 id');
    const ms = []; for (const x of ids) ms.push(await 成员.找(x));
    const 同 = !a.name && !a.new && (await 会话.列()).find(c => c.app === (a.app || null)
      && c.members.length === ms.length && ms.every(m => c.members.includes(m.id)));
    if (同) return 同;
    if (ms.length === 1 && ms[0].kind === 'human' && !a.new) { // 和好友单聊: 他先开过的那个就是
      const 他开的 = (await 会话.列()).find(c => c.remote && c.remote.单 && c.remote.from === ms[0].raw && !c.remote.kicked);
      if (他开的) return 他开的;
    }
    const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), app: a.app || null,
      name: a.name || ms.map(m => m.name).join('、'), members: ms.map(m => m.id), names: Object.fromEntries(ms.map(m => [m.id, m.name])),
      topic: a.topic || '', at: Date.now() };
    (await 会话.列()).unshift(c); 会话.记录.set(c.id, []);
    await 会话.存目录(); 会话.变(c.id, 'open');
    if (ms.some(m => m.kind === 'human')) await 房间.邀人(c, ms.filter(m => m.kind === 'human'));
    return c;
  },
  名: (c, id) => id === 'user' ? (c.remote ? (c.names.user || '房主') : c.room ? c.room.me : '用户') : id === 'note' ? '系统'
    : c.remote && id === 'h:' + c.remote.gid ? c.remote.me + '(我)' : (!c.remote && (成员.表.find(m => m.id === id) || {}).name) || c.names[id] || id,   // 插件里改了名就用新名
  人: id => id === 'user' || String(id).startsWith('h:'),
  能答: c => c.members.filter(id => !会话.人(id)),
  加(c, e) {
    const l = 会话.记录.get(c.id);
    e = Object.assign({ i: l.length ? l[l.length - 1].i + 1 : 1, at: Date.now() }, e);
    l.push(e); c.at = e.at; if (e.files) 附件.认领(e.files); c.last = (e.from === 'user' ? '' : 会话.名(c, e.from) + ': ') + String(e.text || (e.files ? '[附件]' : '')).slice(0, 60);
    会话.存记录(c.id); 会话.存目录(); 会话.变(c.id, e);
    return e;
  },
  介绍(c, m) {
    const 别人 = c.members.filter(x => x !== m.id).map(x => 会话.名(c, x) + (会话.人(x) ? '(真人)' : ''));
    return '[Colony 会话「' + c.name + '」] 你在这里叫「' + m.name + '」。'
      + (别人.length ? '一起的还有: ' + 别人.join('、') + ', 还有' + (c.room ? '房主「' + c.room.me + '」(真人)' : '用户') + '。' : '对面是用户。')
      + (c.topic ? '\n话题: ' + c.topic : '') + '\n每条消息前面是说话人的名字。轮到你时直接说你的话, 别写自己的名字。'
      + (别人.length ? '没什么要补充的就只回 PASS。' : '');
  },
  async 给(c, m) { // 有记忆的给全部(游标裁成新的), 没记忆的给最近 30 条; 附件只给游标后的(见过的不再取)
    const 新 = [];
    (会话.记录.get(c.id) || []).forEach(e => {
      if (e.error) return;
      if (e.from === m.id) 新.push({ role: 'assistant', content: e.text, e });
      else 新.push({ role: 'user', content: 会话.名(c, e.from) + ': ' + (e.text || (e.files ? '(发了附件)' : '')), e });
    });
    // 新进来的(这个会话里它还没收过话): 只补最近 24 条, 说一句前面截了; 插件里改了名, 下一条告诉它
    const 键0 = 会话.键(c, m.id) + '@' + m.id, 初 = m.memory && !游标.表[键0], 截 = 初 && 新.length > 24;
    const 史 = m.memory ? (初 ? 新.slice(-24) : 新) : 新.slice(-30);
    const 介 = 会话.介绍(c, m) + (截 ? '\n(你是后来进来的, 前面还有 ' + (新.length - 24) + ' 条没给你, 下面是最近 24 条)' : '');
    c.称 = c.称 || {};
    if (m.memory && !初 && c.称[m.id] && c.称[m.id] !== m.name) 史.push({ role: 'user', content: '[系统] 你在这里改名了: 现在叫「' + m.name + '」(原来叫「' + c.称[m.id] + '」)' });
    c.设 = c.设 || {}; const 人 = m.persona || '';
    if (m.memory && !初 && (c.设[m.id] || '') !== 人) 史.push({ role: 'user', content: 人 ? '[系统] 你的人设改了, 从现在起按这个来: ' + 人 : '[系统] 你的人设取消了, 照你平常的样子来' });
    if (c.称[m.id] !== m.name || (c.设[m.id] || '') !== 人) { c.称[m.id] = m.name; c.names[m.id] = m.name; c.设[m.id] = 人; 会话.存目录(); }
    const 全 = [{ role: 'user', content: 介 }].concat(史);
    // 游标按字比对, 所以先用纯字裁出新的那段, 再给这段里带附件的拼上文件
    const 键 = 会话.键(c, m.id) + '@' + m.id, 留 = m.memory ? 游标.裁(键, 全.map(x => ({ role: x.role, content: x.content }))) : 全;
    const 出 = [];
    for (const x of 留) {
      const 原 = 全.find(y => y.content === x.content && y.role === x.role);
      出.push(原 && 原.e && 原.e.files && x.role === 'user' ? { role: 'user', content: await 附件.拼(x.content, 原.e.files) } : x);
    }
    return 出;
  },
  键: (c, id) => 'colony-' + c.id + (c.代 ? '~' + c.代 : '') + '-' + id.replace(/[^\w-]/g, '_'),
  点名(c, text) {
    if (/@(所有人|all|everyone)/i.test(text)) return 会话.能答(c);
    const 中 = [];
    // 现名和记录里的旧名都认(刚改了名, 上一条 @ 的还是旧名也不落空); 长名先认: 「小明二号」不被认成「小明」
    c.members.flatMap(id => [...new Set([会话.名(c, id), c.names[id], (c.称 || {})[id]].filter(Boolean))].map(n => [id, n])).sort((a, b) => b[1].length - a[1].length)
      .forEach(([id, n]) => { const k = '@' + n; if (text.includes(k)) { 中.push(id); text = text.split(k).join(' '); } });
    return c.members.filter(id => 中.includes(id));
  },
  队: new Map(),   // 会话:成员 → 上一轮的 Promise: 同一个成员在同一个会话里一次只回一轮, 后来的排队
  轮(c, id) { // 问一个成员一轮, 进记录; 回那一条(不说话回 null)。排到时记录里已经没有它没见过的话(前一轮一起回了)就不再问
    const k = c.id + ':' + id, 前 = 会话.队.get(k) || Promise.resolve();
    const p = 前.catch(() => { }).then(() => {
      const l = 会话.记录.get(c.id) || [], 尾 = l.filter(e => !e.error && e.from !== 'note').pop();
      return 尾 && 尾.from === id ? null : 会话.单轮(c, id);
    });
    会话.队.set(k, p);
    p.finally(() => { if (会话.队.get(k) === p) 会话.队.delete(k); });
    return p;
  },
  async 单轮(c, id) {
    const m = await 成员.找(id), k = c.id + ':' + id, ac = new AbortController(), 步 = [];
    let 想 = '';   // 过程: 思考和工具步骤跟着正在打的字一起推给界面, 最后存进这条记录(think / tools)
    会话.跑.set(k, ac); 会话.变(c.id, { thinking: id, name: m.name });
    const 动 = x => { if (x.think != null) 想 = x.think;
      if (x.tool) { const i = 步.findIndex(s => s.id === x.tool.id && s.status !== 'completed'); if (i >= 0 && x.tool.status !== 'running') 步[i] = Object.assign({}, 步[i], x.tool, { label: x.tool.label || 步[i].label, emoji: x.tool.emoji || 步[i].emoji }); else 步.push(x.tool); }
      会话.变(c.id, { live: id, think: 想, tools: 步.slice() }); };
    try {
      const r = await 投递.问(m, { session: 会话.键(c, id), messages: await 会话.给(c, m), 已裁: m.memory, chat: c.id,
        signal: ac.signal, on: t => 会话.变(c.id, { typing: id, text: t }), 动 });
      if (r.queued) { 会话.加(c, { from: 'note', text: r.没响应
        ? m.name + ' 90 秒没有任何响应(云端桥显示它在线, 但消息可能没送到它那里: webhook 地址失效或它的进程没在跑)。已当留言放着, 它回来后的回复会自己出现在这里; 一直不回就请它重新照「云端型」指令接一次'
        : m.name + ' 不在线, 已留言; 它上线后的回复会自己出现在这里' }); return null; }
      const t = r.content.replace(/^\s*(\S{1,20})[:：]\s*/, (x, n) => n === m.name ? '' : x).trim();
      if (!t && !(r.files || []).length) return 会话.加(c, { from: id, text: m.name + ' 回了空的(没有字也没有附件); 再问一次, 还是空就看它那边的日志', error: true });
      if (/^\[?(PASS|SKIP)\]?[。.!！]?$/i.test(t)) { 会话.变(c.id, { pass: id }); return null; }
      const 收 = await 媒体.收(t);   // 回复里的图片、视频、音频、文件变成附件
      return 会话.加(c, Object.assign({ from: id, text: 收.text }, 收.files.length ? { files: 收.files } : {}, 想 ? { think: 想.slice(0, 20000) } : {}, 步.length ? { tools: 步.slice(0, 50) } : {}));
    } catch (e) {
      if (ac.signal.aborted) return null;
      return 会话.加(c, { from: id, text: e.message, error: true });
    } finally { 会话.跑.delete(k); 会话.变(c.id, { done: id }); }
  },
  async 说(a) {
    const c = await 会话.取(a.chat), text = String(a.text || '').trim(), 回 = [], files = (a.files || []).filter(f => f && f.key);
    if (c.remote) return 房间.客说(c, { text, files });
    const from = a.from || 'user';
    if (text || files.length) 会话.加(c, Object.assign({ from, text }, files.length ? { files } : {}));
    let 谁 = a.to === 'all' ? 会话.能答(c) : a.to === 'none' ? [] : Array.isArray(a.to) ? a.to.map(String)
      : a.to ? [String(a.to)] : 会话.点名(c, text);
    if (!谁.length && a.to !== 'none' && from === 'user') 谁 = 会话.能答(c);   // 客人没点名: 只当聊天, 不叫 agent
    谁 = 谁.map(x => (成员.表.find(m => m.name === x) || {}).id || x).filter(id => c.members.includes(id) && !会话.人(id));
    for (const id of 谁) { const e = await 会话.轮(c, id); if (e) 回.push(e); }
    // 接力: 调用方给 relay 就用它; 不给就看群设置(c.接力 轮数 + c.接着 开关)。真人(客人)说话不接力; 用户插话 = 这次重新数
    const 接 = from !== 'user' ? 0 : a.relay != null ? Math.max(0, Math.min(Math.round(+a.relay || 0), 20)) : c.接着 ? Math.max(1, Math.min(c.接力 || 3, 20)) : 0;
    const 号 = 会话.接号[c.id] = (会话.接号[c.id] || 0) + 1;   // 新的一句进来, 上一次的接力让位
    for (let n = 0; n < 接 && 会话.能答(c).length > 1 && 会话.接号[c.id] === 号; n++) {
      let 说了 = false;
      for (const id of 会话.能答(c)) {
        if (会话.接号[c.id] !== 号) break;
        const l = 会话.记录.get(c.id);
        if (l.length && l[l.length - 1].from === id) continue;
        const e = await 会话.轮(c, id); if (e) { 回.push(e); 说了 = true; }
      }
      if (!说了) break;
    }
    return 回;
  },
  停(chatId) { let n = 0; 会话.跑.forEach((ac, k) => { if (!chatId || k.startsWith(chatId + ':')) { ac.abort(); n++; } }); return n; },
  async 改(a) { // 拉人、移出、改名、改话题
    const c = await 会话.取(a.chat);
    if (c.remote) throw new Error('这是别人的群, 拉人、改名要房主来');
    const 新人 = [];
    for (const x of a.add || []) {
      const m = await 成员.找(x);
      if (!c.members.includes(m.id)) { c.members.push(m.id); c.names[m.id] = m.name;
        if (m.kind === 'human') 新人.push(m); else 会话.加(c, { from: 'note', text: m.name + ' 加入了' }); }
    }
    if (新人.length) await 房间.邀人(c, 新人);
    (a.remove || []).forEach(x => { if (c.members.includes(x) && c.members.length > 1) { c.members = c.members.filter(id => id !== x);
      if (String(x).startsWith('h:') && c.room) 房间.踢(c, x);
      会话.加(c, { from: 'note', text: 会话.名(c, x) + ' 离开了' }); } });
    if (a.name) c.name = a.name;
    if (a.topic != null) c.topic = a.topic;
    if (a.relay != null) c.接力 = Math.max(1, Math.min(Math.round(+a.relay) || 3, 20));
    if (a.relayOn != null) c.接着 = !!a.relayOn;
    await 会话.存目录(); 会话.变(c.id, 'members');
    return c;
  },
  async 清(id) { // 清空聊天: 记录和附件删掉, 会话换代(键后缀变), 有记忆的 agent 从头开始(它自己的长期记忆清不掉)
    const c = await 会话.取(id); if (c.remote) throw new Error('这是别人的群, 只有房主能清空');
    会话.停(id);
    (会话.记录.get(id) || []).forEach(e => (e.files || []).forEach(附件.删));
    Object.keys(游标.表).filter(k => k.startsWith(会话.键(c, '') )).forEach(k => delete 游标.表[k]); 游标.存();
    c.代 = (c.代 || 0) + 1; c.称 = {}; c.last = ''; 会话.记录.set(id, []);
    await 会话.存记录(id); await 会话.存目录();
    会话.加(c, { from: 'note', text: '聊天记录已清空; agent 从头开始(它们自己的长期记忆清不掉)' });
    if (c.room) 房间.给全(c, 房间.同步(c, 0));
    会话.变(id, 'members');
  },
  async 删(id) {
    await 会话.列(); 会话.停(id);
    const 它 = 会话.目录.find(c => c.id === id); if (它 && (它.room || 它.remote)) 房间.退(它);
    (会话.记录.get(id) || (await ctx.kv.get(会话.记录键(id))) || []).forEach(e => (e.files || []).forEach(附件.删));
    会话.目录 = 会话.目录.filter(c => c.id !== id); 会话.记录.delete(id);
    await 会话.存目录(); await ctx.kv.del(会话.记录键(id)).catch(() => { });
    Object.keys(游标.表).filter(k => k.startsWith('colony-' + id + '-')).forEach(k => delete 游标.表[k]); 游标.存();
    会话.变(id, 'closed');
  },
  接号: {},
  外形: c => ({ id: c.id, name: c.name, members: c.members.map(id => ({ id, name: 会话.名(c, id), human: 会话.人(id) || undefined })), topic: c.topic || undefined,
    last: c.last, at: c.at, room: c.room ? 'host' : c.remote ? 'guest' : undefined, relay: c.接着 ? c.接力 || 3 : 0 }),
};
// ═ 授权 · 跟着: 成员 ═
// 小应用要用谁, 得用户点过: bridge.pick 弹选人框, 勾上的记进 bridge.grants[应用 id]; 小应用只看得到、问得到给了它的人。
// 应用是谁由 Stem 带来(隔离窗的 context.miniappId); 块和全能 agent 自己调不受限
const 授权 = {
  键: 'bridge.grants', 表: null,
  async 读() { if (!授权.表) 授权.表 = (await ctx.kv.get(授权.键)) || {}; return 授权.表; },
  谁: meta => meta && meta.frame ? (meta.context && meta.context.miniappId) || '?' : null,
  async 有(app, id) { return !app || ((await 授权.读())[app] || []).includes(id); },
  async 要(app, id) { if (!(await 授权.有(app, id))) throw new Error('这个应用没被允许用「' + id + '」: 先 bridge.pick 让用户选'); },
  async 给(app, ids) { const t = await 授权.读(); t[app] = [...new Set((t[app] || []).concat(ids))]; await ctx.kv.set(授权.键, t); },
  async 收(app, id) {
    const t = await 授权.读(); t[app] = (t[app] || []).filter(x => id && x !== id);
    if (!t[app].length) delete t[app];
    await ctx.kv.set(授权.键, t);
  },
  async 应用名(app) { try { return (await ctx.call('apps.get', { id: app })).name || app; } catch (e) { return app; } },
  async 弹(a, app) { // 选人框借对话框画: 回勾上的成员 id(取消、点暗处回 [])
    const 名 = await 授权.应用名(app), ms = (await 成员.拉(true)).filter(m => !a.kind || m.kind === a.kind), n = Math.max(1, +a.n || 1);
    return new Promise(ok => {
      const o = 对话框.开('<h2></h2><p class="u-hint"></p><div class="br-pick-l"></div>'), 选 = [], 好 = document.createElement('button');
      o.querySelector('h2').textContent = '「' + 名 + '」想用 ' + n + ' 位成员'; o.querySelector('.u-hint').textContent = a.why || '';
      好.className = 'u-btn u-pri'; o.querySelector('.u-foot').prepend(好); o.querySelector('[data-x]').textContent = '取消';
      const 数 = () => { 好.textContent = '给它用(' + 选.length + ' / ' + n + ')'; 好.disabled = !选.length; };
      const L = o.querySelector('.br-pick-l');
      ms.forEach(m => {
        const r = document.createElement('label'); r.className = 'br-pick-i' + (m.online ? '' : ' off');
        r.innerHTML = '<input type="checkbox"><span></span><b></b><i></i>';
        r.querySelector('span').textContent = m.kind === 'human' ? '🙂' : m.kind === 'agent' ? '🤖' : '✦'; r.querySelector('b').textContent = m.name;
        r.querySelector('i').textContent = (m.kind === 'human' ? '好友' : m.kind === 'agent' ? 'agent' : '模型') + (m.memory ? ' · 有记忆' : '') + (m.online ? '' : ' · 没接上');
        r.querySelector('input').onchange = e => { e.target.checked ? 选.push(m.id) : 选.splice(选.indexOf(m.id), 1); 数(); };
        L.appendChild(r);
      });
      if (!ms.length) L.textContent = '通讯录是空的: 先在 Colony Bridge 插件里接上 agent, 或在 AI 配置里加厂商';
      数();
      let v = []; 好.onclick = () => { v = 选.slice(); o.remove(); };
      new MutationObserver((_, ob) => { if (!o.isConnected) { ob.disconnect(); ok(v); } }).observe(o.parentNode, { childList: true });
    });
  },
};
// ═ 信使 ═
// 跨电脑传话: 公共 MQTT 中转(broker.emqx.io, 走 wss), 自己写的极简客户端(只要 CONNECT / SUBSCRIBE / PUBLISH / PING, QoS 0)。
// 中转只看到乱码: 每个房间一把 AES-GCM 钥匙, 只在邀请码里, 不经中转。一条消息先 JSON, 再加密, 大的切成 48 KB 一片, 收齐再拼。
// 断了 3 秒后自己重连、重订阅; 重连期间发的先排着
const 信使 = {
  地址: 'wss://broker.emqx.io:8084/mqtt', 片: 48 * 1024,
  开(opt) { // opt: {topics[], on(topic, obj), 状态?(在线 bool)} → {发(topic, obj), 关(), 订(topic)}
    const enc = new TextEncoder(), dec = new TextDecoder(), 订着 = new Set(opt.topics || []), 排 = [], 拼 = new Map();
    let ws = null, 活 = false, 关了 = false, 号 = 1, 心 = null, 重 = null;
    const 串 = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
    const 长 = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
    const 包 = (头, 体) => { const u = new Uint8Array(1 + 长(体.length).length + 体.length); u.set([头, ...长(体.length)]); u.set(体, u.length - 体.length); return u; };
    const 订 = t => { if (!活) return; const b = [号 >> 8, 号++ & 255, ...串(t), 0]; ws.send(包(0x82, new Uint8Array(b))); };
    const 推 = (t, data) => { const tb = 串(t), u = new Uint8Array(tb.length + data.length); u.set(tb); u.set(data, tb.length); ws.send(包(0x30, u)); };
    const 连 = () => {
      if (关了) return;
      try { ws = new WebSocket(信使.地址, ['mqtt']); } catch (e) { 重 = setTimeout(连, 3000); return; }
      ws.binaryType = 'arraybuffer';
      let buf = new Uint8Array(0);
      ws.onopen = () => {
        const vh = [...串('MQTT'), 4, 2, 0, 60], pl = 串('cb' + Math.random().toString(36).slice(2, 12));
        ws.send(包(0x10, new Uint8Array([...vh, ...pl])));
      };
      ws.onmessage = e => {
        const n = new Uint8Array(e.data), m = new Uint8Array(buf.length + n.length); m.set(buf); m.set(n, buf.length); buf = m;
        for (;;) { // 一帧: 头 + 变长长度 + 体
          if (buf.length < 2) break;
          let len = 0, mul = 1, i = 1, d;
          do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
          if (buf.length < i + len) break;
          const 头 = buf[0], 体 = buf.slice(i, i + len); buf = buf.slice(i + len);
          const 型 = 头 >> 4;
          if (型 === 2) { 活 = true; 订着.forEach(订); 排.splice(0).forEach(([t, d]) => 推(t, d)); opt.状态 && opt.状态(true);
            clearInterval(心); 心 = setInterval(() => { try { ws.send(new Uint8Array([0xc0, 0])); } catch (x) { } }, 30000); }
          else if (型 === 3) { const tl = (体[0] << 8) | 体[1], t = dec.decode(体.slice(2, 2 + tl)), q = (头 >> 1) & 3; 收(t, 体.slice(2 + tl + (q ? 2 : 0))); }
        }
      };
      ws.onclose = () => { 活 = false; clearInterval(心); opt.状态 && opt.状态(false); if (!关了) 重 = setTimeout(连, 3000); };
      ws.onerror = () => { try { ws.close(); } catch (x) { } };
    };
    const 收 = async (t, data) => {
      try {
        const o = JSON.parse(dec.decode(await 信使.解(opt.钥, data)));
        if (o.片) { // {片: id, i, n, d}
          const k = t + o.片, 有 = 拼.get(k) || { n: o.n, 块: [], at: Date.now() }; 有.块[o.i] = o.d; 拼.set(k, 有);
          if (有.块.filter(x => x != null).length < o.n) return;
          拼.delete(k); return opt.on(t, JSON.parse(有.块.join('')));
        }
        opt.on(t, o);
      } catch (e) { } // 别人的、坏的、钥匙不对的: 不认
      拼.forEach((v, k) => { if (Date.now() - v.at > 120000) 拼.delete(k); });
    };
    连();
    return {
      async 发(t, obj, k) {   // k: 用别人的钥匙(往别人的收件箱发)
        const s = JSON.stringify(obj), 出 = [];
        if (s.length <= 信使.片) 出.push(s);
        else { const id = Math.random().toString(36).slice(2, 10), n = Math.ceil(s.length / 信使.片);
          for (let i = 0; i < n; i++) 出.push(JSON.stringify({ 片: id, i, n, d: s.slice(i * 信使.片, (i + 1) * 信使.片) })); }
        for (const x of 出) { const d = await 信使.锁(k || opt.钥, enc.encode(x)); 活 ? 推(t, d) : 排.push([t, d]); }
      },
      订(t) { if (!订着.has(t)) { 订着.add(t); 订(t); } },
      关() { 关了 = true; clearTimeout(重); clearInterval(心); try { ws && ws.close(); } catch (e) { } },
      get 在() { return 活; },
    };
  },
  async 钥(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); },
  async 锁(k, data) { const iv = crypto.getRandomValues(new Uint8Array(12)), c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, data));
    const u = new Uint8Array(12 + c.length); u.set(iv); u.set(c, 12); return u; },
  解: async (k, u) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12))),
  b64: u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  un64: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  码: (room, gid, key) => 'colony-br:' + room + '.' + gid + '.' + 信使.b64(key),
  读码(s) { const m = /colony-br:([\w-]+)\.([\w-]+)\.([\w-]+)/.exec(String(s || '')); if (!m) throw new Error('不是 Colony 群邀请码(应以 colony-br: 开头)'); return { room: m[1], gid: m[2], key: 信使.un64(m[3]) }; },
};
// ═ 房间 · 跟着: 信使, 会话, 附件 ═
// 真人进群(照狼人杀 v2 的 Nexus, 星型): 开群的这座桥当房主, 别人的桥(Colony 里的或单独的 agent-bridge.html)拿邀请码进来当客人。
// 房主订 colony-br/<房>/h, 客人订 colony-br/<房>/g/<自己随机的 gid>; 客人只跟房主说话, 房主把记录、谁在想、打字逐个转给每位客人。
// 真人是会话成员(id h:<gid>), 不会被自动点名; 客人说话只有 @ 到的 agent 回(房主说话照旧)。附件客人要看时再向房主要, 只给这群记录里有的。
// 客人断线重连带上看到的最后一条, 房主补发之后的; 没等到同步就隔 5 秒再打招呼; 客人发的话带编号, 房主去重, 没回音的重连后再发。移出 = 拉黑 gid, 不再转发
const 房间 = {
  开着: new Map(),   // 会话 id → 信使连接
  上次: new Map(),   // 节流打字
  题: (room, who) => 'colony-br/' + room + '/' + who,
  // ── 房主 ──
  async 开房(c, me) {
    if (!c.room) {
      c.room = { id: Math.random().toString(36).slice(2, 12), key: 信使.b64(crypto.getRandomValues(new Uint8Array(32))),
        me: me || (好友.我 && 好友.我.name) || '房主', guests: {}, banned: [], ns: [] };
      await 会话.存目录();
    } else if (me) c.room.me = me;
    await 房间.连主(c);
    return 房间.码(c);
  },
  码: c => 信使.码(c.room.id, 'j', 信使.un64(c.room.key)),
  async 邀人(c, ms) { // 从通讯录拉好友: 开房(我当房主), 往他收件箱发邀请; 他在线就自动进来, 不在线等他上线再邀
    await 房间.开房(c, 好友.我.name);
    for (const m of ms) {
      c.room.banned = c.room.banned.filter(g => g !== m.raw);
      const f = 好友.表.find(x => x.uid === m.raw); if (f) await 好友.邀(c, f);
    }
    await 会话.存目录();
  },
  async 连主(c) {
    if (房间.开着.has(c.id)) return;
    const 钥 = await 信使.钥(信使.un64(c.room.key));
    const 连 = 信使.开({ 钥, topics: [房间.题(c.room.id, 'h')], on: (t, o) => 房间.主收(c.id, o).catch(() => { }),
      状态: 在 => { if (在) Object.keys(c.room.guests).forEach(g => 连.发(房间.题(c.room.id, 'g/' + g), { t: 'hi' })); } });
    房间.开着.set(c.id, 连);
  },
  给客: (c, gid, o) => { const 连 = 房间.开着.get(c.id); if (连) 连.发(房间.题(c.room.id, 'g/' + gid), o); },
  给全: (c, o) => Object.keys(c.room.guests).filter(g => c.room.guests[g].in !== false).forEach(g => 房间.给客(c, g, o)),
  种: (c, id) => id.startsWith('h:') ? 'human' : id === 'user' ? 'human' : ((成员.表.find(m => m.id === id) || {}).kind || 'agent'),
  外: (c, e) => ({ i: e.i, from: e.from, text: e.text, files: e.files, error: e.error, at: e.at }),
  同步(c, after) {
    const l = (会话.记录.get(c.id) || []).filter(e => e.i > (after || 0)).slice(-200).map(e => 房间.外(c, e));
    return { t: 'sync', chat: { name: c.name, topic: c.topic }, members: c.members, kinds: Object.fromEntries(c.members.map(x => [x, 房间.种(c, x)])),
      names: Object.assign({}, c.names, { user: c.room.me }), msgs: l, ns: c.room.ns.slice(-100) };
  },
  async 主收(cid, o) {
    const c = await 会话.取(cid).catch(() => null);
    if (!c || !c.room || !o || !o.gid || !/^[\w-]{6,40}$/.test(o.gid)) return;
    const g = o.gid, hid = 'h:' + g;
    if (c.room.banned.includes(g)) return 房间.给客(c, g, { t: 'kicked' });
    if (o.t === 'hello') {
      const name = String(o.name || '客人').slice(0, 24);
      if (!c.room.guests[g] || !c.room.guests[g].in) {
        const 新 = !c.members.includes(hid);
        c.room.guests[g] = { name, at: Date.now(), in: true };
        if (新) c.members.push(hid);
        c.names[hid] = name; await 会话.存目录();
        if (新 || c.members.length > 1) 会话.加(c, { from: 'note', text: name + ' 加入了' }); 会话.变(c.id, 'members');
      }
      return 房间.给客(c, g, 房间.同步(c, o.after));
    }
    if (!c.room.guests[g]) return 房间.给客(c, g, { t: 'who' });   // 不认识的: 叫它先 hello
    if (o.t === 'say') {
      if (o.n && c.room.ns.includes(o.n)) return;
      if (o.n) { c.room.ns.push(o.n); if (c.room.ns.length > 300) c.room.ns.splice(0, 100); }
      const files = [];
      for (const f of (o.files || []).slice(0, 10)) files.push(typeof f.data === 'string' && f.data.length < 12e6
        ? await 附件.存(f.data, String(f.name || '附件').slice(0, 120), String(f.mime || 'application/octet-stream'))
        : { key: 附件.号(), name: String(f.name || '附件').slice(0, 120), mime: String(f.mime || ''), size: +f.size || 0, big: true });
      return 会话.说({ chat: c.id, text: String(o.text || '').slice(0, 20000), files, from: hid });
    }
    if (o.t === 'file') { // 只给这群记录里有的附件
      const 有 = (会话.记录.get(c.id) || []).some(e => (e.files || []).some(f => f.key === o.key));
      if (!有) return;
      const data = await ctx.kv.get(附件.前缀 + o.key).catch(() => null);
      return 房间.给客(c, g, { t: 'file', key: o.key, data: data || null });
    }
    if (o.t === 'bye') {
      delete c.room.guests[g]; c.members = c.members.filter(x => x !== hid); await 会话.存目录();
      c.room.banned.push(g);
      会话.加(c, { from: 'note', text: 会话.名(c, hid) + ' 退出了' }); 会话.变(c.id, 'members');
    }
  },
  听(id, x) { // 会话有变: 开着房的转给客人
    const c = (会话.目录 || []).find(y => y.id === id);
    if (!c || !c.room || !房间.开着.has(id)) return;
    if (x && x.i) return 房间.给全(c, { t: 'msg', e: 房间.外(c, x) });
    if (x === 'members') return 房间.给全(c, 房间.同步(c, 1e12));
    if (x === 'closed') return 房间.给全(c, { t: 'closed' });
    if (x && x.typing) { const k = id + x.typing, t = Date.now(); if (t - (房间.上次.get(k) || 0) < 400) return; 房间.上次.set(k, t); }
    if (x && x.live) { const k = id + '~' + x.live, t = Date.now(); if (t - (房间.上次.get(k) || 0) < 600) return; 房间.上次.set(k, t);
      x = Object.assign({}, x, { think: String(x.think || '').slice(-4000) }); }
    if (x && (x.typing || x.live || x.thinking || x.done || x.pass)) 房间.给全(c, { t: 'live', x });
  },
  踢(c, hid) {
    const g = hid.slice(2);
    if (!c.room.banned.includes(g)) c.room.banned.push(g);
    房间.给客(c, g, { t: 'kicked' }); delete c.room.guests[g];
  },
  // ── 客人 ──
  async 加入(code, name, opt = {}) { // opt: 好友拉的 {gid: 我的 uid, from: 他的 uid, 单: 单聊}
    const r = 信使.读码(code), 有 = (await 会话.列()).find(c => c.remote && c.remote.room === r.room);
    if (有) { if (name) 有.remote.me = name; if (有.remote.kicked) { 有.remote.kicked = false; 房间.开着.delete(有.id); }
      await 会话.存目录(); 房间.连客(有); return 有; }
    const gid = opt.gid || Array.from(crypto.getRandomValues(new Uint8Array(9)), b => (b % 36).toString(36)).join('');
    const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), app: null, name: '群聊(连接中…)',
      members: [], names: {}, kinds: {}, topic: '', at: Date.now(),
      remote: { room: r.room, key: 信使.b64(r.key), gid, me: String(name || '客人').slice(0, 24), from: opt.from, 单: !!opt.单 } };
    (await 会话.列()).unshift(c); 会话.记录.set(c.id, []);
    await 会话.存目录(); 会话.变(c.id, 'open');
    await 房间.连客(c);
    return c;
  },
  待: new Map(),   // 会话 id → [{n, text, files}] 还没回音的
  async 连客(c) {
    if (房间.开着.has(c.id) || c.remote.kicked) return;
    const R = c.remote, 钥 = await 信使.钥(信使.un64(R.key)), 主 = 房间.题(R.room, 'h');
    // 中转不留信: 房主还没订上(刚开群、不在线)时这声 hello 就丢了, 没收到同步就 5 秒再问一次
    let 等 = null;
    const hello = () => { const l = 会话.记录.get(c.id) || []; 连.发(主, { t: 'hello', gid: R.gid, name: R.me, after: l.length ? l[l.length - 1].i : 0 });
      clearTimeout(等); 等 = setTimeout(() => { if (!R.on && !R.kicked && 房间.开着.get(c.id) === 连) hello(); }, 5000); };
    const 连 = 信使.开({ 钥, topics: [房间.题(R.room, 'g/' + R.gid)], on: (t, o) => 房间.客收(c.id, o, hello).catch(() => { }),
      状态: 在 => { R.on = false; if (在) hello(); 会话.变(c.id, 'members'); } });
    房间.开着.set(c.id, 连);
  },
  镜(c, e) { const l = 会话.记录.get(c.id); if (l.length && l[l.length - 1].i >= e.i) return; l.push(e); c.at = e.at;
    c.last = (e.from === 'note' ? '' : 会话.名(c, e.from) + ': ') + String(e.text || (e.files ? '[附件]' : '')).slice(0, 60); 会话.存记录(c.id); 会话.变(c.id, e); },
  async 客收(cid, o, hello) {
    const c = await 会话.取(cid).catch(() => null);
    if (!c || !c.remote) return;
    if (o.t === 'hi' || o.t === 'who') return hello();
    if (o.t === 'sync') {
      Object.assign(c, { name: o.chat.name || c.name, topic: o.chat.topic || '', members: o.members || [], names: o.names || {}, kinds: o.kinds || {} });
      if (c.remote.单) c.name = (o.names || {}).user || c.name;   // 好友找我单聊: 会话名是他
      c.remote.on = true;
      (o.msgs || []).forEach(e => 房间.镜(c, e));
      const 见 = new Set(o.ns || []), 待 = 房间.待.get(c.id) || [];
      房间.待.set(c.id, 待.filter(x => !见.has(x.n)));
      房间.待.get(c.id).forEach(x => 房间.开着.get(c.id).发(房间.题(c.remote.room, 'h'), Object.assign({ t: 'say', gid: c.remote.gid }, x)));
      await 会话.存目录(); 会话.变(c.id, 'members');
      return;
    }
    if (o.t === 'msg') {
      if (o.e.from === 'h:' + c.remote.gid) 房间.待.set(c.id, (房间.待.get(c.id) || []).slice(1));
      return 房间.镜(c, o.e);
    }
    if (o.t === 'live') return 会话.变(c.id, o.x);
    if (o.t === 'file') { if (o.data) await ctx.kv.set(附件.前缀 + o.key, o.data); 房间.要过.delete(o.key); return 会话.变(c.id, 'file'); }
    if (o.t === 'kicked' || o.t === 'closed') {
      c.remote.kicked = true; c.remote.on = false; await 会话.存目录();
      房间.镜(c, { i: 1e12 + Date.now(), from: 'note', text: o.t === 'kicked' ? '你被移出了这个群' : '房主解散了这个群', at: Date.now() });
      const 连 = 房间.开着.get(c.id); if (连) 连.关(); 房间.开着.delete(c.id);
      会话.变(c.id, 'members');
    }
  },
  async 客说(c, a) {
    if (c.remote.kicked) throw new Error('你已经不在这个群里了');
    const files = [];
    for (const f of a.files || []) {
      const v = f.big ? null : await 附件.取(f);
      files.push({ name: f.name, mime: f.mime, size: f.size, data: v && v.length < 12e6 ? v : undefined });
    }
    const x = { n: Math.random().toString(36).slice(2, 12), text: a.text || '', files };
    房间.待.set(c.id, (房间.待.get(c.id) || []).concat([x]));
    const 连 = 房间.开着.get(c.id); if (!连) await 房间.连客(c);
    房间.开着.get(c.id).发(房间.题(c.remote.room, 'h'), Object.assign({ t: 'say', gid: c.remote.gid }, x));
    会话.变(c.id, { thinking: 'send', name: '发送中' });
    setTimeout(() => 会话.变(c.id, { done: 'send' }), 1500);
    return [];
  },
  要过: new Set(),
  要文件(c, key) { // 客人要看附件: 本地没有就向房主要一次
    if (!c.remote || 房间.要过.has(key)) return; 房间.要过.add(key);
    const 连 = 房间.开着.get(c.id); if (连) 连.发(房间.题(c.remote.room, 'h'), { t: 'file', gid: c.remote.gid, key });
  },
  退(c) { const 连 = 房间.开着.get(c.id); if (!连) return;
    if (c.remote && !c.remote.kicked) 连.发(房间.题(c.remote.room, 'h'), { t: 'bye', gid: c.remote.gid });
    if (c.room) 房间.给全(c, { t: 'closed' });
    setTimeout(() => { 连.关(); }, 800); 房间.开着.delete(c.id); },
  async 起() { // 桥起来时: 开着房的重新连上, 进过的群重新连上
    for (const c of await 会话.列()) { if (c.room) 房间.连主(c).catch(() => { }); else if (c.remote && !c.remote.kicked) 房间.连客(c).catch(() => { }); }
  },
};
会话.听者.add(房间.听);
ctx.cleanup(() => { 会话.听者.delete(房间.听); 房间.开着.forEach(x => x.关()); 房间.开着.clear(); });
// ═ 云端 · 跟着: 成员, 会话 ═
// 云端桥(colony-agent v2 协议, 默认地址从插件 instr 拿; 也能 bridge.join 贴别的地址): 跨网的 agent 经它接进来。
// 名单 GET members; 推送 GET events(SSE: member-pending/joined/updated/online/offline/removed/rejected, message, status, chat-done);
// 发话 POST chat {to: agentKey, content, chatId, msgId} → {queued: 对方离线已留言}; 管理 POST approve|reject {pendingId}, revoke|reapprove|remove {agentKey}。
// 成员 id = cl:<agentKey>, 有记忆(对方自己记着, 这里只发新话); 申请在插件或 👥 → 加人 里通过。对方离线时留言, 它回来后的回复按 chatId 认回到原会话
const 云端 = {
  桥: [], 连: new Map(), 待回: new Map(), 认: {}, 听者: new Set(),
  头: b => b.token ? { Authorization: 'Bearer ' + b.token } : {},
  变() { 成员.拉(true).catch(() => { }); 云端.听者.forEach(f => { try { f(); } catch (e) { } }); },
  async 起() {
    云端.桥 = (await ctx.kv.get('bridge.cloud')) || null;
    云端.认 = (await ctx.kv.get('bridge.cloud.chats')) || {};
    if (!云端.桥) { // 头一回: 插件里的默认云端桥
      云端.桥 = [];
      const r = await 转发.有() ? await 成员.一次('instr', {}).catch(() => null) : null;
      if (r && r.cloud) 云端.桥.push({ base: r.cloud.replace(/\/+$/, '') });
      await ctx.kv.set('bridge.cloud', 云端.桥);
    }
    云端.桥.forEach(b => 云端.接(b).catch(() => { }));
  },
  async 调(b, action, body) {
    const res = await fetch(b.base + '/colony-agent/v2/' + action, { method: body ? 'POST' : 'GET',
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, 云端.头(b)), body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && j.error) ? j.error + (j.fix ? ' — ' + j.fix : '') : action + ' 失败: HTTP ' + res.status);
    return j;
  },
  async 刷(c) { const j = await 云端.调(c.b, 'members'); Object.assign(c, { members: j.members || [], pending: j.pending || [], revoked: j.revoked || [] }); c.on = true; 云端.变(); },
  async 接(b) {
    const old = 云端.连.get(b.base); if (old && old.es) old.es.close();
    const c = { b, members: [], pending: [], revoked: [], on: false, es: null };
    云端.连.set(b.base, c);
    await 云端.刷(c);
    const es = c.es = new EventSource(b.base + '/colony-agent/v2/events' + (b.token ? '?token=' + encodeURIComponent(b.token) : ''));
    const 改 = (k, f) => es.addEventListener(k, e => { try { f(JSON.parse(e.data)); } catch (x) { } 云端.变(); });
    const 有 = d => c.members.find(x => x.agentKey === d.agentKey);
    es.addEventListener('ready', () => 云端.刷(c).catch(() => { }));
    改('member-pending', p => { if (!c.pending.find(x => x.pendingId === p.pendingId)) c.pending.push(p); });
    改('member-rejected', d => { c.pending = c.pending.filter(x => x.pendingId !== d.pendingId); });
    const 加 = d => { const m = 有(d); m ? Object.assign(m, d) : c.members.push(d); c.pending = c.pending.filter(x => x.name !== d.name || !d.agentKey); };
    改('member-joined', 加); 改('member-updated', 加);
    改('member-online', d => { const m = 有(d); if (m) m.online = true; });
    改('member-offline', d => { const m = 有(d); if (m) m.online = false; });
    改('member-removed', d => { c.members = c.members.filter(x => x.agentKey !== d.agentKey); });
    const 听 = (k, f) => es.addEventListener(k, e => { try { f(JSON.parse(e.data)); } catch (x) { } });
    听('message', 云端.到);
    听('chat-done', p => { const w = 云端.待回.get(p.chatId); if (w) w.end(); });
    听('status', p => { const w = 云端.待回.get(p.chatId); if (w) w.status(p.status); });
    es.onerror = () => { c.on = es.readyState !== 2; 云端.变(); };
  },
  // 一段回复到了: 正在等的那轮接着拼; 没人等(离线留言的回音) → 按 chatId 认回原会话, 当新的一条
  async 到(p) {
    const w = p.chatId && 云端.待回.get(p.chatId);
    if (w) return w.push(p.content || '');
    const 认 = p.chatId && 云端.认[p.chatId];
    if (!认) return;
    const c = (会话.目录 || []).find(x => x.id === 认.chat); if (!c) return;
    const 收 = await 媒体.收(String(p.content || ''));
    会话.加(c, Object.assign({ from: 认.from, text: 收.text }, 收.files.length ? { files: 收.files } : {}));
  },
  成员() {
    const 出 = [];
    云端.连.forEach(c => c.members.filter(m => m.status !== 'revoked').forEach(m => 出.push({ id: 'cl:' + m.agentKey, name: m.name || m.keyShort, kind: 'agent', cloud: c.b.base,
      memory: true, online: !!m.online, agentKey: m.agentKey,
      备注: (m.online ? '云端' : '云端 · 离线可留言') + (m.webhook ? ' · webhook' : '') + (m.lastSeen && Date.now() - m.lastSeen > 864e5 ? ' · ' + Math.round((Date.now() - m.lastSeen) / 864e5) + ' 天没动静' : '') })));
    return 出;
  },
  申请() { const 出 = []; 云端.连.forEach(c => c.pending.forEach(p => 出.push(Object.assign({ base: c.b.base }, p)))); return 出; },
  async 批(base, pendingId, ok) {
    const c = 云端.连.get(base); if (!c) throw new Error('没连这座云端桥');
    await 云端.调(c.b, ok ? 'approve' : 'reject', { pendingId });
    await 云端.刷(c);
  },
  async 管(id, action) { // revoke | reapprove | remove
    const k = String(id).replace(/^cl:/, ''); let c = null;
    云端.连.forEach(x => { if (x.members.some(m => m.agentKey === k) || x.revoked.some(m => m.agentKey === k)) c = x; });
    if (!c) throw new Error('不认识这个云端成员');
    await 云端.调(c.b, action, { agentKey: k }); await 云端.刷(c);
  },
  // 问一轮: 回 {content}; 离线 → {content: '', queued: true}(它回来后的回复自动进原会话)
  async 问(m, content, a) {
    const c = 云端.连.get(m.cloud); if (!c) throw new Error('云端桥没连上: ' + m.cloud);
    const chatId = crypto.randomUUID(), msgId = crypto.randomUUID();
    if (a.chat) { 云端.认[chatId] = { chat: a.chat, from: m.id, at: Date.now() };
      const ks = Object.keys(云端.认); if (ks.length > 300) ks.slice(0, 100).forEach(k => delete 云端.认[k]);
      ctx.kv.set('bridge.cloud.chats', 云端.认); }
    const 段 = []; let 完 = false, 醒 = null;
    云端.待回.set(chatId, { push: t => { 段.push(t); a.on && a.on(段.join('\n')); 醒 && 醒(); }, end: () => { 完 = true; 醒 && 醒(); }, status: s => a.status && a.status(s) });
    try {
      const j = await 云端.调(c.b, 'chat', { to: m.agentKey, content, chatId, msgId });
      if (j.queued) return { content: '', queued: true };
      // 云端桥说它在线, 不等于它真会回(webhook 地址失效时桥照样当它在线)。90 秒连一个字、一个状态都没有 → 当没送到:
      // 不再傻等, 按留言处理(它真回来了, 回复照样按 chatId 进原会话), 并说清楚可能是什么问题
      let last = Date.now(), 动 = false;
      const 原状态 = 云端.待回.get(chatId).status;
      云端.待回.get(chatId).status = s => { 动 = true; last = Date.now(); 原状态(s); };
      while (!完) {
        if (a.signal && a.signal.aborted) throw new Error('停了');
        if (!动 && !段.length && Date.now() - last > 90000)
          return { content: '', queued: true, 没响应: true };
        if (Date.now() - last > 600000) break;
        const n = 段.length; await new Promise(r => { 醒 = r; setTimeout(r, 1000); }); 醒 = null; if (段.length > n) { last = Date.now(); 动 = true; }
      }
      return { content: 段.join('\n') };
    } finally { 云端.待回.delete(chatId); if (a.chat && 段.length) { delete 云端.认[chatId]; ctx.kv.set('bridge.cloud.chats', 云端.认); } }
  },
  async 加桥(base, token) {
    base = String(base || '').trim().replace(/\/+$/, ''); if (!/^https?:\/\//.test(base)) throw new Error('要一个 http(s) 地址');
    const h = await (await fetch(base + '/colony-agent/v2/health', { headers: token ? { Authorization: 'Bearer ' + token } : {} })).json().catch(() => null);
    if (!h || h.service !== 'colony-bridge') throw new Error('这个地址不是 Colony 云端桥(health 没认出来)');
    云端.桥 = 云端.桥.filter(b => b.base !== base).concat([{ base, token: token || undefined }]);
    await ctx.kv.set('bridge.cloud', 云端.桥); await 云端.接(云端.桥[云端.桥.length - 1]);
    return { ok: true, health: h };
  },
  async 删桥(base) { const c = 云端.连.get(base); if (c && c.es) c.es.close(); 云端.连.delete(base);
    云端.桥 = 云端.桥.filter(b => b.base !== base); await ctx.kv.set('bridge.cloud', 云端.桥); 云端.变(); },
};
ctx.cleanup(() => 云端.连.forEach(c => c.es && c.es.close()));
// ═ 好友 · 跟着: 信使, 房间, 成员, 会话 ═
// 真人进通讯录(像微信加好友): 每座桥有自己的身份 {uid, name, key} 和一个收件箱 colony-br/u/<uid>(用 key 加密, 经公共中转常连着)。
// 好友码 colony-fr:<uid>.<key> 发给对方 → 他在 👥 → 加人 贴进来, 往我的收件箱发申请(带他自己的收件箱钥匙) → 我在「申请」里通过 → 回 ok, 两边都进通讯录。
// 好友是成员 {id: h:<uid>, kind: human}: 单聊、拉群和 agent 一样从通讯录点。拉好友进会话 = 这个会话开房(我当房主), 往他收件箱发 invite,
// 他的桥自动以 gid = 他的 uid 进来(所以两边的成员 id 对得上)。在线: 连上时给每个好友 hi, 之后每 60 秒 hey, 150 秒没动静算离线;
// 好友上线时, 他在而还没进的房再发一次邀请(中转不存离线消息)
const 好友 = {
  我: null, 表: [], 申请: [], 发出: [], 见: {}, 连: null, 钟: null,
  题: uid => 'colony-br/u/' + uid,
  码: () => 'colony-fr:' + 好友.我.uid + '.' + 好友.我.key,
  读码(s) { const m = /colony-fr:([a-z0-9]{6,24})\.([\w-]{40,})/.exec(String(s || '')); if (!m) throw new Error('不是好友码(应以 colony-fr: 开头)'); return { uid: m[1], key: m[2] }; },
  在线: uid => Date.now() - (好友.见[uid] || 0) < 150000,
  async 起() {
    好友.我 = await ctx.kv.get('bridge.me');
    if (!好友.我) {
      好友.我 = { uid: Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join(''),
        key: 信使.b64(crypto.getRandomValues(new Uint8Array(32))), name: colony.单独 ? '朋友' : 'Colony 用户' };
      await ctx.kv.set('bridge.me', 好友.我);
    }
    好友.表 = (await ctx.kv.get('bridge.friends')) || [];
    好友.申请 = (await ctx.kv.get('bridge.requests')) || [];
    好友.发出 = (await ctx.kv.get('bridge.sent')) || [];
    const 钥 = await 信使.钥(信使.un64(好友.我.key));
    好友.连 = 信使.开({ 钥, topics: [好友.题(好友.我.uid)], on: (t, o) => 好友.收(o).catch(() => { }),
      状态: 在 => { if (在) { 好友.表.forEach(f => 好友.发(f, { t: 'hi' })); 好友.重申(); } } });
    // 中转不存离线消息: 好友申请没通过的, 连上时和每 60 秒再发一次(对方收到同一个人的申请只更新那一条), 7 天后不再发
    好友.钟 = setInterval(() => { 好友.表.forEach(f => 好友.发(f, { t: 'hey' })); 好友.重申(); 成员.拉(true).catch(() => { }); }, 60000);
    ctx.cleanup(() => { clearInterval(好友.钟); 好友.连 && 好友.连.关(); });
  },
  async 发(f, o) { // 往一个人的收件箱发(用他的钥匙)
    const 钥 = f.钥 || (f.钥 = await 信使.钥(信使.un64(f.key)));
    return 好友.连.发(好友.题(f.uid), Object.assign({ from: 好友.我.uid }, o), 钥);
  },
  存: () => Promise.all([ctx.kv.set('bridge.friends', 好友.表.map(({ 钥, ...f }) => f)), ctx.kv.set('bridge.requests', 好友.申请), ctx.kv.set('bridge.sent', 好友.发出)]),
  变() { 成员.拉(true).catch(() => { }); 好友.听者.forEach(f => { try { f(); } catch (e) { } }); },
  听者: new Set(),
  async 收(o) {
    if (!o || !o.from || o.from === 好友.我.uid) return;
    const f = 好友.表.find(x => x.uid === o.from);
    if (o.t === 'req') { // 有人加我
      if (f) { f.key = o.key; f.name = o.name || f.name; delete f.钥; await 好友.发(f, { t: 'ok', name: 好友.我.name }); return 好友.存(); }
      好友.申请 = 好友.申请.filter(x => x.uid !== o.from).concat([{ uid: o.from, key: String(o.key), name: String(o.name || '朋友').slice(0, 24), msg: String(o.msg || '').slice(0, 200), at: Date.now() }]);
      await 好友.存(); return 好友.变();
    }
    if (o.t === 'ok') { // 我加的人通过了
      const s = 好友.发出.find(x => x.uid === o.from);
      if (!s && !f) return;
      if (!f) 好友.表.push({ uid: o.from, key: s.key, name: String(o.name || s.name || '朋友').slice(0, 24), at: Date.now() });
      else if (o.name) f.name = String(o.name).slice(0, 24);
      好友.发出 = 好友.发出.filter(x => x.uid !== o.from); 好友.见[o.from] = Date.now();
      await 好友.存(); return 好友.变();
    }
    if (!f) return;   // 下面的只认好友
    const 刚上线 = !好友.在线(f.uid);
    好友.见[f.uid] = Date.now();
    if (o.name && o.name !== f.name) { f.name = String(o.name).slice(0, 24); 好友.存(); }
    if (o.t === 'hi') 好友.发(f, { t: 'hey', name: 好友.我.name });
    if (o.t === 'hi' || 刚上线) { 好友.补邀(f); 好友.变(); }
    if (o.t === 'invite') return 房间.加入(o.code, 好友.我.name, { gid: 好友.我.uid, from: f.uid, 单: !!o.单 }).catch(() => { });
    if (o.t === 'drop') { 好友.表 = 好友.表.filter(x => x.uid !== f.uid); await 好友.存(); 好友.变(); }
  },
  重申() { 好友.发出.filter(x => Date.now() - x.at < 7 * 864e5).forEach(x => 好友.发({ uid: x.uid, key: x.key }, { t: 'req', key: 好友.我.key, name: 好友.我.name, msg: x.msg || '' }).catch(() => { })); },
  async 补邀(f) { // 他在、还没进的房: 再邀一次
    for (const c of await 会话.列()) if (c.room && c.members.includes('h:' + f.uid) && !(c.room.guests[f.uid] || {}).in) 好友.邀(c, f);
  },
  邀(c, f) { return 好友.发(f, { t: 'invite', code: 房间.码(c), name: 好友.我.name, 单: 会话.能答(c).length === 0 && c.members.length === 1 }); },
  async 加(code, msg) {
    const r = 好友.读码(code);
    if (r.uid === 好友.我.uid) throw new Error('这是你自己的好友码');
    const 有 = 好友.表.find(x => x.uid === r.uid);
    if (有) return { already: true, name: 有.name };
    好友.发出 = 好友.发出.filter(x => x.uid !== r.uid).concat([{ uid: r.uid, key: r.key, at: Date.now(), msg: msg || '' }]);
    await 好友.存();
    await 好友.发({ uid: r.uid, key: r.key }, { t: 'req', key: 好友.我.key, name: 好友.我.name, msg: msg || '' });
    好友.变();
    return { sent: true };
  },
  async 通过(uid) {
    const q = 好友.申请.find(x => x.uid === uid); if (!q) throw new Error('没有这条申请');
    好友.申请 = 好友.申请.filter(x => x.uid !== uid);
    if (!好友.表.some(x => x.uid === uid)) 好友.表.push({ uid, key: q.key, name: q.name, at: Date.now() });
    好友.见[uid] = Date.now();
    await 好友.存(); await 好友.发(q, { t: 'ok', name: 好友.我.name }); 好友.变();
  },
  async 拒(uid) { 好友.申请 = 好友.申请.filter(x => x.uid !== uid); await 好友.存(); 好友.变(); },
  async 删(uid) { const f = 好友.表.find(x => x.uid === uid); if (f) await 好友.发(f, { t: 'drop' }).catch(() => { });
    好友.表 = 好友.表.filter(x => x.uid !== uid); await 好友.存(); 好友.变(); },
  async 改名(n) { 好友.我.name = String(n).slice(0, 24); await ctx.kv.set('bridge.me', 好友.我); 好友.表.forEach(f => 好友.发(f, { t: 'hey', name: 好友.我.name })); 好友.变(); },
  成员: () => 好友.表.map(f => ({ id: 'h:' + f.uid, raw: f.uid, name: f.name, kind: 'human', memory: true, online: 好友.在线(f.uid), 备注: 好友.在线(f.uid) ? '' : '不在线' })),
};
// ═ 样式 ═
// 颜色跟界面块的设计变量走; 弹窗、按钮、提示条用界面块的框样式(单独打开时这两份借来自己挂上)。布局照微信电脑版: 最左一条竖栏, 列表栏, 聊天区, 右边抽屉
const 样式 = `
.br{--b-bg:var(--bg,#0d0d0f);--b-bg2:var(--bg-2,#141417);--b-bg3:#101012;--b-ln:var(--border,rgba(255,255,255,.08));--b-tx:var(--text,#ececec);
--b-mu:var(--text-3,#8a8a92);--b-ac:var(--accent,#B5FF00);display:flex;height:100%;min-height:420px;background:var(--b-bg);color:var(--b-tx);
font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;position:relative}
.br *{box-sizing:border-box}.br button{font:inherit;color:inherit;background:none;border:1px solid var(--b-ln);border-radius:7px;padding:4px 10px;cursor:pointer}
.br button:hover{background:rgba(255,255,255,.06)}.br .br-pri{background:var(--b-ac);color:#000;border-color:transparent}.br .br-pri:hover{filter:brightness(1.08);background:var(--b-ac)}
.br button:disabled{opacity:.4;cursor:default}.br input,.br textarea{color:inherit;font:inherit}
.br-rail{width:54px;flex:none;background:var(--b-bg3);border-right:1px solid var(--b-ln);display:flex;flex-direction:column;align-items:center;padding:12px 0;gap:6px}
.br-rail .me{width:34px;height:34px;border-radius:9px;background:var(--b-ac);color:#000;display:grid;place-items:center;font-weight:700;margin-bottom:10px}
.br-rail button{width:38px;height:38px;border:0;border-radius:9px;font-size:18px;padding:0;position:relative;color:var(--b-mu)}
.br-rail button.on{color:var(--b-ac);background:rgba(255,255,255,.07)}.br-rail .sp{flex:1}
.br-rail .n{position:absolute;top:2px;right:1px;min-width:15px;height:15px;border-radius:8px;background:#fa5151;color:#fff;font-size:10px;line-height:15px;padding:0 4px}
.br-side{width:250px;flex:none;border-right:1px solid var(--b-ln);display:flex;flex-direction:column;background:var(--b-bg2)}
.br-top{display:flex;gap:6px;padding:12px 10px 8px;align-items:center}
.br-top input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid var(--b-ln);border-radius:7px;padding:5px 9px;outline:none}
.br-top button{width:30px;height:30px;padding:0;font-size:17px;flex:none}
.br-list{flex:1;overflow:auto;padding:2px 6px 10px}
.br-sec{color:var(--b-mu);font-size:11.5px;padding:10px 8px 4px}
.br-it{display:flex;gap:9px;align-items:center;padding:8px;border-radius:8px;cursor:pointer}.br-it:hover{background:rgba(255,255,255,.05)}
.br-it.on{background:rgba(255,255,255,.09)}.br-it .t{flex:1;min-width:0}.br-it b{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br-it i{display:block;font-style:normal;color:var(--b-mu);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br-it .tm{color:var(--b-mu);font-size:11px;align-self:flex-start;flex:none}.br-it input{flex:none;margin:0}.br-it.off{opacity:.5}
.br-av{width:34px;height:34px;flex:none;border-radius:9px;background:rgba(255,255,255,.07);display:grid;place-items:center;font-size:16px;position:relative}
.br-dot{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border-radius:50%;border:2px solid var(--b-bg2);background:#3ddc84}.br-dot.off{background:#666}
.br-main{flex:1;min-width:0;display:flex;flex-direction:column}
.br-head{display:flex;align-items:center;gap:8px;padding:0 10px 0 18px;border-bottom:1px solid var(--b-ln);height:52px;flex:none}
.br-head .n{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.br-head .c{color:var(--b-mu)}.br-head .sp{flex:1}
.br-head button{border:0;font-size:18px;width:34px;height:34px;padding:0;color:var(--b-mu)}
.br-log{flex:1;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:12px}
.br-msg{display:flex;gap:9px;max-width:80%}.br-msg.me{align-self:flex-end;flex-direction:row-reverse}
.br-msg .bx{background:rgba(255,255,255,.07);border-radius:9px;padding:8px 11px;white-space:pre-wrap;word-break:break-word}
.br-msg.me .bx{background:rgba(149,236,105,.85);color:#111}.br-msg.err .bx{color:#ff8a80}.br-msg .who{font-size:11.5px;color:var(--b-mu);margin-bottom:3px}
.br-msg.live .bx{opacity:.75}.br-st{color:var(--b-mu);font-size:12px;align-self:center;text-align:center}
.br-fs{display:flex;flex-direction:column;gap:6px;margin-top:6px}.br-msg.me .br-fs{align-items:flex-end}
.br-fs img,.br-fs video{max-width:260px;max-height:220px;border-radius:8px;display:block;background:#000}.br-fs audio{width:240px}
.br-fc{display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.06);border:1px solid var(--b-ln);border-radius:8px;padding:7px 10px;max-width:260px}
.br-fc b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.br-fc i{font-style:normal;color:var(--b-mu);font-size:11px;flex:none}
.br-empty{margin:auto;color:var(--b-mu);text-align:center;line-height:1.9;white-space:pre-line}
.br-box{border-top:1px solid var(--b-ln);display:flex;flex-direction:column;flex:none}
.br-tool{display:flex;gap:2px;padding:6px 10px 0;align-items:center;flex-wrap:wrap}.br-tool button{border:0;padding:3px 7px;font-size:15px;color:var(--b-mu)}
.br-tool .at{font-size:12px;border:1px solid var(--b-ln);border-radius:12px;padding:1px 8px}.br-tool .sp{flex:1}
.br-tool label{display:flex;gap:4px;align-items:center;color:var(--b-mu);font-size:12px;cursor:pointer}
.br-tool input[type=number]{width:44px;background:rgba(255,255,255,.05);border:1px solid var(--b-ln);border-radius:5px;padding:1px 4px}
.br-pend{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px 0}.br-pend:empty{display:none}
.br-chip{display:flex;gap:6px;align-items:center;background:rgba(255,255,255,.06);border:1px solid var(--b-ln);border-radius:7px;padding:3px 4px 3px 8px;font-size:12px;max-width:220px}
.br-chip img{width:26px;height:26px;object-fit:cover;border-radius:4px}.br-chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br-chip button{border:0;padding:0 5px;color:var(--b-mu)}
.br-in{display:flex;gap:8px;align-items:flex-end;padding:6px 12px 10px}
.br-in textarea{flex:1;resize:none;min-height:60px;max-height:180px;background:transparent;border:0;padding:4px 2px;outline:none}
.br-drop{position:absolute;inset:0;background:rgba(181,255,0,.08);border:2px dashed var(--b-ac);display:grid;place-items:center;font-size:15px;pointer-events:none;z-index:5}
.br-mem{position:absolute;top:52px;right:0;bottom:0;width:260px;border-left:1px solid var(--b-ln);padding:14px;overflow:auto;background:var(--b-bg2);z-index:4;box-shadow:-12px 0 30px rgba(0,0,0,.35)}
.br-mem h4{margin:14px 0 6px;font-size:12px;color:var(--b-mu);font-weight:500}.br-mem h4:first-child{margin-top:0}
.br-mem .x{margin-left:auto;border:0;padding:0 6px;color:var(--b-mu)}
.br-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 4px}.br-grid .g{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11.5px;cursor:pointer;position:relative}
.br-grid .g span:last-child{max-width:54px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--b-mu)}
.br-grid .g .x{position:absolute;top:-6px;right:2px;width:16px;height:16px;border-radius:8px;background:#444;color:#fff;font-size:11px;line-height:14px;border:0;padding:0;display:none}
.br-grid .g:hover .x{display:block}.br-grid .add .br-av{border:1px dashed var(--b-ln);background:none;color:var(--b-mu)}
.br-mem .kv{display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid var(--b-ln);cursor:pointer}
.br-mem .kv span:last-child{color:var(--b-mu);max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br-pane{padding:24px 28px;overflow:auto;flex:1}.br-pane h3{margin:0 0 6px;font-size:16px}.br-pane p{color:var(--b-mu);margin:4px 0 12px}
.br-pane pre{background:rgba(255,255,255,.04);border:1px solid var(--b-ln);border-radius:8px;padding:12px;white-space:pre-wrap;font-size:12px;max-height:280px;overflow:auto}
.br-pane .row{display:flex;gap:8px;margin:8px 0;align-items:center}.br-pane input{flex:1;background:rgba(255,255,255,.05);border:1px solid var(--b-ln);border-radius:7px;padding:6px 9px;outline:none}
.br-hide{display:none!important}
.br-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#fa5151;color:#fff;font-size:10px;line-height:16px;text-align:center;padding:0 4px}
.br-think{margin:2px 0 6px;font-size:12px;color:var(--b-mu);border-left:2px solid var(--b-ln);padding-left:8px;max-width:640px}.br-think summary{cursor:pointer;user-select:none}
.br-think>div{white-space:pre-wrap;max-height:260px;overflow:auto;margin-top:2px}.br-tools{font-size:12px;margin:2px 0 6px;color:var(--b-mu)}.br-tools .run{color:var(--b-ac)}.br-tools .err{color:#ff8a80}
.br-pane textarea,.br-pane select{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--b-ln);border-radius:7px;padding:8px;outline:none;color:inherit;font:inherit}
.br-msg .bx code{background:rgba(255,255,255,.1);padding:0 4px;border-radius:4px;font-size:12px}.br-msg .bx .ag-h{font-weight:600;margin:4px 0 2px}.br-msg .bx .ag-li{padding-left:2px}
.br-msg .bx table{border-collapse:collapse;margin:4px 0;font-size:12px}.br-msg .bx td,.br-msg .bx th{border:1px solid var(--b-ln);padding:3px 8px}
.br-pick-l{max-height:50vh;overflow:auto;margin:10px 0}.br-pick-i{display:flex;gap:9px;align-items:center;padding:8px;border-radius:8px;cursor:pointer}.br-pick-i:hover{background:var(--surface-hover,rgba(255,255,255,.05))}
.br-pick-i i{font-style:normal;color:var(--text-muted,#8a8a92);font-size:12px;margin-left:auto}.br-pick-i.off{opacity:.5}
`;
if (typeof document !== 'undefined') {
  const st = document.createElement('style');
  const 有 = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); // 界面块在就已挂了这两份
  st.textContent = (有 ? '' : 设计变量 + 框样式) + 样式;
  document.head.appendChild(st);
  ctx.cleanup(() => st.remove());
}
// ═ 界面 · 跟着: 成员, 会话, 附件, 房间, 好友, 云端, 样式 ═
// 照微信电脑版: 最左一条竖栏(💬 会话 / 👥 成员), 列表栏(搜索 + ⊕ 拉群), 聊天区(顶上群名和 ⋯, 底下工具条和输入框), 群信息点 ⋯ 从右边滑出。
// 成员页一页管人: 左边通讯录(顶上一行「加人」: 好友码、贴码、申请), 点谁右边就是谁的资料(发消息、改名、人设、模型、删)。
// 本机和云端 agent 在 Colony Bridge 插件里接、批(指令也在插件里); 这里只认插件名单和云端桥名单, 变了自己刷新。
// 弹窗、提示、确认借界面块的对话框(单独打开时也带着); 别人的回复用全能 agent 的轻 md 排版(先转义, 模型写的 HTML 不会活)
const 转义 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const 问 = (话, 默认) => new Promise(ok => { // 对话框.开 画框, 这里只放一个输入框和「好」
  const o = 对话框.开('<p></p><input class="u-field">'), i = o.querySelector('input'), 好 = document.createElement('button');
  o.querySelector('p').textContent = 话; i.value = 默认 == null ? '' : String(默认);
  好.className = 'u-btn u-pri'; 好.textContent = '好'; o.querySelector('.u-foot').prepend(好);
  o.querySelector('[data-x]').textContent = '取消';
  let v = null; 好.onclick = () => { v = i.value; o.remove(); ok(v); };
  i.onkeydown = e => { if (e.key === 'Enter') 好.click(); if (e.key === 'Escape') o.querySelector('[data-x]').click(); };
  new MutationObserver((_, ob) => { if (!o.isConnected) { ob.disconnect(); if (v === null) ok(null); } }).observe(o.parentNode, { childList: true });
  i.focus();
});
const 报 = e => 对话框.提示(String(e && e.message || e));
// 贴码: 界面的「加进来」和 bridge.join 走这一个口; 本机 agent 不在这里接
const 贴码 = async (码, o = {}) => {
  const t = String(码 || '').trim();
  if (/colony-fr:/.test(t)) return 好友.加(t, o.msg);
  if (/colony-br:/.test(t)) return 会话.外形(await 房间.加入(t, o.name));
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(t)) throw new Error('本机 agent 在 Colony Bridge 插件里接(弹窗 → 扫描 / 接入包), 接好了通讯录自己有');
  if (/^https?:\/\//.test(t)) return 云端.加桥(t, o.token);
  throw new Error('认不出: 好友码 colony-fr:…、群邀请码 colony-br:…、云端桥 https://…; agent 在 Colony Bridge 插件里接');
};
// 要紧的事(删人、清空、解散)点两下: 第一下变「再点一下…」
const 两下 = (b, 话, f) => { b.onclick = () => { if (对话框.两下(b, 话)) Promise.resolve(f()).catch(报); }; return b; };
const 标角 = (av, n) => { if (n) av.appendChild(h('span', 'br-badge', n)); };
const 复制 = async (文, 钮, 选) => { try { await navigator.clipboard.writeText(文); 对话框.提示('已复制'); }
  catch (e) { if (选) { const r = document.createRange(); r.selectNodeContents(选); getSelection().removeAllRanges(); getSelection().addRange(r); } 对话框.提示('已选中, 按 Ctrl+C'); } };
const h = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const 时 = t => { if (!t) return ''; const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString()
  ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : (d.getMonth() + 1) + '/' + d.getDate(); };
const 界面 = {
  // 收着: 用户手动收起思考的那几条(思考默认展开)
  el: null, 输入: null, 当前: null, 收着: new Set(), 页: 'chats', 卡: null, 选: null, 搜: '', 活: new Map(), 状态: new Map(), 待: [], 抽: false, 未读: {},
  $: s => 界面.el.querySelector(s),
  装() {
    if (typeof document === 'undefined' || !ctx.root) return;
    ctx.root.style.height = '100%';
    if (colony.单独) { document.documentElement.style.height = document.body.style.height = '100%'; document.body.style.margin = '0'; ctx.root.style.height = '100vh'; }
    const el = 界面.el = h('div', 'br');
    el.innerHTML = '<div class="br-rail"><div class="me">C</div><button data-p="chats" title="会话">💬<span class="n br-hide"></span></button>'
      + '<button data-p="contacts" title="成员: 通讯录、加人、申请">👥</button><div class="sp"></div>'
      + '<button data-re title="重新看插件名单和 AI 配置">↻</button></div>'
      + '<div class="br-side"><div class="br-top"><input placeholder="搜索"><button data-new title="拉群">⊕</button></div><div class="br-list"></div></div>'
      + '<div class="br-main"><div class="br-head"><span class="n"></span><span class="c"></span><span class="sp"></span><button data-more title="群信息">⋯</button></div>'
      + '<div class="br-log"></div><div class="br-pane br-hide"></div>'
      + '<div class="br-box"><div class="br-tool"><button data-file title="发文件、图片、视频、音频">📎</button><span class="ats"></span><span class="sp"></span>'
      + '<label class="rl" title="打开后: 大家回完再轮着接着聊(轮数在 ⋯ 群设置里); 你插话就从头数; 都 PASS 就停"><input type="checkbox"> 接着聊 <span class="rn"></span></label></div>'
      + '<div class="br-pend"></div><div class="br-in"><textarea placeholder="说点什么… @名字 点名; 可粘贴、拖进图片和文件; Enter 发送, Shift+Enter 换行"></textarea>'
      + '<button data-stop class="br-hide">停</button><button data-send class="br-pri">发送</button></div></div></div>'
      + '<div class="br-mem br-hide"></div><input type="file" multiple class="br-hide">';
    ctx.root.replaceChildren(el);
    el.querySelectorAll('.br-rail [data-p]').forEach(b => { b.onclick = () => { 界面.页 = b.dataset.p; 界面.选 = null; 界面.卡 = null; 界面.全(); }; });
    el.querySelector('[data-re]').onclick = () => 成员.拉(true).then(() => 对话框.提示('通讯录刷新了')).catch(报);
    el.querySelector('[data-new]').onclick = () => { 界面.选 = 界面.选 ? null : []; 界面.页 = 'contacts'; 界面.全(); };
    el.querySelector('.br-top input').oninput = e => { 界面.搜 = e.target.value.trim().toLowerCase(); 界面.左(); };
    el.querySelector('[data-more]').onclick = () => { 界面.抽 = !界面.抽; 界面.右(); };
    el.querySelector('.rl input').onchange = e => { if (界面.当前) 会话.改({ chat: 界面.当前, relayOn: e.target.checked }).catch(报); };
    const ta = 界面.输入 = el.querySelector('.br-in textarea'), fi = el.querySelector('input[type=file]'); // 只认这一个: 资料页里还有人设框
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); 界面.发(); } };
    ta.onpaste = e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); 界面.收(fs); } };
    el.querySelector('[data-file]').onclick = () => fi.click();
    fi.onchange = () => { 界面.收([...fi.files]); fi.value = ''; };
    const 主 = el.querySelector('.br-main');
    let 层 = null;
    主.addEventListener('dragover', e => { if (!界面.当前 || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault();
      if (!层) { 层 = h('div', 'br-drop', '放开就加到这条消息里'); 主.appendChild(层); } });
    主.addEventListener('dragleave', e => { if (层 && !主.contains(e.relatedTarget)) { 层.remove(); 层 = null; } });
    主.addEventListener('drop', e => { if (层) { 层.remove(); 层 = null; } if (!界面.当前 || !e.dataTransfer.files.length) return; e.preventDefault(); 界面.收([...e.dataTransfer.files]); });
    el.querySelector('[data-send]').onclick = () => 界面.发();
    el.querySelector('[data-stop]').onclick = () => { if (界面.当前) 会话.停(界面.当前); };
    const 左 = () => { 界面.左(); 界面.右(); if (界面.页 === 'contacts') 界面.中(); }, 事 = (id, x) => 界面.事(id, x);
    成员.听者.add(左); 会话.听者.add(事); 好友.听者.add(左); 云端.听者.add(左);
    ctx.cleanup(() => { 成员.听者.delete(左); 会话.听者.delete(事); 好友.听者.delete(左); 云端.听者.delete(左); 界面.el = null; });
    界面.全();
    成员.拉().catch(() => { });
  },
  全() { 界面.el.querySelectorAll('.br-rail [data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === 界面.页)); 界面.左(); 界面.中(); 界面.右(); },
  行(头, 名, 小, 在, on) { // 列表里的一行: 头像(带在线点)、名字、一行小字
    const it = h('div', 'br-it' + (在 === false ? ' off' : '') + (on ? ' on' : '')), av = h('span', 'br-av', 头), t = h('span', 't');
    if (在 != null) av.appendChild(h('span', 'br-dot' + (在 ? '' : ' off')));
    t.append(h('b', '', 名), h('i', '', 小 || '')); it.append(av, t); return it;
  },
  async 左() {
    if (!界面.el) return;
    const L = 界面.$('.br-list'), 列 = [];
    界面.$('[data-new]').textContent = 界面.选 ? '×' : '⊕';
    const 未 = Object.values(界面.未读).reduce((a, b) => a + b, 0), 角 = 界面.$('[data-p="chats"] .n');
    角.textContent = 未 > 99 ? '99+' : 未; 角.classList.toggle('br-hide', !未);
    const 申数 = 好友.申请.length + 云端.申请().length; 界面.$('[data-p="contacts"]').style.color = 申数 ? '#fa5151' : '';
    if (界面.页 === 'chats') {
      const cs = (await 会话.列()).filter(c => !c.app && 界面.配(c)).sort((a, b) => b.at - a.at);
      if (!cs.length) 列.push(h('div', 'br-st', 界面.搜 ? '没找到' : '还没有会话: 去 👥 点一个人开聊, 或点 ⊕ 拉群'));
      cs.forEach(c => {
        const it = 界面.行((c.remote && c.remote.单) || (c.members.length === 1 && 会话.人(c.members[0])) ? '🙂' : c.remote ? '🌐' : c.members.length > 1 ? '👥' : 界面.头(c.members[0], c),
          c.name + (c.members.length > 1 ? ' (' + (c.members.length + (c.remote ? 0 : 1)) + ')' : ''), c.last || (c.remote && !c.remote.on ? '连接中…' : ''), null, c.id === 界面.当前);
        标角(it.firstChild, 界面.未读[c.id]); it.appendChild(h('span', 'tm', 时(c.at)));
        it.onclick = () => 界面.开(c.id);
        列.push(it);
      });
    } else {
      if (界面.选) 列.push(h('div', 'br-sec', '勾上要拉进群的成员'));
      else { const nf = 界面.行('＋', '加人', 申数 ? 申数 + ' 条申请等你通过' : '好友码、贴码、申请', null, !界面.卡); 标角(nf.firstChild, 申数);
        nf.onclick = () => { 界面.卡 = null; 界面.全(); }; 列.push(nf); }
      [['human', '好友'], ['agent', '电脑上的 agent'], ['cloud', '云端 agent'], ['model', 'AI 模型']].forEach(([k, n]) => {
        const ms = 成员.表.filter(m => (k === 'cloud' ? !!m.cloud : m.kind === k && !m.cloud) && 界面.配({ name: m.name }));
        if (!ms.length) return;
        列.push(h('div', 'br-sec', n + ' · ' + ms.length));
        ms.forEach(m => {
          const it = 界面.行(界面.头(m.id), m.name, m.kind === 'human' ? (m.online ? '在线' : '不在线 · 上线后自动收到')
            : (m.memory ? '有记忆' : '无记忆') + (m.备注 ? ' · ' + m.备注 : '') + (m.model ? ' · ' + m.model : ''), m.online, !界面.选 && 界面.卡 === m.id);
          if (界面.选) { const cb = h('input'); cb.type = 'checkbox'; cb.checked = 界面.选.includes(m.id); it.prepend(cb);
            it.onclick = e => { if (e.target !== cb) cb.checked = !cb.checked; cb.checked ? 界面.选.push(m.id) : 界面.选.splice(界面.选.indexOf(m.id), 1); 界面.建钮(); }; }
          else it.onclick = () => { 界面.卡 = m.id; 界面.全(); };
          列.push(it);
        });
      });
      if (!成员.表.length) 列.push(h('div', 'br-st', '通讯录是空的: 在 Colony Bridge 插件里接 agent, 或在 AI 配置里加厂商; 也能点上面「加人」加好友'));
      if (界面.选) {
        const b = h('button', 'br-pri'); b.dataset.mk = 1; b.style.cssText = 'margin:10px 2px;width:calc(100% - 4px)';
        b.onclick = async () => { if (!界面.选.length) return; const c = await 会话.开({ with: 界面.选, new: true }); 界面.选 = null; 界面.页 = 'chats'; 界面.全(); 界面.开(c.id); };
        列.push(b);
      }
    }
    L.replaceChildren(...列);
    if (界面.选) 界面.建钮();
  },
  加人() { // 我的好友码 + 一个贴码框 + 收到的申请 + 接 agent 去插件
    const p = 界面.$('.br-pane'), me = 好友.我;
    p.innerHTML = '<h3>我的好友码</h3><p>发给朋友, 他贴进自己的桥, 你通过后就互相在通讯录里了。码里带你收件箱的钥匙, 只发给信得过的人。</p>'
      + '<div class="row"><span style="color:var(--b-mu)">我叫</span><input data-me><button data-me-ok>改名</button></div><pre data-code></pre><div class="row"><button data-cp class="br-pri">复制好友码</button></div>'
      + '<h3 style="margin-top:24px">贴码加进来</h3><p>好友码 colony-fr:…(加好友)、群邀请码 colony-br:…(进他的群)、云端桥地址 https://…</p>'
      + '<div class="row"><input data-code-in placeholder="colony-fr:… / colony-br:… / https://…"><input data-msg placeholder="附一句(加好友时)" style="flex:0 0 140px"><button data-join class="br-pri">加进来</button></div>'
      + '<h3 style="margin-top:24px">申请</h3><div data-req></div>'
      + '<h3 style="margin-top:24px">接 agent</h3><p>电脑上的 agent(hermes、Claude Code、Codex…)和云端 agent 都在 <b>Colony Bridge 插件</b>里接: 点浏览器右上角的插件图标, 复制接入指令发给 agent, 它接好、你在插件里点通过, 这里的通讯录就自己有了。</p>';
    if (me) { p.querySelector('[data-me]').value = me.name; p.querySelector('[data-code]').textContent = 好友.码(); }
    else p.querySelector('[data-code]').textContent = '正在连中转…';
    p.querySelector('[data-me-ok]').onclick = () => { const n = p.querySelector('[data-me]').value.trim(); if (n) 好友.改名(n).then(() => 对话框.提示('改好了')); };
    p.querySelector('[data-cp]').onclick = () => me && 复制(好友.码(), null, p.querySelector('[data-code]'));
    p.querySelector('[data-join]').onclick = async e => {
      const b = e.target, v = p.querySelector('[data-code-in]').value.trim(); if (!v) return;
      b.disabled = true;
      try {
        const 群 = /colony-br:/.test(v) && await 问('你在群里叫什么(别人看到的)', me && me.name || '客人'); if (群 === null) return;
        const r = await 贴码(v, { msg: p.querySelector('[data-msg]').value.trim(), name: (群 || '').trim() || '客人' });
        if (群 !== false) { 界面.页 = 'chats'; 界面.全(); return 界面.开(r.id); }
        对话框.提示(/colony-fr:/.test(v) ? (r.already ? '「' + r.name + '」已经是好友了' : '申请发出去了, 等对方通过') : '连上云端桥了');
        p.querySelector('[data-code-in]').value = '';
      } catch (x) { 报(x); } finally { b.disabled = false; }
    };
    const req = p.querySelector('[data-req]'), 行 = (头, 字, 钮) => { const r = h('div', 'row'); r.append(h('span', 'br-av', 头)); const t = h('span', '', 字); t.style.flex = '1'; r.append(t);
      钮.forEach(([n, f], i) => { const b = h('button', i ? '' : 'br-pri', n); b.onclick = () => Promise.resolve(f()).catch(报); r.append(b); }); req.appendChild(r); };
    好友.申请.forEach(q => 行('🙂', q.name + (q.msg ? ' : ' + q.msg : ''), [['通过', () => 好友.通过(q.uid)], ['忽略', () => 好友.拒(q.uid)]]));
    云端.申请().forEach(q => 行('☁', (q.name || q.pendingId.slice(0, 8)) + ' · 云端 agent', [['通过', () => 云端.批(q.base, q.pendingId, true)], ['拒绝', () => 云端.批(q.base, q.pendingId, false)]]));
    好友.发出.forEach(x => 行('…', '发出去的申请 → ' + x.uid.slice(0, 6) + '… 等通过', [['撤回', async () => { 好友.发出 = 好友.发出.filter(y => y !== x); await 好友.存(); 界面.中(); }]]));
    if (!req.children.length) req.appendChild(h('p', '', '没有待处理的申请'));
  },
  名片() { // 成员资料: 发消息、名字、人设、模型、删
    const p = 界面.$('.br-pane'), m = 成员.表.find(x => x.id === 界面.卡);
    if (!m) { 界面.卡 = null; return 界面.加人(); }
    const 种 = m.kind === 'human' ? '好友(真人)' : m.cloud ? '云端 agent' : m.kind === 'agent' ? '电脑上的 agent' : 'AI 模型 · ' + m.provider;
    p.innerHTML = '<div class="row" style="gap:14px;margin-bottom:14px"><span class="br-av" style="width:56px;height:56px;font-size:26px"></span><div style="flex:1"><h3 class="nm"></h3><p class="sub" style="margin:2px 0"></p></div>'
      + '<button data-chat class="br-pri">发消息</button></div>'
      + '<h3>名字</h3><div class="row"><input data-n><button data-n-ok>改名</button></div><p class="nt"></p>'
      + '<div data-adv><h3 style="margin-top:18px">人设(系统提示)</h3><p>它在所有会话里都按这个来; 有记忆的 agent 改了下一条会被告知。留空 = 它平常的样子。</p>'
      + '<textarea data-persona rows="6"></textarea><div class="row"><button data-persona-ok>保存人设</button></div>'
      + '<h3 style="margin-top:18px">模型</h3><div class="row"><select data-m style="flex:1"></select><button data-m-ok>用这个</button></div><p class="mt"></p></div>';
    p.querySelector('.br-av').textContent = 界面.头(m.id);
    p.querySelector('.nm').textContent = m.name;
    p.querySelector('.sub').textContent = 种 + (m.online ? ' · 在线' : ' · 不在线') + (m.memory ? ' · 有记忆' : '') + (m.model ? ' · ' + m.model : '') + (m.备注 ? ' · ' + m.备注 : '');
    p.querySelector('[data-chat]').onclick = () => 会话.开({ with: [m.id] }).then(c => { 界面.页 = 'chats'; 界面.全(); 界面.开(c.id); }).catch(报);
    if (m.kind !== 'model') p.querySelector('[data-chat]').after(两下(h('button', '', '删掉'), '删掉「' + m.name + '」', () => 投递.删(m).then(() => { 界面.卡 = null; 界面.全(); })));
    const ni = p.querySelector('[data-n]'); ni.value = m.name;
    p.querySelector('.nt').textContent = m.id.startsWith('ep:') ? '会同步改插件名单, 下一条消息告诉它新名字' : m.kind === 'human' ? '只是你这边的备注名' : '桥里的显示名; 下一条消息告诉它新名字';
    p.querySelector('[data-n-ok]').onclick = () => 成员.改(m.id, { name: ni.value }).then(() => 对话框.提示('改好了')).catch(报);
    if (m.kind === 'human') return p.querySelector('[data-adv]').remove();
    const ta = p.querySelector('[data-persona]'); ta.value = m.persona || ''; ta.placeholder = '比如: 你是个说话简短、爱抬杠的数学老师。每次回答不超过三句。';
    p.querySelector('[data-persona-ok]').onclick = () => 成员.改(m.id, { persona: ta.value }).then(() => 对话框.提示(ta.value.trim() ? '人设存好了' : '人设取消了')).catch(报);
    const sel = p.querySelector('[data-m]'), 默认 = m.默认模型 || m.model || '';
    sel.innerHTML = '<option value="">默认(' + 转义(默认 || '它自己定') + ')</option>';
    成员.模型(m).then(l => { l.forEach(x => { const o = h('option', '', x); o.value = x; sel.appendChild(o); }); sel.value = (成员.设[m.id] || {}).model || '';
      if (!l.length) p.querySelector('.mt').textContent = m.cloud ? '云端 agent 的模型由它自己定' : '没列出可换的模型'; });
    p.querySelector('[data-m-ok]').onclick = () => 成员.改(m.id, { model: sel.value }).then(() => 对话框.提示('下一条起用 ' + (sel.value || '默认'))).catch(报);
  },
  中() {
    if (!界面.el) return;
    const log = 界面.$('.br-log'), pane = 界面.$('.br-pane'), id = 界面.当前, 卡 = 界面.页 === 'contacts',
      c = !卡 && id && (会话.目录 || []).find(x => x.id === id);
    log.classList.toggle('br-hide', 卡); pane.classList.toggle('br-hide', !卡);
    界面.$('.br-head .n').textContent = 卡 ? (界面.卡 ? '成员资料' : '加人') : c ? c.name : 'agent 桥接';
    界面.$('.br-head .c').textContent = !卡 && c ? (c.members.length > 1 || c.room || c.remote ? '(' + (c.members.length + (c.remote ? 0 : 1)) + ')' : '')
      + (c.room ? ' · 🌐 有人可进' : c.remote ? (c.remote.kicked ? ' · 已离开' : c.remote.on ? ' · 🌐 已连上房主' : ' · 连接中…') : '') : '';
    界面.$('[data-more]').classList.toggle('br-hide', 卡 || !c);
    界面.$('.br-box').classList.toggle('br-hide', 卡 || !c);
    if (卡) return 界面.卡 ? 界面.名片() : 界面.加人();
    if (!c) {
      log.replaceChildren(h('div', 'br-empty', '和电脑上的 agent、AI 模型聊天, 也能把几个拉进一个群\n👥 通讯录点一个开聊, ⊕ 勾几个建群; agent 在 Colony Bridge 插件里接'));
      return;
    }
    const 列 = (会话.记录.get(id) || []).map(e => 界面.泡(c, e));
    界面.活.forEach((v, who) => 列.push(界面.泡(c, { from: who, text: v.text || (v.think || (v.tools || []).length ? '' : '…'), think: v.think, tools: v.tools }, true)));
    界面.状态.forEach(s => 列.push(h('div', 'br-st', s)));
    const 底 = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren(...列);
    if (底 || log.dataset.c !== id) log.scrollTop = log.scrollHeight;
    log.dataset.c = id;
    const ats = 界面.$('.ats'), 条 = [];
    const 可点 = c.members.filter(x => !(c.remote && x === 'h:' + c.remote.gid));
    if (可点.length > 1 || c.room || c.remote) [['@所有人', '@所有人 ']].concat(可点.map(x => ['@' + 会话.名(c, x), '@' + 会话.名(c, x) + ' '])).forEach(([n, v]) => {
      const s = h('button', 'at', n);
      s.onclick = () => { const ta = 界面.输入; ta.value = v + ta.value; ta.focus(); };
      条.push(s);
    });
    ats.replaceChildren(...条);
    界面.$('.rl').classList.toggle('br-hide', !!c.remote || 会话.能答(c).length < 2);
    界面.$('.rl input').checked = !!c.接着; 界面.$('.rl .rn').textContent = c.接着 ? '(' + (c.接力 || 3) + ' 轮)' : '';
    界面.$('[data-stop]').classList.toggle('br-hide', ![...会话.跑.keys()].some(k => k.startsWith(id + ':')));
  },
  事(id, x) {
    if (!界面.el) return;
    if (x && x.i && x.from !== 'user' && id !== 界面.当前 && x.from !== 'note') 界面.未读[id] = (界面.未读[id] || 0) + 1;
    if (x === 'file') return 界面.中();
    if (typeof x === 'string' || (x && x.i)) 界面.左();
    if (x === 'closed' && id === 界面.当前) { 界面.当前 = null; 界面.抽 = false; 界面.中(); 界面.右(); }
    if (id !== 界面.当前) return;
    const c = (会话.目录 || []).find(y => y.id === id);
    if (x && x.typing) { 界面.活.set(x.typing, Object.assign(界面.活.get(x.typing) || {}, { text: x.text })); 界面.状态.delete(x.typing); }
    else if (x && x.live) { 界面.活.set(x.live, Object.assign(界面.活.get(x.live) || {}, { think: x.think, tools: x.tools })); 界面.状态.delete(x.live); }
    else if (x && x.thinking) 界面.状态.set(x.thinking, x.name + ' 在想…');
    else if (x && x.done) { 界面.活.delete(x.done); 界面.状态.delete(x.done); }
    else if (x && x.pass) {
      界面.活.delete(x.pass); 界面.状态.set(x.pass + '.p', 会话.名(c, x.pass) + ' 没有要说的');
      setTimeout(() => { 界面.状态.delete(x.pass + '.p'); 界面.中(); }, 2500);
    }
    if (x === 'members') { 界面.右(); 界面.左(); }
    界面.中();
  },
  泡(c, e, live) {
    if (e.from === 'note') return h('div', 'br-st', e.text);
    const me = c.remote ? e.from === 'h:' + c.remote.gid : e.from === 'user', d = h('div', 'br-msg' + (me ? ' me' : '') + (e.error ? ' err' : '') + (live ? ' live' : '')), w = h('div');
    if (!me) d.appendChild(h('span', 'br-av', 界面.头(e.from, c)));
    if (!me && (c.members.length > 1 || c.room || c.remote)) w.appendChild(h('div', 'who', 会话.名(c, e.from)));
    if (e.think) { const d2 = h('details', 'br-think'); d2.open = !界面.收着.has(e.i); d2.append(h('summary', '', (live && !e.text ? '💭 在想… ' : '💭 思考 ') + e.think.length + ' 字'), h('div', '', e.think));
      d2.ontoggle = () => { if (e.i) d2.open ? 界面.收着.delete(e.i) : 界面.收着.add(e.i); }; w.appendChild(d2); }
    if (e.tools && e.tools.length) { const ts = h('div', 'br-tools'); e.tools.forEach(t => ts.appendChild(h('div', t.status === 'completed' ? 'ok' : t.status === 'running' ? 'run' : 'err',
      (t.emoji || '🔧') + ' ' + t.name + (t.label ? ' · ' + t.label : '') + (t.status === 'running' ? ' …' : t.status === 'completed' ? ' ✓' : ' ✗')))); w.appendChild(ts); }
    if (e.text) { const bx = h('div', 'bx'); if (me || live) bx.textContent = e.text; else bx.innerHTML = 轻md(转义(e.text)); w.appendChild(bx); }
    if (e.files && e.files.length) { const fs = h('div', 'br-fs'); e.files.forEach(f => fs.appendChild(界面.件(f, c))); w.appendChild(fs); }
    d.appendChild(w);
    return d;
  },
  件(f, c) { // 一个附件怎么画: 图、视频、音频直接放, 别的是一张卡; 进的别人的群, 本地没有就向房主要
    const 类 = 附件.类(f), 卡 = () => { const k = h('div', 'br-fc'); k.append(h('span', '', 类 === 'text' ? '📄' : '📦'), h('b', '', f.name), h('i', '', 附件.尺(f.size))); return k; };
    if (f.big || !['image', 'video', 'audio'].includes(类)) return 卡();
    const el = h(类 === 'image' ? 'img' : 类);
    if (类 !== 'image') el.controls = true;
    el.title = f.name;
    附件.取(f).then(v => { if (v) el.src = v; else if (c && c.remote) { 房间.要文件(c, f.key); el.replaceWith(h('div', 'br-fc', '⏳ ' + f.name)); } else el.replaceWith(卡()); });
    if (类 === 'image') el.onclick = () => window.open().document.write('<img src="' + el.src + '" style="max-width:100%">');
    return el;
  },
  async 开(id) {
    界面.当前 = id; 界面.活.clear(); 界面.状态.clear(); delete 界面.未读[id];
    if (界面.页 !== 'chats') { 界面.页 = 'chats'; 界面.el.querySelectorAll('.br-rail [data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === 'chats')); }
    await 会话.取(id); 界面.左(); 界面.中(); 界面.右();
    界面.输入.focus();
  },
  头(id, c) {
    if (id === 'note') return '·';
    if (会话.人(id)) return '🙂';
    const k = (c && c.kinds && c.kinds[id]) || (成员.表.find(x => x.id === id) || {}).kind;
    if (String(id).startsWith('cl:')) return '☁';
    return k === 'agent' ? '🤖' : k === 'model' ? '✦' : '·';
  },
  配(c) { return !界面.搜 || [c.name].concat(c.members ? c.members.map(x => 会话.名(c, x)) : []).some(s => String(s).toLowerCase().includes(界面.搜)); },
  建钮() { const b = 界面.$('[data-mk]'); if (b) { b.textContent = '建群(' + 界面.选.length + ' 位)'; b.disabled = !界面.选.length; } },
  右() { // 群信息抽屉: 点 ⋯ 才开
    if (!界面.el) return;
    const p = 界面.$('.br-mem'), c = 界面.当前 && 界面.页 === 'chats' && (会话.目录 || []).find(x => x.id === 界面.当前);
    p.classList.toggle('br-hide', !界面.抽 || !c);
    if (!界面.抽 || !c) return p.replaceChildren();
    const 人们 = (c.remote ? ['user'] : ['user']).concat(c.members);
    const 列 = [h('h4', '', '成员 · ' + 人们.length)], g = h('div', 'br-grid');
    人们.forEach(id => {
      const it = h('div', 'g');
      it.append(h('span', 'br-av', id === 'user' ? (c.remote ? '🙂' : '🙂') : 界面.头(id, c)), h('span', '', 会话.名(c, id) + (id === 'user' && !c.remote ? '(我)' : '')));
      if (id !== 'user' && 成员.表.some(x => x.id === id)) it.onclick = () => { 界面.页 = 'contacts'; 界面.卡 = id; 界面.抽 = false; 界面.全(); };
      if (!c.remote && id !== 'user' && c.members.length > 1) { const x = h('button', 'x', '×'); x.title = '移出'; x.onclick = e => { e.stopPropagation(); 会话.改({ chat: c.id, remove: [id] }); }; it.appendChild(x); }
      g.appendChild(it);
    });
    const 外 = c.remote ? [] : 成员.表.filter(m => !c.members.includes(m.id));
    if (外.length) {
      const add = h('div', 'g add'); add.append(h('span', 'br-av', '＋'), h('span', '', '拉人'));
      add.onclick = () => { 列表.classList.toggle('br-hide'); };
      g.appendChild(add);
    }
    列.push(g);
    const 列表 = h('div', 'br-hide');
    外.forEach(m => {
      const it = h('div', 'br-it' + (m.online ? '' : ' off'));
      it.append(h('span', 'br-av', 界面.头(m.id)), h('span', 't', m.name + (m.online ? '' : ' (没接上)')));
      it.onclick = () => 会话.改({ chat: c.id, add: [m.id] }).catch(报);
      列表.appendChild(it);
    });
    列.push(列表);
    if (!c.remote) { // 邀请真人: 生成邀请码, 对方在他的桥里 👥 → 加人 贴进来
      列.push(h('h4', '', '邀请码(不加好友也能进)'));
      const box = h('div');
      if (c.room) {
        const code = 房间.码(c), pre = h('pre', '', code), cp = h('button', 'br-pri', '复制邀请码');
        pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:11px;margin:0 0 6px;padding:8px;background:rgba(255,255,255,.04);border-radius:6px';
        cp.onclick = () => 复制(code, null, pre);
        const nm = h('div', 'kv'); nm.append(h('span', '', '我在群里叫'), h('span', '', c.room.me));
        nm.onclick = async () => { const n = await 问('你在这个群里的名字(别人看到的)', c.room.me); if (n && n.trim()) 房间.开房(c, n.trim()).then(() => 界面.右()); };
        box.append(pre, cp, nm, h('div', 'br-st', '发给朋友: 他在自己的桥里 👥 → 加人, 贴进去就进来了。码里带钥匙, 只发给信得过的人'));
      } else {
        const b = h('button', '', '生成邀请码');
        b.onclick = async () => { const n = await 问('你在群里叫什么(别人看到的)', '房主'); if (n === null) return; await 房间.开房(c, n.trim() || '房主'); 界面.右(); 界面.中(); };
        box.append(b, h('div', 'br-st', '生成后别人拿码就能进这个群, 和这里的 agent 一起聊'));
      }
      列.push(box);
    }
    列.push(h('h4', '', '群信息'));
    const kv = (k, v, f) => { const r = h('div', 'kv'); r.append(h('span', '', k), h('span', '', v || '未设置')); r.onclick = f; return r; };
    if (c.remote) {
      列.push(kv('名称', c.name, () => { }), kv('我在群里叫', c.remote.me, () => { }));
      列.push(h('div', 'br-st', '这是别人开的群: 记录在房主那里, 这边是镜子; 拉人、改名要房主来'));
    } else {
      列.push(kv('名称', c.name, async () => { const n = await 问('会话名', c.name); if (n && n.trim()) 会话.改({ chat: c.id, name: n.trim() }); }));
      列.push(kv('话题', c.topic, async () => { const n = await 问('告诉成员这里聊什么(会写进给他们的介绍)', c.topic || ''); if (n != null) 会话.改({ chat: c.id, topic: n.trim() }); }));
      if (会话.能答(c).length > 1) 列.push(kv('接着聊几轮', (c.接力 || 3) + ' 轮' + (c.接着 ? ' · 开着' : ' · 关着'), async () => {
        const n = await 问('输入框旁「接着聊」打开时, 大家回完再轮着聊几轮(1-20)? 你插话就从头数, 都 PASS 就停', c.接力 || 3);
        if (n != null && +n > 0) 会话.改({ chat: c.id, relay: +n }); }));
      const clr = 两下(h('button', '', '清空聊天记录'), '清空(agent 从头开始)', () => 会话.清(c.id)); clr.style.cssText = 'margin-top:16px;width:100%';
      列.push(clr);
    }
    const del = 两下(h('button', '', c.remote ? '退出并删除' : c.room ? '解散并删除' : '删除会话'), '删除(记录一起删)', () => 会话.删(c.id)); del.style.cssText = 'margin-top:8px;width:100%;color:#ff8a80';
    列.push(del);
    p.replaceChildren(...列);
  },
  async 收(fs) {
    for (const f of fs) {
      const chip = h('div', 'br-chip'); chip.append(h('span', '', '读取 ' + f.name + '…'));
      界面.$('.br-pend').appendChild(chip);
      try {
        const rec = await 附件.收(f); 界面.待.push(rec);
        chip.replaceChildren();
        if (附件.类(rec) === 'image' && !rec.big) { const im = h('img'); 附件.取(rec).then(v => { im.src = v; }); chip.appendChild(im); }
        chip.append(h('span', '', rec.name + ' · ' + 附件.尺(rec.size) + (rec.big ? ' (太大, 只发名字)' : '')));
        const x = h('button', '', '×'); x.onclick = () => { 界面.待 = 界面.待.filter(y => y !== rec); 附件.删(rec); chip.remove(); };
        chip.appendChild(x);
      } catch (e) { chip.textContent = f.name + ' 读不了: ' + e.message; }
    }
  },
  发() {
    const ta = 界面.输入, t = ta.value.trim(), id = 界面.当前, files = 界面.待.splice(0);
    if ((!t && !files.length) || !id) return;
    ta.value = ''; 界面.$('.br-pend').replaceChildren();
    会话.说({ chat: id, text: t, files }).catch(e => { 界面.状态.set('err', e.message); 界面.中(); });
  },
};
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【多 agent 应用】要做让几个 agent(接口)一起干活的小应用时(竞技、评审、出题打分、辩论、规则游戏、分工协作…, 类型不限):
//   先读 petri:ui 的「写小应用」; 要跑选手写的 HTML 就再读 petri:plugin-manager 的「作品运行窗」。桌面上有三个样板, 照着改最快:
//   答题擂台(并行作答 + 匿名互评)、作品擂台(写 HTML → 运行窗里点和截图 → 评审)、棋局擂台(应用当裁判, 非法步退回)。apps.get 读它们的代码。
//   ① 选人: bridge.pick {n, why} 弹框让用户勾(勾过的就授权给这个应用了, 以后 bridge.contacts 就看得到, 不用再弹); 过滤掉 kind:'human'(真人不能 ask)。
//      agent 自测时不点框: 先给它 pick 授权一次, 应用里留一个 window.设(选手, 评审) 直接塞成员。
//   ② 问: bridge.ask {to, session, system, text, files}。session 定隔离: 每局 × 每人 × 每个角色一个(局号-角色-成员id), 同一个 session 才记得前文;
//      互不该看到的(选手之间、评审和选手)一定用不同 session。并行用 Promise.all, 3 人约 20 秒; 评审一个 session 一次看完所有答卷比一份份问稳。
//   ③ 公平: 匿名号(答卷A、B…)和作者的对应只留在应用里, 顺序洗牌; 评审不评自己; 评审 ≥3 人时去掉最高最低再平均。
//      有长期记忆的 agent(hermes)换了 session 还会带出它的用户档案和以前聊过的东西: 要求盲测的比赛别让它当选手兼评审, 或在结果里注明。
//   ④ 回复要机器读的: system 里写「只输出 JSON」并在 text 末尾给出要填的 JSON 样子(带上每个键名); 用正则抠第一个 {…} 再 JSON.parse, agent 常在前后多说几句。
//      抠不出或缺项就换个 session 再问一次(同 session 它会照着自己上次的错); 两次都不行就记「没交 / 不计」继续, 别让一个人拖住整局。
//   ⑤ 规则游戏: 局面只放在应用里, 每步只收一个动作(坐标 / 选项), 应用判合法; 不合法把原因写进下一句退回重来(最多 3 次再判负);
//      每步把整个局面用文字画给它(它可能不记得), 并给出对手上一步。调用失败(超时、限流)也算一次退回。
//   ⑥ 作品: 让它「只回代码, 放在 ```html 代码块里」; 应用抠代码块; 运行窗 runOpen 回 text + controls(能点的东西和 label), 交给测试员 agent 设计步骤,
//      应用照 runAct 做并记下每步之后的页面字, 再 runShot 截图 → bridge.file 存成附件 → 评审拿代码 + 运行记录 + 截图打分。用完 runClose。
//   ⑦ 耗时和失败照实显示(每人一个状态: 作答中 / ✓ 几秒 / ✗ 原因); 赛果只存摘要到 store(最近 20-30 局), 别存截图。真人要参赛就拉进会话(bridge.open / say)。
//   ⑧ 让人看得懂: 每位选手一个座位, 答卷先封着再开卷, 评语一条条飞到被评的答卷下, 从低到高亮分; 模型回的 **加粗** 等 markdown 符号先去掉。
//      小应用没 pick 授权就 ask 会报「这个应用没被允许用」: 让用户在弹框里勾一次, 勾的可能是同名的另一位(如「阶跃plan」), 用 pick 回的 id。
// ═ 自报 ═
// 和电脑上的 agent(Colony Bridge 插件里接上的 hermes / openclaw / 网关)、跨网的云端 agent、AI 配置里的模型、加了好友的真人单聊、拉群, 能发图片、视频、音频和文件;
// 也能把外部 agent 接成厂商当全能 agent 的大脑(bridge.connect)。有记忆的 agent 只收它没见过的话。小应用用 bridge.pick 让用户选人, 再 bridge.ask / open / say。
// 本机和云端 agent 在 Colony Bridge 插件里接、批(接入指令也在那里), 名单变了这边自己刷新; 真人用 bridge.join 贴好友码、群邀请码, bridge.invite 拿我的码;
// 管人用 bridge.member(改名、人设、换模型、删、通过申请); 真人经公共 MQTT 中转, 端到端加密, 群由开群的这边当房主。
// 单独打开(没有别的块)也能用: 通讯录是插件里的 agent、云端 agent 和好友, 就是一个能和 agent 一起聊的小 IM。没有 AI 配置块时桥顶上
// 数据 {"prefix": "bridge.cursors", "label": "送达游标(每个会话 × 外部 agent 发到了哪条)", "kind": "state", "edit": "bridge.connect"}
// 数据 {"prefix": "bridge.chat", "label": "会话目录和聊天记录", "kind": "data", "edit": "bridge.close"}
// 数据 {"prefix": "bridge.file.", "label": "聊天里的附件(没进记录的 24 小时后自己清)", "kind": "data", "edit": "bridge.close"}
// 数据 {"prefix": "bridge.files.loose", "label": "还没进会话记录的附件和存的时刻", "kind": "state"}
// 数据 {"prefix": "bridge.me", "label": "我的身份和好友码", "kind": "config", "edit": "bridge.member"}
// 数据 {"prefix": "bridge.friends", "label": "好友", "kind": "config", "edit": "bridge.member"}
// 数据 {"prefix": "bridge.requests", "label": "收到的好友申请", "kind": "data", "edit": "bridge.member"}
// 数据 {"prefix": "bridge.sent", "label": "发出去等通过的申请", "kind": "data"}
// 数据 {"prefix": "bridge.members.cfg", "label": "成员设置(备注名、人设、模型)", "kind": "config", "edit": "bridge.member"}
// 数据 {"prefix": "bridge.cloud", "label": "云端桥地址和离线留言的去处", "kind": "config", "edit": "bridge.join"}
// 数据 {"prefix": "bridge.grants", "label": "哪个小应用能用哪些成员", "kind": "config", "edit": "bridge.member"}
// 数据 {"prefix": "bridge.rooms", "label": "群(房主和客人)的钥匙", "kind": "config"}
// ═ 装配 ═
// 13 个能力。小应用(隔离窗)能调的: contacts(只看给了它的成员) pick ask open say read stop close file, 都只碰给了它的成员和它自己开的会话;
// member join invite connect 只给块和 agent(管人、加人、拿码、接厂商)
const 查 = async (meta, c) => { const app = 授权.谁(meta); if (app && c.app !== app) throw new Error('这个会话不是这个应用开的'); return app; };
const 条 = (c, e) => ({ i: e.i, from: e.from, name: 会话.名(c, e.from), text: e.text, files: e.files, error: e.error || undefined, at: e.at });
const 申请表 = () => 好友.申请.map(q => ({ id: 'req:h:' + q.uid, kind: 'human', name: q.name, msg: q.msg }))
  .concat(云端.申请().map(p => ({ id: 'req:cl:' + p.pendingId, kind: 'agent', name: p.name, webhook: !!p.webhook, base: p.base })));
ctx.provide('bridge.contacts', async (a, meta) => {
  a = a || {}; const app = 授权.谁(meta), w = app ? 'members' : (a.what || 'members');
  if (w === 'requests') return 申请表();
  if (w === 'me') return { uid: 好友.我.uid, name: 好友.我.name, code: 好友.码(), sent: 好友.发出.map(x => 'h:' + x.uid) };
  if (w === 'grants') { const t = await 授权.读(), out = []; for (const k of Object.keys(t)) out.push({ app: k, name: await 授权.应用名(k), members: t[k] }); return out; }
  if (w === 'bridges') { const 出 = []; 云端.连.forEach(c => 出.push({ base: c.b.base, online: c.on, revoked: c.revoked.map(m => ({ id: 'cl:' + m.agentKey, name: m.name })) })); return 出; }
  const ms = await 成员.拉(!!a.refresh), t = app ? ((await 授权.读())[app] || []) : null;
  return ms.filter(m => (!a.kind || m.kind === a.kind) && (!t || t.includes(m.id))).map(成员.公开);
}, {
  desc: '通讯录: 本机 agent(经插件)、云端 agent、AI 配置里的模型、加了好友的真人, 带在线、有没有记忆。小应用只看得到用户给了它的(没给过先 bridge.pick)。'
    + 'what 看别的: requests 待通过的好友和云端申请(id 是 req:…, 用 bridge.member accept), me 我的名字和好友码, grants 哪些小应用能用谁, bridges 连着的云端桥和撤销了的成员',
  schema: { what: 'string?(members|requests|me|grants|bridges)', kind: 'string?(agent|model|human)', refresh: 'boolean?' }, frames: true, common: true,
});
ctx.provide('bridge.member', async a => {
  const id = String(a.id || '');
  if (a.app) { await 授权.收(a.app, id || undefined); return { app: a.app, member: id || '全部' }; }   // 收回小应用的授权
  if (id === 'me') { if (a.name) await 好友.改名(a.name); return { name: 好友.我.name, code: 好友.码() }; }
  if (id.startsWith('req:')) { // 申请: accept true 通过, false 忽略
    const [, k, x] = /^req:(h|cl):(.+)$/.exec(id) || [];
    if (k === 'h') await (a.accept === false ? 好友.拒(x) : 好友.通过(x));
    else if (k === 'cl') { const q = 云端.申请().find(p => p.pendingId === x); if (!q) throw new Error('没有这条申请'); await 云端.批(q.base, x, a.accept !== false); }
    else throw new Error('不认识的申请: ' + id);
    return { ok: true };
  }
  if (/^https?:\/\//.test(id)) { if (!a.remove) throw new Error('云端桥只能 remove'); await 云端.删桥(id.replace(/\/+$/, '')); return { ok: true }; }
  if (a.revoke || a.restore) { await 云端.管(id, a.revoke ? 'revoke' : 'reapprove'); return { ok: true }; }
  if (a.remove) { await 投递.删(await 成员.找(id)); return { ok: true }; }
  if (a.models) return { models: await 成员.模型(await 成员.找(id)) };
  return 成员.改(id, a);
}, {
  desc: '管一位成员: name 改名(本机 agent 同步改插件名单, 下一条告诉它), persona 人设/系统提示(空串取消), model 换模型(空串默认), models:true 列能换的模型, remove 删掉(好友、本机 agent、云端成员); '
    + '云端成员 revoke 撤销 / restore 恢复。id 是 req:… 时 accept true/false 通过或忽略申请; id 是 me 改我在好友那边的名字; id 是云端桥地址 + remove 断开那座桥; 给 app 收回那个小应用的授权(给 id 只收这一位)',
  schema: { id: 'string', name: 'string?', persona: 'string?', model: 'string?', models: 'boolean?', remove: 'boolean?', revoke: 'boolean?', restore: 'boolean?', accept: 'boolean?', app: 'string?' }, frames: false,
});
ctx.provide('bridge.join', a => 贴码(a.code, a), {
  desc: '贴别人给的码加进来, 自动认: 好友码 colony-fr:…(发好友申请, msg 附一句)、群邀请码 colony-br:…(进他的群, name 是你在群里的名字)、云端桥地址 https://…(token 可选)。'
    + '本机和云端 agent 在 Colony Bridge 插件里接、批(接入指令也在那里), 接好了通讯录自己有',
  schema: { code: 'string', name: 'string?', msg: 'string?', token: 'string?' }, frames: false,
});
ctx.provide('bridge.invite', async a => {
  if (a.kind === 'friend') return { kind: 'friend', code: 好友.码(), name: 好友.我.name };
  if (a.kind !== 'room') throw new Error('kind 给 friend 或 room; agent 的接入指令在 Colony Bridge 插件里');
  const c = await 会话.取(a.chat); if (c.remote) throw new Error('这是别人的群');
  const code = await 房间.开房(c, a.name); 会话.变(c.id, 'members'); return { kind: 'room', code, me: c.room.me };
}, {
  desc: '拿给真人的码: friend 我的好友码; room 这个会话(chat)的群邀请码, 别人用 bridge.join 进来, name 是你在群里的名字。agent 的接入指令在 Colony Bridge 插件里',
  schema: { kind: 'string(friend|room)', chat: 'string?', name: 'string?' }, frames: false,
});
ctx.provide('bridge.pick', async (a, meta) => {
  const app = 授权.谁(meta) || 'agent', ids = await 授权.弹(a || {}, app);
  if (app !== 'agent' && ids.length) await 授权.给(app, ids);
  return (await 成员.拉()).filter(m => ids.includes(m.id)).map(成员.公开);
}, {
  desc: '弹选人框让用户挑成员给这个应用用(勾上的就授权了, 以后不用再问); 回挑中的 [{id, name, kind, memory, online}], 取消回 []',
  schema: { n: 'number?(想要几位)', kind: 'string?(agent|model|human)', why: 'string?(给用户看的理由)' }, frames: true,
});
// stream: 回一个异步迭代器, 一条条推 {text: 到此为止的字} / {think: 到此为止的思考} / {tool: {id,name,label,emoji,status}}, 最后一条 {done: 结果}
// (结果和不流时一样); 字和思考 80ms 合一次推, 工具步骤立刻推。小应用里 colony.call('bridge.ask', {..., stream: true}, 每条 => …) 收
// 叫停: ask 带 id 时登记一个中止器, bridge.stop {ask: id} 断开(对方那边的请求也断); 同一个应用只能停自己的
const 在问 = new Map();
const 问一句 = async (a, meta, on, 动) => {
  const app = 授权.谁(meta), m = await 成员.找(a.to);
  await 授权.要(app, m.id);
  const 号 = a.id ? (app || 'agent') + ':' + a.id : null, ac = new AbortController();
  if (号) 在问.set(号, ac);
  try { return await 问一句里(a, app, m, on, 动, ac.signal); }
  catch (e) { if (ac.signal.aborted) throw new Error('已叫停'); throw e; }
  finally { if (号 && 在问.get(号) === ac) 在问.delete(号); }
};
const 问一句里 = async (a, app, m, on, 动, signal) => {
  const s = 'colony-' + (app ? 'app-' + app : 'ask') + '-' + String(a.session || 'main').replace(/[^\w-]/g, '_');
  const content = await 附件.拼(String(a.text || ''), (a.files || []).filter(f => f && f.key));
  const r = await 投递.问(m, { session: s, system: a.system, messages: [{ role: 'user', content }], 增量: true, on, 动, signal, think: a.think === 'off' || a.think === 'on' ? a.think : undefined });
  const 收 = await 媒体.收(r.content, 'ask:' + s);
  return Object.assign({ from: m.id, name: m.name, content: 收.text }, r.think ? { think: r.think } : {}, r.queued ? { queued: true } : {}, 收.files.length ? { files: 收.files } : {});
};
const 流着问 = (a, meta) => ({ async *[Symbol.asyncIterator]() {
  const 队 = []; let 醒 = null, 完 = null, 错 = null, 字 = null, 想 = null, 钟 = null;
  const 推 = x => { 队.push(x); 醒 && 醒(); };
  const 攒 = () => { if (!钟) 钟 = setTimeout(() => { 钟 = null; if (想 != null) { 推({ think: 想 }); 想 = null; } if (字 != null) { 推({ text: 字 }); 字 = null; } }, 80); };
  问一句(a, meta, t => { 字 = t; 攒(); }, x => { if (x.think != null) { 想 = x.think; 攒(); } else 推(x); })
    .then(r => { 完 = r; 醒 && 醒(); }, e => { 错 = e; 醒 && 醒(); });
  for (;;) {
    while (队.length) yield 队.shift();
    if (错) { clearTimeout(钟); throw 错; }
    if (完) { clearTimeout(钟); if (想 != null) yield { think: 想 }; if (字 != null) yield { text: 字 }; yield { done: 完 }; return 完; }
    await new Promise(r => { 醒 = r; }); 醒 = null;
  }
} });
ctx.provide('bridge.ask', (a, meta) => a.stream ? 流着问(a, meta) : 问一句(a, meta), {
  desc: '问一个成员一句, 不开会话: 同一个 session 接着聊(有记忆的 agent 自己记着, 普通模型桥替它记最近 30 条), 每次只给新的那句; system 头一回或变了才发。'
    + '回 {from, name, content, think?, files?}: 它回的图片、视频、音频、文件取回存好, files 是附件 {key,name,mime,size}, 用 bridge.file 拿内容(24 小时后清, 要留就存走)。真人不能 ask, 拉进会话聊。'
    + 'stream: true 边想边看: 一条条推 {text} 到此为止的字 / {think} 到此为止的思考(有的才有) / {tool:{name,label,emoji,status}} 工具步骤(hermes 有), 最后 {done: 结果}; 小应用里 colony.call(\'bridge.ask\', {..., stream: true}, 每条 => …)',
  schema: { to: 'string(成员 id)', text: 'string', session: 'string?(同一局/同一个对手用同一个)', system: 'string?', files: '[{key,name,mime,size}]?', stream: 'boolean?', id: 'string?(给了就能 bridge.stop {ask: id} 叫停)', think: 'off|on?(AI 配置里的模型开关深度思考; agent 自己管, 这个不起作用)' }, frames: true, common: true,
});
ctx.provide('bridge.open', async (a, meta) => {
  const app = 授权.谁(meta);
  if (a.chat) { // 改已有的会话
    const c = await 会话.取(a.chat); await 查(meta, c);
    for (const x of a.add || []) await 授权.要(app, (await 成员.找(x)).id);
    if (a.clear) await 会话.清(a.chat);
    return 会话.外形(await 会话.改(a));
  }
  for (const x of a.with || []) await 授权.要(app, (await 成员.找(x)).id);
  return 会话.外形(await 会话.开(Object.assign({}, a, { app })));
}, {
  desc: '开会话: with 一个人是单聊, 几个人是群(真人好友拉进来他就自动进群); 同样几个人再开就是原来那个(new: true 另开)。回 {id, name, members}。'
    + '给 chat 就是改它: add 拉人 / remove 移出(成员 id), name 改名, topic 话题, relay 接力轮数(1-20), relayOn 接力开关, clear 清空记录和附件',
  schema: { with: 'string[]?(成员 id)', chat: 'string?', name: 'string?', topic: 'string?', new: 'boolean?', add: 'string[]?', remove: 'string[]?',
    relay: 'number?', relayOn: 'boolean?', clear: 'boolean?' }, frames: true, common: true,
});
ctx.provide('bridge.say', async (a, meta) => {
  const c = await 会话.取(a.chat); await 查(meta, c);
  return (await 会话.说(a)).map(e => 条(c, e));
}, {
  desc: '在会话里说一句并等回复: 默认文里 @名字 的回, 没点名就所有人按顺序回(后回的看得到先回的); to 指定(成员 id 数组 / all / none 只说不问); relay 回完再接力几轮(0-20)。成员回 PASS 就不说话。files 带附件(bridge.file 存的)。回这次新增的 [{from, name, text}]',
  schema: { chat: 'string', text: 'string?', to: 'string|string[]?', relay: 'number?(0-20)', files: '[{key,name,mime,size}]?' }, frames: true, common: true,
});
ctx.provide('bridge.read', async (a, meta) => {
  const app = 授权.谁(meta);
  if (!a || !a.chat) return (await 会话.列()).filter(c => app ? c.app === app : true).map(c => Object.assign(会话.外形(c), { app: c.app || undefined }));
  const c = await 会话.取(a.chat); await 查(meta, c);
  const l = 会话.记录.get(c.id) || [], after = +a.after || 0;
  return { chat: 会话.外形(c), messages: l.filter(e => e.i > after).map(e => 条(c, e)),
    thinking: [...会话.跑.keys()].filter(k => k.startsWith(c.id + ':')).map(k => k.slice(c.id.length + 1)) };
}, {
  desc: '读会话记录: after 给上次读到的 i 只回之后的; thinking 是正在回的成员(想边回边看就隔一会儿读一次)。不给 chat 回会话列表(小应用只看到自己开的)',
  schema: { chat: 'string?', after: 'number?' }, frames: true,
});
ctx.provide('bridge.stop', async (a, meta) => {
  if (a && a.ask) { const ac = 在问.get((授权.谁(meta) || 'agent') + ':' + a.ask); if (ac) ac.abort(); return { stopped: !!ac }; }
  if (a && a.chat) await 查(meta, await 会话.取(a.chat));
  else if (授权.谁(meta)) throw new Error('小应用要给 chat');
  return { stopped: 会话.停(a && a.chat) };
}, { desc: '让正在回的成员停下: chat 停这个会话(不给停全部); ask 停一次带 id 的 bridge.ask(它会报「已叫停」, 对方那边的请求也断开)', schema: { chat: 'string?', ask: 'string?' }, frames: true });
ctx.provide('bridge.close', async (a, meta) => {
  await 查(meta, await 会话.取(a.chat)); await 会话.删(a.chat); return { closed: a.chat };
}, { desc: '删掉一个会话、它的记录和附件', schema: { chat: 'string' }, frames: true });
ctx.provide('bridge.file', async (a, meta) => {
  if (a.drop) { // 用完就放: 只放没进会话记录的(进了记录的跟着会话走, 删会话才删)
    const ks = [].concat(a.drop); 附件.松 = (await ctx.kv.get(附件.松键)) || {}; let n = 0;
    for (const k of ks) if (附件.松[k]) { await ctx.kv.del(附件.前缀 + k).catch(() => { }); delete 附件.松[k]; n++; }
    await ctx.kv.set(附件.松键, 附件.松); return { dropped: n, kept: ks.length - n };
  }
  if (a.key) { const v = await ctx.kv.get(附件.前缀 + a.key); if (v == null) throw new Error('没有这个附件(过期或删了): ' + a.key); return { key: a.key, data: v }; }
  if (a.data == null) throw new Error('给 key 取, 或给 data 存');
  return 附件.存(String(a.data), a.name, a.mime, 'loose:' + (授权.谁(meta) || 'agent'));
}, {
  desc: '附件: 给 key 取内容(data: 网址或文字); 给 data(data: 网址或纯文字, 可带 name、mime)存一个, 回 {key, name, mime, size} 放进 bridge.say / ask 的 files。没进会话记录的 24 小时后清; 用完就 drop 掉(给 key 或 key 数组, 进了会话记录的不删)',
  schema: { key: 'string?', data: 'string?', name: 'string?', mime: 'string?', drop: 'string|string[]?' }, frames: true,
});
ctx.provide('bridge.connect', async a => {
  a = a || {};
  if (a.cursors) { // 送达游标: 看或清
    const ks = Object.keys(游标.表).filter(k => !a.session || k.startsWith(a.session + '@'));
    if (a.reset) { ks.forEach(k => delete 游标.表[k]); 游标.存(); return { reset: ks.length }; }
    return ks.map(k => ({ key: k, at: 游标.表[k].at, 带系统: !!游标.表[k].带系统 }));
  }
  if (typeof a.name !== 'string' || !a.name.trim()) throw new Error('缺 name: 给这个外部 agent 起个名, 它会成为 AI 配置里的一个厂商');
  if (!colony.has('ai.configure')) return 厂商记录.直写(a);
  const 清单 = a.model ? [] : await 厂商记录.拉模型(String(a.endpoint || 网关端点).trim().replace(/\/+$/, ''));
  if (!a.model && 清单.length === 1) a = Object.assign({}, a, { model: 清单[0] });
  const 同 = (await ctx.call('ai.providers')).find(p => p.name === a.name);
  if (同 && 同.protocol !== 'gateway') throw new Error('已有叫「' + a.name + '」的厂商(协议 ' + 同.protocol + '), 换个名字');
  let r = await ctx.call('ai.configure', { name: a.name, protocol: 'gateway', endpoint: a.endpoint || 网关端点, apiKey: 'local', model: a.model, toolMode: 'text', default: !!a.default });
  if (!r.model && (r.models || []).length === 1) r = await ctx.call('ai.configure', { name: a.name, model: r.models[0] });
  return r;
}, {
  desc: '把一个外部 agent(网关端点)接成厂商当全能 agent 的大脑: 协议 gateway(带会话 id、只发增量), 顺带拉它的模型清单(只有一个就直接选上); 没有 AI 配置块时桥直接写厂商记录。'
    + 'cursors:true 看送达游标(外部 agent 每个会话发到了哪条), 加 session 只看那个会话的, reset 清掉(下一轮按头一回发)',
  schema: { name: 'string?', endpoint: 'string?(默认 http://127.0.0.1:4123/v1)', model: 'string?', default: 'boolean?', cursors: 'boolean?', session: 'string?', reset: 'boolean?' },
  frames: false,
});
好友.起().then(() => { 房间.起(); 成员.拉(true); }).catch(e => console.warn('[bridge] 好友', e));
云端.起().then(() => 成员.拉(true)).catch(e => console.warn('[bridge] 云端', e));
附件.扫();
界面.装();
成员.拉().catch(() => { });
return {};
'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ═ 状态 ═
// 全块共用的状态, 段之间只传这个对象
const AG = {
  sid: 'main',   // 当前会话
  hist: [],   // 当前会话的记录, 唯一事实源: 引擎往里 push, 渲染从这里画
  busy: false,   // 引擎在跑
  live: { text: '' },   // 正在流出的回答
  brain: null,   // {provider, model, think}, 空就用 AI 配置里的默认
  换: null,   // 这一轮临时换上的大脑 {provider, model}: 原来选的连断时由 引擎.换大脑 填, 一轮完就清
  disposed: false,   // 本实例已被卸载(多半是自己被热替换了)
};
const 切 = (s, n) => s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1] || '') ? n - 1 : n);   // 不截在 emoji 中间
const 短 = (s, n) => {
  s = String(s == null ? '' : s);
  return s.length > n ? `${切(s, n)}…(共 ${s.length} 字)` : s;
};
const 片 = m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];   // 内容一律当成若干片
const 是问 = m => m.role === 'user' && !m.代发 && !m.截图;   // 用户自己问的(系统代发的不算; 旧记录里代发叫 截图)
const 登记 = (路径, fn, desc, schema, common) =>   // 本块的能力都不接隔离窗; common = 常用, agent 给成工具
  ctx.provide(路径, fn, { desc, schema, frames: false, common });
// ═ 样式 ═
// 颜色先在 #agent-dock 上取一遍带默认值的短名(b 底 b2 二层底 l 线 l2 粗线 t 字 m 灰字 d 淡字 a 强调 s 面 f 等宽),
// 界面块不在场停靠栏也是深色能看的; 下面全用短名。ag-solo = 单独打开铺满整页: 收起、换边、拉边都不要
const 样式 = `#agent-dock{--b:var(--bg,#0a0a0a);--b2:var(--bg-2,#131313);
--l:var(--border,rgba(255,255,255,.08));--l2:var(--border-strong,rgba(255,255,255,.18));
--t:var(--text,#fafafa);--m:var(--text-muted,#8a8a8a);--d:var(--text-dim,#5a5a5a);--a:var(--accent,#B5FF00);
--s:var(--surface,rgba(255,255,255,.05));--bd:1px solid var(--l);--bd2:1px solid var(--l2);
--f:var(--mono,ui-monospace,Menlo,Consolas,monospace);position:fixed;z-index:130;display:flex;
flex-direction:column;background:var(--b2);color:var(--t);
font:13px/1.5 var(--sans,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif);
box-shadow:0 -2px 20px rgba(0,0,0,.3);box-sizing:border-box}#agent-dock *{box-sizing:border-box}
#agent-dock button{cursor:pointer}
#agent-dock.ag-solo #agent-min,#agent-dock.ag-solo #agent-side,#agent-dock.ag-solo #agent-grip{display:none}
#agent-dock.ag-solo #agent-bar{cursor:default}#agent-dock.collapsed{width:52px;height:52px;border-radius:50%;
border:var(--bd2);cursor:grab;background:rgba(0,0,0,.72);backdrop-filter:blur(14px);align-items:center;
justify-content:center;font-size:22px;transition:transform .15s;user-select:none}
#agent-dock.collapsed:hover{transform:scale(1.08);border-color:var(--a)}
#agent-dock.collapsed.dragging{cursor:grabbing;transition:none}
#agent-dock.collapsed>*:not(.ag-fab){display:none}#agent-dock.expanded .ag-fab{display:none}
#agent-dock.expanded.ag-bottom{bottom:0;left:0;right:0;height:var(--dock-h,420px);border-top:var(--bd)}
#agent-dock.expanded.ag-right{top:0;bottom:0;right:0;width:var(--dock-w,420px);border-left:var(--bd)}
#agent-grip{position:absolute;z-index:1}.ag-bottom #agent-grip{top:-3px;left:0;right:0;height:8px;
cursor:ns-resize}.ag-right #agent-grip{left:-3px;top:0;bottom:0;width:8px;cursor:ew-resize}
#agent-grip::after{content:"";position:absolute;background:var(--l2);border-radius:2px}
.ag-bottom #agent-grip::after{top:3px;left:50%;transform:translateX(-50%);width:40px;height:3px}
.ag-right #agent-grip::after{left:3px;top:50%;transform:translateY(-50%);width:3px;height:40px}
#agent-bar{display:flex;align-items:center;gap:10px;padding:8px 16px;flex-shrink:0;cursor:pointer;
border-bottom:var(--bd)}#agent-bar .ag-logo{width:26px;height:26px;border-radius:50%;display:flex;
align-items:center;justify-content:center;font-weight:700;font-size:12px}#agent-bar .ag-title{flex:1;
font-weight:500}.ag-ic{background:none;border:none;color:var(--m);font-size:14px;padding:2px 6px}
.ag-ic:hover{color:var(--t)}#agent-sess,#agent-brain{display:flex;gap:6px;align-items:center;padding:6px 12px;
flex-shrink:0;border-bottom:var(--bd);font-size:11px;color:var(--m)}
#agent-dock select,.ag-in,#agent-set input{flex:1;min-width:0;background:var(--b);border:var(--bd);
color:var(--t);border-radius:7px;padding:4px 8px;font-size:12px}#agent-brain select{flex:none;max-width:42%;
font-family:var(--f);font-size:11px}#agent-dock option{background:var(--b2);color:var(--t)}
.ag-btn,#agent-set button{background:none;border:1px dashed var(--l2);color:var(--m);padding:4px 8px;
border-radius:7px;font-size:11px;white-space:nowrap}.ag-btn:hover,#agent-set button:hover{color:var(--a);
border-color:var(--a)}.ag-ic.warn{color:#ff6b6b;font-size:11px}#agent-sess{position:relative}
#agent-sess-cur{border-style:solid;color:var(--t);max-width:45%}#agent-meter{margin-left:auto;
font-family:var(--f);font-size:10.5px;white-space:nowrap}#agent-sess-dd{position:absolute;z-index:2;top:100%;
left:12px;min-width:220px;max-height:240px;overflow:auto;padding:4px;background:var(--b2);border:var(--bd2);
border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4)}.ag-sess-row{display:flex;align-items:center;gap:4px;
padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--t)}
.ag-sess-row:hover{background:var(--s)}.ag-sess-row.on{color:var(--a)}.ag-sess-row>span{flex:1}
#agent-sess-cur,.ag-sess-row>span,.ag-call-meta,.ag-card .ag-name{overflow:hidden;text-overflow:ellipsis;
white-space:nowrap}#agent-convo{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;
gap:10px}#agent-convo>*{flex-shrink:0}.ag-msg{max-width:82%;padding:9px 13px;border-radius:14px;
line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.ag-msg.user{align-self:flex-end}
.ag-msg.user :is(.ag-call,.ag-card){background:var(--b2);color:var(--t)}.ag-dl{margin-left:8px;color:var(--a);
cursor:pointer}.ag-msg.user,#agent-bar .ag-logo,#agent-send{background:var(--a);color:#000}
.ag-msg.assistant{align-self:flex-start;background:var(--s);border:var(--bd)}.ag-msg.live{border-style:dashed}
.ag-h{font-weight:700;margin:6px 0 2px}.ag-msg table{border-collapse:collapse;margin:4px 0;white-space:normal}
.ag-msg td{padding:3px 8px;border:var(--bd2)}.ag-msg code{font:11.5px var(--f);background:var(--b);
padding:0 3px;border-radius:4px}.ag-msg pre{background:rgba(0,0,0,.35);padding:8px 10px;border-radius:8px;
overflow:auto;margin:6px 0;font:11.5px/1.5 var(--f);white-space:pre}.ag-chain{align-self:flex-start;width:96%;
border:var(--bd);border-radius:10px;font-size:11.5px;background:rgba(255,255,255,.02);overflow:hidden}
.ag-chain-head{display:flex;gap:8px;padding:6px 10px;cursor:pointer;user-select:none;color:var(--m)}
.ag-chain-body{display:none;flex-direction:column;gap:4px;padding:0 6px 6px}
.ag-chain.open>.ag-chain-body,.ag-plain>.ag-chain-body{display:flex}.ag-plain{border:0;background:none}
.ag-plain>.ag-chain-head{display:none}.ag-plain>.ag-chain-body{padding:0}.ag-call{border:var(--bd);
border-radius:8px;overflow:hidden}.ag-chain-head>span,.ag-call-meta{margin-left:auto}
.ag-chain-head>span,.ag-path,.ag-call-meta{color:var(--d);font-family:var(--f);font-size:10.5px}
.ag-call-line{display:flex;gap:8px;align-items:center;padding:5px 10px;cursor:pointer;user-select:none}
.ag-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;background:var(--d)}
.ag-ok>.ag-call-line .ag-dot{background:var(--a)}.ag-err>.ag-call-line .ag-dot{background:#ff6b6b}
.ag-run>.ag-call-line .ag-dot{background:none;border:1.5px solid var(--d);border-top-color:transparent;
animation:ag-spin .7s linear infinite}.ag-call-meta{max-width:50%}.ag-call-body{display:none;margin:0;
padding:7px 12px;border-top:1px dashed var(--l);font:10.5px/1.5 var(--f);color:var(--m);white-space:pre-wrap;
overflow-wrap:anywhere;max-height:300px;overflow:auto}.ag-call.open .ag-call-body{display:block}
@keyframes ag-spin{to{transform:rotate(360deg)}}.ag-card{display:inline-flex;align-items:center;gap:6px;
max-width:100%;padding:4px 8px;font-size:11px;background:var(--s);border:var(--bd);border-radius:8px;
color:var(--t);vertical-align:top;cursor:pointer;white-space:nowrap}.ag-card.dead{color:#f5a623;
border-color:rgba(245,166,35,.4);cursor:default}.ag-card img{width:28px;height:28px;object-fit:cover;
border-radius:4px}.ag-card .ag-x{color:var(--m);padding:0 2px}.ag-card .ag-x:hover{color:#ff6b6b}
.ag-media{max-width:min(320px,100%);border-radius:10px;display:block;margin:6px 0;cursor:zoom-in}
.ag-media.big{max-width:100%;cursor:zoom-out}#agent-convo audio{max-width:100%;height:32px}
.ag-parts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}#agent-status{padding:2px 16px;font-size:11px;
color:var(--m);font-style:italic;flex-shrink:0}#agent-atts{display:flex;flex-wrap:wrap;gap:6px;
padding:6px 16px 0;flex-shrink:0}#agent-status:empty,#agent-atts:empty{display:none}.ag-row{display:flex;
gap:8px;padding:10px 16px;border-top:var(--bd);flex-shrink:0}#agent-input{flex:1;background:var(--b);
border:var(--bd);color:var(--t);padding:8px 12px;border-radius:8px;resize:none;min-height:36px;
max-height:100px;font-family:inherit;font-size:13px;line-height:1.4}#agent-send{border:none;padding:8px 18px;
border-radius:8px;font-weight:600;font-size:13px}#agent-send.stop{background:#ff6b6b;color:#fff}
.ag-row>button:not(#agent-send){background:var(--s);color:var(--t);border:var(--bd);padding:6px 10px;
border-radius:8px;font-size:15px}#agent-dock.drag-over{outline:2px dashed var(--a);outline-offset:-2px}
body.ag-dragging iframe{pointer-events:none}#agent-brain #agent-brain-t{max-width:22%}
.ag-live>.ag-call-body{max-height:5em;overflow:hidden}.ag-path{margin-left:6px}#agent-pop{display:none}
#agent-dock.collapsed>#agent-pop:not(:empty){display:block;position:absolute;bottom:60px;right:0;
width:max-content;max-width:260px;padding:6px 10px;border-radius:10px;background:var(--b2);border:var(--bd2);
font-size:12px}#agent-pop .ag-call{border:0}#agent-pop :is(.ag-call-meta,.ag-call-body,.ag-path){display:none}
#agent-set{position:relative;height:0;z-index:3}#agent-set>div{position:absolute;top:4px;width:300px;
overflow:auto;padding:2px 12px 10px;background:var(--b2);border:var(--bd2);border-radius:10px;
box-shadow:0 8px 30px rgba(0,0,0,.5)}#agent-set label{display:block;margin:8px 0 4px;font-size:11px;
color:var(--m)}#agent-set div div{display:flex;gap:6px}#agent-set select{flex:0 1 auto;min-width:0}
#agent-set [type=number]{flex:none;width:56px}#agent-set>div>input{width:100%}#agent-set p{margin:6px 0 0;
font-size:11px;color:var(--m)}`;
// ═ 骨架 · 跟着: 样式 ═
// 停靠栏的壳和手感: 收成球、底/右停靠、拖边调大小; 位置和大小记在 kv
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const 骨架 = {
  dock: null,
  open: false,
  pos: { side: 'bottom', h: 420, w: 420, fabB: 24, fabR: 24 },   // fab 是收起的球
  onSend: null,   // (text, parts) => void, 装配段赋值
  onStop: null,   // () => void
  onZip: null,   // () => void, 压缩键
  statusT: null,
  $: id => ctx.root && ctx.root.querySelector('#' + id),
  听(ev, fn) {
    document.addEventListener(ev, fn);
    ctx.cleanup(() => document.removeEventListener(ev, fn));
  },
  html: () => `<div id="agent-dock" class="collapsed ag-bottom" style="bottom:24px;right:24px">
<div id="agent-grip"></div><div class="ag-fab">💬</div><div id="agent-pop"></div><div id="agent-bar">
<span class="ag-logo">A</span><span class="ag-title">全能 agent</span>
<button class="ag-ic" id="agent-clear" title="清空当前会话(点两下)">🗑</button>
<button class="ag-ic" id="agent-side" title="换到右边 / 底部">⇋</button>
<button class="ag-ic" id="agent-min" title="收起">▾</button></div><div id="agent-sess">
<button class="ag-btn" id="agent-sess-cur" data-a="drop" title="切换会话"></button>
<button class="ag-btn" data-a="new">+ 新会话</button>
<button class="ag-btn" data-a="zip" title="压缩: 最近两问留原文, 更早的写成摘要(原文不删)">🗜</button>
<span id="agent-meter" title="每次发给模型多少(连同系统说明和工具说明, 本地估) / 上限; 缓存 = 上一步发过去的里命中前缀缓存的比例(厂商报的), 越高越快越省"></span><div id="agent-sess-dd" hidden></div>
</div><div id="agent-brain"></div><div id="agent-convo"></div><div id="agent-status"></div>
<div id="agent-atts"></div><div class="ag-row"><button id="agent-attach" title="加文件或图片">📎</button>
<textarea id="agent-input" placeholder="对全能 agent 说话; 回车发送, Shift+回车换行"></textarea>
<button id="agent-send">发送</button><input type="file" id="agent-file" multiple hidden></div></div>`,
  async mount() {
    if (!ctx.root || typeof document === 'undefined') return;
    ctx.root.insertAdjacentHTML('beforeend', `<style>${样式}</style>${骨架.html()}`);
    骨架.dock = 骨架.$('agent-dock');
    骨架.wire();
    const saved = await ctx.kv.get('agent.dock').catch(() => null);
    Object.assign(骨架.pos, saved || {});
    骨架.独 = colony.单独;   // 单独打开: 这一页就是对话栏, 铺满, 不缩成球
    骨架.open = 骨架.独 || !!骨架.pos.open;   // 上次展开着就还展开: 本块被热替换后不缩回一个球
    骨架.apply();
  },
  apply() {
    const d = 骨架.dock, p = 骨架.pos, on = 骨架.open, r = p.side === 'right';
    Object.entries({ expanded: on, collapsed: !on, 'ag-bottom': !r, 'ag-right': r, 'ag-solo': 骨架.独 })
      .forEach(([c, v]) => d.classList.toggle(c, !!v));
    d.style.bottom = on ? '' : p.fabB + 'px';
    d.style.right = on ? '' : p.fabR + 'px';
    d.style.setProperty('--dock-h', 骨架.独 ? '100vh' : p.h + 'px');
    d.style.setProperty('--dock-w', p.w + 'px');
  },
  keep: () => ctx.kv.set('agent.dock', 骨架.pos),
  expand(on) {
    骨架.open = 骨架.pos.open = !!on || !!骨架.独;
    骨架.keep();
    骨架.apply();
    if (!on) return;
    const c = 骨架.$('agent-convo');
    c.scrollTop = c.scrollHeight;   // 收着时对话区不显示, 滚动位置会丢
    骨架.$('agent-input').focus();
  },
  setBusy(on) {
    const b = 骨架.$('agent-send');
    b.textContent = on ? '停止' : '发送';
    b.classList.toggle('stop', !!on);
  },
  回填(t) { // 话没发出去, 放回输入框
    const ta = 骨架.$('agent-input');
    if (ta && t && !ta.value) ta.value = t;
  },
  status(text, 留) { // 留: 不自己消失, 等下一句来换("正在压缩"要一直挂到模型写完)
    const el = 骨架.$('agent-status');
    el.textContent = text || '';
    clearTimeout(骨架.statusT);
    if (!留) 骨架.statusT = setTimeout(() => { el.textContent = ''; }, 3000);
  },
  用量(used, budget, 账) { // 账: 上一步厂商报的用量, 有就带上缓存命中率
    const el = 骨架.$('agent-meter'), pct = Math.round(used / budget * 100) + '%';
    if (el) el.textContent = `${(used / 1000).toFixed(1)}k / ${Math.round(budget / 1000)}k · ${pct}`
      + (账 && 账.入 ? ` · 缓存 ${Math.round(账.缓存 / 账.入 * 100)}%` : '');
  },
  两下(b, fn) {
    const 回 = () => {
      b.textContent = b.dataset.t;
      b.classList.remove('warn');
      delete b.dataset.t;
    };
    if (b.dataset.t) return clearTimeout(+b.dataset.arm), 回(), fn();
    Object.assign(b.dataset, { t: b.textContent, arm: setTimeout(回, 3000) });
    b.textContent = '确定?';
    b.classList.add('warn');
  },
  send() {
    const ta = 骨架.$('agent-input'), text = ta.value.trim(), parts = 引用.take();
    if (!text && !parts.length) return 骨架.status('先写点什么, 或加个文件再发');   // 空着点发送也说一声
    ta.value = '';
    骨架.onSend(text, parts);
  },
  拖(el, start, move, end) { // 球拖动和拉边共用; 没挪够 5px 不算拖, 免得点一下变成拖
    let live = false, moved = false, sx = 0, sy = 0;
    el.addEventListener('pointerdown', e => {
      if (!start(e)) return;
      live = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('ag-dragging');   // 拖过 iframe 上方时指针事件会被它吃掉
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!live || (!moved && Math.abs(dx) + Math.abs(dy) < 5)) return;
      moved = true;
      move(dx, dy);
    });
    el.addEventListener('pointerup', () => {
      if (!live) return;
      live = false;
      document.body.classList.remove('ag-dragging');
      end(moved);
    });
  },
  wire() {
    const d = 骨架.dock, p = 骨架.pos, $ = 骨架.$, ta = $('agent-input');
    let s = null;   // 按下那一刻的位置或大小, 移动量都相对它算
    骨架.拖(d, () => {
      if (骨架.open) return false;   // 展开着不是在拖球, 别动 s: 它这时是拉边条记的大小
      s = { b: p.fabB, r: p.fabR };
      return true;
    }, (dx, dy) => {
      d.classList.add('dragging');
      p.fabR = Math.max(4, s.r - dx);
      p.fabB = Math.max(4, s.b - dy);
      骨架.apply();
    }, moved => {
      d.classList.remove('dragging');
      if (moved) 骨架.keep();
      else 骨架.expand(true);
    });
    骨架.拖($('agent-grip'), () => {
      s = { h: p.h, w: p.w };
      return true;
    }, (dx, dy) => {
      if (p.side === 'right') p.w = Math.min(Math.max(320, s.w - dx), window.innerWidth - 80);
      else p.h = Math.min(Math.max(220, s.h - dy), window.innerHeight - 80);
      骨架.apply();
    }, 骨架.keep);
    $('agent-bar').onclick = e => { if (!e.target.closest('.ag-ic')) 骨架.expand(false); };
    $('agent-min').onclick = () => 骨架.expand(false);
    $('agent-clear').onclick = e => 骨架.两下(e.currentTarget, () => 会话.clear());
    $('agent-side').onclick = () => {
      p.side = p.side === 'right' ? 'bottom' : 'right';
      骨架.apply();
      骨架.keep();
    };
    $('agent-send').onclick = () => $('agent-send').classList.contains('stop') ? 骨架.onStop() : 骨架.send();
    ta.onkeydown = e => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;   // 中文输入法选词的回车不算发送
      e.preventDefault();
      骨架.send();
    };
    $('agent-attach').onclick = () => $('agent-file').click();
    $('agent-file').onchange = e => {
      [...e.target.files].forEach(引用.add);
      e.target.value = '';
    };
    ta.onpaste = e => { if (引用.收(e.clipboardData)) e.preventDefault(); };
    d.ondragover = e => {
      e.preventDefault();
      d.classList.add('drag-over');
    };
    d.ondragleave = () => d.classList.remove('drag-over');
    d.ondrop = e => {
      e.preventDefault();
      d.classList.remove('drag-over');
      引用.收(e.dataTransfer);
      if (!骨架.open) 骨架.expand(true);
    };
  },
};
// ═ 会话 ═
// 会话清单和当前会话记在 kv; 记录只在 AG.hist 一份, 引擎每步整个写回, 所以不读库
const 会话 = {
  list: [],
  drop: false,   // 下拉开着
  edit: null,   // 正在改名的那个会话的 id
  keyOf: sid => 'chat.transcript.' + sid,
  async load() {
    const list = await ctx.kv.get('chat.sessions');
    会话.list = Array.isArray(list) && list.length ? list : [{ id: 'main', name: '默认会话' }];
    const cur = await ctx.kv.get('chat.currentSession');
    await 会话.取(会话.list.some(s => s.id === cur) ? cur : 会话.list[0].id);
  },
  async 取(id) {
    const hist = await ctx.kv.get(会话.keyOf(AG.sid = id));
    AG.hist = Array.isArray(hist) ? hist : [];
  },
  save() { // 先重画: 写库失败画面也是新的
    渲染.flush();
    return ctx.kv.set(会话.keyOf(AG.sid), AG.hist);
  },
  saveList: () => ctx.kv.set('chat.sessions', 会话.list),
  async open(id) {
    if (!会话.list.some(s => s.id === id)) return;
    会话.drop = false;
    await 会话.取(id);
    await ctx.kv.set('chat.currentSession', id);
    会话.render();
    渲染.flush();
  },
  async create() {
    const s = { id: 's' + Date.now().toString(36), name: `会话 ${会话.list.length + 1}` };
    会话.list.push(s);
    await 会话.saveList();
    await 会话.open(s.id);
  },
  async rename(id, name) {
    const s = 会话.list.find(x => x.id === id);
    if (s && name) s.name = name;
    await 会话.saveList();
    会话.render();
  },
  async remove(id) {
    会话.list = 会话.list.filter(s => s.id !== id);
    if (!会话.list.length) 会话.list.push({ id: 'main', name: '默认会话' });
    await ctx.kv.del(会话.keyOf(id));
    await 会话.清引用(id);
    await 会话.saveList();
    if (AG.sid === id) await 会话.open(会话.list[0].id);
    else 会话.render();
  },
  async clear() {
    AG.hist.length = 0;   // 引擎和渲染都拿着同一个数组, 不能换新数组
    await 会话.save();
    await 会话.清引用(AG.sid);
  },
  async 清引用(sid) { // 附件、大结果跟着记录一起删
    for (const e of await ctx.kv.list(`ref:${sid}:`)) await ctx.kv.del(e.key);
  },
  render() {
    const box = 骨架.$('agent-sess'), dd = 骨架.$('agent-sess-dd');
    if (!box) return;
    const ic = (a, t, tip) => `<button class="ag-ic" data-a="${a}" title="${tip}">${t}`
      + '</button>';
    const 删 = 会话.list.length > 1 ? ic('del', '🗑', '删掉这个会话和它的记录(点两下)') : '';
    const row = s => `<div class="ag-sess-row${s.id === AG.sid ? ' on' : ''}`
      + `" data-id="${esc(s.id)}">`
      + (会话.edit !== s.id ? `<span>${esc(s.name)}</span>${ic('ren', '✏', '改名')}${删}`
        : `<input class="ag-in" id="agent-sess-in" value="${esc(s.name)}">${ic('ok', '✓', '好')}`
          + ic('no', '✕', '算了')) + '</div>';
    骨架.$('agent-sess-cur').textContent = `${(会话.list.find(s => s.id === AG.sid) || {}).name || ''} ▾`;
    dd.hidden = !会话.drop;
    dd.innerHTML = 会话.list.map(row).join('');
    box.onclick = ev => {
      const b = ev.target.closest('[data-a]'), row = ev.target.closest('.ag-sess-row');
      const id = row && row.dataset.id;
      if (b && b.dataset.a === 'del') return 骨架.两下(b, () => 会话.remove(id));
      if (b) return 会话.act(b.dataset.a, id);
      if (id && 会话.edit !== id) 会话.open(id);
    };
    const inp = 骨架.$('agent-sess-in');
    if (!inp) return;
    inp.focus();
    inp.onkeydown = ev => {
      if (ev.key === 'Enter' && !ev.isComposing) 会话.act('ok');
      if (ev.key === 'Escape') 会话.act('no');
    };
  },
  act(a, id) {
    if (a === 'new') return 会话.create();
    if (a === 'zip') return 骨架.onZip();
    if (a === 'ok') return 会话.done();
    if (a === 'drop') 会话.drop = !会话.drop;
    会话.edit = a === 'ren' ? id : null;
    会话.render();
  },
  done() {
    const inp = 骨架.$('agent-sess-in'), id = 会话.edit;
    会话.edit = null;
    return 会话.rename(id, inp ? inp.value.trim() : '');
  },
};
// ═ 渲染 · 跟着: 骨架, 工具表 ═
// 记录变了只补新来的几条, 对不上才整画; 流式只换正在变的那点(50ms 合一次); 上翻时不强拉到底。
// 提问、中途说的话、回答照原文画; 两段话之间的思考和工具归一组: 组头一句总括, 点开一行一行(图标、一句、用时), 行再点开看全文
// ✂ 轻md
// 只认标题、粗体、行内代码、列表、表格; 进来的要已转义, 模型写的 HTML 不会活(类名 ag-h / ag-li, 借的块自己给样式)
const 轻md = s => {
  const 行内 = t => t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let out = '', 块 = true, 表 = '';   // 块: 刚出过块元素, 下一行不再补换行(pre-wrap 会多出空行)
  const 出 = h => { out += h; 块 = true; };
  (s + '\n').split('\n').forEach((l, i, a) => {
    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (!/^[\s|:-]+$/.test(l)) 表 += '<tr>' + l.trim().slice(1, -1).split('|')
        .map(c => `<td>${行内(c.trim())}</td>`).join('') + '</tr>';
      return;
    }
    if (表) { 出(`<table>${表}</table>`); 表 = ''; }
    if (i === a.length - 1) return;
    const h = l.match(/^#{1,4} (.*)/), li = l.match(/^(\s*)([-*]|\d+\.) (.*)/);
    if (h) 出(`<div class="ag-h">${行内(h[1])}</div>`);
    else if (li) 出(`<div class="ag-li" style="margin-left:${li[1].length * 6}px">`
      + `${li[2].length < 2 ? '•' : li[2]} ${行内(li[3])}</div>`);
    else { out += (块 ? '' : '\n') + 行内(l); 块 = false; }
  });
  return out;
};
// ✂ 轻md 完
const 渲染 = {
  timer: null,
  stick: true,   // 在底部就跟着新内容滚
  opened: {},   // 用户点过的行和卡, 重画后听用户的
  后: [],   // 重画完挨个叫(用量表、朗读键)
  cache: new Map(),   // [[show:键]] 读过的值, 免得流式重画时反复读库
  paint() {
    if (!渲染.timer) 渲染.timer = setTimeout(渲染.tail, 50);
  },
  tail() { // 记录条数没变、格子还在, 就只换正在变的那点
    渲染.timer = null;
    const box = 骨架.$('agent-convo'), slot = box && box.querySelector('.ag-live-slot');
    if (!slot || 渲染.n !== AG.hist.length) return 渲染.flush();
    渲染.活(box, slot);
    渲染.down();
  },
  键: m => m ? m.role + m.at + (m.toolCallId || '') : '',
  元(h) {
    const d = document.createElement('div');
    d.innerHTML = h;
    return d.firstChild;
  },
  flush() {
    clearTimeout(渲染.timer);
    渲染.timer = null;
    const box = 骨架.$('agent-convo'), H = AG.hist;
    if (!box) return;
    if (!box.onclick) {
      box.onclick = 渲染.click;
      box.onscroll = () => { 渲染.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60; };
      box.addEventListener('load', 渲染.down, true);   // 图片加载完会变高, 在底部就得再跟一下
    }
    let slot = box.querySelector('.ag-live-slot'), y = box.scrollTop;
    const 整 = !slot || 渲染.n > H.length || 渲染.末 !== 渲染.键(H[渲染.n - 1]);
    if (整) {
      box.innerHTML = '<div class="ag-live-slot"></div>';
      slot = box.lastChild;
      渲染.n = 0;
      渲染.Q = { k: 'q', calls: {}, gi: 0, t: 0 };
    }
    for (; 渲染.n < H.length; 渲染.n++) 渲染.加(H[渲染.n], box, slot);
    渲染.末 = 渲染.键(H[渲染.n - 1]);
    渲染.活(box, slot);
    if (整 && !渲染.stick) box.scrollTop = y;
    渲染.down();
    box.querySelectorAll('.ag-show:not(.on)').forEach(e => { e.classList.add('on'); 渲染.show(e); });
    渲染.后.forEach(f => f());
  },
  加(m, box, slot) {
    const Q = 渲染.Q, 行 = 渲染.行, cs = m.toolCalls || [],
      错 = m.ok === false || /^出错/.test(m.role === 'note' && m.content);
    const 进 = (h, 旧) => { // 进这一组(旧: 换掉的那一行); 组记到哪一刻、有没有失败
      if (旧) 旧.outerHTML = h;
      else 渲染.组(Q, box, slot).insertAdjacentHTML('beforeend', h);
      if (Q.g) Object.assign(Q.g, { t1: m.at, bad: Q.g.bad || 错 });
    };
    if (是问(m)) {
      渲染.头(Q.g);
      渲染.Q = { k: 'q' + m.at, calls: {}, gi: 0, t: m.at };
      return box.insertBefore(渲染.元(`<div class="ag-msg user">${渲染.内(m)}</div>`), slot);
    }
    if (m.role === 'tool') // 结果到了, 换掉调用那一行
      进(渲染.call(Q.calls[m.toolCallId] || { name: m.name }, m), box.querySelector('[data-k="'
        + CSS.escape(m.toolCallId || '') + '"]'));
    else if (m.role === 'note') 进(行(错 ? '⚠' : '📝', esc(m.content), '', '', '', 错 ? 'ag-err' : 'ag-info'));
    else if (m.role === 'summary') { // 摘要是新旧的分界, 自成一组, 不混进上一问
      渲染.头(Q.g);
      Q.g = null;
      进(行('🗜', `第 ${m.压了.join('–')} 条的摘要, 原文还在`, '', esc(m.content), 'sum' + m.at));
    }
    else if (m.role === 'user') { // 系统代发的(看图、截断提醒): 发给模型是 user
      const 图 = 片(m).filter(p => /^image/.test(p.mime || p.mimeType || p.type)).length;
      进(行(图 ? '🖼' : '📨', `系统代发${图 ? ` · 图 ${图} 张` : ''}`, '', 渲染.内(m), 'sys' + m.at));
    } else {
      if (m.think) 进(行('🧠', esc(渲染.首(m.think)) || '思考', 渲染.时(m.ms), esc(m.think), 'think' + m.at));
      if (渲染.纯(m.content)) { // 说的话是正文, 前面那组到此为止
        渲染.头(Q.g);
        Q.g = null;
        const b = box.insertBefore(渲染.元(渲染.bubble('assistant', m.content)), slot);
        if (!cs.length) b.dataset.at = m.at;   // 这条是回答(语音按它念)
        Q.t = m.at;   // 后面的工具从说完这句算起
      }
      cs.forEach(c => 进(渲染.call(Q.calls[c.id] = c, 0, m.at)));
    }
    Q.t = m.at || Q.t;
  },
  组(Q, box, slot) { // 这一组的格子, 没有就在最后开一组
    const 格 = '<div class="ag-chain"><div class="ag-chain-head"></div><div class="ag-chain-body"></div>'
      + '</div>';
    if (!Q.g) Q.g = { k: Q.k + ':' + Q.gi++, t0: Q.t, t1: Q.t, el: box.insertBefore(渲染.元(格), slot) };
    Q.g.el.dataset.k = Q.g.k;
    return Q.g.el.lastChild;
  },
  头(g, 在) { // 组头: 思考几次、用了几个工具, 别的行(停止、摘要)也写它那句, 收着也看得出是什么; 在跑的、有失败的展开, 空组不留
    const c = g && g.el, rs = c ? [...c.lastChild.querySelectorAll(':scope>.ag-call:not(.ag-live)')] : [];
    if (!c || !rs.length && !(在 && c.querySelector('.ag-live'))) return c && c.remove();
    const 类 = r => /^think/.test(r.dataset.k) ? '想' : r.matches('.ag-tool') ? '工' : '';
    const 想 = rs.filter(r => 类(r) === '想').length, 工 = rs.filter(r => 类(r) === '工').length;
    const 别 = rs.filter(r => !类(r)).map(r => r.firstChild.children[1].textContent)
      .map(s => esc(s.length > 40 ? 切(s, 40) + '…' : s));
    c.classList.toggle('open', g.k in 渲染.opened ? 渲染.opened[g.k] : !!在 || !!g.bad);
    c.classList.toggle('ag-plain', !想 && !工 && !在);   // 只有停止、摘要、出错这类行: 不要组头, 行直接摆出来
    c.firstChild.innerHTML = [想 && `思考 ${想} 次`, 工 && `用了 ${工} 个工具`].concat(别).filter(Boolean)
      .join(' · ') + '<span>' + (在 ? '进行中 · ' : g.bad ? '有失败 · ' : '')
      + `${想 || 工 || 在 ? 渲染.时((在 ? Date.now() : g.t1) - g.t0) + ' ' : ''}▾</span>`;
  },
  live() { // 正在流的: [说的字(围栏不画原文), 组里最后一行: 在做什么(思考、正在写的代码露最后几行), 这一轮到现在几秒]
    const L = AG.live, t = L.text || '', f = t.indexOf('\x60\x60\x60tool');
    const 写 = L.写 || f >= 0 && { chars: t.length - f, text: t.slice(f + 7) },   // 围栏记号不露
      码 = 写 ? String(写.text || '') : '',
      找 = k => (码.match(new RegExp(`"${k}":\\s*"([^"]+)`)) || [])[1],
      名 = 写 && 工具表.pathOf(找('path') || 写.name || 找('name') || '工具'),   // 经 call 转的写真能力
      秒 = 渲染.时(Date.now() - L.t0), 尾 = s => esc(String(s || '').split('\n').slice(-8).join('\n').slice(-600));
    return [渲染.bubble('assistant live', f < 0 ? t : t.slice(0, f)), !AG.busy || !L.t0 ? ''
      : 写 ? 渲染.行('✍', `正在写 ${esc(名)} · ${写.chars} 字`, 秒,
        尾(码.replace(/\\n/g, '\n').replace(/\\(["\\/])/g, '$1')), '', 'open')
        : t ? '' : L.思 ? 渲染.行('🧠', `思考中 · ${L.思.length} 字`, 秒, 尾(L.思), '', 'open')
          : 渲染.行('⋯', '等模型回复', 秒)];
  },
  活(box, slot) { // 说的字流在最下面, 正在做的事是当前那组的最后一行; 收着时球上叠这组最近 4 行
    const [字, 行] = 渲染.live(), Q = 渲染.Q, 活行 = 行 && 渲染.元(行.replace('ag-call', 'ag-call ag-live ag-run'));
    box.querySelectorAll('.ag-live').forEach(e => e.remove());
    slot.innerHTML = 字 && 行 ? 字 + '<div class="ag-chain open"><div class="ag-chain-body"></div></div>' : 字;
    if (活行) (字 ? slot.lastChild.lastChild : 渲染.组(Q, box, slot)).append(活行);   // 已经说了话: 在做的事排在话后面
    box.querySelectorAll('.ag-run[data-t] .ag-call-meta').forEach(e => { // 跑着的工具: 秒数每秒跳
      const 秒 = 渲染.时(Date.now() - e.closest('[data-t]').dataset.t);
      e.textContent = e.textContent.replace(/跑着.*/, '跑着 · ' + 秒);
    });
    clearTimeout(渲染.钟);
    if (AG.busy) 渲染.钟 = setTimeout(渲染.paint, 1000);
    渲染.头(Q.g, AG.busy);
    if (!Q.g || !Q.g.el.isConnected) Q.g = null;
    const pop = 骨架.$('agent-pop');
    const 近 = box.querySelectorAll(`[data-k^="${Q.k}:"] .ag-call, .ag-live-slot .ag-call`);   // 这一问的
    if (pop && AG.busy) pop.innerHTML = [...近].slice(-4).map(e => e.outerHTML).join('');
  },
  说(s, 秒) { // 球上说一句, 过几秒收(别清掉后来的)
    const pop = 骨架.$('agent-pop');
    pop.textContent = s;
    if (秒) setTimeout(() => { if (pop.textContent === s) pop.textContent = ''; }, 秒 * 1000);
  },
  完() { // 一轮做完: 球上说 ✓ 和回答的头一截, 没答出来就 ⚠
    const m = AG.hist[AG.hist.length - 1] || {};
    渲染.说((m.role === 'assistant' && m.content ? '✓ ' : '⚠ ') + 渲染.首(m.content || '停下了'), 5);
  },
  // 卡里的一行: 标 已转义, 文 是点开看的(已是 HTML); 键 记用户点没点开
  行: (图, 标, 尾, 文, 键, cls, t) => `<div class="ag-call ${cls || 'ag-ok'}${键 && 渲染.opened[键] ? ' open' : ''}`
    + `" data-k="${esc(键 || '')}${t ? '" data-t="' + t : ''}"><div class="ag-call-line">`
    + `<span class="ag-dot"></span><span>${图 && 图 + ' '}${标}`
    + `</span>${尾 ? `<span class="ag-call-meta">${esc(尾)}</span>` : ''}</div>`
    + `${文 ? `<div class="ag-call-body">${文}</div>` : ''}</div>`,
  纯: s => String(s == null ? '' : s)
    .replace(/```[\s\S]*?```|\[\[show:[^\]]*\]\]/g, m => m[0] === '`' ? ' (代码略) ' : ' ')
    .replace(/[#*`>|_]/g, '').replace(/\s+/g, ' ').trim(),   // 去掉 Markdown 的一行字(朗读、球上那句都用它)
  首: s => 切(渲染.纯(s), 60),
  时: ms => (ms |= 0) < 1000 ? ms + ' 毫秒' : (ms / 1000).toFixed(1) + ' 秒',
  down() {
    const box = 骨架.$('agent-convo');
    if (box && 渲染.stick) box.scrollTop = box.scrollHeight;
  },
  bubble: (cls, text) => text ? `<div class="ag-msg ${cls}">${渲染.body(text)}</div>` : '',
  body(text) { // 代码块外的换行靠 pre-wrap
    return String(text == null ? '' : text).split('```').map((seg, i) => i % 2
      ? `<pre>${esc(seg.replace(/^\w*\n/, ''))}</pre>`
      : 渲染.inline(seg)).join('');
  },
  inline: text => 渲染.md(esc(text))
    .replace(/\[\[show:([^\]\s]{1,200})\]\]/g, '<span class="ag-show" data-k="$1">⏳</span>'),
  md: s => 轻md(s),
  内(m) { // 一条用户消息里的字、图、引用
    let body = '', extra = '';
    片(m).forEach(p => {
      if (p.type === 'image' && p.data) {
        extra += 渲染.media('image/', `data:${p.mimeType || 'image/png'};base64,${p.data}`);
      } else if (p.type === 'ref') extra += `<span class="ag-show" data-k="${esc(p.key)}">⏳</span>`;
      else if (p.type === 'text' && p.name) extra += 渲染.tcard('📄', p.name, p.text);
      else if (p.type === 'text') body += 渲染.body(p.text);
    });
    return body + (extra ? `<div class="ag-parts">${extra}</div>` : '');
  },
  // 对话栏里的媒体只挂小的: 图先空着, 解码成 ≤480 宽的缩略图再显示(缩略图按原图记一份), 点开才换原图, 再点换回;
  // 音视频 preload=none, 按播放才加载。一整天的对话挂几十张 4K 截图也只占几十 MB, 不会把标签页撑爆
  缩: new Map(),   // 原图(长度 + 尾部) → 缩略图 blob 网址, 最多 200 张
  原: new Map(),   // 缩略图 blob 网址 → 原图, 点开时用
  纹: src => src.length + ':' + src.slice(-64),
  media(mime, src) {
    if (mime.startsWith('video/') || mime.startsWith('audio/')) {
      const tag = mime.startsWith('video/') ? 'video' : 'audio';
      return `<${tag} class="ag-media" src="${esc(src)}" preload="none" controls></${tag}>`;
    }
    const t = 渲染.缩.get(渲染.纹(src));
    if (t) return `<img class="ag-media" src="${t}">`;
    const id = 'agm' + Math.random().toString(36).slice(2, 9);
    渲染.缩图(src).then(u => {
      const el = document.getElementById(id);
      if (el) { el.src = u; el.removeAttribute('id'); 渲染.down(); }
    });
    return `<img class="ag-media ag-thumb" id="${id}" alt="…">`;
  },
  async 缩图(src) { // 解码一次, 画小存成 webp(留透明); 失败就用原图(和改之前一样)
    const k = 渲染.纹(src);
    if (渲染.缩.has(k)) return 渲染.缩.get(k);
    let u = src;
    try {
      const b = await createImageBitmap(await (await fetch(src)).blob());
      const s = Math.min(1, 480 / b.width), w = Math.max(1, Math.round(b.width * s)), h = Math.max(1, Math.round(b.height * s));
      if (s < 1) {
        const c = new OffscreenCanvas(w, h);
        c.getContext('2d').drawImage(b, 0, 0, w, h);
        u = URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.85 }));
        渲染.原.set(u, src);
      }
      b.close();
    } catch (e) {}
    渲染.缩.set(k, u);
    if (渲染.缩.size > 200) {
      const [k0, u0] = 渲染.缩.entries().next().value;
      渲染.缩.delete(k0);
      if (u0.startsWith('blob:')) { 渲染.原.delete(u0); URL.revokeObjectURL(u0); }
    }
    return u;
  },
  tcard: (icon, name, t, key) => 渲染.行(icon, `${esc(name)} · ${String(t).length} 字`
    + `<a class="ag-dl" data-n="${esc(name)}" data-ref="${esc(key || '')}">⤓ 下载</a>`, '',
    esc(短(String(t), 20000)), '', 'ag-info'),   // 文字卡片也是一行, 点开看全文
  async 下载(a) { // 名字没扩展名(粘贴的字)加 .txt, 免得存成网页; 库里有原件用原件
    const v = a.dataset.ref && await ctx.kv.get(a.dataset.ref).catch(() => null), n = a.dataset.n;
    const u = URL.createObjectURL(new Blob([v ? 渲染.hitOf(v, n).text : a.closest('.ag-call').lastChild
      .textContent]));
    Object.assign(document.createElement('a'), { href: u, download: /\.\w{1,6}$/.test(n) ? n : n + '.txt' })
      .click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  },
  json(x, max) { // 只截显示, 不动数据
    let s;
    try {
      s = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
    } catch (e) { }
    if (typeof s !== 'string') s = String(x);   // 转不成(自己套自己)或 undefined
    return s.length > max ? `${s.slice(0, max)}\n…(共 ${s.length} 字, 只显示前 ${max} 字)` : s;
  },
  call(c, res, t) { // 工具一行: 在做什么、主要参数、用时; 点开看参数(字照原样, 代码就是代码)和结果; t: 开跑的时刻
    let name = c.name, args = c.args;
    if (name === 'call' && args) [name, args] = [工具表.nameOf(String(args.path)), args.args];   // 经 call 的按真能力画
    const 对 = args && typeof args === 'object' ? Object.entries(args)
      : args === undefined ? [] : [['', args]],
      字 = v => typeof v === 'string' ? v : 渲染.json(v, 2000), path = 工具表.pathOf(name), 说 = 工具表.说明[path],
      brief = 短(对.map(([, v]) => 字(v).trim().split('\n')[0]).join(' · '), 60);
    return 渲染.行('', esc(说 || path) + (说 ? `<span class="ag-path">${esc(path)}</span>` : ''),
      brief + (brief ? ' · ' : '') + (res ? 渲染.时(res.ms) : AG.busy ? '跑着' : '没有结果'),
      esc((短(对.map(([k, v]) => (k && k + ': ') + 字(v)).join('\n'), 4000)
        + (res ? `\n\n${res.ok ? '结果' : '出错'}\n${渲染.json(res.content, 4000)}` : '')).trim()),
      c.id || res && res.toolCallId, (res ? (res.ok ? 'ag-ok' : 'ag-err') : AG.busy ? 'ag-run' : 'ag-info')
      + ' ag-tool', !res && t);
  },
  click(e) {
    const dl = e.target.closest('.ag-dl'), line = e.target.closest('.ag-call-line,.ag-chain-head'),
      img = e.target.closest('img.ag-media');
    if (dl) return 渲染.下载(dl);
    if (line) 渲染.opened[line.parentNode.dataset.k] = line.parentNode.classList.toggle('open');
    if (img) { // 点开换原图, 再点换回缩略图(原图不常驻)
      const big = img.classList.toggle('big');
      if (big && 渲染.原.has(img.src)) { img.dataset.t = img.src; img.src = 渲染.原.get(img.src); }
      else if (!big && img.dataset.t) { img.src = img.dataset.t; delete img.dataset.t; }
    }
  },
  async show(el) { // [[show:键]] 出屏: 读 kv, 媒体直接放, 文字做小卡
    const key = el.dataset.k;
    let hit = 渲染.cache.get(key);
    if (hit && hit.dead && Date.now() - hit.at > 10000) hit = null;   // 失效的 10 秒后再读: 东西可能晚到
    if (!hit) {
      const v = await ctx.kv.get(key).catch(() => null);
      hit = 渲染.hitOf(v, key);
      if (hit.src && /^image\//.test(hit.mime)) await 渲染.缩图(hit.src);   // 先做好缩略图, 画的时候直接用
      渲染.cache.delete(key);
      渲染.cache.set(key, hit);
      if (渲染.cache.size > 40) 渲染.cache.delete(渲染.cache.keys().next().value);
    }
    if (!el.isConnected) return;   // 等读库的工夫已经重画过, 新画的那个会再来
    const html = hit.dead ? `<span class="ag-card dead">⚠ 引用失效: ${esc(key)}</span>`
      : !hit.src ? 渲染.tcard('🗃', hit.name, hit.text, key)
        : /^(image|audio|video)\//.test(hit.mime) ? 渲染.media(hit.mime, hit.src)
        : `<a class="ag-card" download="${esc(hit.name)}" href="${esc(hit.src)}">⤓ ${esc(hit.name)}</a>`;
    el.insertAdjacentHTML('afterend', html);
    el.remove();
    渲染.down();
  },
  hitOf(v, key) {
    if (v == null) return { dead: true, at: Date.now() };
    const o = typeof v === 'object' ? v : {};
    const src = o.dataUrl || o.url || '', mime = o.mimeType || 渲染.mimeOf(src);
    if (src) return { src, mime, name: o.name || key };
    const text = typeof v === 'string' ? v : typeof o.text === 'string' ? o.text : JSON.stringify(v, null, 2);
    return { text, name: o.name || key };
  },
  mimeOf(src) {
    if (src.startsWith('data:')) return src.slice(5).split(/[;,]/)[0];
    const ext = ((src.split(/[?#]/)[0].match(/\.(\w+)$/) || [])[1] || '').toLowerCase();
    if (/^(png|jpe?g|gif|webp|svg)$/.test(ext)) return 'image/' + ext;
    if (/^(mp3|wav|ogg|m4a)$/.test(ext)) return 'audio/' + ext;
    return /^(mp4|webm|mov)$/.test(ext) ? 'video/' + ext : '';
  },
};
// ═ 引用 · 跟着: 状态, 骨架 ═
// 大的东西(长字、文件、点选卡片、工具拿到的大字节和图、截掉的长结果)存进库, 记录里只留一行引用; 这一问给模型原样。
// 参数里写 {"$ref": 键} 就换成原件(用法在系统提示里说一次)
const 引用 = {
  待: [],   // 输入框上方的卡片 {name, v: 字或 data 网址, mime, 卡}
  身: new Map(),   // 最近 16 份原样(只在内存), 刷新后没了就只给一行
  长: 1500,   // 粘贴、拖进来的字超过这么多变卡片
  文本名: /\.(txt|md|json|csv|js|mjs|ts|py|html?|css|xml|ya?ml|log|java|go|rs|rb|php|sh|sql|toml|ini)$/i,
  存(v, name, mime, from, 私) { // 回记录里的那一片; 私: 这一问也不给原样
    const key = `ref:${AG.sid}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      字 = !/^data:/.test(v);
    mime = mime || (字 ? 'text/plain' : v.slice(5, v.search(/[;,]/)));
    ctx.kv.set(key, { name, mimeType: mime, from, at: Date.now(), [字 ? 'text' : 'dataUrl']: v })
      .catch(e => 骨架.status('存不进库: ' + e.message));
    if (!私) 引用.身 = new Map([...引用.身].slice(-15).concat([[key, v]]));
    return { type: 'ref', key, name, mime, size: v.length };
  },
  行: p => '[引用 ' + p.name + ' · ' + p.mime + ' · ' + (/^text\//.test(p.mime) ? p.size + ' 字'
    : `${p.size * 0.75 / 1024 | 0} KB`) + ' · ' + p.key + ']',
  async 取(k) { // → [原件, 库里那条]; 只认引用的键
    const v = /^(ref|media):/.test(k) ? await ctx.kv.get(k) : null, s = v && (v.text || v.dataUrl);
    if (typeof s !== 'string') throw new Error('只认引用, 这个取不到: ' + k);
    return [s, v];
  },
  async 填(a) {
    if (!a || typeof a !== 'object') return a;
    if (typeof a.$ref == 'string') return (await 引用.取(a.$ref))[0];
    const o = Array.isArray(a) ? [] : {};
    for (const k in a) o[k] = await 引用.填(a[k]);
    return o;
  },
  藏: (t, ps) => [String(t || '').replace(/\bsk-[\w-]{16,}/g, k => { // 发出去前 sk- 变私引用, 只见后四位
    ps = (ps || []).concat(引用.存(k, 'sk-…' + k.slice(-4), '', '用户', 1));
    return `(sk-…${k.slice(-4)})`;
  }), ps],
  余: () => 引擎.预算 - 引擎.用,
  截(s, key) {
    const 头 = 切(s, 引擎.结果上限), 占 = 引擎.估([{ content: s }]), 余 = 引用.余();
    return `${头}\n…[截断: 共 ${s.length} 字, 给了前 ${头.length} 字(截在第 ${头.split('\n').length}`
      + ` 行); 全文存成 ${key}, 约占上下文 ${占 / 1e3 | 0}k, 还剩 ${余 / 1e3 | 0}k: `
      + `${占 < 余 / 2 ? '放得下, ref.read {key} 一次读完' : '放不下, ref.read {key, from, n} 分段读'}]`;
  },
  async read(a) { // 图排进下一条代发再看一次
    const [s, v] = await 引用.取(a.key),
      p = { type: 'ref', key: a.key, name: v.name || a.key, mime: v.mimeType || '', size: s.length };
    if (/^data:image\//.test(s)) return 引用.身.set(a.key, s) && 引擎.新图.push(p) && '图在紧跟的那条消息里';
    if (/^data:/.test(s)) return 引用.行(p) + '(这种你看不了; 原件要交给别的能力就在参数里写 {"$ref": 键})';
    const f = Math.max(0, a.from | 0), 占 = 引擎.估([{ content: s.slice(f) }]), 余 = 引用.余() / 2;
    const e = Math.min(s.length, f + (a.n || Math.max(2000, 占 < 余 ? s.length : (s.length - f) * 余 / 占 | 0)));
    return s.slice(f, e) + (e < s.length ? `\n…[第 ${f}–${e} 字, 共 ${s.length} 字; 接着读 from: ${e}]` : '');
  },
  收(d) { // 粘贴、拖进来的文件和长字变卡片; 回收没收
    const fs = [...(d && d.files || [])], t = fs.length ? '' : d && d.getData('text') || '';
    fs.forEach(引用.add);
    if (t.length > 引用.长) 引用.放('粘贴的字', t);   // 字数卡片和那一行里都会写
    return fs.length > 0 || t.length > 引用.长;
  },
  add(file) { // 像文字的读成字(能按段取), 别的读成 data 网址
    const r = new FileReader(), n = file.name || '文件', t = file.type || '';
    if (file.size > 20 << 20) return 骨架.status(n + ' 超过 20MB');
    r.onload = () => 引用.放(n, String(r.result), t);
    r.onerror = () => 骨架.status('读不了 ' + n);
    /^text\/|json|javascript|xml|yaml/.test(t) || 引用.文本名.test(n) ? r.readAsText(file) : r.readAsDataURL(file);
  },
  放(name, v, mime, 卡) {
    引用.待.push({ name, v, mime, 卡 });
    引用.render();
    骨架.expand(true);
  },
  take() {
    const ps = 引用.待.splice(0).map(a => 引用.存(a.v, a.name, a.mime, '用户'));
    引用.render();
    return ps;
  },
  render() {
    const box = 骨架.$('agent-atts');
    if (!box) return;
    box.innerHTML = 引用.待.map((a, i) => '<span class="ag-card">' + (/^data:image\//.test(a.v)
      ? `<img src="${esc(a.v)}">` : a.卡 ? '🎯' : '📄') + '<span class="ag-name">' + esc(a.name)
      + `</span><span class="ag-x" data-i="${i}">✕</span></span>`).join('');
    box.onclick = e => {
      const x = e.target.closest('.ag-x');
      if (x) 引用.待.splice(+x.dataset.i, 1) && 引用.render();
    };
  },
};
登记('ref.read', 引用.read, '按引用的键取原件: 字给 from/n 取一段, 不给 n 给到上下文放得下为止; 图再给你看一次。'
  + '这一问里的字和图已原样给你; 要把原件交给任何能力(脚本里也一样), 参数里写 {"$ref": 键}; 给人看写 [[show:键]]',
  { key: 'string', from: 'number?', n: 'number?' }, true);
// ↦ 借 petri:ai 的 厂商配置
// ↦ 借 petri:ai 的 协议适配
// ↦ 借 petri:ai 的 选模型
// ↦ 借 petri:ai 的 登记能力 · 要: 流式, 工具, 思考 · 按需: 大脑选择.要
// ═ 大脑选择 · 跟着: 状态, 骨架, 厂商配置, 协议适配, 选模型 ═
// 选哪家厂商的哪个模型、思不思考, 记在 kv; 都不选就是 null, 让 AI 配置块用它的默认。
// 行末 ⚙ 开借来的「选模型」小表, 语音、通话往 设 里加类
const 大脑选择 = {
  设: { 类: [], 空: {} },
  厂商们: null,   // 上次画时的厂商清单
  // 按需(单独导出带 AI 的哪几类): 选了厂商的类 + 小表刚加的, 写成 AI 的范围名。只看数据和 AI 的类名表(它总剪进来),
  // 不看这份里剪进来了哪几类
  async 要() {
    const 名 = 协议适配.类名, out = [];
    for (const k in 名) if (大脑选择.设.加?.includes(k) || await 厂商配置.用(k)) out.push(名[k]);
    return out;
  },
  开() {
    const 开着 = 骨架.$('agent-set');
    if (开着) return 开着.remove(), 大脑选择.摘();
    骨架.$('agent-brain').insertAdjacentHTML('afterend', '<div id="agent-set"><div></div></div>');
    const box = 骨架.$('agent-set').firstChild, g = 骨架.$('agent-set-b'), 宽 = 骨架.dock.clientWidth;
    box.style.left = Math.max(10, Math.min(g.offsetLeft + g.offsetWidth, 宽 - 10) - 300) + 'px';   // 贴着 ⚙ 弹
    box.style.maxHeight = Math.max(160, innerHeight - box.getBoundingClientRect().top - 10) + 'px';
    // 网址、Key 那几行: 单独导出或 AI 配置块停着(这份里剪进了模型调用)时一直有; Colony 里一家都没配时也有, 小表是 AI 配置的, 存进 AI 配置
    大脑选择.摘 = 选模型.挂(box, Object.assign(大脑选择.设,
      { 厂商: typeof 模型调用 !== 'undefined' || !(大脑选择.厂商们 || []).length }));
  },
  缺() { // 没配厂商、没选模型时的人话
    const ps = 大脑选择.厂商们, b = AG.brain || {};
    if (!ps) return '';
    if (!ps.length) return '还没配置厂商: 点大脑一行的 ⚙ 加一个';
    const p = ps.find(x => x.id === b.provider) || ps.find(x => x.default) || ps[0];
    return b.model || p.model ? '' : `厂商「${p.name}」还没选模型: 在大脑一行选一个`;
  },
  async load() {
    const b = await ctx.kv.get('agent.brain');
    AG.brain = b && (b.provider || b.model || b.think) ? b : null;
    骨架.听('ai:providers', 大脑选择.render);   // 厂商配置一变, 下拉跟着变
    ctx.cleanup(() => 大脑选择.摘 && 大脑选择.摘());   // 小浮层开着时本块被换掉
  },
  async render() {
    const box = 骨架.$('agent-brain');
    if (!box) return;
    const did = await 厂商配置.默认id(), provs = 大脑选择.厂商们 = (await 厂商配置.列表()).map(p => 厂商配置.摘要(p, did));
    const 钮 = '<button class="ag-ic" id="agent-set-b" title="模型设置">⚙</button>';
    if (!provs.length) {
      box.innerHTML = '<span>还没配置厂商, 点 ⚙ 加一个</span>' + 钮;
      骨架.$('agent-set-b').onclick = 大脑选择.开;
      return;
    }
    const b = AG.brain || {}, curM = b.model || '';
    const 认 = x => x.id === b.provider || x.name === b.provider;   // 旧记录记的是名字
    if (b.provider && !provs.some(认)) {   // 选的厂商删了
      await 大脑选择.pick('', curM, b.think, 1);
      return;
    }
    const p = b.provider ? provs.find(认) : provs.find(x => x.default) || provs[0];
    const cur = b.provider ? p.id : '';
    if (cur !== (b.provider || '')) await ctx.kv.set('agent.brain', AG.brain = { ...b, provider: cur });
    const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
    const ms = [...new Set([curM, p.model].concat(厂商配置.候选(p, 'chat')).filter(Boolean))];   // 存过的模型不在清单里也照样显示
    box.innerHTML = `<span>大脑${大脑选择.没了 ? ' (选的厂商没了, 用默认的)' : ''}</span>`
      + '<select id="agent-brain-p">' + opt('', '默认厂商', !cur)
      + provs.map(x => opt(x.id, x.name + (x.tested ? '' : ' (没测通)'), x.id === cur)).join('') + '</select>'
      + '<select id="agent-brain-m">' + opt('', '默认模型', !curM) + ms.map(m => opt(m, m, m === curM)).join('')
      + '</select><select id="agent-brain-t" title="思考">' + [['on', '思考'], ['', '默认'], ['off', '不思考']]
        .map(([v, t]) => opt(v, t, v === (b.think || ''))).join('') + '</select>' + 钮;
    骨架.$('agent-set-b').onclick = 大脑选择.开;
    骨架.$('agent-brain-p').onchange = e => 大脑选择.pick(e.target.value, '');   // 换厂商先清掉模型
    骨架.$('agent-brain-m').onchange = e => 大脑选择.pick(cur, e.target.value);
    骨架.$('agent-brain-t').onchange = e => 大脑选择.pick(cur, curM, e.target.value);
  },
  async pick(provider, model, think = (AG.brain || {}).think, 没了) {
    大脑选择.没了 = !!没了;
    AG.brain = provider || model || think
      ? { provider: provider || null, model: model || null, think: think || null } : null;
    await ctx.kv.set('agent.brain', AG.brain);
    大脑选择.render();
  },
};
// ═ 工具表 ═
// 模型看到的就是能力树本身: 提供者标了常用的给成工具, 别的只在系统提示里列一行、用 call 调; 新能力上线下一轮自动出现
const 工具表 = {
  名表: {},   // 工具名 → 能力路径
  说明: {},   // 能力路径 → 它自报的说明的头一小句, 工具行上给人看
  目录: [],   // 没标常用的能力: 一行一个
  不给: ['agent.', 'frame.inject', 'ai.chat', 'ai.realtime'],   // 自己的入口、模型自己调自己的、回活对象的不列
  给: p => !工具表.不给.some(x => x.endsWith('.') ? p.startsWith(x) : p === x),
  nameOf(path) { // 厂商只认字母数字 _ -、最多 64 个: 别的路径(中文、带 _、太长)尾上加指纹防撞
    const p = String(path), n = p.replace(/\./g, '__');
    const 名 = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(p) && n.length <= 64 ? n
      : n.replace(/[^\w-]/g, '_').slice(0, 56) + '_'
      + [...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
    工具表.名表[名] = path;
    return 名;
  },
  pathOf(name) { return 工具表.名表[name] || String(name).replace(/__/g, '.'); },
  形状(v) { // Stem 的写法('string?' / 'string|null?' / 'a|b' / 'string|string[]' / '[{…}]')转成 JSON Schema
    if (v && typeof v === 'object') return 工具表.参数(v);
    let s = String(v == null ? 'any' : v).replace(/\([^()]*\)\s*$/, '').trim();   // 尾上的(备注)原样留在描述里
    if (s.endsWith('?')) s = s.slice(0, -1).trim();
    const out = { description: String(v).slice(0, 200) };
    const 简单 = ['string', 'number', 'boolean', 'object', 'array', 'null'];
    if (s === 'any' || s === '') return out;
    if (s[0] === '[') { out.type = 'array'; out.items = { type: 'object' }; return out; }
    if (s[0] === '{' || s === 'Element') { out.type = 'object'; return out; }
    // "或": GPT / Claude / Grok 见到不合规的 schema 整个请求拒收(类型不能重复, 数组要有 items)
    const ps = [...new Set(s.split('|').map(x => x.trim()))];
    const 字 = ps.filter(x => !简单.includes(x) && !x.endsWith('[]'));
    if (ps.length > 1) {
      if (字.length === ps.length) out.enum = ps;
      else if (!字.length && !ps.some(x => x === 'array' || x.endsWith('[]'))) out.type = ps;
      else out.anyOf = ps.filter(x => !字.includes(x))
        .map(x => { const o = 工具表.形状(x); delete o.description; return o; })
        .concat(字.length ? [{ enum: 字 }] : []);
      return out;
    }
    s = ps[0];
    if (s.endsWith('[]')) { out.type = 'array'; out.items = 工具表.形状(s.slice(0, -2)); return out; }
    if (简单.includes(s)) out.type = s;
    if (s === 'array') out.items = {};
    return out;
  },
  参数(schema) {
    const properties = {}, required = [];
    for (const k in schema) {
      const raw = schema[k];
      properties[k] = 工具表.形状(raw);
      if (typeof raw !== 'string' || !/\?(\s*\([^()]*\))?\s*$/.test(raw)) required.push(k);
    }
    return { type: 'object', properties, ...required.length && { required } };
  },
  async list() {
    const caps = (colony.单独 ? [] : await ctx.call('stem.capabilities'))   // 单独打开没有 Stem 的能力清单
      .filter(c => 工具表.给(c.path) && !Object.values(c.schema || {}).includes('Element'));   // 要传页面元素的模型给不了
    caps.forEach(c => { 工具表.说明[c.path] = String(c.desc || '').split(/[:：,，;；。(（]/)[0].slice(0, 14); });
    // 渐进式披露: 目录只按前缀列名字, 说明和参数要用时 stem.capabilities {path} 再查
    const 组 = {};
    caps.filter(c => !c.common).forEach(c => {
      const i = c.path.indexOf('.'), 头 = i < 0 ? c.path : c.path.slice(0, i);
      (组[头] = 组[头] || []).push(i < 0 ? c.path : c.path.slice(i + 1));
    });
    工具表.目录 = Object.keys(组).map(k => `${k}: ${组[k].join(' ')}`);
    return caps.filter(c => c.common).map(c => ({
      name: 工具表.nameOf(c.path),
      description: 短(c.desc || c.path, 300),
      parameters: 工具表.参数(c.schema),
    })).concat({ name: 'call', description: '调目录里的能力: path 是能力路径, args 是它的参数',
      parameters: 工具表.参数({ path: 'string', args: 'object?' }) });
  },
};
// ═ 大脑 · 跟着: 状态, 大脑选择 ═
// 只管把一轮请求交给 AI 配置块、把流接回来。
// 带上会话 id: 接外部 agent 的网关靠它一个会话对一个大脑, 普通厂商的协议不认这个字段, 无副作用
const 大脑 = {
  chat: a => 大脑.流(a).catch(e => { // 没配厂商、没选模型: 换成大脑一行上的说法(AI 块的报错是写给调用它的程序看的)
    const 缺 = 大脑选择.缺();
    throw 缺 ? new Error(缺) : e;
  }),
  async 流(a) {
    const req = { messages: a.messages, tools: a.tools, stream: true, signal: a.signal, session: AG.sid,
      ...AG.brain, ...AG.换 };   // 大脑行选的厂商、模型、思考档(on|off)
    const it = await ctx.call('ai.chat', req).catch(e => {   // 单独导出、AI 停着时, 剪来的「登记能力」登记给 agent 自己
      throw /无此能力/.test(e.message) ? new Error('没有 AI 配置块在岗: 导入并启用 petri:ai, 配一个厂商') : e;
    });
    let content = '', 末 = {};
    const 流 = it && typeof it[Symbol.asyncIterator] === 'function' ? it : [Object.assign({ done: true }, it)];
    for await (const c of 流) { // 不流式的回复当成只有最后一片
      if (c.done) {
        if (c.content != null) content = c.content;
        末 = c;
        break;
      }
      if (c.delta) {
        content += c.delta;
        if (a.onDelta) a.onDelta(c.delta, content);
      } else if (c.reasoning && a.onThink) a.onThink(c.reasoning);   // 思考片不进正文, 只报进度
      else if (c.tool && a.onTool) a.onTool(c.tool, c.chars, c.text);   // 在写哪个工具的参数、写了多少、写到哪了
    }
    const t = 末.toolCalls;   // stop: 厂商说的停止原因, length = 被截断
    return { content, toolCalls: t && t.length ? t : null, stop: 末.stop || null, usage: 末.usage || null,
      没思考: 末.没思考 || '' };
  },
};
// ═ 系统提示 · 跟着: 状态, 工具表 ═
// 每轮发给模型的系统提示在这里拼: 改这段就改了 agent 的规矩(代码解读里能改、能换回原版); 原文加工具清单见 agent.prompt
const 系统提示 = async () => {
  let blocks = '';
  try {
    blocks = (await ctx.call('stem.blocks')).map(b => {
      if (b.broken) return `${b.id}(坏了: ${b.error})`;
      const a = b.about || {}, 技 = a.skills || [];
      return `${b.id} ${b.name}${b.running ? '' : `(${b.error || '没在跑'})`}`
        + (a.desc ? ': ' + a.desc : '')
        + (技.length ? ' · 技能: ' + 技.map(s => `${s.name}(${s.when})`).join('、') : '');
    }).join('\n');
  } catch (e) { blocks = `(读不到块清单: ${e.message})`; }
  const 偏好 = await ctx.kv.get('agent.memory').then(v => String(v || '').trim(), () => '');   // 难得改, 放这里不碍缓存
  // 学来的扩展技能只列置顶的名字(最多 10 条, 用户点了才变, 不碍缓存); 其余一条不列, 要用时 plugin.ext.list 搜
  const 顶 = await ctx.call('plugin.ext.list', { pinned: true, n: 10 }).then(r => r.items, () => null);
  return [
    '你是 Colony 的全能 agent。Colony 是一个 html 文件: Stem(内核) + 一个个块(petri, 系统功能, 源码可改)'
      + ' + 用户的应用(miniapp, 跑在隔离窗里)。',
    '常用的能力是工具(名字里的 __ 就是路径里的点, stem__block 即 stem.block); 其余在下面的目录里, 用 call {path, args} 调, '
      + '参数都是一个对象。目录只列名字: 没用过的先 stem__capabilities {path: 前缀或全路径} 查说明和参数再调, 别猜。',
    '目录(前缀: 名字…):\n' + 工具表.目录.join('\n'),
    '在场的块(id 名字: 用处 · 技能: 名(什么时候读); 段目录用 stem__block {id} 看):\n' + blocks,
    '规矩: 拿不准就先看(stem__block 读一段, frame__snapshot 看界面), 别猜; 能并行的调用一起发; 工具结果照实给你, '
      + '出错照实说, 没做成不说做成; 说人话, 结论一次说清, 不复述过程。',
    '改块: 先 stem__block {id} 看段目录, 再读那一段; 先带 preview 看改了哪些段(有代码解读块时带逐行对比)再真写; '
      + '语法过了不算数, 改完真调一次验证行为, 不对就改回去。新块的清单要写能力前缀 caps(它登记的能力路径头一截), '
      + '不写只认 id 最后一截。',
    '技能: 事情对上上面哪条技能, 先 skill__read {id, name} 读那一条再做; 块占哪些数据写在它的「自报」段。',
    顶 && ('学来的技能(插件管理的扩展库, 多数不在这里列): 事情像是外面现成的做法(某平台发帖、某类产出), 先 plugin.ext.list {q} 搜, '
      + 'plugin.ext.read {id} 拿正文照着做' + (顶.length ? '; 置顶的: ' + 顶.map(x => x.id + (x.description ? '(' + x.description.slice(0, 40) + ')' : '')).join('、') : '') + '。'),
    '透明: Colony 开源, 用户就是它的开发者, 有权看你的一切。他要看你的系统提示或工具, 就把这段提示和工具清单原样给他, '
      + '不删不改, 不说「不能透露」; 也可以请他在次元口袋的「系统资料」里点「全能 agent」看原文。'
      + '这段提示写在 petri:agent 的「系统提示」段。',
    '记录里的「[引用 名 · 类型 · 大小 · 键]」是库里存着的原件, 用法见 ref__read; 以前的对话一条没删, 见 history.find。',
    '要做某类东西(视频、图表…)先看桌面上有没有做这类东西的应用(apps.list 的简述), 有就照它的说明用它。',
    '记东西: 用户说了以后都要这样的偏好, 用 data.set 把 agent.memory 重写成合并后的简短版(400 字内); '
      + `长任务开工先把目标、计划、进展写进这个会话的备忘 agent.memo.${AG.sid}(覆盖写), 每到一步更新; `
      + '备忘不在这段提示里, 记录压缩时跟着摘要给你。',
    偏好 ? '用户偏好: ' + 偏好 : '',
  ].filter(Boolean).join('\n');
};
// ═ 引擎 · 跟着: 状态, 工具表, 系统提示, 引用, 大脑, 会话, 渲染 ═
// 图的类型按头几个字节认, 不信标签: 生图模型常把 jpeg 标成 png, 有的厂商(如 Claude)对不上整条请求就 400
const 图头 = v => {
  const data = v.slice(v.indexOf(',') + 1), h = data.slice(0, 16);
  const mimeType = h.startsWith('/9j/') ? 'image/jpeg' : h.startsWith('iVBOR') ? 'image/png' : h.startsWith('R0lGOD') ? 'image/gif'
    : h.startsWith('UklGR') ? 'image/webp' : v.slice(5, v.search(/[;,]/)) || 'image/png';
  return { mimeType, data };
};
// 一轮 = 请求 → 模型要用工具就并行执行、结果回灌 → 再请求, 直到它不再要工具。不解析文字, 不替模型判断对错
const 引擎 = {
  最多轮: 50,
  结果上限: 20000,   // 一条工具结果最多回灌这么多字, 最长的一段代码放得下
  新图: [],   // 这一步拿到的图的引用, 见 看图
  用: 0,   // 上一步量的上下文用量
  底: 0,   // 每一步都跟着发的系统说明和工具说明占多少, 见 头
  没压: '',   // 上次没压成的原因(给人看)
  预算: 256000,   // 上下文预算(本地估), settings:agent.ctxBudget 能改
  重试等: [2000, 5000, 10000],   // 大脑那头断了隔这么久再问(厂商给了等几秒就按它的), 还不行才报错
  工具等: 600000,   // 一个工具最多等这么久(视频要轮询十来分钟), 过了先当失败
  等锁: 15000,   // 接力时最多等别处放下这个会话的锁
  完: [],   // 一轮跑完挨个叫(朗读念结果、通话转告)
  压缩中: false,
  歇: 0,   // 摘要没写成后歇几步再压: 写不成的模型每步都去压只是白花钱
  摘要模板: '把下面的对话压成一份接力摘要, 给接着干活的你自己看。按这七条写, 共不超过 1500 字, 不复述闲聊:\n'
    + '1 用户最终目标(尽量用原话)\n2 已完成的动作\n3 已读、已改的对象: 只写块名/段名和关键 ID, 改了什么以 code.versions 为准'
    + '(有代码解读块时)\n4 现在代码和数据的状态\n5 试过但失败的做法和原因\n6 还没解决的问题\n7 下一步计划',
  abort: null,
  stopped: false,
  原因: '',
  插话: [],
  记(t) { AG.hist.push({ role: 'note', content: t, at: Date.now() }); },
  async 头(tools) { // 每一步都发的系统说明 + 工具说明: 记下占多少, 用量表和超预算都算上它
    tools = tools || await 工具表.list();   // 先拿工具表: 系统提示里的目录跟着它
    const sys = await 系统提示();
    引擎.底 = 引擎.估([{ content: sys + JSON.stringify(tools) }]);
    return sys;
  },
  喂(m, 旧) { // 记录 → 发给模型的消息; 说明行不喂。引用: 这一问里的给原样(图给图, 字照样截), 更早的只给一行
    const 展 = p => {
      if (p.type === 'image' && (旧 || !p.data)) return { type: 'text', text: `[图片 ${p.name || ''}]` }; // 旧记录
      const v = p.type === 'ref' && !旧 && 引用.身.get(p.key);
      return p.type !== 'ref' ? p : !v || /^data:(?!image\/)/.test(v) ? { type: 'text', text: 引用.行(p) }
        : /^data:/.test(v) ? { type: 'image', name: p.name, ...图头(v) }
        : { type: 'text', text: `[${p.name}]\n${v.length > 引擎.结果上限 ? 引用.截(v, p.key) : v}` };
    };
    const r = m.role, c = m.content;
    if (r === 'user') return { role: r, content: Array.isArray(c) ? c.map(展) : c };
    if (r === 'summary')   // 会话备忘不在系统提示里(每步都改, 放那里每步都把前缀缓存作废): 压缩时存进摘要, 跟着它给
      return { role: 'user', content: `[第 ${m.压了.join('–')} 条记录的摘要, 原文用 history.read 读]\n${c}`
        + (m.备忘 ? `\n\n[压缩时这个会话的备忘 agent.memo.${AG.sid}]\n${m.备忘}` : '') };
    if (r === 'assistant') return { role: r, content: c, ...m.toolCalls && { toolCalls: m.toolCalls } };
    return r === 'tool' ? { role: r, toolCallId: m.toolCallId, name: m.name, content: c } : null;
  },
  估(list) { // 本地估用量, 不读厂商报的数: 换模型不用改
    return list.reduce((n, m) => {
      const ps = 片(m);
      const s = ps.map(p => p.type === 'image' ? '' : String(p.text == null ? '' : p.text)).join('')
        + (m.toolCalls ? JSON.stringify(m.toolCalls) : '');
      const 汉 = (s.match(/[⺀-￿]/g) || []).length;
      return n + 汉 + (s.length - 汉) / 4 + 1200 * ps.filter(p => p.type === 'image').length;
    }, 0);
  },
  账(u) { // 厂商报的一步用量, 各家字段不同: 入 = 发过去的总数(含命中缓存的), 缓存 = 其中命中的, 出 = 回的
    const 读 = u.cache_read_input_tokens || 0, 入 = u.prompt_tokens ?? (u.input_tokens != null
      ? u.input_tokens + 读 + (u.cache_creation_input_tokens || 0) : u.promptTokenCount);
    return 入 == null ? null : { 入, 出: u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0,
      缓存: u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 读 };
  },
  分组(list) { // 一条消息加跟着它的工具结果是一组; 丢和压都按组, 不拆开
    const gs = [];
    list.forEach(m => { if (m.role !== 'tool' || !gs.length) gs.push([]); gs[gs.length - 1].push(m); });
    return gs;
  },
  起点() { // 最后一条摘要在第几条
    for (let i = AG.hist.length - 1; i > 0; i--) if (AG.hist[i].role === 'summary') return i;
    return 0;
  },
  装(不丢) { // 发给模型的 = 最后一条摘要 + 它之后的原文。还超预算才从旧到新成组丢, 头尾两组不丢; 不丢 = 只量大小
    const 起 = 引擎.起点(), 后 = AG.hist.slice(起), 末问 = 后.map(是问).lastIndexOf(true);   // 这一问里的引用给原样
    // 较早的工具结果只留开头, 每次请求少发很多。分界每 10 轮才往后挪一次: 挪一下, 从那条起的前缀缓存就作废, 每步挪就每步不中
    const 答 = 后.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0), 档 = Math.floor((答.length - 6) / 10) * 10;
    const 折 = 档 > 0 ? 答[档] : 0, 旧 = (m, i) => i < 折 && m.role === 'tool' && m.content.length > 600 ? {
      ...m, content: `${切(m.content, 400)}\n…[较早的工具结果只留开头, 原文 history.read {from: ${起 + i}, n: 1}]`
    } : m;
    const gs = 引擎.分组(后.map((m, i) => 引擎.喂(旧(m, i), i < 末问)).filter(Boolean));
    let 丢 = 0, n = !不丢 && 引擎.底 + 引擎.估(gs.flat());   // 估是逐条相加的: 丢一组减一组, 不用每次重估全部
    while (gs.length > 2 && n > 引擎.预算) { n -= 引擎.估(gs.splice(1, 1)[0]); 丢++; }
    if (丢) 骨架.status(`上下文超预算, 这一步没带最早的 ${丢} 组(原文还在)`);   // 不悄悄丢
    return gs.flat();
  },
  async 量() { // 量上下文用量, 写到用量表。量的是没丢之前的: 量丢过的, 大组一丢就永远"不超", 永远不压
    引擎.预算 = +(await ctx.kv.get('settings:agent.ctxBudget').catch(() => 0)) || 256000;
    const 用 = 引擎.用 = 引擎.底 + 引擎.估(引擎.装(true));
    骨架.用量(用, 引擎.预算, AG.hist.findLast(m => m.usage)?.usage);
    return 用;
  },
  验摘要(t) { // 摘要得照七条写: 太短、认不出几条就算没写成(曾经只回了半句乱码, 却替掉了前面 261 条记录)
    t = String(t || '').trim();
    const 条 = new Set((t.match(/^[\s#>*-]*[1-7一二三四五六七](?=[\s.、:：)）*])/gm) || []).map(x => x.slice(-1)));
    return !t ? '是空的' : t.length < 100 || 条.size < 6 ? `${t.length} 字, 七条认出 ${条.size} 条` : '';
  },
  async 压缩(硬) { // 对话过预算七成(硬 = 手动, 不看用量)就压: 旧的一段让模型写成摘要插进记录, 原文不删; 压不成照常发
    引擎.没压 = '';   // 系统说明和工具说明压不了, 不算进七成: 预算设得很小时不会每步都去压
    if (引擎.压缩中 || ((await 引擎.量()) - 引擎.底 < 引擎.预算 * 0.7 && !硬)) return false;
    if (!硬 && 引擎.歇 > 0) return !(引擎.没压 = `上次摘要没写成, 再过 ${引擎.歇--} 步再压`);
    const s = 引擎.起点(), gs = 引擎.分组(AG.hist.slice(s).filter(m => m.role !== 'note'));
    const 重 = g => 引擎.估(g.map(m => 引擎.喂(m, true)).filter(Boolean));
    let i = gs.length, 留 = 0, 问 = 0;   // 从新往旧留原文: 至少两组, 留到预算的三成; 手动压留到最近两问就够
    while (i > 1 && (gs.length - i < 2 || 留 + 重(gs[i - 1]) < 引擎.预算 * 0.3 && !(硬 && 问 >= 2)))
      留 += 重(gs[--i]), 问 += 是问(gs[i][0]);
    const old = gs.slice(0, i).flat(), p = i < gs.length ? AG.hist.indexOf(gs[i][0]) : AG.hist.length;
    if (old.length < 2) {
      引擎.没压 = s ? '最近两问要留原文, 更早的上次已经压过了' : '对话还短: 最近两问要留原文, 再往前没有了';
      return false;
    }
    const 尾 = (x, n) => {   // 超长留尾部: 新的比旧的要紧
      x = typeof x === 'string' ? x : JSON.stringify(x);
      return x.length > n ? '…' + x.slice(-n) : x;
    };
    const 行 = m => m.role === 'summary' ? '【上一份摘要】' + m.content
      : m.role + (m.name ? `(${m.name})` : '') + ': '
      + 尾(引擎.喂(m, true).content, m.role === 'tool' ? 600 : 2000)
      + (m.toolCalls ? ' 调用: ' + m.toolCalls.map(c => c.name + ' ' + 尾(c.args, 300)).join('; ') : '');
    const 原文 = 尾(old.map(行).join('\n'), 80000);
    引擎.压缩中 = true;
    骨架.status('正在压缩上下文…', true);
    try {
      const messages = [{ role: 'system', content: 引擎.摘要模板 }, { role: 'user', content: 原文 }];
      const r = await 大脑.chat({ messages, signal: (引擎.abort = new AbortController()).signal });   // 压的时候也能停
      const 坏 = 引擎.验摘要(r.content);
      if (坏) {   // 收下坏摘要, 它前面的原文就再也不发了: 当没压, 原文照发, 歇几步再试
        引擎.歇 = 5;
        引擎.没压 = `摘要没写成(${坏}), 原文照常发, ${引擎.歇} 步后再压; 老这样就换个模型`;
        if (!硬) 引擎.记(引擎.没压);
        return false;
      }
      const 备 = await ctx.kv.get('agent.memo.' + AG.sid).then(v => String(v || '').trim(), () => '');
      AG.hist.splice(p, 0, { role: 'summary', content: r.content.trim(), ...备 && { 备忘: 备 }, 压了: [s, p - 1], at: Date.now() });
      await 会话.save();
      return true;
    } catch (e) {
      引擎.没压 = 引擎.stopped ? '停了' : `写摘要时出错: ${e && e.message || e}`;
      return false;
    } finally {
      引擎.压缩中 = false;
      引擎.abort = null;
      骨架.status('');
    }
  },
  收纳(v, from, 深) { // 大字节(图、音频)存成引用, 里层的也算; 另拷一份再换, 不改人家的对象; 窗口元素只留名字
    const 大 = (k, x) => typeof x === 'string' && x.length > 4000
      && (/^(dataUrl|data|base64|audioBase64)$/.test(k) || /^data:[^,]{0,80};base64,/.test(x));
    const 存 = (x, mime) => {
      const p = 引用.存(/^data:/.test(x) ? x : `data:${mime || 'application/octet-stream'};base64,${x}`,
        from + ' 的结果', 0, from);
      if (/^image\//.test(p.mime)) 引擎.新图.push(p);
      return 引用.行(p);
    };
    if (大('', v)) return 存(v);
    if (!v || typeof v !== 'object' || 深 > 6) return v;
    const d = v.nodeType === 1 && v.dataset;
    if (d && d.colonyApp) return { frame: d.colonyApp, miniappId: d.miniapp || null,
      note: '窗已挂上, 用 frame.snapshot 看它' };
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) return v;
    const o = Array.isArray(v) ? [] : {};
    for (const k in v) o[k] = 大(k, v[k]) ? 存(v[k], v.mimeType) : 引擎.收纳(v[k], from, (深 || 0) + 1);
    return o;
  },
  文本(out, from) { // 先收纳再截, 截掉的全文存成引用; ref.read 不截(它自己按上下文剩多少给)
    const v = 引擎.收纳(out, from), s = v === undefined ? 'null' : typeof v === 'string' ? v : JSON.stringify(v);
    return from === 'ref.read' || s.length <= 引擎.结果上限 ? s : 引用.截(s, 引用.存(s, from + ' 的结果', 0, from).key);
  },
  补结果() { // 上次没跑完会留下没有结果的工具调用, 厂商不收这样的记录: 紧跟着发起它的那条补一句实话
    const 有 = new Set(AG.hist.filter(m => m.role === 'tool').map(m => m.toolCallId));
    AG.hist.slice().forEach(m => (m.toolCalls || []).filter(c => !有.has(c.id)).forEach(c => {
      AG.hist.splice(AG.hist.indexOf(m) + 1, 0, {
        role: 'tool', toolCallId: c.id, name: 工具表.pathOf(c.name), ok: false, at: Date.now(),
        content: '结果未知: 执行到一半页面关了或本块重启了。先看它生效没有, 再决定要不要重做'
      });
    }));
  },
  已用轮() { // 最后一问之后助手说了几条。不另存数字, 换了实例也接着数
    let n = 0;
    for (let i = AG.hist.length - 1; i >= 0 && !是问(AG.hist[i]); i--)
      n += AG.hist[i].role === 'assistant';
    return n;
  },
  看图() { // 工具结果只能是文字: 这一步拿到的图(工具给的、ref.read 要再看的)另起一条代发, 记录里只留引用
    const ps = 引擎.新图.splice(0);
    if (ps.length) AG.hist.push({ role: 'user', 代发: true, at: Date.now(),
      content: [{ type: 'text', text: '[刚才拿到的图。这条不是用户发的]' }].concat(ps) });
  },
  截断(r) {
    const 字 = (r.content || '').length + JSON.stringify(r.toolCalls || '').length - 2;
    const tk = r.usage && r.usage.completion_tokens, 共 = tk ? `共 ${tk} token(含思考, 这家单次大约就这么多)` : '';
    AG.hist.push({ role: 'user', 代发: true, at: Date.now(), content: `[不是用户发的: 你上条回答写到约 ${字} 字${共}`
      + `被截断${r.toolCalls ? ', 写了一半的调用已丢' : ''}; 拆成更小的几块重来]` });
  },
  锁(sid, 等) { // 库可能开在几个标签页里: 每个会话一把锁。回放锁的函数(等它真放掉); 别处拿着(等「等」毫秒没放)回 null
    if (!navigator.locks) return () => { };
    return new Promise(ok => {
      const 份 = (globalThis.__stemBoot || {}).id || '';   // 带上是哪一份
      const q = navigator.locks.request(`agent-run:${份}:${sid}`,
        等 ? { signal: AbortSignal.timeout(等) } : { ifAvailable: true },   // Colony: 窗里的拷贝和外面同源时不抢一把锁
        l => l && new Promise(放 => ok(() => (放(), q))));
      q.then(() => ok(null), () => ok(null));
    });
  },
  async 接力() { // 新实例开机: 上一轮没跑完(本块替换了自己、页面刷新了)就接着跑。只认库里的记号和记录的时间
    const r = await ctx.kv.get('chat.running').catch(() => null), 放 = r && await 引擎.锁(r.sid, 引擎.等锁);
    if (!放) return;   // 别的标签页在跑, 不抢; 同一页里上一个实例收完尾会放锁
    await 放();
    if (!await ctx.kv.get('chat.running').catch(() => null)) return;   // 等的工夫它跑完了
    await ctx.kv.del('chat.running').catch(() => { });
    await 会话.load();
    const last = AG.hist[AG.hist.length - 1];
    if (r.sid !== AG.sid || !last) return;
    if (Date.now() - (last.at || 0) < 120000) { 骨架.expand(true); return 引擎.run(null, null, true); }
    引擎.记('上次那一轮没做完, 说"继续"就接着做');
    await 会话.save();
  },
  换过: [],   // 这一轮断过的模型, 头一个是原来选的
  async 换大脑(e) { // 原来选的重试完还断: 先换同类(同家同档 > 同家), 同家连断两个再换别家; 最多换两次, 只管这一轮, 换了就说
    if (引擎.换过.length >= 2) return false;
    const ps = await 厂商配置.列表().catch(() => []), did = await 厂商配置.默认id().catch(() => null);
    const b = Object.assign({}, AG.brain, AG.换);
    const p = ps.find(x => x.id === b.provider || x.name === b.provider) || ps.find(x => x.id === did) || ps[0];
    const cur = b.model || p?.model;
    if (!p || !cur) return false;
    引擎.换过.push(cur);
    const 段 = m => String(m).toLowerCase().split(/[-_/.:\s]+/).filter(x => x && !/^\d/.test(x));   // claude-opus-5-5 → [claude, opus]
    const 原 = 段(引擎.换过[0]), 别家 = 引擎.换过.length >= 2 && 引擎.换过.every(m => 段(m)[0] === 原[0]);
    const 分 = m => {
      const s = 段(m);
      return 别家 ? (s[0] === 原[0] ? -1 : m === p.model ? 1 : 0)   // 别家先换这家的默认模型
        : (s[0] === 原[0] ? 2 : 0) + (s[1] && s[1] === 原[1] ? 1 : 0);
    };
    const 候 = 厂商配置.文本(p).filter(m => !引擎.换过.includes(m)).sort((x, y) => 分(y) - 分(x) || (y > x ? 1 : -1));
    if (!候.length || 分(候[0]) < 0) return false;
    AG.换 = { provider: p.id, model: 候[0] };
    const 话 = `大脑「${cur}」重试完还是断(${短(e.message, 80)}), 这一轮换成${别家 || 分(候[0]) <= 0 ? '别家的' : '同类的'}「${候[0]}」接着做, 下一轮换回`;
    引擎.记(话);
    骨架.status(话);
    渲染.paint();
    return true;
  },
  async 问(req) { // 问大脑一次; 断了隔一会再问, 再断换模型(见 换大脑); 等时点了停止就不问
    for (let i = 0; ; i++) {
      引擎.abort = new AbortController();
      try {
        return await 大脑.chat(Object.assign({ signal: 引擎.abort.signal }, req));
      } catch (e) {
        const 断 = e && (e.retry || e.name === 'TypeError' || e.status >= 500 || e.status === 429
          || /bad record MAC|EOF|ECONNRESET|socket|network|Failed to fetch|timeout|超时|连不上|网络|tls|5(02|03|04)/i.test(e.message));
        if (!断 || 引擎.stopped) throw e;
        if (i >= 引擎.重试等.length) { // 重试完还断: 换个模型接着问, 换上的每个只问一次
          if (!await 引擎.换大脑(e)) throw e;
          i = 引擎.重试等.length - 1;
          continue;
        }
        const 等 = Math.min(e.等 || 引擎.重试等[i], 60000);
        骨架.status(`${e.status === 429 ? '被厂商限流' : '大脑那头断了'}, ${等 / 1000} 秒后第 ${i + 1} 次重试…`);
        AG.live.text = '';   // 说到一半的那几个字先收掉
        渲染.paint();
        // 只用一个定时器: 标签页在后台时浏览器把每个定时器放慢到 1 秒, 一串小的会把 2 秒拖成 20 秒; 点停止马上醒
        await Promise.race([new Promise(ok => setTimeout(ok, 等)), 引擎.停了]);
        if (引擎.stopped) throw e;
      } finally {
        引擎.abort = null;
        AG.live.text = '';
      }
    }
  },
  async 执行(call) {
    const t0 = Date.now(), a = call.args || {}, 通 = call.name === 'call';   // call: 调目录里的能力
    const path = 通 ? String(a.path || '') : 工具表.pathOf(call.name);
    let out, ok = true, 钟;
    try { // 停止、超时能打断卡住的工具; 结果转不成文字(自己套自己、超大整数)也只算这一步失败
      if (!工具表.给(path)) throw new Error('这个能力不给模型用: ' + path);
      out = 引擎.文本(await Promise.race([引用.填(通 ? a.args : a).then(x => ctx.call(path, x)),
        引擎.停了.then(() => { throw new Error('已停止; 这个工具可能还在后台跑') }),
        new Promise((_, no) => { 钟 = setTimeout(() => no(new Error('等了 ' + 引擎.工具等 / 1000
          + ' 秒没回, 先当失败; 它可能还在后台跑')), 引擎.工具等); })]), path);
    } catch (e) {
      ok = false;
      out = 引擎.文本({ error: e && e.message || String(e) }, path);
    }
    clearTimeout(钟);
    const at = Date.now();
    AG.hist.push({ role: 'tool', toolCallId: call.id, name: path, content: out, ok, ms: at - t0, at });
  },
  async run(text, parts, 接着) { // 接着: 不加新的用户消息, 从记录停下的地方往下跑
    const content = parts && parts.length ? [{ type: 'text', text: text || '' }].concat(parts) : text;
    if (AG.busy) return 接着 || 引擎.interject(content);
    AG.busy = true;   // 先立"忙"再等别的: 不然两句连发开出两轮
    const 放锁 = await 引擎.锁(AG.sid);
    if (!放锁) {
      AG.busy = false;
      骨架.status('另一个标签页正在跑这个会话, 等它跑完再说');
      return 骨架.回填(text);
    }
    引擎.stopped = false;
    引擎.换过 = [];
    AG.换 = null;
    引擎.停了 = new Promise(ok => { 引擎.叫停 = ok; });
    骨架.setBusy(true);
    try {
      const h = await ctx.kv.get(会话.keyOf(AG.sid)).catch(() => null);
      if (Array.isArray(h)) AG.hist = h;   // 别的页或上一个实例可能刚写过: 接着库里最新的写
      引擎.补结果();
      if (!接着) AG.hist.push({ role: 'user', content, at: Date.now() });
      引擎.接话();
      await ctx.kv.set('chat.running', { sid: AG.sid, at: Date.now() }).catch(() => { });
      await 会话.save();
      { // 工具连用上限: settings:agent.maxRounds 能改, 没设 = 50, 0 或负数 = 不限
        const m = await ctx.kv.get('settings:agent.maxRounds').catch(() => null);
        引擎.最多轮 = m == null ? 50 : +m > 0 ? +m : Infinity;
      }
      while (引擎.已用轮() < 引擎.最多轮) {
        await 引擎.压缩();
        if (引擎.stopped || AG.disposed) break;
        const tools = await 工具表.list();   // 先拿工具表: 系统提示里的目录跟着它
        const msgs = [{ role: 'system', content: await 引擎.头(tools) }, ...引擎.装()];
        const t0 = Date.now(), 画 = (k, v) => { AG.live[k] = v; 渲染.paint(); };
        const q = { messages: msgs, tools, onDelta: (d, all) => 画('text', all),
          onThink: t => 画('思', AG.live.思 + t),
          onTool: (n, chars, text) => 画('写', { name: 工具表.pathOf(n), chars, text }) };
        Object.assign(AG.live, { t0, 思: '', 写: null });
        渲染.paint();
        let r;
        try {
          r = await 引擎.问(q);
          if (!r.content && !r.toolCalls && r.stop !== 'length') r = await 引擎.问(q);
        } catch (e) {
          if (!引擎.stopped) 引擎.记(`出错: ${e && e.message || e}`);
          break;
        }
        Object.assign(AG.live, { t0: 0, 写: null });
        const a = { role: 'assistant', content: r.content, at: Date.now(), ms: Date.now() - t0 };
        const 账 = r.usage && 引擎.账(r.usage);
        if (账) { a.usage = 账; 骨架.用量(引擎.用, 引擎.预算, 账); }   // 厂商报的用量随记录存下: 看缓存命中、查花费
        if (AG.live.思) a.think = AG.live.思;
        const 断 = r.stop === 'length';
        if (r.toolCalls && !断) a.toolCalls = r.toolCalls;
        AG.hist.push(a);
        if (断) 引擎.截断(r);
        else if (!r.content && !r.toolCalls) 引擎.记('模型两次都回了空话(没字也没调工具): 换个说法或换个模型再试');
        if (r.没思考) 引擎.记('这家不认「思考」档, 这一问按默认问的: ' + 短(r.没思考, 150));
        await 会话.save();
        if (引擎.stopped || !断 && !r.toolCalls) break;
        if (!断) await Promise.all(r.toolCalls.map(c => 引擎.执行(c)));
        引擎.看图();
        await 会话.save();
        引擎.接话();
        if (引擎.已用轮() >= 引擎.最多轮)
          引擎.记(`工具已连用 ${引擎.最多轮} 轮, 到上限了先停一下; 说"继续"接着做`);
      }
      if (引擎.stopped) 引擎.记(引擎.原因);
    } finally {
      if (AG.换) 引擎.记(`这一轮后面是「${AG.换.model}」答的; 下一轮换回「${引擎.换过[0]}」`);
      AG.换 = null;
      AG.busy = false;
      AG.live.text = '';
      AG.live.t0 = 0;
      骨架.setBusy(false);
      await 会话.save().catch(e => 骨架.status('存盘失败: ' + e.message));
      if (!AG.disposed) await ctx.kv.del('chat.running').catch(() => { });   // 被替换的不清: 新实例靠它接着跑
      await 放锁();
      if (!AG.disposed) 引擎.完.forEach(f => f());
      if (引擎.插话.length && !AG.disposed) 引擎.run(null, null, true);
    }
  },
  stop(reason) { // 被替换时不掐正在跑的工具: 多半就是换掉自己的那次写入
    if (!AG.busy) return;
    引擎.stopped = true;
    引擎.原因 = reason || '用户停止';
    if (引擎.abort) { try { 引擎.abort.abort(); } catch (e) { } }
    if (引擎.叫停 && !AG.disposed) 引擎.叫停();
  },
  interject(content) {
    引擎.插话.push(content);
    骨架.status('已记下, 这一步做完就带上');
  },
  接话() { 引擎.插话.splice(0).forEach(content => AG.hist.push({ role: 'user', content, at: Date.now() })); },
};
// ═ 眼手 ═
// 看页面(眼)和点、填、按键、拖(手)是同一份代码: 注进每个隔离窗, 也直接跑在 Colony 自己的页面上, 两边行为才一样。
// 手动前先调 ui.point, 界面块在就把光标滑过去
function 眼手代码(colony) {
  const 略 = (colony.略 || {}).nodeType === 1 && colony.略;   // 在 Colony 自己的页面上跳过 agent 面板
  const 截 = (s, n) => { // 不截在 emoji 中间
    s = String(s);
    return s.length <= n ? s : s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n)
      + `…(共 ${s.length} 字)`;
  };
  let ring = window.__colonyTrace;
  if (!ring) { // 块热替换后会在同一页面再跑一遍, console 不能包两层
    ring = window.__colonyTrace = [];
    ring.丢 = 0;
    const rec = (level, args) => {
      const msg = 截(args.map(x => {
        try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); }
      }).join(' '), 500);
      if (ring.push({ level, msg, at: Date.now() }) > 200) {
        ring.shift();
        ring.丢++;
      }
    };
    ['log', 'warn', 'error'].forEach(k => {
      const raw = console[k];
      console[k] = (...a) => (rec(k, a), raw.apply(console, a));
    });
    window.addEventListener('error', e => rec('error', [e.message || '脚本出错']));
    window.addEventListener('unhandledrejection', e =>
      rec('error', [`没接住的 Promise: ${e.reason && e.reason.message || e.reason}`]));
  }
  const text = el => (el.textContent || '').trim().replace(/\s+/g, ' ');
  const label = el => text(el) || el.value || el.getAttribute('aria-label') || '';
  const page = () => (document.body || document.documentElement).innerText.replace(略 ? 略.innerText : '', '')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
  const laid = () => !!(document.body && document.body.getBoundingClientRect().width); // 刚挂上的窗可能还没排版
  const settle = () => new Promise(rs => laid() ? rs() : setTimeout(rs, 80));
  const visible = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width > 0 && r.height > 0) return cs.visibility !== 'hidden';
    return !laid() && cs.display !== 'none' && cs.visibility !== 'hidden'; // 整页还没排版时只能按样式判
  };
  const all = q => [...document.querySelectorAll(q)].filter(el => visible(el) && !(略 && 略.contains(el)));
  const sel = el => { // 从最近的 id 写到元素本身, 传回来才唯一
    if (el.id) return '#' + CSS.escape(el.id);
    let p = el.tagName.toLowerCase(), par = el.parentElement;
    if (!par) return p;
    const sib = [...par.children].filter(c => c.tagName === el.tagName);
    if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(el) + 1})`;
    return par === document.body || par === document.documentElement ? p : sel(par) + ' > ' + p;
  };
  const inner = els => { // 文字相同的元素一层套一层时要最里面那个
    const deep = el => el.querySelectorAll('*').length;
    return els.sort((x, y) => deep(x) - deep(y))[0];
  };
  const find = a => {
    if (a.x != null) return document.elementFromPoint(a.x, a.y);
    if (a.selector) {
      try { return document.querySelector(a.selector); }
      catch (e) { throw new Error('选择器写错了: ' + a.selector); }
    }
    if (!a.text) return null;
    const t = a.text.trim(), els = all('*');
    return inner(els.filter(el => label(el) === t)) || inner(els.filter(el => label(el).includes(t))) || null;
  };
  const 处 = (a, el) => { // [元素, x, y], 没给坐标取正中
    const r = (el = el || find(a)) && el.getBoundingClientRect();
    return el && [el, a.x != null ? +a.x : r.left + r.width / 2, a.y != null ? +a.y : r.top + r.height / 2];
  };
  // 报一声手要到哪, 界面块在就把光标滑过去
  const 到 = (x, y) => Promise.resolve(colony.call && colony.call('ui.point', { x, y })).catch(() => { });
  const 发 = (el, ts, x, y, dt) => ts.split(' ').forEach(t => { // 在 (x, y) 上发几个指针、鼠标或拖放事件
    const E = /^p/.test(t) ? PointerEvent : /^dr/.test(t) ? DragEvent : MouseEvent;
    el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
      pointerId: 1, dataTransfer: dt }));
  });
  const safe = v => { // 要能变 JSON; 太长由 agent 那头统一截
    try {
      return JSON.parse(JSON.stringify(v === undefined ? null : v, (k, x) => x && x.nodeType === 1
        ? `<${x.tagName.toLowerCase()}${x.id ? '#' + x.id : ''}>` : typeof x === 'function' ? '[函数]' : x));
    } catch (e) { return String(v); }
  };
  const 页态 = () => document.documentElement.outerHTML   // 结构、样式和框里的值
    + [...document.querySelectorAll('input,select,textarea')].map(e => e.value + e.checked);
  const 做 = async (p, fn, 后) => { // 光标先到, 做完(拖要一会儿)等一拍, 异步的更新也算, 再比页面变没变
    const el = p[0], 提醒 = el.disabled ? '元素被禁用' : visible(el) ? '' : '元素看不见';
    await 到(p[1], p[2]);
    const 前 = 页态();
    await fn();
    await new Promise(rs => setTimeout(rs, 80));
    return Object.assign({ ok: true, changed: 页态() !== 前 }, 后 ? 后() : {}, 提醒 ? { 提醒 } : {});
  };
  const 好字 = s => (s.toWellFormed ? s.toWellFormed() : s)   // 半个 emoji 编码成网址会崩
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '');   // XML 不认的字(如 U+FFFF)混进来, 整页就画不成图
  const AF = (async () => { }).constructor;
  const png = (c, kind) => ({ ok: true, kind, mimeType: 'image/png', dataUrl: c.toDataURL('image/png'),
    width: c.width, height: c.height });
  colony.expose('__snapshot', () => {
    const 前 = (q, f) => {
      const l = all(q);
      return l.slice(0, 40).map(f).concat(l.length > 40 ? [`…(共 ${l.length} 个)`] : []);
    };
    return settle().then(() => ({
      title: document.title,
      text: 截(page(), 8000),
      buttons: 前('button,[role=button],input[type=button],input[type=submit]',
        el => ({ text: 截(label(el), 80), selector: sel(el) })),
      inputs: 前('input:not([type=button]):not([type=submit]),textarea,select', el => ({
        selector: sel(el), type: el.type, value: el.type === 'password' ? (el.value ? '(密码, 不读)' : '')
          : 截(el.value, 200), placeholder: el.placeholder })),
      links: 前('a[href]', el => ({ text: 截(text(el), 80), href: el.href })),
    }));
  });
  colony.expose('__click', a => settle().then(() => {
    const p = 处(a);
    if (!p) return { ok: false, error: `没找到要点的元素: ${a.selector || a.text || '(没给 selector、text 或 x, y)'}` };
    return 做(p, () => 发(p[0], 'click', p[1], p[2]));
  }));
  colony.expose('__drag', a => settle().then(() => { // 按下, 分 8 步挪到 to(光标一起滑), 松开; draggable 的走拖放
    const p = 处(a), q = 处(a.to || {}), dt = new DataTransfer(), el = p && p[0];
    let i = 0, D = el;
    while (D && !D.draggable) D = D.parentElement;   // 按在可拖的东西里面, 拖的就是它
    return !p || !q ? { ok: false, error: `没找到${p ? '放到哪(to)' : '要拖的元素'}` } : 做(p, () => {
      发(el, 'pointerdown mousedown', p[1], p[2]);
      if (D) 发(D, 'dragstart', p[1], p[2], dt);
      到(q[1], q[2]);
      return new Promise(rs => {
        (function 步() {
          const x = p[1] + (q[1] - p[1]) * ++i / 8, y = p[2] + (q[2] - p[2]) * i / 8;
          const 过 = D ? document.elementFromPoint(x, y) || q[0] : el;
          发(过, D ? 'dragover' : 'pointermove mousemove', x, y, dt);
          if (i < 8) return setTimeout(步, 50);
          if (D) 发(q[0], 'drop', x, y, dt), 发(D, 'dragend', x, y, dt);
          rs(发(el, 'pointerup mouseup', x, y));
        })();
      });
    });
  }));
  colony.expose('__input', a => {
    const el = a.selector && find(a);
    if (!el) return { ok: false, error: `没找到输入框: ${a.selector || '(没给 selector)'}` };
    const v = a.value == null ? '' : String(a.value);
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); // 直赋 value 会被 React 忽略
    return 做(处(a, el), () => {
      el.focus();
      if (el.isContentEditable) el.textContent = v; else if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, () => // 页面可能改写或拒收: 回框里真正的值
      ({ value: el.type === 'password' ? '(密码, 不读)' : el.isContentEditable ? el.textContent : el.value }));
  });
  colony.expose('__key', a => {
    const el = a.selector ? find(a) : document.activeElement || document.body;
    if (!el) return { ok: false, error: '没找到元素: ' + a.selector };
    if (!a.key) return { ok: false, error: '缺 key, 如 Enter、Escape、ArrowDown' };
    return 做(处(a, el), () => ['keydown', 'keypress', 'keyup']
      .forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: a.key, bubbles: true, cancelable: true }))));
  });
  colony.expose('__eval', a => {
    const expr = String(a.expr || '');
    let f;
    try { f = new AF(`return (${expr}\n);`); } catch (e) { f = new AF(expr); } // 先当表达式, 不成再当语句体
    return f().then(v => ({ ok: true, value: safe(v) }));
  });
  colony.expose('__waitFor', a => {
    const limit = Math.min(Math.max(a.timeout | 0 || 8000, 100), 60000), t0 = Date.now();
    const hit = () => {
      if (a.selector) { const el = find(a); return !!(el && visible(el)); }
      return !a.text || page().includes(a.text);
    };
    return new Promise(rs => {
      const end = found => {
        obs.disconnect();
        clearTimeout(tm);
        const ms = Date.now() - t0;
        rs(found ? { ok: true, found: true, ms } : { ok: false, found: false, ms, error: ms + ' 毫秒内没出现' });
      };
      const obs = new MutationObserver(() => { if (hit()) end(true); });
      const tm = setTimeout(() => end(false), limit);
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
        characterData: true });
      if (hit()) end(true);
    });
  });
  colony.expose('__screenshot', () => {
    const cv = [...document.querySelectorAll('canvas')]
      .sort((x, y) => y.width * y.height - x.width * x.height)[0];
    if (cv) { // 有画布就取像素, 比把页面画成图准
      try { return png(cv, 'canvas'); }
      catch (e) { return { ok: false, error: '画布取不出像素(画过跨域图): ' + e.message }; }
    }
    const root = document.documentElement, cl = root.cloneNode(true),
      w = Math.min(root.clientWidth || 800, 1600), h = Math.min(root.clientHeight || 600, 1600);
    cl.querySelectorAll('script').forEach(n => n.remove()); // 脚本画不出来, 只会把图撑大
    return new Promise(rs => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
          const g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, w, h);
          g.drawImage(im, 0, 0);
          rs(png(c, 'dom'));
        } catch (e) { rs({ ok: false, error: '页面画成图后取不出像素(含跨域图): ' + e.message }); }
      };
      im.onerror = () => rs({ ok: false, error: '页面画不成图, 改用 frame.snapshot 看文字' });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
        + '<foreignObject width="100%" height="100%">' + 好字(new XMLSerializer().serializeToString(cl))
        + '</foreignObject></svg>';
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  });
  colony.expose('__trace', a => {
    const k = a.limit | 0 || 50, out = a.level ? ring.filter(t => t.level === a.level) : ring;
    const 头 = out.length > k || ring.丢 ? [{ level: 'note', msg: `共留 ${ring.length} 条`
      + `${ring.丢 ? `(更早丢了 ${ring.丢} 条)` : ''}, 给了最近 ${Math.min(k, out.length)} 条` }] : [];
    return 头.concat(out.slice(-k));
  });
  colony.expose('__ping', () => ({ ok: true }));
}
const 眼手 = { shim: `(${眼手代码})(colony);` };
const 宿主 = {}; // 同一份眼手直接跑在 Colony 自己的页面上, 'host' 就能看能点
let 宿主错 = '';
try {
  new Function('colony', 眼手.shim)({ expose: (n, f) => { 宿主[n] = f; }, call: ctx.call, 略: ctx.root });
} catch (e) { 宿主错 = e.message; }
const 调 = async (frame, path, args) => {
  try {
    if (frame !== 'host') return await ctx.call('stem.invoke', { frame, path, args });
    if (!宿主[path]) throw new Error('宿主眼手没装上: ' + 宿主错);
    return await 宿主[path](args);
  } catch (e) {
    const m = e && e.message || String(e);
    return { ok: false, error: /未暴露/.test(m) ? '这个窗挂载时眼手还没装上, 重开它一次就有了' : m };
  }
};
const 列窗 = async () => [{ frame: 'host', 说明: 'Colony 自己的页面' }].concat(
  (await ctx.call('stem.frames')).map(f => ({ frame: f.frame, miniappId: f.miniappId, alive: f.alive })));
const 转 = 路径 => a => 调(a.frame || 'host', 路径, a), F = 'string?(不填 = host)';
登记('frame.list', 列窗, '列能看能操作的窗; host 是 Colony 自己的页面(不含 agent 面板), 其它用 frame 或 miniappId 指', {});
登记('frame.snapshot', 转('__snapshot'), '看一个窗: 标题、可见文字(≤8000 字)、按钮、输入框、链接', { frame: F }, true);
登记('frame.click', 转('__click'), '点一个元素, 按选择器、文字或窗里的坐标 x, y 找; changed = 页面(含样式、框里的值)变没变, 别处自己在动的也算',
  { frame: F, selector: 'string?', text: 'string?', x: 'number?', y: 'number?' }, true);
登记('frame.drag', 转('__drag'), '像人一样按住拖到 to 再松开, 两头都照 frame.click 那样找',
  { frame: F, selector: 'string?', text: 'string?', x: 'number?', y: 'number?',
    to: '{selector?, text?, x?, y?}' });
登记('frame.input', 转('__input'), '往输入框填值', { frame: F, selector: 'string', value: 'string' });
登记('frame.key', 转('__key'), '按一个键(只触发页面的按键监听, 不会真打字), 不给 selector 就按在焦点上',
  { frame: F, key: 'string', selector: 'string?' });
登记('frame.eval', 转('__eval'), '在窗里算一段 JS, 可以 await', { frame: F, expr: 'string' }, true);
登记('frame.waitFor', 转('__waitFor'), '等元素或文字出现',
  { frame: F, selector: 'string?', text: 'string?', timeout: 'number?(毫秒, 默认 8000)' });
登记('frame.screenshot', 转('__screenshot'), '截图(PNG dataUrl); agent 拿到的大图已存库换成引用, 引用里写着怎么给人看',
  { frame: F }, true);
登记('frame.trace', 转('__trace'), '窗里的 console.log/warn/error 和没接住的错误, 最近 200 条',
  { frame: F, level: 'log|warn|error?', limit: 'number?(默认 50)' }, true);
登记('frame.inject', () => 眼手.shim, '挂隔离窗时注进去的眼手代码', {});
// ═ 脚本 · 跟着: 引用 ═
// 一段 JS 里串多步能力, 省来回。跑在隐藏隔离窗里: 拿不到主页面, 只能经 colony.call 用能力
const 脚本 = {
  窗: new Set(),   // js.run 自己挂着、还在跑的窗: 只有它们能经 agent.via 转调
  // 脚本里的 < 写成 \u003c: 带 script 的闭合标签也不会截断这一页; html、head、body 标签浏览器自己补
  页: code => `<!DOCTYPE html><meta charset="UTF-8"><${'script'}>colony.expose("run",async a=>{const logs=[],
log=(...x)=>logs.push(x.map(v=>{try{return typeof v==="string"?v:JSON.stringify(v)}
catch(e){return String(v)}}).join(" ")),sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{const f=new(async()=>{}).constructor("colony","args",
"sleep","log",${JSON.stringify(code).replace(/</g, '\\u003c')});
const v=await f({call:(p,x)=>colony.call("agent.via",{path:p,args:x})},a,sleep,log);
return{ok:true,value:v===undefined?null:v,logs}}
catch(e){return{ok:false,error:String(e&&e.message||e),logs}}})<\/script>`,
  async run(a) {
    if (typeof a.code !== 'string' || !a.code.trim()) throw new Error('缺 code: 要跑的函数体字符串');
    const secs = a.timeout || 60;
    const f = await ctx.call('stem.mount', { code: 脚本.页(a.code), hidden: true, context: { by: 'js.run' } });
    const frame = f.dataset.colonyApp;
    脚本.窗.add(f);
    try {
      return await Promise.race([
        ctx.call('stem.invoke', { frame, path: 'run', args: a.args == null ? {} : a.args }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`脚本跑了 ${secs} 秒没结束, 已停`)), secs * 1000)),
      ]);
    } finally {
      脚本.窗.delete(f);
      try { await ctx.call('stem.unmount', { frame }); } catch (e) { }
    }
  },
};
ctx.provide('agent.via', (a, m) => { // 隔离窗能调, 但只认上面那几个窗(frame 是 Stem 填的, 伪造不了)
  if (!m.frame || !脚本.窗.has(m.frame)) throw new Error('agent.via 只给 js.run 的脚本用');
  return 引用.填(a.args).then(x => ctx.call(String(a.path), x));
}, { desc: 'js.run 脚本里 colony.call 的中转', schema: { path: 'string', args: 'object?' } });
登记('js.run', 脚本.run,
  '在隐藏隔离窗里跑一段 JS 函数体: 体内可 await colony.call(路径, 参数)、await sleep(毫秒)、log(...); args 是传入的参数; return 的值回来',
  { code: 'string', args: 'object?', timeout: 'number?(秒, 默认 60)' }, true);
// ═ 历史 ═
// 对话一条没删(压缩只插摘要), 检索就是在记录里找: 当前会话用内存里的, 别的会话读库
const 历史 = {
  字: m => (Array.isArray(m.content) ? m.content.map(p => p.text || '').join(' ') : String(m.content || ''))
    + (m.toolCalls ? ' ' + JSON.stringify(m.toolCalls) : ''),
  async 全部() {
    const out = { [AG.sid]: AG.hist };
    (await ctx.kv.list('chat.transcript.')).forEach(e => {
      if (e.key.slice(16) !== AG.sid) out[e.key.slice(16)] = e.value || [];
    });
    return out;
  },
  async find(a) {
    const q = String(a.q || '').toLowerCase(), all = await 历史.全部(), hit = [];
    if (!q) throw new Error('缺 q: 要找的词');
    Object.keys(all).forEach(sid => all[sid].forEach((m, i) => {
      const t = 历史.字(m), k = t.toLowerCase().indexOf(q);
      if (k < 0) return;
      const 摘录 = t.slice(Math.max(0, k - 40), k + q.length + 80);
      hit.push({ session: sid, i, role: m.role, at: m.at, 摘录 });
    }));
    return hit.slice(-(a.n || 20));
  },
  async read(a) {
    const list = (await 历史.全部())[a.session || AG.sid] || [], from = Math.max(0, a.from | 0);
    return list.slice(from, from + Math.min(a.n || 10, 30))
      .map((m, k) => Object.assign({}, m, { i: from + k }));
  },
};
登记('history.find', 历史.find, '在以前的对话里按词找(所有会话; 一条没删, 压缩只插摘要), 回哪个会话第几条和前后文; 原文用 history.read 读',
  { q: 'string', n: 'number?(最多几条, 默认 20)' });
登记('history.read', 历史.read, '按第几条读对话原文',
  { session: 'string?(不给 = 当前会话)', from: 'number', n: 'number?(默认 10, 最多 30)' });
// ═ 语音 · 跟着: 骨架, 渲染, 厂商配置, 协议适配, 大脑选择, 大脑, 会话 ═
// ✂ 语音
// 🔊 念回答、做完播报、🎤 转文字: 选了厂商就用模型, 没选用浏览器的。长回答先压成 100 字内的口语记在这条上;
// 只响一个, 再点就停。麦克风授权一次就留着
const 语音 = {
  设: { 播: false },
  音: null,
  键: '',   // 正在念(或在准备)的回答
  序: 0,   // 开念、停都加一: 停了以后晚到的声音不放
  录: null,
  流: null,
  错: e => 骨架.status('语音没成: ' + e.message),
  async 厂(类) { // 这一类选的厂商; 选了厂商没选模型先说清, 不等录完、念完才报
    const p = await 厂商配置.用(类);
    if (p && !(p.modelOf || {})[类])
      throw new Error(`${协议适配['openai-compatible'].类型[类].名}选了「${p.name}」, 还没选模型: 点 ⚙ 选一个`);
    return p;
  },
  async 麦() {
    if (!语音.流 || !语音.流.active) 语音.流 = await navigator.mediaDevices.getUserMedia({ audio: true });
    return 语音.流;
  },
  async 收音(rate, 片) {   // 回停的函数
    const s = await 语音.麦(), ac = new AudioContext({ sampleRate: rate }), 节 = ac.createScriptProcessor(4096,
      1, 1);
    ac.createMediaStreamSource(s).connect(节);
    节.onaudioprocess = e => 片(e.inputBuffer.getChannelData(0));
    节.connect(ac.destination);
    return () => ac.close();
  },
  b64: u => 协议适配.成base64(u),
  pcm: f => new Uint8Array(Int16Array.from(f, x => Math.max(-1, Math.min(1, x)) * 32767).buffer),
  wav(f, rate) {   // 各家听写都收
    const d = 语音.pcm(f), u = new Uint8Array(44 + d.length), v = new DataView(u.buffer);
    [0x46464952, 36 + d.length, 0x45564157, 0x20746d66, 16, 0x10001, rate, rate * 2, 0x100002, 0x61746164,
      d.length]
      .forEach((x, i) => v.setUint32(i * 4, x, true));
    u.set(d, 44);
    return u;
  },
  字: 渲染.纯,
  图() {
    骨架.$('agent-convo').querySelectorAll('.ag-spk').forEach(b => {
      b.textContent = b.parentNode.dataset.at === 语音.键 ? '⏸' : '🔊';
    });
  },
  停() {
    const a = 语音.音;
    语音.序++;
    语音.音 = null;
    语音.键 = '';
    if (a && a.pause) a.pause();
    else if (a) speechSynthesis.cancel();
    语音.图();
  },
  async 读(m, 球) {   // 球: 自动播报, 念什么、没念成都写在球上
    语音.停();
    const 序 = 语音.序, t = 语音.字(String(m.content || '')), 说 = (s, 秒) => 球 && 渲染.说(s, 秒);
    语音.键 = String(m.at);
    语音.图();
    说('🗣 …');
    try {
      const 厂 = await 语音.厂('tts');   // 没配好先说, 不先花时间压口语
      if (!m.口播) {
        m.口播 = t.length <= 100 ? t : (await 大脑.chat({ messages: [{ role: 'system', content: '把下面的内容说成 100 字以内'
          + '的口语, 像当面告诉对方, 不要 Markdown、列表和开场白, 直接说结果。' }, { role: 'user', content: t.slice(0, 6000) }] }))
          .content.trim();
        会话.save();
        语音.写口播(骨架.$('agent-convo').querySelector(`[data-at="${m.at}"]`), m);
      }
      说('🗣 ' + m.口播);
      if (序 === 语音.序) await 语音.放(m, 序, 厂);
      说('🗣 ' + m.口播, 1);
    } catch (e) {
      说('🔇 ' + e.message, 8);
      throw e;
    } finally {
      if (序 === 语音.序) 语音.停();
    }
  },
  声: Symbol(),   // 念过的声音挂在回答上(存库不带), 再念不再合成
  async 放(m, 序, 厂) {   // 念完才回
    const t = m.口播;
    if (!厂) {
      if (typeof speechSynthesis === 'undefined') throw new Error('没选语音的厂商, 浏览器也不会朗读');
      const u = 语音.音 = new SpeechSynthesisUtterance(t);
      u.lang = 'zh-CN';
      return new Promise(ok => {
        u.onend = u.onerror = ok;
        speechSynthesis.speak(u);
      });
    }
    const r = m[语音.声] = m[语音.声] || await ctx.call('ai.speak', { text: t });
    if (序 !== 语音.序) return;
    const a = 语音.音 = new Audio(`data:${r.mimeType};base64,${r.data}`);
    return new Promise((ok, bad) => {
      a.onended = a.onpause = ok;
      a.play().catch(bad);
    });
  },
  点(e) {
    const b = e.target.closest('.ag-spk'), at = b && b.parentNode.dataset.at;
    if (!b) return;
    if (语音.键 === at) return 语音.停();
    const m = AG.hist.find(x => String(x.at) === at);
    if (m) 语音.读(m).catch(语音.错);
  },
  async 听() {   // 再点停, 字放进输入框不发
    if (语音.录) return 语音.录.stop();
    const b = 骨架.$('agent-mic'), R = window.SpeechRecognition || window.webkitSpeechRecognition,
      厂 = await 语音.厂('stt');
    const 放 = t => {
      const ta = 骨架.$('agent-input');
      ta.value = (ta.value ? ta.value + ' ' : '') + t;
    };
    const 完 = () => {
      语音.录 = null;
      b.textContent = '🎤';
    };
    if (厂) {
      const 块 = [], 关 = await 语音.收音(16000, f => 块.push(f.slice()));
      语音.录 = {
        stop() {
          关();
          完();
          const f = new Float32Array(块.reduce((n, x) => n + x.length, 0));
          块.reduce((o, x) => (f.set(x, o), o + x.length), 0);
          ctx.call('ai.transcribe', { audio: 语音.b64(语音.wav(f, 16000)), mimeType: 'audio/wav' })
            .then(x => x.text ? 放(x.text) : 骨架.status('没听到说话'), 语音.错);
        },
      };
    } else if (R) {
      const r = 语音.录 = new R(), 话 = { 'no-speech': '没听到说话', 'not-allowed': '浏览器没让用麦克风',
        network: '浏览器自带的听写连不上谷歌; 点 ⚙ 给转录选一家' };
      let 回了 = false;   // 出了字或报了错; 都没有就是没听到, 也要说一声
      r.lang = 'zh-CN';
      r.onresult = e => { 回了 = true; 放(e.results[0][0].transcript); };
      r.onerror = e => { 回了 = true; 骨架.status(`听写没成: ${话[e.error] || e.error}`); };
      r.onend = () => { 完(); if (!回了) 骨架.status('没听到说话'); };
      r.start();
    } else return 骨架.status('没选转录的厂商, 浏览器也不会听写: 点 ⚙ 选一个');
    b.textContent = '⏹';
  },
  写口播(el, m) {
    if (el && m && m.口播 && m.口播 !== 语音.字(String(m.content)) && !el.querySelector('.ag-tts'))
      el.lastChild.insertAdjacentHTML('beforebegin', `<div class="ag-tts">🗣 ${esc(m.口播)}</div>`);
  },
  画() {   // 重画完: 新画的回答补上 🔊 和口语
    骨架.$('agent-convo').querySelectorAll('[data-at]').forEach(el => {
      if (el.querySelector('.ag-spk')) return;
      el.insertAdjacentHTML('beforeend', '<button class="ag-spk">🔊</button>');
      语音.写口播(el, AG.hist.find(x => String(x.at) === el.dataset.at));
    });
    语音.图();
  },
  完() {   // 一轮做完, 开着播报又收成了球就念
    const 末 = AG.hist[AG.hist.length - 1] || {};
    if (末.role === 'assistant' && 末.content && 语音.设.播 && !骨架.open) 语音.读(末, 1).catch(语音.错);
  },
  async 装() {
    if (!骨架.dock) return;
    渲染.后.push(语音.画);
    引擎.完.push(语音.完);
    大脑选择.设.类.push('stt', 'tts');
    Object.assign(大脑选择.设.空, { stt: '浏览器自带', tts: '浏览器自带' });
    骨架.$('agent-clear').insertAdjacentHTML('beforebegin',
      '<button class="ag-ic" id="agent-bo" title="收成球时做完自动播报">🔇</button>');
    const bo = 骨架.$('agent-bo');
    bo.onclick = () => {
      bo.textContent = (语音.设.播 = !语音.设.播) ? '🔈' : '🔇';
      ctx.kv.set('agent.voice', 语音.设);
    };
    骨架.$('agent-send').insertAdjacentHTML('beforebegin', '<button id="agent-mic" title="说话转文字">🎤</button>');
    骨架.$('agent-mic').onclick = () => 语音.听().catch(语音.错);
    骨架.$('agent-convo').addEventListener('click', 语音.点);
    骨架.dock.insertAdjacentHTML('beforeend', '<style>.ag-spk{background:none;border:none;'
      + 'opacity:.6}.ag-spk:hover{opacity:1}.ag-tts{margin-top:6px;font-size:12px;color:var(--m)}'
      + '</style>');
    ctx.cleanup(() => {
      语音.停();
      if (语音.流) 语音.流.getTracks().forEach(x => x.stop());
    });
    Object.assign(语音.设, await ctx.kv.get('agent.voice').catch(() => null));
    bo.textContent = 语音.设.播 ? '🔈' : '🔇';
  },
};
// ✂ 语音 完
// ═ 通话 · 跟着: 语音, 大脑选择, 骨架, 引擎 ═
// ✂ 通话 · 要: 语音
// 📞 语音模型陪你聊, 要办的事用唯一的工具交给 agent 后台办, 办完由它说。断句在本地: 服务端按音量认开口,
// 门槛高、小声说它不理, 它生成时也听不见插话。有的模型(如 stepaudio-2.5-realtime)不调工具, 见 判 和 text
const 通话 = {
  挂: null,   // 通着时是挂断的函数
  告: null,   // 通着时: 后台一轮办完, 把结果交给它说
  门: 0.012,   // 一片声音的均方根过了它就算在说(Chrome 自动增益后人声在 0.06~0.1)
  交: {
    name: 'agent_do', description: '用户要查、改、打开或操作 Colony 里的任何东西时必须调用: 交给 agent 在后台办',
    parameters: { type: 'object', properties: { task: { type: 'string', description: '要办的事, 用户原话即可' } },
      required: ['task'] },
  },
  async 拨() {
    const 放 = new AudioContext({ sampleRate: 24000 }), 在放 = new Set(), 条 = 骨架.$('agent-talk');
    const 收 = [() => 放.close()];
    const 量 = 放.createAnalyser(), 样 = new Float32Array(量.fftSize = 4096), 近 = [0, 0, 0, 0];   // 它最近 0.7 秒放得多响
    量.connect(放.destination);
    let 会 = null, 说着 = false, 待 = '', 尾 = 0, 你 = '', 它 = '', 新 = true, 静 = 0, 停 = 0, 长 = 0, 前 = [], 轮 = null;
    // 待: 办完了你却正说着, 等你这句它答完再交给它念; 新: 下一片字是新的一段话; 静: 1 它在念调用别放, 2 已照字办了;
    // 停 / 长: 这句静了、说了几秒; 前: 开口前 0.5 秒的声音; 轮: 你这句和它的回答, 两样都到了才看它是不是答应了却没调
    const 字幕 = () => { 条.textContent = `📞 ${你 ? `你: ${你}  ` : ''}${它 ? '它: ' + 它 : '通话中'}`; };
    const 办 = task => task ? (引擎.run('📞 ' + task), '已交给 agent 在后台办, 办完告诉你') : '没说要办什么';
    const 判 = () => {   // 它说了"我这就去查"却没调: 把你这句交出去; 反问的不算
      if (!轮 || !轮.听 || 轮.它 == null) return;
      if (/(去|这就|马上|帮你).{0,3}(查|办|看|打开|改|做|找)/.test(轮.它) && !/[吗？?]/.test(轮.它)) 办(轮.听);
      轮 = null;
    };
    const 说 = () => {   // 你没在说话才交给它; 它正在答的话, AI 块会等它答完再请它念
      if (!待 || 说着 || !会) return;
      会.发文字(待);
      待 = '';
    };
    通话.告 = () => {
      const m = AG.hist[AG.hist.length - 1] || {};
      待 = `(agent 办完了) ${m.role === 'assistant' ? '' : '没办成: '}${短(语音.字(String(m.content || '')), 300)}`
        + '\n用一两句口语告诉用户';
      说();
    };
    通话.挂 = why => {
      通话.挂 = 通话.告 = null;
      收.forEach(f => { try { f(); } catch (e) { } });
      会 = null;
      骨架.$('agent-call').classList.remove('on');
      条.textContent = '';
      if (why) 骨架.status(why);
    };
    骨架.$('agent-call').classList.add('on');
    字幕();
    try {
      if (!await 语音.厂('realtime')) throw new Error('还没有哪家选了双工模型, 点 ⚙ 在「双工」一行选一个');
      会 = await ctx.call('ai.realtime', { tools: [通话.交],
        instructions: '你是 Colony 的语音助手, 说话简短、口语。用户要你查、改、打开、操作任何东西时, 立刻调用 agent_do'
          + '(task 填用户原话), 不要只说"我去查"而不调用; 调用后说一句"交给 agent 了"就停。agent 办完会发来一条「agent 办完了」,'
          + ' 你照实转告。闲聊直接答。' });
      if (!通话.挂) return 会.关();   // 等着接通时就挂了
      收.push(() => 会.关());
      // 一直传(不传的话服务端 60 秒没动静就断); 一开口就停它的声音、取消它的回答, 清掉攒着的(静音、回声),
      // 再传开口前 0.5 秒(免得吞掉开头); 静了 0.8 秒或说满 25 秒就提交。
      // 它在放声时门槛抬到「近」最响那下的一半: 喇叭漏回麦克风的回声比原声小、还晚到, 不算你开口
      收.push(await 语音.收音(24000, f => {
        let q = 0, e = 0;
        for (let i = 0; i < f.length; i++) q += f[i] * f[i];
        量.getFloatTimeDomainData(样);
        样.forEach(v => { e += v * v; });
        近.shift();
        近.push(Math.sqrt(e / 样.length));
        const 响 = Math.sqrt(q / f.length) > Math.max(通话.门, Math.max(...近) / 2);
        const 片 = 语音.b64(语音.pcm(f)), 秒 = f.length / 24000;
        if (!会) return;
        if (响 && !说着) {
          说着 = true;
          停 = 长 = 尾 = 0;
          在放.forEach(x => x.stop());
          会.打断();
          会.清音频();
          前.forEach(x => 会.发音频(x));
        }
        前 = 前.slice(-2).concat(片);
        会.发音频(片);
        if (!说着) return;
        停 = 响 ? 0 : 停 + 秒;
        长 += 秒;
        if (停 < 0.8 && 长 < 25) return;
        说着 = false;
        轮 = { 听: '', 它: null };
        新 = true;
        会.提交();
      }));
      会.on('audio', d => {
        if (静 || 说着) return;
        const u = Uint8Array.from(atob(d), c => c.charCodeAt(0));
        const p = new Int16Array(u.buffer, 0, u.length >> 1);
        if (!p.length) return;
        const buf = 放.createBuffer(1, p.length, 24000), x = 放.createBufferSource();
        buf.getChannelData(0).set(Float32Array.from(p, v => v / 32768));
        x.buffer = buf;
        x.connect(量);
        x.start(尾 = Math.max(尾, 放.currentTime));
        尾 += buf.duration;
        在放.add(x);
        x.onended = () => 在放.delete(x);
      });
      会.on('heard', t => {
        你 = t;
        if (轮) 轮.听 = t, 判();
        字幕();
      });
      会.on('text', t => {   // 有的模型把调用写成字念出来: 那段不放声, 照字办
        if (静 === 2) return;
        它 = (新 ? '' : 它) + t;
        新 = false;
        if (/agent_do/.test(它)) {
          静 = 1;
          在放.forEach(x => x.stop());
          const 写 = /agent_do\s*\((\{.*?\})\s*\)/.exec(它);
          if (写) {
            静 = 2;
            轮 = null;
            会.打断();
            try { 它 = 办(String(JSON.parse(写[1]).task || '')); } catch (e) { }
          }
        }
        字幕();
      });
      会.on('turnDone', () => {
        if (轮 && 轮.它 == null) 轮.它 = 它, 判();
        新 = true;
        静 = 0;
        说();
      });
      会.on('toolCall', c => {
        轮 = null;
        会.回工具(c.id, 办(String((c.args || {}).task || '')));
      });
      会.on('error', e => 骨架.status('通话里出了错(没挂断): ' + e.message));   // 抢话时"没有可取消的回答"这类, 会话还在
      会.on('close', () => 通话.挂 && 通话.挂('通话断了'));
    } catch (e) {
      if (通话.挂) 通话.挂('没打通: ' + e.message);
    }
  },
  装() {
    if (!骨架.dock) return;
    大脑选择.设.类.push('realtime');
    引擎.完.push(() => 通话.告 && 通话.告());
    骨架.$('agent-clear').insertAdjacentHTML('beforebegin',
      '<button class="ag-ic" id="agent-call" title="语音通话">📞</button>');
    骨架.$('agent-bar').insertAdjacentHTML('afterend',
      '<div id="agent-talk"></div><style>#agent-talk{padding:4px 16px;'
      + 'font-size:12px;color:var(--a);border-bottom:var(--bd)}'
      + '#agent-talk:empty{display:none}'
      + '#agent-call.on{color:#ff6b6b}</style>');
    骨架.$('agent-call').onclick = () => 通话.挂 ? 通话.挂() : 通话.拨();
    ctx.cleanup(() => 通话.挂 && 通话.挂());
  },
};
// ✂ 通话 完
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【攒技能】同一类事做成了、以后还会遇到时: 把做法写成相关那块技能段的一条「// 【名】什么时候读: 做法」(续行用「//   」),
//   stem.setBlock 段的 replace 加进去, 没有技能段就用 segment 新建。有差不多的就改那条; 一次性的、没验证过的不写;
//   写了告诉用户改了哪块哪条。用户说「复盘」: 能复用的做法写成技能, 稳定的偏好写进 agent.memory, 没做完的写进会话备忘。
// 【新块】新做一个块、写它的清单时: 清单要写 caps, 列这块登记的能力路径头一截(ctx.provide('天气.查') 写 ["天气"]);
//   不写就只认 id 最后一截, 头一截不是它的能力只记在它自己名下, 页面和别的块调不到。
// ═ 自报 ═
// 你说要做什么, 它就用看、写、改、跑替你去做: 各块的能力它都能调, 块和小应用的源码它也能改
// 数据 {"prefix": "chat.running", "label": "正在跑的记号", "kind": "state", "edit": "agent 对话栏"}
// 数据 {"prefix": "chat.", "label": "会话记录", "kind": "data", "edit": "agent 对话栏"}
// 数据 {"prefix": "ref:", "label": "对话里的附件", "kind": "data"}
// 数据 {"prefix": "agent.", "label": "记性、备忘、大脑选择", "kind": "config"}
// 数据 {"prefix": "settings:agent.", "label": "agent 设置", "kind": "config"}
// 现在 agent.prompt
// 打开 agent.open
// ═ 读技能 ═
// 块的技能段是一条条「// 【名】什么时候读: 做法」, 按条读: 为一条把整段读进上下文太费。
// skill 不在本块清单的 caps 里: 只记在本块名下, 只有 agent 自己调得到, 本来就只给它用
登记('skill.read', async a => {
  const ls = (await ctx.call('stem.block', { id: a.id, segment: '技能' })).segment.text.split('\n');
  const 头 = ls.map((l, i) => /^\/\/ 【.+?】/.test(l) ? i : -1).filter(i => i >= 0), 名 = 头.map(i => /【(.+?)】/.exec(ls[i])[1]);
  if (!a.name) return { id: a.id, 技能: 名 };
  let k = 名.indexOf(a.name);
  if (k < 0) k = 名.findIndex(n => n.includes(a.name) || a.name.includes(n));
  if (k < 0) throw new Error(`${a.id} 的技能段没有「${a.name}」, 有: ${名.join('、') || '(空)'}`);
  return ls.slice(头[k], 头[k + 1] ?? ls.length).map(l => l.replace(/^\/\/ ?/, '')).join('\n').trim();
}, '读一块技能段里的一条(系统提示里列的技能名); 不给 name 回这块有哪些技能', { id: 'string', name: 'string?' }, true);
// ═ 装配 · 跟着: 状态, 骨架, 会话, 渲染, 引用, 大脑选择, 系统提示, 引擎 ═
// 接线: 界面的动作接到引擎, 引擎的进度接到界面; 自己被替换时把话说清, 不无声消失
骨架.mount();
骨架.onSend = (t, ps) => 引擎.run(...引用.藏(t, ps));   // sk- 先藏成引用; 空话调用方都挡了; 忙时转插话
骨架.onStop = () => 引擎.stop('用户停止');
const 手压 = async () => { // 手动压缩也算"忙": 压时不给切会话、清空, 这时发的话排队
  if (AG.busy) return !(引擎.没压 = '这一轮还没做完, 做完再压');
  AG.busy = true;
  引擎.stopped = false;
  骨架.setBusy(true);
  try {
    return await 引擎.压缩(true);
  } finally {
    AG.busy = false;
    骨架.setBusy(false);
    if (引擎.插话.length) 引擎.run(null, null, true);
  }
};
骨架.onZip = async () => 骨架.status((await 手压()) ? '压好了: 旧的对话写成了摘要, 原文还在' : '没压成: ' + 引擎.没压);
渲染.后.push(引擎.量);
引擎.完.push(渲染.完);   // 球上说 ✓, 剪掉语音也有
// 刷新或被换掉时, 输入框里没发的字和卡片留在本标签页, 新实例开机放回去
const 留稿 = () => {
  try {
    sessionStorage.setItem('agent.draft', JSON.stringify({ t: 骨架.$('agent-input').value, 待: 引用.待 }));
  } catch (e) { }
};
骨架.听('visibilitychange', 留稿);
ctx.cleanup(留稿);
try {
  const d = JSON.parse(sessionStorage.getItem('agent.draft'));
  sessionStorage.removeItem('agent.draft');
  if (d) [骨架.$('agent-input').value, 引用.待] = [d.t || '', d.待 || []];
} catch (e) { }
// ✂ 语音
语音.装();
// ✂ 语音 完
// ✂ 通话 · 要: 语音
通话.装();
// ✂ 通话 完
Object.entries({ open: '切会话', remove: '删会话', clear: '清空', create: '建新会话' }).forEach(([k, 做]) => {
  const fn = 会话[k];
  会话[k] = async (...a) => AG.busy ? 骨架.status('等这一轮结束再' + 做) : fn.apply(会话, a);
});
登记('agent.send', async a => {
  if (typeof a.text !== 'string' || !a.text.trim()) throw new Error('缺 text: 要说的话');
  const queued = AG.busy;   // 先记下: 下面一发话引擎就立刻忙起来, 发完再看永远是"排队"
  骨架.expand(true);
  骨架.onSend(a.text, []);
  return { ok: true, queued };
}, '给全能 agent 发一句话(它忙时排为插话)', { text: 'string' });
登记('agent.attach', a => { // 不马上发: 人补一句再发(界面块点选的「发给 agent」走这里)
  if (typeof a.text !== 'string' || !a.text.trim()) throw new Error('缺 text: 卡片内容');
  引用.放(String(a.name || '卡片'), a.text, 'text/plain', true);
  return true;
}, '往 agent 输入框上方放一张卡片, 人补一句再发', { text: 'string', name: 'string?' });
登记('agent.open', () => { 骨架.expand(true); return true; }, '展开 agent 对话栏, 光标放进输入框', {});
登记('agent.compact', async () => ({ ok: await 手压(), why: 引擎.没压 }), '手动压缩当前会话: 回 {ok, why(没压成的原因)}', {});
登记('agent.prompt', async () => { // 和引擎每轮做的一样: 先拿工具表(目录跟着它), 再拼系统提示
  const tools = await 工具表.list();
  return `${await 系统提示()}\n\n## 工具(${tools.length} 个, 下一轮原样发给模型)\n`
    + tools.map(t => t.name + ': ' + t.description).join('\n');
}, '下一轮发给模型的系统提示原文和工具清单; 系统提示写在本块的「系统提示」段, 在代码解读里能改', {});
骨架.听('colony:cap', e => { if (e.detail && String(e.detail.path || '').startsWith('ai.')) 大脑选择.render(); });
const 收浮 = e => { // 会话下拉、⚙ 小表: 点外面或按 Esc 收起
  if (e.type === 'keydown' && e.key !== 'Escape') return;
  const 外 = s => e.type === 'keydown' || !e.target.closest(s);
  if (会话.drop && 外('#agent-sess')) 会话.act('drop');
  if (骨架.$('agent-set') && 外('#agent-set,#agent-set-b')) 大脑选择.开();
};
骨架.听('pointerdown', 收浮);
骨架.听('keydown', 收浮);
ctx.cleanup(() => {
  AG.disposed = true;
  引擎.stop('本块被替换了, 新实例会接着做');
});
(async () => {
  try {
    await 会话.load();
    await 大脑选择.load();
    会话.render();
    大脑选择.render();
    引用.render();
    await 引擎.头().catch(() => { });   // 先拿各能力自报的说明(画旧工具行要用), 量出系统说明和工具说明占多少
    渲染.paint();
    await 引擎.接力();
  } catch (e) {
    骨架.status('启动出错: ' + e.message);
    console.error('[agent]', e);
  }
})();
return {};
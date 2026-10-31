'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 stem 的 隔离窗
// ═ 设计变量 · 借用者: petri:bridge ═
// 整个 Colony 的设计变量归界面块: 别的块照 var(--accent, 默认值) 取, 这里一换它们跟着换
const 设计变量 = `:root{color-scheme:dark;--bg:#0a0a0a;--bg-2:#131313;--bg-3:#1a1a1a;
  --surface:rgba(255,255,255,.035);--surface-hover:rgba(255,255,255,.065);--border:rgba(255,255,255,.08);
  --border-strong:rgba(255,255,255,.18);--text:#fafafa;--text-muted:#8a8a8a;--text-dim:#555;
  --accent:#B5FF00;--accent-soft:rgba(181,255,0,.12);--warn:#FF9500;--danger:#FF4444;--radius:12px;
  --radius-lg:18px;--mono:ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --serif:"Fraunces",Georgia,serif}
  option,optgroup{background:var(--bg-2);color:var(--text)}`;   // 下拉展开那层要不透明的底, 不然叠在白底上
// ═ 状态 ═
// 全块共用的状态和小工具
const UI = {
  wins: new Map(),   // 开着的窗: 'app:<id>' / 'folder:<id>' / 'block:<id>' / 'src:<目标>' → {el, 类, frame?, 画?}
  apps: new Map(),   // 桌面上的应用: id → 记录(画桌面时刷新; 拖动时要同步拿到代码)
};
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const 登记 = (路径, fn, desc, schema, 窗里能调, common) =>
  ctx.provide(路径, fn, { desc, schema, frames: !!窗里能调, common });
const 听 = (el, ev, fn, 捕) => {
  el.addEventListener(ev, fn, 捕);
  ctx.cleanup(() => el.removeEventListener(ev, fn, 捕));
};
const 新号 = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
// 单独打开(没有 Stem)时, 要 Stem 的事回一句为什么; 在 Colony 里回 v
const 在Colony = (v = true) => colony.单独 ? '这是单独打开的界面, 这一项要放进 Colony 才能用' : v;
const 下载文件 = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// ═ 应用登记 · 跟着: 状态, 桌面 ═
// 小应用的登记表: 记录住 miniapp:<id>, 改了发 colony:apps
const 应用登记 = {
  图标: ['🎨', '🛠', '📊', '📝', '🔧', '⚡', '🎯', '💡', '🚀', '🧩', '💎', '🌟'],
  颜色: ['#B5FF00', '#FF9500', '#00B8FF', '#FF4488', '#9D4EDD', '#FFD60A'],
  通知: () => document.dispatchEvent(new CustomEvent('colony:apps')),
  async list() {
    return (await ctx.kv.list('miniapp:')).map(e => e.value).filter(m => m && m.id)
      .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  },
  async get(a) {
    const m = await ctx.kv.get('miniapp:' + a.id);
    if (!m) throw new Error(`没有这个应用: ${a.id}(apps.list 看有哪些)`);
    return m;
  },
  简: m => ({ id: m.id, name: m.name, desc: m.desc, icon: m.icon, updatedAt: m.updatedAt,
    bytes: (m.code || '').length }),   // 回给 agent 的: 不带整份源码
  async create(a) { // 没给名字、简述就读 <title>、<meta name="description">
    if (!a || typeof a.code !== 'string') throw new Error('apps.create 要 code: 一份完整的 HTML');
    const 读 = re => ((re.exec(a.code) || [])[1] || '').trim();
    const name = a.name || 读(/<title[^>]*>\s*([^<\n]{1,60})/i) || '未命名',
      desc = a.desc || 读(/<meta\s+name="description"\s+content="([^"]*)"/i);
    let h = 0;
    for (const c of name + desc) h = (h * 31 + c.charCodeAt(0)) | 0;
    const id = 新号('m'), now = Date.now();
    const m = Object.assign({ icon: 应用登记.图标[Math.abs(h) % 12], color: 应用登记.颜色[Math.abs(h) % 6] },
      Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)),   // 没给的不盖默认的图标、颜色
      { id, name, desc, createdAt: now, updatedAt: now, trust: false });
    await ctx.kv.set('miniapp:' + id, m);
    应用登记.通知();
    return m;
  },
  async update(a) { // replace 同改块: 有一处对不上就一处都不改
    const m = await 应用登记.get(a), p = Object.assign({}, a.patch);
    if ('trust' in p) throw new Error('完全访问只能由用户在应用窗上点开, 这里改不了');
    if (a.replace) p.code = [].concat(a.replace).reduce((c, r) => {
      const n = r && typeof r.old === 'string' && r.old ? c.split(r.old).length - 1 : 0;
      if (n !== 1 || typeof r.new !== 'string')
        throw new Error(`replace 每项 {old, new}: old 要一字不差且只对上一处(这次 ${n} 处); 一处都没改`);
      return c.replace(r.old, () => r.new);
    }, m.code || '');
    if ('code' in p && typeof p.code !== 'string') throw new Error('code 要一份完整的 HTML; 只改几处用 replace');
    Object.assign(m, p, { id: m.id, updatedAt: Date.now() });
    await ctx.kv.set('miniapp:' + m.id, m);
    应用登记.通知();
    return m;
  },
  async 设信任(id, v) { // 只有应用窗上用户点的键调它: 不是能力、不在动作表, agent 和应用都调不到
    const m = await 应用登记.get({ id });
    m.trust = v === true;
    await ctx.kv.set('miniapp:' + id, m);
    应用登记.通知();
  },
  async remove(a) {
    await 应用登记.get(a);
    await ctx.kv.del('miniapp:' + a.id);
    for (const e of await ctx.kv.list(`appstore:${a.id}:`)) await ctx.kv.del(e.key);
    窗口.关('app:' + a.id);
    await 桌面.改(d => {
      delete d.pos['app:' + a.id];
      桌面.摘(d, a.id);
    });
    应用登记.通知();
    return { ok: true, removed: a.id };
  },
  async 复制(id, 夹) { // 只复制代码: 存的数据不带, 回到隔离
    const 原 = await 应用登记.get({ id });
    const 新 = await 应用登记.create({ code: 原.code, name: 原.name + ' 副本', desc: 原.desc, icon: 原.icon,
      color: 原.color });
    await 桌面.改(d => {
      const f = 夹 && d.folders.find(x => x.id === 夹), p = d.pos['app:' + id];
      if (f) f.items.push(新.id);
      else 桌面.放(d, 'app:' + 新.id, p ? p.x + 桌面.格.w : 0, p ? p.y : 0);
    });
    return '已复制: ' + 新.name;
  },
  async 存来源(来源, code, name, icon) { // 同一个来源再导出: 更新那个图标
    const 旧 = (await 应用登记.list()).find(m => m.来源 === 来源);
    if (!旧) return 应用登记.create({ code, name, icon, 来源 });
    const m = await 应用登记.update({ id: 旧.id, patch: { code } });
    运行窗.重开(m.id);   // 开着的旧窗换成新导出的
    return m;
  },
};
// ═ 小应用存储 ═
// 小应用存数据: 按隔离窗的 miniappId 分开存, 小应用冒充不了别的应用; 不在小应用里调(agent)要给 app; 形状错就照实报错
const 小应用存储 = (a, meta, 名) => {
  const k = typeof a === 'string' ? a : a && a.key,
    id = meta && meta.context && meta.context.miniappId || a && a.app;
  if (typeof k !== 'string' || !id)
    throw new Error(名 + (id ? ' 要 key(字符串)' : ' 不在小应用里调时要给 app(应用 id)') + ', 收到 '
      + String(JSON.stringify(a)).slice(0, 60));
  return `appstore:${id}:${k}`;
};
// ═ 样式 ═
// 类名都带 u- 前缀、不做全局重置: 各块的 root 在同一个页面里, 全局规则会打到别的块。
// 桌面 z 10: 不在窗里的别的块的页垫在下面, 页里吸顶的表头也透不出来
const 样式 = `.u-shell{position:fixed;inset:0;z-index:10;display:flex;background:var(--bg);color:var(--text);
  background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(181,255,0,.04),transparent 60%);
  font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
  .u-shell h1,.u-shell p{margin:0}
  .u-shell button,.u-win button{font-family:inherit}
  .u-shell ::-webkit-scrollbar{width:10px;height:10px}
  .u-shell ::-webkit-scrollbar-thumb{background:var(--border);border-radius:5px}.u-side{width:220px;
  flex-shrink:0;background:rgba(13,13,13,.85);border-right:1px solid var(--border);display:flex;
  flex-direction:column}.u-sb-head{padding:16px 18px 12px;border-bottom:1px solid var(--border)}
  .u-sb-title{font-family:var(--serif);font-style:italic;font-size:14px}
  .u-sb-list{flex:1;overflow-y:auto;padding:8px 10px}.u-sb-item{display:flex;align-items:center;gap:8px;
  padding:8px 10px;margin:2px 0;border-radius:8px;cursor:pointer;color:var(--text-muted);font-size:13px;
  overflow:hidden;white-space:nowrap}.u-sb-item:hover{background:var(--surface);color:var(--text)}
  .u-sb-item.on{background:rgba(181,255,0,.08);color:var(--text);border:1px solid rgba(181,255,0,.2);
  padding:7px 9px}
  .u-main{flex:1;position:relative;overflow:hidden;background:var(--u-wall,none) center/cover}
  .u-nm,.u-clock,.u-sub,.u-head h1{text-shadow:0 1px 3px rgba(0,0,0,.7)}/* 浅色壁纸上也看得清 */
  .u-page{position:absolute;inset:0;display:flex;flex-direction:column;padding:32px;overflow:auto}
  .u-page.u-drop::after{content:"";position:absolute;inset:12px;border:2px dashed var(--accent);
  border-radius:var(--radius-lg);pointer-events:none;z-index:5}
  .u-head{display:flex;align-items:center;justify-content:space-between;padding:20px 28px;flex-shrink:0}
  .u-brand{display:flex;align-items:center;gap:14px}.u-mark{width:44px;height:44px;border-radius:12px;
  background:var(--accent);color:#000;display:flex;align-items:center;justify-content:center;
  font-weight:bold;font-size:20px}
  .u-brand h1{font-family:var(--serif);font-style:italic;font-size:24px;font-weight:600;line-height:1}
  .u-sub{font-size:10px;letter-spacing:.12em;color:var(--text-dim);text-transform:uppercase}
  .u-acts{display:flex;align-items:center;gap:10px}.u-round{width:38px;height:38px;border-radius:50%;
  background:var(--surface);border:1px solid var(--border);color:var(--text-muted);cursor:pointer;
  font-size:16px}.u-round:hover{background:var(--surface-hover);color:var(--text)}
  .u-tiles{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.u-tile{position:relative;
  background:var(--accent);color:#000;border-radius:999px;padding:10px 18px 10px 16px;font-size:14px;
  font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;line-height:1}
  .u-tile:hover{filter:brightness(1.05)}.u-tile.u-off{opacity:.45}.u-reset{position:absolute;top:-6px;
  right:-6px;min-width:20px;height:20px;border-radius:10px;padding:0;background:var(--surface);
  border:1px solid var(--border);color:var(--text-muted);cursor:pointer;font-size:11px;line-height:1;
  display:flex;align-items:center;justify-content:center}
  .u-reset:hover{color:var(--accent);border-color:var(--accent)}.u-err{background:var(--danger);color:#fff;
  width:18px;height:18px;border-radius:50%;font-size:12px;font-style:normal;display:flex;align-items:center;
  justify-content:center}.u-grid{position:relative;min-height:100%;flex-shrink:0}
  .u-empty{text-align:center;padding:80px 20px;color:var(--text-muted)}.u-card{position:absolute;width:92px;
  height:104px;padding:8px 6px;border:1px solid transparent;border-radius:10px;cursor:pointer;display:flex;
  flex-direction:column;align-items:center;gap:6px;user-select:none;text-align:center;box-sizing:border-box}
  .u-card:hover{background:var(--surface-hover);border-color:var(--border)}.u-ico{width:48px;height:48px;
  flex-shrink:0;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:27px;
  background:var(--bg-3);border:1px solid var(--border)}.u-nm{font-size:12px;font-weight:500;
  line-height:1.25;max-width:84px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden}.u-count{position:absolute;right:12px;top:2px;min-width:17px;height:17px;padding:0 4px;
  border-radius:999px;background:var(--accent);color:#000;font-size:10px;font-weight:600;display:flex;
  align-items:center;justify-content:center}
  .u-card.u-target{background:var(--accent-soft);border-color:var(--accent)}
  .u-fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:10px}
  .u-fgrid .u-card{position:static;width:auto;height:auto;min-height:100px}.u-win{position:fixed;inset:0;
  z-index:50;display:flex;flex-direction:column;background:var(--bg-2);color:var(--text);
  font-family:var(--sans);line-height:1.6;box-sizing:border-box}.u-win.u-w{right:auto;bottom:auto;
  border:1px solid var(--border-strong);border-radius:12px;overflow:hidden;
  box-shadow:0 18px 50px rgba(0,0,0,.55)}.u-bar{display:flex;align-items:center;
  justify-content:space-between;padding:10px 16px;background:var(--bg-2);
  border-bottom:1px solid var(--border);flex-shrink:0}
  .u-w .u-bar{cursor:move;user-select:none;touch-action:none}.u-info{display:flex;align-items:center;
  gap:10px;font-size:13px;min-width:0;overflow:hidden;white-space:nowrap}
  .u-dot{width:8px;height:8px;background:var(--accent);border-radius:50%;flex-shrink:0}
  .u-bar button{background:transparent;border:1px solid var(--border);color:var(--text);padding:5px 12px;
  border-radius:6px;font-size:12px;cursor:pointer;margin-left:8px}
  .u-bar button:hover{background:var(--surface-hover)}
  .u-wbody{flex:1;overflow:auto;padding:12px 16px;position:relative}
  .u-win[data-k^="app:"] .u-wbody{padding:0;overflow:hidden}
  .u-rz{position:absolute;z-index:3;display:none;touch-action:none}.u-w>.u-rz{display:block}
  .u-rz[data-d=n],.u-rz[data-d=s]{left:12px;right:12px;height:6px;cursor:ns-resize}
  .u-rz[data-d=e],.u-rz[data-d=w]{top:12px;bottom:12px;width:6px;cursor:ew-resize}.u-rz[data-d=n]{top:0}
  .u-rz[data-d=s],.u-rz[data-d=se]{bottom:0}.u-rz[data-d=e],.u-rz[data-d=se]{right:0}.u-rz[data-d=w]{left:0}
  .u-rz[data-d=se]{width:12px;height:12px;cursor:nwse-resize}
  .u-win[data-k^="block:"] .u-wbody{padding:0}
  .u-src{margin:0;font:12px/1.6 var(--mono);white-space:pre;color:var(--text)}
  .u-src b{color:var(--accent)}.u-src i{display:inline-block;width:4em;margin-right:14px;text-align:right;
  color:var(--text-muted);font-style:normal;user-select:none}.u-menu{position:fixed;z-index:200;
  min-width:150px;padding:6px;border-radius:10px;background:var(--bg-2);
  border:1px solid var(--border-strong);box-shadow:0 12px 38px rgba(0,0,0,.45);color:var(--text);
  font-family:var(--sans)}
  .u-mi{padding:8px 12px;border-radius:7px;font-size:13px;cursor:pointer;white-space:nowrap}
  .u-mi:hover{background:var(--surface-hover)}.u-sep{height:1px;background:var(--border);margin:5px 3px}
  .u-ed{position:fixed;top:12px;right:12px;z-index:250;
  width:290px;max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;background:var(--bg-2);
  border:1px solid var(--accent);border-radius:12px;padding:10px 12px;color:var(--text);
  font-family:var(--sans);font-size:13px;line-height:1.5;box-shadow:0 12px 38px rgba(0,0,0,.45)}
  .u-ed-h{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .u-ed-h b{flex:1;min-width:100%;cursor:move;user-select:none;touch-action:none}
  .u-ed-h button{background:transparent;border:1px solid var(--border);color:var(--text);border-radius:6px;
  padding:3px 8px;font-size:12px;cursor:pointer;font-family:inherit}
  .u-ed-h button:hover{border-color:var(--accent)}.u-ed .u-lab{display:flex;align-items:center;gap:8px}
  .u-ed input[type=range]{flex:1}.u-ed .u-hint{margin:6px 0}
  /* 拖窗时应用画面不接鼠标, 不然滑进去就丢了; 缩放只放大内容, 窗和菜单的位置照屏幕算 */.u-dragging iframe{pointer-events:none}
  .u-win.u-min{display:none}.u-sb-item.u-min{opacity:.5}
  .u-shell,.u-win>.u-bar,.u-win>.u-wbody,.u-modal{zoom:var(--u-zoom,1)}.u-no{opacity:.4;cursor:not-allowed}
  .u-clock{font-size:12px;line-height:1.25;color:var(--text-muted);text-align:right;white-space:nowrap}
  .u-bk{padding:14px 26px 20px}.u-bk h3{font-size:14px;margin:18px 0 4px}
  .u-bk ul{margin:4px 0;padding-left:18px;font-size:12px}.u-bk summary{margin-top:16px;cursor:pointer}
  .u-tag{font-size:11px;padding:1px 8px;border-radius:5px;white-space:nowrap;background:var(--accent-soft);
  color:var(--accent)}.u-tag.u-warn{background:rgba(255,149,0,.12);color:var(--warn)}
  .u-tag.u-bad{background:rgba(255,68,68,.12);color:var(--danger)}
  .u-brow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 0;font-size:13px;
  border-top:1px solid var(--border)}.u-brow:first-child{border:0}.u-brow>b{min-width:90px}
  .u-brow .u-btn{padding:4px 11px;font-size:12px}
  @media(min-width:621px){.u-win:not(.u-w){left:calc(220px * var(--u-zoom,1))}}/* 放大的窗不盖左栏 */
  @media(max-width:620px){.u-side{display:none}.u-page{padding:12px}
  .u-head{padding:8px;flex-wrap:wrap;gap:10px}.u-bar [data-min]{display:none}}`;   // 窄屏没有左栏, 收起了就找不回来
// ✂ 框样式
// 弹窗、表单、按钮、提示条的样式: 对话框段用的就这些, 借对话框的块一起借它(别的块的 root 里也认 u- 类名)
const 框样式 = `.u-ov button,.u-ov input,.u-ov select{font-family:inherit}.u-modal>h2,.u-modal>h3,.u-modal>p{margin:0}
  .u-ov{position:fixed;inset:0;
  background:rgba(0,0,0,.7);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:center;
  justify-content:center;padding:20px;color:var(--text);font-family:var(--sans);line-height:1.6}
  .u-modal{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:28px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-sizing:border-box;
  scrollbar-width:thin}.u-modal.u-wide{max-width:720px}
  .u-modal>h2{font-size:18px;font-weight:500;margin-bottom:6px;font-family:var(--serif)}
  .u-modal>h2 small{font-family:var(--sans);font-size:11px;color:var(--text-muted)}
  .u-modal>h3{font-size:14px;margin:18px 0 4px}
  .u-hint{font-size:11px;color:var(--text-muted);line-height:1.6}.u-field{display:block;width:100%;
  margin-top:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:9px 12px;
  border-radius:8px;font-size:13px;box-sizing:border-box}
  .u-lab{display:block;margin:10px 0 4px;font-size:12px;color:var(--text-muted)}
  .u-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .u-foot{margin-top:16px;display:flex;justify-content:flex-end;gap:8px}.u-btn{background:transparent;
  color:var(--text);border:1px solid var(--border);padding:9px 20px;border-radius:8px;cursor:pointer;
  font-size:13px}.u-btn:hover{border-color:var(--accent);color:var(--accent)}
  .u-btn.u-pri{background:var(--accent);color:#000;border:none;font-weight:600}
  .u-toast{position:fixed;left:50%;transform:translateX(-50%);background:var(--bg-2);
  border:1px solid var(--border);padding:10px 18px;border-radius:8px;z-index:300;font-size:13px;
  color:var(--text);font-family:var(--sans)}`;
// ✂ 框样式 完
// ═ 骨架 ═
// 左侧栏(桌面、开着的窗、给别的块的插槽) + 顶栏(品牌、时钟、⚙、每块一个亮框) + 桌面; 窗和弹窗都盖在上面
const 骨架 = `<div class="u-shell"><div class="u-side"><div class="u-sb-head"><span class="u-sb-title">
  Colony</span></div><div class="u-sb-list">
  <div class="u-sb-item on" id="u-desk" title="把窗都收起来, 看桌面">🖥 桌面</div>
  <div id="u-wins"></div><div id="u-slot"></div></div></div>
  <div class="u-main"><div class="u-page" id="u-page"><div class="u-head"><div class="u-brand">
  <div class="u-mark">C</div><div><h1>Colony</h1><span class="u-sub">htmlcode</span></div></div>
  <div class="u-acts"><span class="u-clock" id="u-clock"></span>
  <button class="u-round" id="u-set" title="Stem 面板: 管块、导入导出(单独打开时是界面设置)">⚙</button>
  <div class="u-tiles" id="u-tiles"></div></div></div>
  <div class="u-grid" id="u-grid"></div></div></div></div>`;
// ═ 对话框 · 借用者: petri:bridge ═
// 弹窗、提示、点两下。不用浏览器的 confirm / prompt: agent 也要能走同一条界面路
const 对话框 = {
  开(html, wide) { // 点暗处、Esc 也走关闭键; 框里按下、暗处松开不算点暗处
    const o = document.createElement('div');
    o.className = 'u-ov';
    o.innerHTML = `<div class="u-modal${wide ? ' u-wide' : ''}">${html}`
      + '<div class="u-foot"><button class="u-btn" data-x>关闭</button></div></div>';
    let 按 = null;
    o.onmousedown = e => { 按 = e.target; };
    o.onclick = e => { if (e.target === o && 按 === o) o.querySelector('[data-x]').click(); };
    o.querySelector('[data-x]').onclick = () => o.remove();
    ctx.root.appendChild(o);
    return o;
  },
  关一层(免) { // Esc: 最上面一层菜单或弹窗关掉, 回关没关; 免: 跳过点选自己的框。直接调关闭键(派发的点击会被点选拦下)
    const 框 = [...ctx.root.querySelectorAll(`.u-menu, .u-ov${免 ? ':not([data-ed])' : ''}`)].pop();
    if (框) 框.classList.contains('u-menu') ? 框.remove() : 框.querySelector('[data-x]').onclick();
    return !!框;
  },
  记录: [],   // 提示几秒就没了, ui.state 和页面日志里还查得到
  提示(text, 只记) { // 几条一起来就往上摞, 不叠在一处; 只记 = 标签已经钉在那个东西上了
    if (text === undefined || text === null || text === '') return;
    对话框.记录.push({ at: Date.now(), text: String(text) });
    if (对话框.记录.length > 20) 对话框.记录.shift();
    console.log('[提示] ' + text);
    if (只记) return;
    const t = document.createElement('div');
    t.className = 'u-toast';
    t.textContent = text;
    ctx.root.appendChild(t);
    const all = [...ctx.root.querySelectorAll('.u-toast')];
    all.forEach((x, i) => { x.style.bottom = `${80 + (all.length - 1 - i) * 48}px`; });
    setTimeout(() => t.remove(), 2500);
  },
  两下(b, 话) { // 要紧的事点两下才做: 第一下这个键换成「再点一下…」, 3 秒内再点回 true, 不点就复原
    const 回 = () => {
      clearTimeout(b.两);
      b.textContent = b.原;
      b.原 = null;
    };
    if (b.原 != null) return !回();
    b.原 = b.textContent;
    b.textContent = '再点一下' + 话;
    b.两 = setTimeout(回, 3000);
  },
};
// ═ 窗口 · 跟着: 状态, 反馈 ═
// 应用窗、文件夹窗同一套: 🗗 或双击标题栏切最大化; 按住标题栏拖走, 拖边改大小; – 收到左栏; 每类窗记一份样子
const 窗口 = {
  键: 'settings:ui.win',
  记: {},   // {app: {max, x, y, w, h}, folder: {...}}
  async 载() { 窗口.记 = (await ctx.kv.get(窗口.键)) || {}; },
  存: () => ctx.kv.set(窗口.键, 窗口.记).catch(() => { }),
  序: () => [...UI.wins].sort((a, b) => (+b[1].el.style.zIndex || 0)
    - (+a[1].el.style.zIndex || 0)),   // 开着的窗, 最前的在头
  大: 类 => 类 === 'app' ? (窗口.记[类] || {}).max !== false : (窗口.记[类] || {}).max === true,   // 应用窗默认最大化
  开(键, 类, 标题, 按钮, 关时) {
    const el = document.createElement('div'), w = { el, 类, 关时 };
    el.className = 'u-win';
    el.dataset.k = 键;
    el.innerHTML = '<div class="u-bar"><div class="u-info"><i class="u-dot"></i><span data-t></span></div>'
      + `<div>${按钮 || ''}`
      + '<button data-min title="收起到左边栏">–</button><button data-max></button><button data-x>✕</button>'
      + '</div></div><div class="u-wbody"></div>'
      + ['n', 's', 'e', 'w', 'se'].map(d => `<i class="u-rz" data-d="${d}"></i>`).join('');
    el.querySelector('[data-t]').textContent = 标题;
    ctx.root.appendChild(el);
    UI.wins.set(键, w);
    const bar = el.querySelector('.u-bar');
    el.querySelectorAll('.u-rz').forEach(h => { h.onpointerdown = e => 窗口.拖(e, w, h.dataset.d); });
    bar.onpointerdown = e => { if (!e.target.closest('button') && !窗口.大(类)) 窗口.拖(e, w, ''); };
    bar.ondblclick = e => { if (!e.target.closest('button')) 窗口.切(w); };
    el.querySelector('[data-max]').onclick = () => 窗口.切(w);
    el.querySelector('[data-min]').onclick = () => 窗口.收(w);
    el.querySelector('[data-x]').onclick = () => 窗口.关(键);
    el.addEventListener('pointerdown', () => 窗口.前(el), true);
    窗口.摆(w);
    窗口.前(el);
    窗口.列表();
    反馈.长(el, 键);
    return w;
  },
  关(键) {
    const w = UI.wins.get(键);
    if (!w) return;
    UI.wins.delete(键);
    if (w.关时) w.关时();
    w.el.removeAttribute('data-k');   // 缩回去的那一下已经不算这个窗
    w.el.style.pointerEvents = 'none';
    反馈.长(w.el, 键, true).then(() => w.el.remove());
    窗口.列表();
  },
  前(el) { // z 从 50 往上排, 压不到弹窗(100); 收起的放出来
    if (el.classList.contains('u-min')) {
      el.classList.remove('u-min');
      窗口.列表();
    }
    const 别的 = [...ctx.root.querySelectorAll('.u-win')].filter(x => x !== el)
      .sort((a, b) => (+a.style.zIndex || 50) - (+b.style.zIndex || 50));
    别的.concat(el).forEach((x, i) => { x.style.zIndex = 50 + i; });
  },
  收(w) {
    w.el.classList.add('u-min');
    窗口.列表();
  },
  定(w, g, 全) { // 拖的时候标题栏留在屏幕里就行; 全 = 整个窗放进屏幕(开窗、屏幕变窄时)
    const W = Math.round(Math.max(280, Math.min(g.w, innerWidth))),
      H = Math.round(Math.max(180, Math.min(g.h, innerHeight)));
    const x = Math.round(Math.max(全 ? 0 : 120 - W, Math.min(g.x, innerWidth - (全 ? W : 120)))),
      y = Math.round(Math.max(0, Math.min(g.y, innerHeight - (全 ? H : 40))));
    Object.assign(w.el.style, { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px' });
    窗口.记[w.类] = Object.assign({}, 窗口.记[w.类], { x, y, w: W, h: H });
  },
  摆(w) { // 第一次开是屏幕的三分之二、居中; 不压顶栏的亮框, 同类的窗错开一点
    const 大 = 窗口.大(w.类), r = 窗口.记[w.类] || {}, b = w.el.querySelector('[data-max]');
    w.el.classList.toggle('u-w', !大);
    b.textContent = 大 ? '🗗' : '🗖';
    b.title = 大 ? '缩小成窗口' : '最大化';
    if (大) return ['left', 'top', 'width', 'height'].forEach(p => { w.el.style[p] = ''; });
    const W = r.w || innerWidth * 0.66, H = r.h || innerHeight * 0.72, 头 = ctx.root.querySelector('.u-head'),
      顶 = 头 ? Math.max(0, 头.getBoundingClientRect().bottom + 6) : 0;
    const g = { x: r.x != null ? r.x : (innerWidth - W) / 2, w: W, h: H,
      y: Math.max(顶, r.y != null ? r.y : (innerHeight - H) / 3) };
    ctx.root.querySelectorAll('.u-win.u-w').forEach(o => {
      if (o === w.el || Math.abs(o.offsetLeft - g.x) + Math.abs(o.offsetTop - g.y) > 12) return;
      g.x += 28;
      g.y += 28;
    });
    窗口.定(w, g, true);
  },
  切(w) { // 收起着的也放出来: 切完要看得见
    窗口.记[w.类] = Object.assign({}, 窗口.记[w.类], { max: !窗口.大(w.类) });
    窗口.摆(w);
    窗口.前(w.el);
    窗口.存();
  },
  挪(w, g) { // {x, y} 挪、{w, h} 改大小; 最大化着就先变成窗
    if (窗口.大(w.类)) 窗口.切(w);
    const r = w.el.getBoundingClientRect(), v = (k, d) => g[k] != null ? +g[k] : d;
    窗口.定(w, { x: v('x', r.left), y: v('y', r.top), w: v('w', r.width), h: v('h', r.height) });
    窗口.存();
  },
  拖(e, w, d) { // d 空 = 挪; n/s/e/w = 拉边(抓住指针, 滑过应用窗也不丢)
    if (e.button) return;
    const r0 = w.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, t = e.currentTarget;
    try { t.setPointerCapture(e.pointerId); } catch (x) { }
    ctx.root.classList.add('u-dragging');
    e.preventDefault();
    窗口.前(w.el);
    t.onpointermove = m => {
      const dx = m.clientX - x0, dy = m.clientY - y0,
        g = { x: r0.left, y: r0.top, w: r0.width, h: r0.height };
      if (!d) {
        g.x += dx;
        g.y += dy;
      }
      if (/e/.test(d)) g.w += dx;
      if (/s/.test(d)) g.h += dy;
      if (/w/.test(d)) {
        g.w = Math.max(280, r0.width - dx);
        g.x = r0.right - g.w;
      }
      if (/n/.test(d)) {
        g.h = Math.max(180, r0.height - dy);
        g.y = r0.bottom - g.h;
      }
      窗口.定(w, g);
    };
    t.onpointerup = t.onpointercancel = () => {
      t.onpointermove = t.onpointerup = t.onpointercancel = null;
      ctx.root.classList.remove('u-dragging');
      窗口.存();
    };
  },
  列表() { // 侧栏列出开着的窗, 收起的淡一些
    const box = $('u-wins');
    if (box) box.innerHTML = [...UI.wins].map(([k, w]) => '<div class="u-sb-item'
      + `${w.el.classList.contains('u-min') ? ' u-min" title="收起了, 点一下放出来' : ''}" data-k="${esc(k)}">`
      + esc(w.el.querySelector('[data-t]').textContent) + '</div>').join('');
  },
};
// ═ 运行窗 · 跟着: 状态, 应用登记, 对话框, 窗口, 点选 ═
// 一个应用一个窗, 挂进隔离窗: 默认隔离(读不到本机, 要数据走能力); 用户在窗上点开「完全访问」才同源, 记在应用记录的 trust 上
const 运行窗 = {
  async 开(id) {
    const 键 = 'app:' + id, 有 = UI.wins.get(键);
    if (有) return 窗口.前(有.el);
    const m = await 应用登记.get({ id }).catch(() => null);
    if (!m) return 对话框.提示('应用不存在: ' + id);
    const 钮 = `<button data-a="信任">${m.trust === true ? '🔓 完全访问' : '🔒 隔离运行'}</button>`
      + '<button data-a="编辑" title="点选编辑">✎</button>';
    const w = 窗口.开(键, 'app', `${m.icon || ''} ${m.name}`, 钮, () => w.frame && w.frame.colony.destroy());
    w.id = id;
    w.el.querySelector('[data-a="信任"]').onclick = e => 运行窗.信任(id, e.currentTarget);
    w.el.querySelector('[data-a="编辑"]').onclick = () => 点选.开();
    try {
      const f = await ctx.call('stem.mount',
        { code: m.code || '', host: w.el.querySelector('.u-wbody'), context: { miniappId: id, trust: m.trust === true },
        attrs: { allow: 'microphone; camera; autoplay; clipboard-read; clipboard-write',
          sandbox: m.trust === true ? 'allow-same-origin' : '' },
        timeout: 8000 });
      if (UI.wins.get(键) !== w) return f.colony.destroy();   // 等握手时窗已经关了
      w.frame = f;
    } catch (e) {
      if (e.frame && e.frame.colony) e.frame.colony.destroy();
      窗口.关(键);
      对话框.提示('打不开: ' + e.message);
    }
  },
  重开(id) { // 源码改了: 开着的窗关了重开, 才跑新代码
    if (!UI.wins.has('app:' + id)) return;
    窗口.关('app:' + id);
    运行窗.开(id);
  },
  async 信任(id, b) { // 隔离 ↔ 完全访问: 只有用户在这里点才改得了; 开要点两下, 第一下说清代价
    const m = await 应用登记.get({ id });
    const 开 = m.trust !== true;
    if (开 && !对话框.两下(b, ': 它能读写全部数据和 Key、改块代码')) return;
    await 应用登记.设信任(id, 开);
    运行窗.重开(id);
    对话框.提示(开 ? `「${m.name}」已完全访问` : `「${m.name}」已恢复隔离运行`);
  },
};
// ═ 桌面 · 跟着: 状态, 应用登记, 窗口, 动作, 反馈 ═
// settings:ui.desktop = {pos: {'app:<id>' | 'folder:<id>': {x, y}}, folders: [{id, name, items}]}
const 桌面 = {
  键: 'settings:ui.desktop',
  格: { w: 104, h: 118 },
  async 读() {
    const d = (await ctx.kv.get(桌面.键)) || {};
    return { pos: d.pos || {}, folders: (d.folders || []).map(f => Object.assign({ items: [] }, f)) };
  },
  队: Promise.resolve(),   // 读改存和画排一条队: 同时整份回写会互相吞掉
  改(fn) {
    const p = 桌面.队.then(async () => {
      const d = await 桌面.读(), r = await fn(d);
      await ctx.kv.set(桌面.键, d);
      return r;
    });
    桌面.队 = p.catch(() => { });
    return p.then(r => {
      桌面.画();
      return r;
    });
  },
  列数: () => Math.max(1, Math.floor(($('u-grid').clientWidth || 600) / 桌面.格.w)),
  吸(x, y) { // 左右压在桌面宽度里, 往下不限
    const w = 桌面.格.w, h = 桌面.格.h;
    return { x: Math.min(桌面.列数() - 1, Math.max(0, Math.round(x / w))) * w,
      y: Math.max(0, Math.round(y / h)) * h };
  },
  空位(want, used) {
    const k = p => p.x + ':' + p.y, w = 桌面.吸(want.x || 0, want.y || 0), cols = 桌面.列数();
    let best = w, bd = used.has(k(w)) ? Infinity : 0;
    for (let r = 0; bd && r < Math.ceil((used.size + 1) / cols) + w.y / 桌面.格.h
      + 1; r++) for (let c = 0; c < cols; c++) {
      const p = { x: c * 桌面.格.w, y: r * 桌面.格.h }, d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
      if (!used.has(k(p)) && d < bd) [best, bd] = [p, d];
    }
    used.add(k(best));
    return best;
  },
  放(d, key, x, y) {
    const used = new Set(Object.keys(d.pos).filter(k => k !== key).map(k => d.pos[k].x + ':' + d.pos[k].y));
    d.pos[key] = 桌面.空位({ x, y }, used);
  },
  夹里: (d, appId) => (d.folders.find(f => f.items.includes(appId)) || {}).id,
  摘: (d, appId) => d.folders.forEach(f => { f.items = f.items.filter(i => i !== appId); }),   // 从所有文件夹里摘掉
  找夹(d, fid) {
    const f = d.folders.find(x => x.id === fid || x.name === fid);   // agent 给名字也认
    if (!f) throw new Error('没有这个文件夹: ' + fid);
    return f;
  },
  卡: (k, ico, 色, 名, 数, 位) => `<div class="u-card${k[0] === 'f' ? ' u-folder' : ''}" draggable="true" data-k="`
    + `${esc(k)}"${位 ? ` style="left:${位.x}px;top:${位.y}px"` : ''}><div class="u-ico" style="background:`
    + `${esc(色 || '#1a1a1a')}33">${esc(ico)}</div>${数 ? `<div class="u-count">${数}</div>` : ''}`
    + `<div class="u-nm">${esc(名)}</div></div>`,
  应用卡: (m, 位) => 桌面.卡('app:' + m.id, m.icon || '📦', m.color, m.name, 0, 位),
  画: () => 桌面.队 = 桌面.队.then(桌面.画一次).catch(e => console.error('[ui]', e)),
  async 画一次() {
    const grid = $('u-grid');
    if (!grid) return;
    const all = await 应用登记.list(), d = await 桌面.读(), 在 = new Set(all.map(m => m.id));
    const 旧 = UI.apps, 前 = 反馈.记(grid);
    UI.apps = new Map(all.map(m => [m.id, m]));
    let 改 = false;
    d.folders.forEach(f => { // 没了的应用从文件夹里摘掉
      const n = f.items.length;
      f.items = f.items.filter(i => 在.has(i));
      改 = 改 || n !== f.items.length;
    });
    const inF = new Set(d.folders.flatMap(f => f.items));
    const 项 = d.folders.map(f => ['folder:' + f.id,
      位 => 桌面.卡('folder:' + f.id, '📁', '', f.name, f.items.length, 位)])
      .concat(all.filter(m => !inF.has(m.id)).map(m => ['app:' + m.id, 位 => 桌面.应用卡(m, 位)]));
    Object.keys(d.pos).forEach(k => {
      if (项.some(x => x[0] === k)) return;
      delete d.pos[k];
      改 = true;
    });
    const used = new Set(), W = 桌面.格.w, H = 桌面.格.h, 位 = {};
    项.forEach(([k]) => { // 先让摆过的各回各格, 再给没摆过的、撞格的找空格: 新图标不抢老图标的格
      const o = d.pos[k], p = o && { x: Math.round(o.x / W) * W, y: Math.round(o.y / H) * H };
      if (!p || used.has(p.x + ':' + p.y)) return;
      used.add(p.x + ':' + p.y);
      位[k] = p;
    });
    项.forEach(([k]) => {
      if (位[k]) return;
      位[k] = d.pos[k] = 桌面.空位(d.pos[k] || { x: 0, y: 0 }, used);
      改 = true;
    });
    const 底 = Math.max(0, ...项.map(([k]) => 位[k].y + H));
    grid.innerHTML = 项.length ? 项.map(([k, 画]) => 画(位[k])).join('')
      : '<div class="u-empty">桌面还是空的。把 .html 文件拖进来, 右键空白处可新建文件夹'
        + `${colony.has('agent.send') ? ', 或吩咐 agent "做一个 xxx"' : ''}</div>`;   // 单独打开没有 agent 就不提
    grid.style.height = 底 ? 底 + 'px' : '';
    反馈.比(grid, 前, 旧);
    if (改) await ctx.kv.set(桌面.键, d);
    UI.wins.forEach(w => { if (w.画) w.画(); });   // 文件夹窗跟着刷新
  },
  排列: () => 桌面.改(d => {
    const keys = [...$('u-grid').querySelectorAll('[data-k]')].map(e => e.dataset.k), cols = 桌面.列数(),
      旧 = JSON.stringify(d.pos);   // 桌面上画着的就是要排的: 文件夹在前
    d.pos = {};
    keys.forEach((k, i) => { d.pos[k] = { x: (i % cols) * 桌面.格.w, y: Math.floor(i / cols) * 桌面.格.h }; });
    if (!keys.length) return '桌面是空的, 没东西要排';   // 什么都没挪也说一声, 不然像没点上
    if (JSON.stringify(d.pos) === 旧) return '已经排好了';
  }),
  挪: (k, at) => 桌面.改(d => { 桌面.放(d, k, +at.x || 0, +at.y || 0); }),
  新建文件夹: (at, 名) => 桌面.改(d => {
    const id = 新号('f');
    d.folders.push({ id, name: 名 || '新建文件夹', items: [] });
    桌面.放(d, 'folder:' + id, at ? at.x : 0, at ? at.y : 0);
    return { ok: true, 对象: 'folder:' + id };
  }),
  改名夹: (fid, 名) => 桌面.改(d => { 桌面.找夹(d, fid).name = 名; }),
  删夹: fid => 桌面.改(d => {
    const f = 桌面.找夹(d, fid);
    d.folders = d.folders.filter(x => x !== f);
    delete d.pos['folder:' + f.id];
    窗口.关('folder:' + f.id);
  }),
  移入: (appId, fid) => 桌面.改(d => {
    const f = 桌面.找夹(d, fid);
    桌面.摘(d, appId);
    f.items.push(appId);
    delete d.pos['app:' + appId];
    return `已移入「${f.name}」`;
  }),
  移出: (appId, at) => 桌面.改(d => {
    桌面.摘(d, appId);
    if (at) 桌面.放(d, 'app:' + appId, at.x, at.y);
    return '已移到桌面';
  }),
  async 开夹(fid) {
    const 键 = 'folder:' + fid, 有 = UI.wins.get(键);
    if (有) return 窗口.前(有.el);
    const w = 窗口.开(键, 'folder', '📁'), body = w.el.querySelector('.u-wbody');
    桌面.接(body, fid);
    w.画 = async () => {
      const f = (await 桌面.读()).folders.find(x => x.id === fid);
      if (!f) return 窗口.关(键);
      w.el.querySelector('[data-t]').textContent = '📁 ' + f.name;
      const 有 = f.items.filter(id => UI.apps.has(id));
      body.innerHTML = '<p class="u-hint">图标拖进来 = 收进文件夹, 拖到桌面 = 移出来</p>'
        + `<div class="u-fgrid">${有.length ? 有.map(id => 桌面.应用卡(UI.apps.get(id))).join('')
          : '<p class="u-hint">空文件夹。</p>'}</div>`;
      窗口.列表();
    };
    await w.画();
  },
  接(el, 夹) { // 桌面和文件夹窗共用
    const 卡 = e => e.target.closest('[data-k]');
    el.onclick = e => { if (卡(e)) 动作.人做(卡(e).dataset.k, '打开'); };
    el.oncontextmenu = e => {
      if (!卡(e)) return;
      e.preventDefault();
      e.stopPropagation();
      菜单.出(e.clientX, e.clientY, 卡(e).dataset.k, { 夹 });
    };
    el.ondragstart = e => { if (卡(e)) 拖放.带上(e, 卡(e).dataset.k); };
  },
};
// ═ 拖放 · 跟着: 桌面, 应用登记, 对话框, 动作, 反馈 ═
// 落点: 桌面换位、文件夹收进去、从文件夹窗放出来、拖出窗口落成 .html(只有 Chromium 认); 拖进来的收成新应用
const 拖放 = {
  文件名: m => (m.name || 'app').replace(/[\\/:*?"<>|]/g, '_') + '.html',
  有: (e, t) => !!e.dataTransfer && [].includes.call(e.dataTransfer.types || [], t),
  分享: new Map(),   // 凭条 → {id, at}: 人把应用图标拖出去 = 同意落点那个应用读它(代码 + 存的数据, 只读, 6 小时, 刷新就没)
  带上(e, k) {
    e.dataTransfer.setData('text/x-colony-key', k);
    const m = k.startsWith('app:') && UI.apps.get(k.slice(4));
    if (!m) return;
    const 条 = 'sh' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    拖放.分享.set(条, { id: m.id, at: Date.now() });
    e.dataTransfer.setData('text/x-colony-share', JSON.stringify({ token: 条, id: m.id, name: m.name, icon: m.icon }));
    const b64 = btoa(unescape(encodeURIComponent(m.code || '')));
    e.dataTransfer.setData('DownloadURL', `text/html:${拖放.文件名(m)}:data:text/html;charset=utf-8;base64,`
      + b64);
    e.dataTransfer.setData('text/x-colony-code',
      JSON.stringify({ name: m.name, icon: m.icon, color: m.color, desc: m.desc,
      code: m.code }));   // 别的窗凭它新建
  },
  凭条(t) { // 拖进别的应用窗的图标: 落点应用凭它读被拖的应用
    const s = 拖放.分享.get(t && t.token || t);
    if (!s || Date.now() - s.at > 6 * 3600e3) throw new Error('凭条无效或过期: 把桌面上的应用图标重新拖进来一次');
    return s.id;
  },
  落点(e) { // 界面缩放过: 屏幕上的距离除回去, 才是桌面格子里的位置
    const g = $('u-grid'), r = g.getBoundingClientRect(), z = g.currentCSSZoom || 1;
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  },
  装() {
    const page = $('u-page'), 清 = () => {
      page.classList.remove('u-drop');
      ctx.root.querySelectorAll('.u-target').forEach(x => x.classList.remove('u-target'));
    };
    听(ctx.root, 'dragover', e => {
      const 外 = 拖放.有(e, 'Files') || (拖放.有(e, 'text/x-colony-code') && !拖放.有(e, 'text/x-colony-key'));
      const 夹 = 拖放.有(e, 'text/x-colony-key') && e.target.closest('.u-folder');
      清();
      if (外 && !e.target.closest('.u-win')) page.classList.add('u-drop');
      if (夹) 夹.classList.add('u-target');
      if (外 || 拖放.有(e, 'text/x-colony-key')) e.preventDefault();
    });
    听(ctx.root, 'dragleave', e => { if (!ctx.root.contains(e.relatedTarget)) 清(); });
    听(ctx.root, 'drop', e => {
      清();
      const 人 = e.isTrusted, 处 = { left: e.clientX, top: e.clientY, width: 1, height: 1 };   // agent 眼手拖的不算人
      反馈.标记(人);
      拖放.落(e).then(t => t && 反馈.说('drop', t, 人, false, 处))
        .catch(x => 反馈.说('drop', x.message, 人, true, 处));
    });
    page.oncontextmenu = e => {
      if (e.target.closest('[data-k]')) return;
      e.preventDefault();
      菜单.出(e.clientX, e.clientY, 'desk', { at: 拖放.落点(e) });
    };
  },
  async 落(e) {
    const k = e.dataTransfer.getData('text/x-colony-key'), 码 = e.dataTransfer.getData('text/x-colony-code');
    const files = [...(e.dataTransfer.files || [])], p = 拖放.落点(e);   // await 之后 dataTransfer 就空了
    const 夹 = e.target.closest('.u-folder, .u-win[data-k^="folder:"]'), fid = 夹 && 夹.dataset.k.slice(7);
    if (k) {
      e.preventDefault();
      if (k.startsWith('app:') && fid) return 桌面.移入(k.slice(4), fid);
      if (e.target.closest('.u-win')) return;
      if (k.startsWith('app:') && 桌面.夹里(await 桌面.读(), k.slice(4))) return 桌面.移出(k.slice(4), p);
      return 桌面.挪(k, p);
    }
    if (!码 && !files.length) return;
    e.preventDefault();
    const 收 = 码 && !files.length ? [JSON.parse(码)] : [];
    for (const f of files.filter(x => /\.html?$/i.test(x.name))) {
      收.push({ code: await f.text(), name: f.name.replace(/\.html?$/i, '') });   // 名字就用文件名, 不看 <title>
    }
    const 占 = new Set([...UI.apps.values()].map(a => a.name));
    const 不撞 = n => { // 同名加「副本」, 还撞就「副本 2」「副本 3」…(和右键「复制」一个叫法)
      n = (n || '').trim() || '未命名';
      let r = n;
      for (let i = 1; 占.has(r); i++) r = n + ' 副本' + (i > 1 ? ' ' + i : '');
      占.add(r);
      return r;
    };
    for (const [i, x] of 收.entries()) {
      const m = await 应用登记.create({ code: x.code, name: 不撞(x.name), icon: x.icon, color: x.color, desc: x.desc });
      await 桌面.改(d => 桌面.放(d, 'app:' + m.id, p.x + i * 桌面.格.w, p.y));
    }
    return 收.length ? `已收进桌面 ${收.length} 个应用(在隔离窗里跑)` : '只收 .html 文件';
  },
};
// ═ 动作 · 跟着: 状态, 应用登记, 桌面, 窗口, 运行窗, 装配台, 点选, 设置, 对话框, 反馈 ═
// 人和 agent 做的事都在这张表: 菜单照它画, 按钮、拖放、ui.do 调同一个函数。一项 = [名字, 做(对象, 值), 要的值, 什么时候有];
// 要的值: '确认…' = 人点两下才做(agent 不用), '?…' = 可不给, '*…' = 只给 agent(菜单不列); 也可以是看对象定的函数。
// 什么时候有: 回假 = 不列; 回一句话 = 列出来但变灰, 点了(或 agent 调)就说这句为什么做不了
const 有解读 = () => colony.has('code.open');   // 有代码解读块才列
const 动作 = {
  表: {
    app: [
      ['打开', o => 运行窗.开(o.id)],
      ['简述', o => 对话框.开(`<h2>${esc(o.icon)} ${esc(o.name)}</h2><p class="u-hint">`
        + `${esc(o.desc) || '(没有简述)'}</p>`)],
      ['改名', (o, v) => 应用登记.update({ id: o.id, patch: { name: v } }).then(应用登记.简), '新名字'],   // 回简述, 不回整份代码
      '-',
      ['移到桌面', o => 桌面.移出(o.id), 0, o => !!o.夹],   // 回字符串算「为什么不能」, 这里转成真假
      ['放进文件夹', (o, v) => 桌面.移入(o.id, v), '*文件夹 id 或名字'],
      ['挪到', (o, v) => 桌面.挪('app:' + o.id, v), '*{x, y}', o => !o.夹],
      ['复制', o => 应用登记.复制(o.id, o.夹)],
      ['导出文件', o => 下载文件(拖放.文件名(o), o.code || '')],
      ['看源码', o => 装配台.源码('miniapp:' + o.id)],
      ['代码解读', o => 装配台.解读('miniapp:' + o.id), 0, 有解读],
      ['收养里面的块', o => 装配台.收养(o.code), '确认: 同 id 的块换成它的',
        o => o.块.length && 在Colony()],
      ['装回本体', o => 装配台.装回(o), '确认: 块和 Stem 换成它的', o => o.全 && 在Colony()],
      '-',
      ['删除', o => 应用登记.remove({ id: o.id }), '确认: 它存的数据一起删'],
    ],
    folder: [
      ['打开', o => 桌面.开夹(o.id)],
      ['改名', (o, v) => 桌面.改名夹(o.id, v), '新名字'],
      ['挪到', (o, v) => 桌面.挪('folder:' + o.id, v), '*{x, y}'],
      '-',
      ['删除', o => 桌面.删夹(o.id), '确认: 里面的应用回到桌面'],
    ],
    desk: [
      ['新建文件夹', (o, v) => 桌面.新建文件夹(o.at, v), '?名字'],
      ['自动排列', () => 桌面.排列()],
      ['点选编辑', () => 点选.开()],
      ['组装成 Colony', (o, v) => 装配台.组装(v), '?{底座: 应用 id, petris: [应用 id], 名字}', 在Colony],
      ['重画皮肤', () => 点选.用皮肤(), '*'],
    ],
    win: [
      ['到最前', o => 窗口.前(o.w.el)],
      ['收起', o => 窗口.收(o.w)],
      ['最大化或还原', o => 窗口.切(o.w)],
      ['挪到', (o, v) => 窗口.挪(o.w, v), '*{x, y}'],
      ['改大小', (o, v) => 窗口.挪(o.w, v), '*{w, h}'],
      ['关', o => 窗口.关(o.id)],
    ],
    block: [
      ['打开', o => 装配台.开块(o.id), 0, o => !UI.wins.has('block:' + o.id)],   // 开着就不列
      ['说明', o => 装配台.开块(o.id, true)],
      ['启用', o => 装配台.设(o, { enabled: true }), 0, o => o.enabled === false],
      ['禁用', o => 装配台.设(o, { enabled: false }), o => o.id === ctx.id
        ? '确认: 桌面会关掉, 在 Stem 简易页能再启用' : 0, o => o.enabled !== false],
      // 只给浮在页上的界面(agent 的球): 窗里的页藏了是空窗, 界面块藏了就全没了
      ['隐藏界面', o => 装配台.设(o, { hidden: true }), 0, o => o.running && !o.hidden && 装配台.浮(o.id)],
      ['显示界面', o => 装配台.设(o, { hidden: false }), 0, o => o.hidden],
      ['恢复原版', o => 装配台.设(o, { code: null }), '确认: 改版留作备用', o => 装配台.改过(o)],
      ['移除收养', o => 装配台.设(o, { remove: true }), '确认', o => o.adopted],
      ['导出到桌面', o => 装配台.导出('block', o)],
      ['看源码', o => 装配台.源码(o.id)],
      ['代码解读', o => 装配台.解读(o.id), 0, 有解读],
    ],
    colony: [
      ['设置', () => 设置.开()],
      ['换皮肤', (o, v) => 皮肤.换(v), '?经典 / 视窗'],
      ['随机壁纸', () => 壁纸.随机()],
      ['AI 画壁纸', (o, v) => 壁纸.画(v), '想要什么样的', () => colony.has('ai.image') || '先在 AI 配置里给「图片」选个模型'],
      ['Stem 面板', () => 设置.stem(), 0, () => colony.has('stem.panel') || 在Colony('这版 Stem 没有面板')],
      ['导入 Petri', (o, v) => 装配台.导入(v), '?应用 id', 在Colony],
      ['导出下一代', () => 装配台.导出('colony'), 0, 在Colony],
      ['导出 Stem', () => 装配台.导出('stem'), 0, 在Colony],
      ['看 Stem 源码', () => 装配台.源码('stem'), 0, 在Colony],
      ['解读 Stem', () => 装配台.解读('stem'), 0, 有解读],
      ['Stem 恢复原版', () => 装配台.stem原版(), '确认: 改版留作备用, 刷新后生效',
        o => 在Colony(o.stem改 || 'Stem 没改过, 跑的就是原版')],
    ],
  },
  async 对象(k, 额外) {
    const i = String(k).indexOf(':'), 类 = i < 0 ? k : k.slice(0, i), id = i < 0 ? '' : k.slice(i + 1);
    const o = Object.assign({ id }, 额外);
    if (类 === 'app') {
      const m = await 应用登记.get({ id });
      return [类, Object.assign(o, m, { 夹: 桌面.夹里(await 桌面.读(), id), 块: 装配台.块名(m.code), 全: 装配台.全(m.code) })];
    }
    if (类 === 'folder') return [类, Object.assign(o, 桌面.找夹(await 桌面.读(), id))];
    if (类 === 'win') {
      if (!UI.wins.has(id)) throw new Error(`没开这个窗: ${id}(开着的窗见 ui.state 的 窗口)`);
      const w = UI.wins.get(id);
      return [类, Object.assign(o, { w, name: w.el.querySelector('[data-t]').textContent })];
    }
    if (类 === 'block') {
      if (在Colony() !== true) throw new Error(在Colony());
      const b = (await ctx.call('stem.blocks')).find(x => x.id === id);
      if (!b) throw new Error('没有这块: ' + id);
      return [类, Object.assign(o, b)];
    }
    if (类 === 'colony') o.stem改 = !colony.单独 && (await ctx.call('stem.lineage')).stemUse === 'edited';
    if (!动作.表[类]) throw new Error('不认得 ' + k
      + ': 对象写 app:<id> / folder:<id> / win:<窗> / block:<id> / desk / colony');
    return [类, o];
  },
  项: (类, o) => 动作.表[类].filter(x => x === '-' || !x[3] || x[3](o)),
  缘(x, o) { // 列出来但做不了的那句为什么
    const v = x[3] && x[3](o);
    return typeof v === 'string' ? v : '';
  },
  async 做(k, 名, 值, 人, 额外) { // agent 做的在界面上提示一句
    const [类, o] = await 动作.对象(k, 额外), 项 = 动作.项(类, o).find(x => x[0] === 名);
    if (!项) throw new Error(`${k} 现在不能「${名}」; 能做的: `
      + 动作.项(类, o).filter(x => x !== '-' && !动作.缘(x, o)).map(x => x[0]).join('、'));
    if (动作.缘(项, o)) throw new Error(动作.缘(项, o));
    const 要 = 动作.要(项, o), 名字 = o.name || (/^(desk|colony)$/.test(类) ? '' : o.id || k);   // 桌面、Colony 不用再点名
    if (要 && !/^(确认|\?)/.test(要) && 要 !== '*' && (值 === undefined || 值 === '')) {
      throw new Error(`「${名}」要给 value: ${要.replace(/^\*/, '')}`);
    }
    反馈.标记(人);
    const r0 = 反馈.框(反馈.找(k));   // 做完它可能不在了(删了、进了文件夹), 标签就钉在原处
    if (!人 && r0) await 反馈.指(r0.left + Math.min(r0.width / 2, 60), r0.top + Math.min(r0.height / 2, 30));
    let r;
    try {
      r = await 项[1](o, typeof 值 === 'string' ? 值.trim() : 值);
    } catch (e) {
      反馈.说(k, e.message, 人, true, r0);
      e.说过 = true;
      throw e;
    }
    await 桌面.队;   // 等桌面画完再钉
    const 话 = typeof r === 'string' ? r : 人 ? '' : [名, 名字].filter(Boolean).join(' ');
    if (话) 反馈.说(r && r.对象 || k, 话, 人, false, r0);
    return r === undefined ? { ok: true } : r;
  },
  人做: (k, 名, 额外, 值) => 动作.做(k, 名, 值, true, 额外).catch(e => e.说过 || 对话框.提示(e.message)),
  要: (x, o) => (typeof x[2] === 'function' ? x[2](o) : x[2]) || '',
  人项: (类, o) => 动作.项(类, o).filter(x => x === '-' || !/^\*/.test(动作.要(x, o))),   // 菜单和按钮: 只给 agent 的不列
  能做: () => Object.fromEntries(Object.entries(动作.表).map(([类, l]) => [类, l.filter(x => x !== '-')
    .map(x => x[0] + (typeof x[2] === 'string' && !/^确认/.test(x[2]) && x[2] !== '*'
      ? `(${x[2].replace(/^[?*]/, '')})` : ''))])),
};
const 菜单 = {
  async 出(x, y, k, 额外) {
    菜单.收();
    const [类, o] = await 动作.对象(k, 额外);
    const list = 动作.人项(类, o).filter((it, i, a) => it !== '-' || i && a[i + 1] && a[i - 1] !== '-');
    const m = document.createElement('div');
    m.className = 'u-menu';
    m.innerHTML = list.map((it, i) => it === '-' ? '<div class="u-sep"></div>' : '<div class="u-mi'
      + `${动作.缘(it, o) ? ' u-no" title="' + esc(动作.缘(it, o)) : ''}" data-i="${i}">`
      + esc(it[0]) + '</div>').join('');
    ctx.root.appendChild(m);
    m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
    m.onclick = e => { // 要确认的点两下; 要给值的(改名)这一项变成输入框, 回车做; 灰的照旧直接说为什么
      const el = e.target.closest('.u-mi'), it = el && list[+el.dataset.i], 要 = it && !动作.缘(it, o)
        && 动作.要(it, o);
      if (!el || el.querySelector('input') || /^确认/.test(要) && !对话框.两下(el, 要.slice(2))) return;
      if (要 && !/^(确认|\?)/.test(要)) {
        el.innerHTML = `<input class="u-field" value="${esc(o.name)}">`;
        el.firstChild.select();
        // 只在回车时做事, 别的键一律放行: 处理函数回 false 会让浏览器吞掉这个键(之前退格、打字全被吞)
        return el.firstChild.onkeydown = x => {
          if (x.key !== 'Enter' || x.isComposing || !x.target.value.trim()) return;   // 输入法选词的回车不算
          菜单.收();
          动作.人做(k, it[0], 额外, x.target.value);
        };
      }
      菜单.收();
      动作.人做(k, it[0], 额外);
    };
  },
  收: () => ctx.root.querySelectorAll('.u-menu').forEach(m => m.remove()),
};
// ═ 自报卡 · 跟着: 状态 ═
// 一块的自报画成一张卡: 用处、此刻的样子、技能(点开看全文)、占的数据、能力(★ agent 直接当工具用, 🪟 小应用也能调)。
// 块窗、次元口袋、代码解读都用这一张, 别的块经 ui.card 借。选: 点技能(第几行)、点数据(前缀)、此刻(画完就看此刻的样子)
const 自报卡 = {
  样式: `.ab{font-size:13px;line-height:1.6}.u-wbody>.ab{padding:4px 18px 18px}.ab h3{margin:4px 0}
    .ab p{margin:2px 0}.ab .u-hint{margin:12px 0 2px}.ab summary{cursor:pointer}
    .ab code{font:12px var(--mono)}.ab pre{margin:4px 0;padding:8px;max-height:60vh;overflow:auto;
    white-space:pre-wrap;border-radius:8px;font:12px/1.6 var(--mono);background:var(--bg-2)}
    .ab [data-ab-p]{cursor:pointer}.ab [data-ab-p]:hover code{color:var(--accent)}`,
  async 挂(el, id, 选 = {}) {
    const b = (await ctx.call('stem.blocks')).find(x => x.id === id);
    if (!b) return (el.textContent = '没有这块: ' + id);
    const a = Object.assign({ desc: '', data: [], skills: [] }, b.about),
      cs = await ctx.call('stem.capabilities', {}), 能 = cs.filter(c => c.by === id),
      句 = c => esc(String(c && c.desc || '').split(/[:：;；。]/)[0]),
      段 = (t, s) => s ? `<p class="u-hint">${t}</p>${s}` : '',
      钮 = (k, t) => `<button class="u-btn" ${k}>${t}</button>`;
    const 停 = b.enabled === false;   // 禁用了 Stem 也记一条 error, 那不算出错
    el.innerHTML = '<div class="ab"><h3>' + esc(`${b.icon || ''} ${b.name}`)
      + `${b.running ? '' : 停 ? ' · 已禁用' : ' · 没在跑'}</h3>`
      + (b.error && !停 ? `<p style="color:var(--danger)">${esc('出错: ' + b.error)}</p>` : '')
      + `<p>${esc(a.desc || '这块还没写用处(写在它「自报」段的第一行)')}</p>`
      + (a.open && b.running ? 钮('data-ab-open', '打开') : '')
      + 段('此刻 · ' + 句(cs.find(c => c.path === a.show)),
        a.show && (b.running ? 钮('data-ab-now', '看它此刻的样子') + '<pre hidden></pre>'
          : `<p class="u-hint">${停 ? '启用' : '跑起来'}后才看得到</p>`))
      + 段('技能 · 教 agent 怎么用这块, 点开看全文', a.skills.map(s => '<details data-ab-l="' + s.line
        + `"><summary>【${esc(s.name)}】${esc(s.when)}</summary><pre></pre></details>`).join(''))
      + 段(`占的数据${选.点数据 ? ' · 点一行去看' : ''}`, a.data.map(n => '<p'
        + `${选.点数据 && n.prefix ? ` data-ab-p="${esc(n.prefix)}"` : ''}><code>${esc(n.prefix || '?')}`
        + '</code> ' + esc(n.label || '这一行不是合格的 JSON: ' + n.error)
        + `${n.edit ? ` · <span title="${esc(n.edit)}">只能经这块改</span>` : ''}</p>`).join(''))
      + (能.length ? `<details><summary class="u-hint">能力 ${能.length} 个 · ★ agent 直接当工具用 · `
        + '🪟 小应用也能调</summary>' + 能.map(c => `<p title="${esc(c.desc)}"><code>${c.common ? '★ ' : ''}`
          + `${esc(c.path)}</code> ${句(c)}${c.frames ? ' 🪟' : ''}</p>`).join('') + '</details>' : '')
      + '</div>';
    const 此 = el.querySelector('[data-ab-now]'), 开 = el.querySelector('[data-ab-open]');
    el.querySelectorAll('[data-ab-l]').forEach(d => {
      d.firstChild.onclick = e => 选.点技能 && (e.preventDefault(), 选.点技能(+d.dataset.abL));
      d.ontoggle = async () => { // 全文从技能段现读: 改过的就是改过的样子
        if (!d.open || d.lastChild.textContent) return;
        const i = +d.dataset.abL, ls = (await ctx.call('stem.block', { id, segment: '技能' })).segment.text
          .split('\n'), j = ls.findIndex((l, k) => k > i && /^\/\/ 【/.test(l));
        d.lastChild.textContent = ls.slice(i, j < 0 ? undefined : j).map(l => l.replace(/^\/\/ ?/, ''))
          .join('\n');
      };
    });
    el.querySelectorAll('[data-ab-p]').forEach(p => { p.onclick = () => 选.点数据(p.dataset.abP); });
    if (开) 开.onclick = () => ctx.call(a.open, {}).catch(e => { 开.textContent = '没打开: ' + e.message; });
    if (此) 此.onclick = async () => {
      const r = await ctx.call(a.show, {}).catch(x => '没看到: ' + x.message);
      此.nextSibling.textContent = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
      此.nextSibling.hidden = false;
    };
    if (此 && 选.此刻) await 此.onclick();
  },
};
// ═ 装配台 · 跟着: 状态, 应用登记, 对话框, 动作, 设置, 反馈, 自报卡 ═
// 裸壳页能做的这里都有, 再加自我迭代那一圈: 导出到桌面、从桌面导入、组装、装回本体。
// 块窗一条规矩: 块有看得见的页就把页搬进窗, 没有就画它能做的事和自报卡; 界面块的页是整个桌面, 它的窗放设置页
const 装配台 = {
  块名: code => [...String(code
    || '').matchAll(new RegExp('<' + 'script type="colony/' + 'petri" data-id="([^"]+)"', 'g'))]
    .map(x => x[1]),   // 拆开写: 免得本块被认成一块
  全: code => new RegExp('<' + 'script id="stem" type="colony/' + 'stem">[\\s\\S]*?// ═ 启动').test(code
    || ''),   // 带完整 Stem
  stem文: code => (new RegExp('<' + 'script id="stem" type="colony/' + 'stem">([\\s\\S]*?)</'
    + 'script>').exec(code) || [])[1],
  改过: b => (b.segs || []).some(s => s.use === 'edited') || (b.deleted || []).length > 0,
  页: id => document.querySelector(`#colony-root > [data-block-id="${CSS.escape(id)}"]`),
  浮(id) { // 页面上有东西又不是一整页(agent 的对话球): 只有这种值得单独藏
    const r = 装配台.页(id);
    return id !== ctx.id && !!r && !r.offsetHeight && r.childElementCount > 0;
  },
  状态: b => b.broken ? ['坏了: ' + b.error, 'u-bad'] : b.enabled === false   // 禁用的 Stem 也记一条错, 那不算错
    ? [b.adopted ? '已收养 · 还没启用' : '已禁用', 'u-warn'] : b.error ? ['出错: ' + b.error, 'u-bad']
    : b.hidden ? ['界面藏起来了', 'u-warn'] : ['在跑', ''],
  async 亮框() {
    const wrap = $('u-tiles'), bs = 在Colony() === true && await ctx.call('stem.blocks');
    if (!wrap) return;
    wrap.innerHTML = !bs ? '<span class="u-sub">单独打开</span>' : bs.map(b => '<div class="u-tile'
      + `${b.enabled === false ? ' u-off' : ''}" data-id="${esc(b.id)}" title="${esc(装配台.状态(b)[0])}`
      + `"><span>${esc(b.name || b.id)}</span>`
      + (装配台.状态(b)[1] === 'u-bad' ? '<i class="u-err">!</i>' : '')
      + `${装配台.改过(b) ? '<button class="u-reset" title="恢复原版(改版留作备用)">↺</button>' : ''}</div>`).join('');
    if (bs.length) 反馈.块(bs);
    wrap.onclick = wrap.oncontextmenu = e => { // 右键亮框是这一块的菜单
      const t = e.target.closest('.u-tile'), k = t && 'block:' + t.dataset.id,
        重 = e.target.closest('.u-reset');
      if (!t) return;
      if (e.type === 'contextmenu') {
        e.preventDefault();
        e.stopPropagation();
        菜单.出(e.clientX, e.clientY, k).catch(x => 对话框.提示(x.message));
      } else if (!重 && UI.wins.has(k)) 窗口.前(UI.wins.get(k).el);
      else if (!重 || 对话框.两下(重, '')) 动作.人做(k, 重 ? '恢复原版' : '打开');
    };
  },
  async 开块(id, 说明) { // 标题栏的 ⋯ 是这块的菜单; 单独打开时只有界面块自己。说明 = 只看自报卡
    const 键 = (说明 ? 'about:' : 'block:') + id, 有 = UI.wins.get(键), 在 = 在Colony() === true;
    if (有) return 窗口.前(有.el);
    const b = 在 ? (await 动作.对象('block:' + id))[1] : { id, name: '界面' }, 页 = 装配台.页(id);
    if (!说明 && id !== ctx.id && !(页 && 页.offsetHeight > 0) && b.running && (b.about || {}).open)
      return ctx.call(b.about.open, {});   // 没页面、自报写了「打开」(全能 agent 展开对话栏): 直接开, 不开空窗
    const w = 窗口.开(键, 'block', (说明 ? '说明 · ' : '') + (b.name || id),
      在 ? '<button data-a title="这块能做的事">⋯</button>' : '', () => {
        const r = w.el.querySelector('.u-wbody > [data-block-id]');   // 搬进来的页送回原处
        if (r) $('colony-root').appendChild(r);
      });
    if (在) w.el.querySelector('[data-a]').onclick = e => { // 不往外传: 菜单等一下才画好, 传出去会被当成点在外面收掉
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      菜单.出(r.left, r.bottom + 4, 'block:' + id).catch(x => 对话框.提示(x.message));
    };
    if (说明) return 自报卡.挂(w.el.querySelector('.u-wbody'), id).catch(e => { w.el.querySelector('.u-wbody')
      .textContent = e.message; });
    await 装配台.身(w, b);
  },
  async 身(w, b) { // 那条规矩; 块重启、禁用、藏起来后再照它画
    const 身 = w.el.querySelector('.u-wbody'), 在 = 身.querySelector(':scope > [data-block-id]');
    if (b.id === ctx.id) return 设置.页(身);
    if (在 && 在.style.display !== 'none') return;
    w.关时();   // 藏起来的页先送回去: 换成卡后它不在页面上, 再「显示界面」也看不见
    const 页 = 装配台.页(b.id);
    if (页 && 页.offsetHeight > 0) return 身.replaceChildren(页);
    身.innerHTML = `<div class="u-bk">${装配台.行(b)}<div data-ab></div></div>`;
    const 卡 = 身.querySelector('[data-ab]');
    身.firstChild.onclick = 装配台.点钮;
    await 自报卡.挂(卡, b.id).catch(e => { 卡.textContent = e.message; });
  },
  行: b => `<div class="u-brow"><b>${esc(b.name || b.id)}</b><span class="u-hint">第 ${b.version || 1}`
    + ` 版</span><span class="u-tag ${装配台.状态(b)[1]}">${esc(装配台.状态(b)[0])}</span>`
    + `${装配台.改过(b) ? '<span class="u-tag u-warn">改过</span>' : ''}<i style="flex:1"></i>`
    + `${b.broken ? '' : 装配台.钮('block:' + b.id, 'block', b)}</div>`,
  钮: (k, 类, o, 免 = []) => 动作.人项(类, o).filter(x => x !== '-' && !免.includes(x[0]))
    .map(x => '<button class="u-btn'
    + (x[0] === '启用' ? ' u-pri' : '') + (动作.缘(x, o) ? ' u-no" title="' + esc(动作.缘(x, o)) : '')
    + (/^确认/.test(动作.要(x, o)) && !动作.缘(x, o) ? '" data-sure="' + esc(动作.要(x, o).slice(2)) : '')
    + `" data-k="${esc(k)}" data-do="${esc(x[0])}">${esc(x[0])}</button>`).join(''),
  async 点钮(e) { // 按钮和菜单走同一条路, 灰的点了说为什么, 要确认的点两下; 做完设置页重画
    const b = e.target.closest('[data-do]'), 页 = b && b.closest('.u-set');
    if (!b || b.dataset.sure != null && !对话框.两下(b, b.dataset.sure)) return;
    await 动作.人做(b.dataset.k, b.dataset.do);
    if (页 && 页.isConnected) 设置.页(页.parentNode);
  },
  async 接() { // 块变了: 开着的块窗照规矩重画, 说明窗重画自报卡, 块没了就关窗
    const bs = 在Colony() === true && await ctx.call('stem.blocks');
    if (bs) UI.wins.forEach((w, k) => {
      const [, 类, id] = /^(block|about):(.*)$/.exec(k) || [], b = 类 && bs.find(x => x.id === id);
      if (!类) return;
      if (!b) 窗口.关(k);
      else if (类 === 'block') 装配台.身(w, b);
      else 自报卡.挂(w.el.querySelector('.u-wbody'), id).catch(() => { });
    });
  },
  async 设(b, 参) { // 启用、禁用、恢复原版的结果顶栏亮框自己会说; 这里只说它说不到的
    await ctx.call('stem.setBlock', Object.assign({ id: b.id }, 参));
    const 名 = `「${b.name || b.id}」`;
    return 参.remove ? 名 + '已移除' : 'hidden' in 参 ? 名 + (参.hidden ? '的界面藏起来了' : '的界面显示出来了') : undefined;
  },
  async 导出(what, b) { // 放上 Colony 桌面; 电脑上要文件就把图标拖出去
    const [来源, 参, 名, 图] = what === 'block'
      ? ['block:' + b.id, { ids: [b.id], stem: false }, `${b.name || b.id} petri`, '🧫']
      : what === 'stem' ? ['stem', { ids: [] }, 'Stem(不带块)', '🧬'] : ['colony', {}, 'Colony 下一代', '🌱'];
    const html = await ctx.call('stem.molt', 参), m = await 应用登记.存来源(来源, html, 名, 图);
    return `已放上桌面: ${m.name}(${Math.round(html.length / 1024)} K 字)`;
  },
  async 导入(v) {
    if (v) return 装配台.收养((await 应用登记.get({ id: v })).code);
    const 件 = (await 应用登记.list()).filter(m => 装配台.块名(m.code).length);
    const o = 对话框.开('<h2>导入 Petri</h2><p class="u-hint">从桌面上挑一个带块的应用: 同 id 的块换成它的, 新块收养后先禁用。</p>'
      + `<div class="u-row">${件.length ? 件.map((m, i) => `<button class="u-btn" data-i="${i}">`
        + `${esc(m.icon)} ${esc(m.name)} <small>${esc(装配台.块名(m.code).join(', '))}</small></button>`)
        .join('')
        : '<p class="u-hint">桌面上还没有带块的应用: 先在一块的菜单里「导出到桌面」, 或者从电脑选文件。</p>'}</div>`
      + '<div class="u-row"><button class="u-btn" data-f>从电脑选文件…</button></div>', true);
    const 完 = async p => {
      o.querySelector('[data-x]').click();
      对话框.开(`<h2>导入结果</h2><p class="u-hint">${esc(await p.catch(e => e.message))}</p>`);
    };
    o.querySelectorAll('[data-i]').forEach(k => { k.onclick = () => 完(装配台.收养(件[+k.dataset.i].code)); });
    o.querySelector('[data-f]').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.html,.htm';
      inp.onchange = () => inp.files[0] && 完(inp.files[0].text().then(装配台.收养));
      inp.click();
    };
  },
  async 组装(v) { // 块最少的当默认底座(纯 Stem 最合适); 和底座是同一个的 petri 勾不上
    const 全 = await 应用登记.list(), 块件 = 全.filter(m => 装配台.块名(m.code).length),
      底座 = 全.filter(m => 装配台.全(m.code)).sort((a, b) => 装配台.块名(a.code).length - 装配台.块名(b.code).length);
    if (v) {
      const 底 = 全.find(m => m.id === v.底座),
        选 = (v.petris || []).map(id => 全.find(m => m.id === id)).filter(Boolean);
      if (!底 || !装配台.全(底.code)) throw new Error('底座要是桌面上一个带完整 Stem 的应用, 能当底座的: '
        + 底座.map(m => m.id + ' ' + m.name).join('、'));
      const html = await 装配台.拼(底.code, 选.map(m => m.code));
      const m = await 应用登记.create({ code: html, name: v.名字 || '组装的 Colony', icon: '🧬',
        desc: `底座「${底.name}」+ ${选.map(x => `「${x.name}」`).join('')}` });
      return `已组装: ${m.name}(${Math.round(html.length / 1024)} K 字)`;
    }
    if (!底座.length) throw new Error('桌面上没有带完整 Stem 的应用可当底座: 先在设置里导出一份 Stem');
    const 项 = (m, 型, i) => `<label class="u-lab"><input type="${型}" data-i="${i}"`
      + (型 === 'radio' ? ' name="u-base"'
      + (i ? '' : ' checked') : '') + `> ${esc(m.icon)} ${esc(m.name)}`
        + (型 === 'checkbox' ? ' <small class="u-hint">'
      + esc(装配台.块名(m.code).join(', ')) + '</small>' : '') + '</label>';
    const o = 对话框.开('<h2>🧬 组装成 Colony</h2><p class="u-hint">选一个底座(带完整 Stem 的), 再勾要装进去的 petri; '
      + '拼出来的放上桌面, 本机不装、不变。</p><h3>底座</h3>'
      + 底座.map((m, i) => 项(m, 'radio', i)).join('') + '<h3>petri</h3><div data-p>'
        + 块件.map((m, i) => 项(m, 'checkbox', i)).join('')
      + '</div><label class="u-lab">名字</label><input class="u-field" data-n value="组装的 Colony">'
      + '<div class="u-row"><button class="u-btn u-pri" data-go>组装</button></div>', true);
    const 底 = () => 底座[+o.querySelector('[name="u-base"]:checked').dataset.i];
    const 同 = () => o.querySelectorAll('[data-p] input').forEach(x => {
      x.disabled = 块件[+x.dataset.i].id === 底().id;
      if (x.disabled) x.checked = false;
    });
    o.querySelectorAll('[name="u-base"]').forEach(x => { x.onchange = 同; });
    同();
    o.querySelector('[data-go]').onclick = () => {
      const petris = [...o.querySelectorAll('[data-p] :checked')].map(x => 块件[+x.dataset.i].id);
      if (!petris.length) return 对话框.提示('至少勾一个 petri(和底座是同一个的勾不上)');
      o.querySelector('[data-x]').click();
      对话框.提示('组装中…');
      动作.做('desk', '组装成 Colony', { 底座: 底().id, petris, 名字: o.querySelector('[data-n]').value.trim() }, true)
        .catch(e => e.说过 || 对话框.提示('组装没成: ' + e.message));   // 成了的那句 动作.做 已经说过
    };
  },
  async 拼(底, 件) { // 隐藏窗里开底座, 让它自己收养、自己导出(门禁照样过); 开完机才露出 call
    const f = await ctx.call('stem.mount', { code: 底, hidden: true, timeout: 15000 });
    const 调 = (path, args) => ctx.call('stem.invoke',
      { frame: f.dataset.colonyApp, path: 'call', args: { path, args } });
    try {
      for (let i = 0; ; i++) {
        try {
          await 调('stem.lineage', {});
          break;
        } catch (e) {
          if (!/未暴露/.test(e.message)) throw e;
          if (i > 150) throw new Error('底座开了 15 秒还没好, 多半是旧版 Stem(不让外面调): 在设置里重新导出一份 Stem 当底座');
          await new Promise(r => setTimeout(r, 100));
        }
      }
      for (const c of 件) await 装配台.收养(c, 调, true);
      return await 调('stem.molt', {});
    } finally {
      f.colony.destroy();
    }
  },
  async 收养(code, 调 = ctx.call, 启用) { // 收下文件里的块, 没收成就照实报错; 启用: 新收的也立刻上岗(装回、组装要)
    const rs = await 调('stem.adopt', { text: code });
    for (const r of rs) {
      if (/^✗/.test(r.result)) throw new Error(r.id + ' ' + r.result);
      if (启用 && /已收养/.test(r.result)) await 调('stem.setBlock', { id: r.id, enabled: true });
    }
    return rs.map(r => r.id + ': ' + r.result).join('; ');
  },
  async 装回(o) { // 拷贝的窗开着: 先让它把自己现在的样子导出来(在里面改的块只存在它自己的库里), 不用桌面上存的旧代码
    const w = UI.wins.get('app:' + o.id), f = w && w.frame && w.frame.dataset.colonyApp,
      code = f && await ctx.call('stem.invoke', { frame: f, path: 'call', args: { path: 'stem.molt' } })
        .catch(() => null) || o.code;
    const s = 装配台.stem文(code), st = s && await ctx.call('stem.setBlock', { id: 'stem', code: s });
    return `装回了: ${await 装配台.收养(code, ctx.call, true)}${!st ? '' : st.needReload
      ? '; Stem 换了, 刷新页面后生效' : '; Stem 和正在跑的一样, 不用刷新'}`;
  },
  async 解读(id) { // 代码解读的界面也是块页窗: 先开窗, 再让它翻到这个目标
    await 装配台.开块('petri:code');
    return ctx.call('code.open', { id });
  },
  async stem原版() {
    await ctx.call('stem.setBlock', { id: 'stem', code: null });
    return '已切回, 刷新页面后生效';
  },
  async 源码(t) { // 看源码: 界面块自己开窗显示原文, 不靠代码解读; t = miniapp:<id> / 块 id / stem
    const 键 = 'src:' + t, 有 = UI.wins.get(键);
    if (有) return 窗口.前(有.el);
    const [名, 码] = /^miniapp:/.test(t)
      ? await 应用登记.get({ id: t.slice(8) }).then(m => [m.name, m.code || ''])
      : await ctx.call('stem.block', { id: t, full: true }).then(b => [b.name || t, b.code]);
    const w = 窗口.开(键, 'src', '源码 · ' + 名);
    w.el.querySelector('.u-wbody').innerHTML = '<pre class="u-src">' + 码.split('\n')
      .map((l, i) => `<i>${i + 1}</i>${/^\/\/ ═ /.test(l) ? `<b>${esc(l)}</b>` : esc(l)}`)
      .join('\n') + '</pre>';
  },
};
// ═ 设置 · 跟着: 对话框, 动作, 装配台, 自报卡 ═
// 设置 = 界面块自己的窗(亮框「界面」): 界面样式五项(字体、缩放、圆角、强调色、壁纸)存 settings:ui.styles, 立即生效;
// 每块一行开关、Colony 一排按钮, 都照动作表画。⚙ 开的是 Stem 自己的面板(单独打开没有 Stem, 就开这一页)
const 设置 = {
  字体: { '默认': '', '衬线': 'Georgia,"Songti SC",SimSun,serif',
    '等宽': 'ui-monospace,"JetBrains Mono",Consolas,monospace' },
  项: [['font', '界面字体', 'select', '默认'], ['fontScale', '界面缩放', '0.85,1.2,0.05', '1'],
    ['radius', '圆角', '4,22,2', '18'], ['accent', '强调色', 'color', '#B5FF00'], ['wall', '桌面壁纸', 'url', '']],
  async 用() {
    const v = (await ctx.kv.get('settings:ui.styles')) || {}, r = document.documentElement.style;
    const 设 = (p, x) => x ? r.setProperty(p, x) : r.removeProperty(p);   // 没动过的不写, 用设计变量里的默认
    设('--sans', 设置.字体[v.font]);
    设('--radius-lg', v.radius != null ? v.radius + 'px' : '');
    设('--u-zoom', v.fontScale && parseFloat(v.fontScale) !== 1 ? v.fontScale : '');
    设('--accent', v.accent);
    设('--accent-soft', v.accent && `color-mix(in srgb,${v.accent} 14%,transparent)`);
    let 墙 = v.wall;   // AI 画的存在次元口袋, 这里记 media: 键, 用时取原件转成本页网址
    if (墙 && 墙.startsWith('media:')) { try { const o = await ctx.call('data.get', { key: 墙, path: 'dataUrl' }); 墙 = URL.createObjectURL(await (await fetch(o)).blob()); } catch (e) { 墙 = ''; } }
    设('--u-wall', 墙 && `url("${墙.startsWith('blob:') ? 墙 : encodeURI(墙)}")`);
  },
  开: () => 装配台.开块(ctx.id),
  stem() { // Stem 把面板画进这个窗; 关窗时还给它
    const 有 = UI.wins.get('stem');
    if (有) return 窗口.前(有.el);
    const w = 窗口.开('stem', 'block', 'Stem', '', () => ctx.call('stem.panel', {}).catch(() => { }));
    return ctx.call('stem.panel', { el: w.el.querySelector('.u-wbody') }).then(() => undefined);
  },
  async 页(el) { // 样式那一栏只画一次(拖着滑条时块变了也不打断); 块和按钮每次重画
    if (!el.querySelector('.u-set')) {
      el.innerHTML = '<div class="u-bk u-set"><h3>🎨 界面样式</h3><p class="u-hint">立即生效并保存; '
        + `想改某个元素, 右键桌面点选编辑${colony.has('agent.send') ? ', 或吩咐 agent' : ''}。</p>`
        + '<div data-st></div><h3>块</h3><div data-bs></div>'
        + '<h3>Colony</h3><p class="u-hint">导出的都放上桌面。</p><div class="u-row" data-co></div>'
        + '<h3>这块自己</h3><div data-ab></div></div>';
      设置.画(el.querySelector('[data-st]'));
      自报卡.挂(el.querySelector('[data-ab]'), ctx.id).catch(() => el.querySelector('[data-ab]').previousSibling
        .remove());   // 单独打开没有块清单: 这一节不要
      el.onclick = 装配台.点钮;
    }
    const bs = 在Colony() === true ? await ctx.call('stem.blocks') : [],
      [, o] = await 动作.对象('colony');
    el.querySelector('[data-bs]').innerHTML = `<p class="u-hint">${bs.length ? '每块一行; 顶栏它的亮框点开是它的窗, '
      + '右键是它的菜单。</p>' + bs.map(装配台.行).join('') : '这是单独打开的界面, 没有别的块; 放进 Colony 才能管块。</p>'}`;
    el.querySelector('[data-co]').innerHTML = 装配台.钮('colony', 'colony', o, ['设置']);
  },
  async 画(el) {
    const v = (await ctx.kv.get('settings:ui.styles')) || {};
    el.innerHTML = 设置.项.map(([k, 名, 值域, 默认]) => {
      const cur = v[k] != null ? v[k] : 默认, 签 = `<label class="u-lab">${名}</label>`;
      if (值域 === 'color') return `${签}<input type="color" data-k="${k}" value="${esc(cur)}">`;
      if (值域 === 'url') return 签 + '<div class="u-row">'
        + `<input class="u-field" style="flex:1" data-k="${k}" value="${esc(cur)}`
        + '" placeholder="图片网址, 回车换上; 空着就是纯色底">'
        + '<button class="u-btn" data-rand>🎲 随机</button></div>'
        + (colony.has('ai.image') ? '<div class="u-row"><input class="u-field" style="flex:1" data-gen placeholder="说一句想要的壁纸, 回车让 AI 画(要在 AI 配置里选了出图模型)">'
          + '<button class="u-btn" data-genb>🎨 画一张</button></div>' : '');
      if (值域 === 'select') return `${签}<select class="u-field" data-k="${k}">`
        + Object.keys(设置.字体).map(x => `<option${x === cur ? ' selected' : ''}>${x}`
          + '</option>').join('') + '</select>';
      const [lo, hi, st] = 值域.split(',');
      return `<label class="u-lab">${名} <span data-v="${k}">${esc(cur)}`
        + '</span></label><input type="range" data-k="'
        + `${k}" min="${lo}" max="${hi}" step="${st}" value="${esc(cur)}" style="width:100%">`;
    }).join('') + '<label class="u-lab">皮肤</label><div class="u-row" data-skins>' + Object.keys(皮肤.套).map(x => `<button class="u-btn${x === 皮肤.当前 ? ' on' : ''}" data-skin="${esc(x)}">${esc(x)}</button>`).join('') + '</div>'
      + '<label class="u-lab">录屏</label><div class="u-row"><button class="u-btn" data-rec></button></div>'
      + '<div class="u-row"><button class="u-btn" data-reset>恢复默认</button></div>';
    { // 录屏授权: 人在这点一次(浏览器规定要人点), 本页之后 agent 随时录, 不用再弹; 再点收回
      const rb = el.querySelector('[data-rec]'), 画 = () => { const s = 演示.状态(); rb.textContent = s.已授权 ? '🎬 已授权录屏 · 点这里收回' : '🎬 授权录屏(选「这个标签页」)'; rb.classList.toggle('on', s.已授权); };
      rb.onclick = async () => { if (演示.状态().已授权) 演示.收(); else { 演示.备(); const b = ctx.root.querySelector('.u-arm'); if (b) b.click(); } setTimeout(画, 400); setTimeout(画, 3000); };
      画();
    }
    el.querySelector('[data-skins]').onclick = async e => { const b = e.target.closest('[data-skin]'); if (!b) return; await 皮肤.换(b.dataset.skin);
      el.querySelectorAll('[data-skin]').forEach(x => x.classList.toggle('on', x.dataset.skin === 皮肤.当前)); };
    let q = Promise.resolve();   // 写入排队: 连着改几项时先读后写会互相吞掉
    const 存 = (k, x) => q = q.then(async () => {
      const cur = (await ctx.kv.get('settings:ui.styles')) || {},
        lab = el.querySelector(`[data-v="${k}"]`);
      cur[k] = x;
      if (lab) lab.textContent = x;
      await ctx.kv.set('settings:ui.styles', cur);
      await 设置.用();
    }), 墙 = el.querySelector('[data-k="wall"]');
    el.querySelectorAll('[data-k]').forEach(inp => {
      if (inp !== 墙) inp.oninput = inp.onchange = () => 存(inp.dataset.k, inp.value);
    });
    墙.onchange = () => 壁纸.换(墙.value.trim()).catch(() => { 墙.value = 墙.defaultValue; });   // 打完字回车或离开才换, 不每个字母载一次
    el.querySelector('[data-rand]').onclick = () => 壁纸.随机();
    const 题 = el.querySelector('[data-gen]');
    if (题) { const 画 = () => 题.value.trim() && 壁纸.画(题.value.trim()).catch(e => 对话框.提示('没画成: ' + e.message));
      题.onkeydown = e => { if (e.key === 'Enter') 画(); }; el.querySelector('[data-genb]').onclick = 画; }
    el.querySelector('[data-reset]').onclick = async () => {
      await ctx.kv.del('settings:ui.styles');
      await 设置.用();
      设置.画(el);   // 滑块也回到默认
      对话框.提示('已恢复默认');
    };
  },
};
// ═ 视图 · 跟着: 状态, 对话框, 窗口, 动作, 点选 ═
// 给 agent 的眼睛: 用户眼前是什么、有哪些东西(每样一个对象名)、每类东西能做什么(用 ui.do 做); 应用里面的按钮用 frame.snapshot
const 视图 = {
  名: el => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(),
  state() {
    const 框 = [...ctx.root.querySelectorAll('.u-ov h2')].map(视图.名);
    const 窗 = 窗口.序().map(([k, w]) => Object.assign(
      { 对象: 'win:' + k, 标题: 视图.名(w.el.querySelector('[data-t]')), 最大化: 窗口.大(w.类) },
      w.el.classList.contains('u-min') ? { 收起: true } : {},
      w.frame ? { frame: w.frame.dataset.colonyApp,
        完全访问: /allow-same-origin/.test(w.frame.getAttribute('sandbox')) } : {}));
    const 顶窗 = 窗.find(x => !x.收起);
    return {
      眼前: 点选.编 ? '点选编辑' : 框.length ? '弹窗: ' + 框[框.length - 1] : 顶窗 && 顶窗.最大化 ? '窗: ' + 顶窗.标题 : '桌面',
      弹窗: 框,   // 从下到上
      窗口: 窗,   // 最前的在第一个
      菜单: [...ctx.root.querySelectorAll('.u-mi')].map(视图.名),
      桌面: [...$('u-grid').querySelectorAll('[data-k]')].map(el => ({ 对象: el.dataset.k,
        名: 视图.名(el.querySelector('.u-nm')),
        x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 })),
      块: [...ctx.root.querySelectorAll('.u-tile')].map(el => ({ 对象: 'block:' + el.dataset.id,
        名: 视图.名(el.querySelector('span')) })),
      点选编辑: 点选.现状(),
      提示: 对话框.记录.slice(-8).map(t => Math.round((Date.now() - t.at) / 1000) + ' 秒前: ' + t.text),
      能做: 动作.能做(),
    };
  },
};
// ═ 点选 · 跟着: 状态, 应用登记, 对话框, 窗口, 运行窗, 视图 ═
// 一个模式点哪改哪(Colony、各块、应用窗、应用里的窗); 隔离窗编辑时临时开同源重开, 退出回到隔离。
// Colony 的样式存皮肤、字写回块源码; 应用的都写回应用源码; 应用里的窗只能看、发给 agent
const 点选 = {
  皮肤键: 'settings:ui.skin',
  编: null,   // 样式: {'colony' | 'app:<id>' | '内层:<id>': {选择器: {属性: 值}}}
  等: null,   // 最近一次记字
  位置: null,   // 浮板拖到了哪
  css: o => Object.keys(o || {}).filter(s => Object.keys(o[s] || {}).length).map(s => s + '{'
    + Object.keys(o[s]).map(p => `${p}:${o[s][p]} !important`).join(';') + '}').join('\n'),
  读覆盖: t => { // petri-ui-edits 样式 → {选择器: {属性: 值}}
    const out = {};
    String(t || '').split('\n').forEach(l => {
      const m = /^(.+?)\{(.*)\}$/.exec(l.trim());
      if (!m) return;
      out[m[1]] = {};
      m[2].split(';').forEach(p => {
        const i = p.indexOf(':');
        if (i > 0) out[m[1]][p.slice(0, i).trim()] = p.slice(i + 1).replace('!important', '').trim();
      });
    });
    return out;
  },
  皮肤: () => $('u-skin')
    || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'u-skin' })),
  async 用皮肤() {
    const v = (await ctx.kv.get(点选.皮肤键)) || {};
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(点选.皮肤键
      + ' 的值要是 {"选择器": {"css属性": "值"}} 对象');
    点选.皮肤().textContent = 点选.css(v);
    return { ok: true, rules: Object.keys(v).length };
  },
  键: 属 => 属.kind === 'colony' ? 'colony' : 属.kind + ':' + 属.id,
  条数: 编 => Object.values(编.样式).reduce((n, o) => n
    + Object.keys(o).filter(k => Object.keys(o[k]).length).length, 0)
    + 编.文字.length,
  现状: () => 点选.编 && { 选中: 点选.编.选 && 点选.编.选.信息, 改动: 点选.条数(点选.编), 没存: 点选.编.改过 },
  async 开() {
    if (点选.编) return;
    const 皮 = JSON.parse(JSON.stringify((await ctx.kv.get(点选.皮肤键)) || {}));
    点选.编 = { 文档: [], 样式: { colony: 皮 }, 文字: [], 选: null, 里: [], 改过: false, 开过: new Set(), 动: new Set() };
    点选.绑(document, { kind: 'colony' });
    点选.扫();
    点选.编.钟 = setInterval(点选.扫, 500);
    点选.面板();
    if ([...UI.wins.keys()].some(k => k.startsWith('app:')))
      对话框.提示('开着的应用窗会自动重开一次, 点选才进得去; 应用里没存的内容会丢。退出时再重开, 回到隔离');
  },
  扫() { // 能进的窗绑上; 进不去的隔离窗临时开同源重开一次
    const 编 = 点选.编;
    if (!编) return;
    编.文档 = 编.文档.filter(x => x.doc.defaultView);
    for (const { doc, 属 } of 编.文档.slice()) for (const fe of doc.querySelectorAll('iframe')) {
      const 窗 = doc === document && fe.closest('.u-win[data-k^="app:"]');
      if (doc === document && !窗) continue;   // 宿主里只进应用窗
      const 新属 = 窗 ? { kind: 'app', id: 窗.dataset.k.slice(4) } : { kind: '内层', id: 属.id };
      let d = null;
      try { d = fe.contentDocument; } catch (e) { }
      if (d && d.body && d.body.childElementCount && !编.文档.some(x => x.doc === d)) 点选.绑(d, 新属);
      const sb = fe.getAttribute('sandbox');
      if (d || !fe.srcdoc || sb == null || /allow-same-origin/.test(sb) || fe.dataset.uLift) continue;
      fe.dataset.uLift = '1';
      fe.setAttribute('sandbox', sb + ' allow-same-origin');
      fe.srcdoc = fe.srcdoc;   // sandbox 装载时才生效; 重开后桥自己再握手
      编.开过.add(新属.id);
    }
  },
  绑(doc, 属) { // 捕获监听: 单击选最里层, 连点两下照常用, 右键照常, 长按发给 agent
    const 编 = 点选.编, offs = [], 键 = 点选.键(属);
    const on = (ev, fn) => {
      doc.addEventListener(ev, fn, true);
      offs.push(() => doc.removeEventListener(ev, fn, true));
    };
    const 免 = t => doc === document && !!(t.closest && t.closest('.u-ed, [data-ed], .u-toast'));
    const 改字中 = t => !!(编.选 && 编.选.el.isContentEditable && 编.选.el.contains(t));
    const 可选 = t => t && t.nodeType === 1 && t !== doc.body && t !== doc.documentElement
      && !/^(SCRIPT|STYLE|LINK|META|BR|IFRAME)$/.test(t.tagName) && !免(t) ? t : null;
    let 连 = false, 上次 = [0, 0, 0], hov = null, hov框 = '', lp = null, 按处 = null, 长按过 = false;
    const 放 = e => 免(e.target) || 连 || e.button === 2   // 改字时按得进字里, 但点不算按下
      || e.type !== 'click' && 改字中(e.target);
    const 拦 = e => {
      if (放(e)) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    const 不悬 = () => {
      if (hov) hov.style.outline = hov框;
      hov = null;
    };
    offs.push(不悬);
    on('mouseover', e => {
      不悬();
      const el = 可选(e.target);
      if (!el || 编.选 && el === 编.选.el) return;
      hov = el;
      hov框 = el.style.outline;
      el.style.outline = '1px dashed #B5FF00';
    });
    on('click', e => {
      if (长按过) {
        长按过 = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!拦(e)) return;
      不悬();
      const el = 可选(e.target);
      if (!el || 编.选 && el === 编.选.el && 编.选.信息.leaf) return;   // 再点选中的字是改字; 别的(画布)按新点的那一点重选
      编.里 = [];
      点选.选(el, 属, e);
    });
    ['mousedown', 'mouseup', 'contextmenu', 'dblclick'].forEach(ev => on(ev, 拦));
    on('pointerdown', e => {
      连 = Date.now() - 上次[0] < 450 && Math.abs(e.clientX - 上次[1]) + Math.abs(e.clientY - 上次[2]) < 12;
      上次 = [Date.now(), e.clientX, e.clientY];
      长按过 = false;
      clearTimeout(lp);
      const el = !放(e) && 可选(e.target);
      if (!el) return;
      e.stopPropagation();
      按处 = [e.clientX, e.clientY];
      lp = setTimeout(() => {
        lp = null;
        长按过 = true;
        不悬();
        点选.选(el, 属, e);
        点选.发送();
      }, 550);
    });
    on('pointermove', e => {
      if (!lp || Math.abs(e.clientX - 按处[0]) + Math.abs(e.clientY - 按处[1]) <= 8) return;
      clearTimeout(lp);
      lp = null;
    });
    on('pointerup', () => clearTimeout(lp));
    on('keydown', e => { // Esc 先取消选中, 再一层层关菜单和弹窗, 最后退出
      if (免(e.target)) return;
      if (e.key === 'Escape') {
        if (编.选) 点选.选(null);
        else if (!对话框.关一层(1)) 点选.关();
      } else if (/^Arrow(Up|Down)$/.test(e.key) && 编.选 && !改字中(e.target)
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) 点选[e.key === 'ArrowUp' ? '外' : '里']();
      else if (e.key === 'Enter' && 改字中(e.target)) 点选.选(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    if (!编.样式[键]) { // 应用存过的覆盖样式: 读进来接着改
      const ex = doc.getElementById('petri-ui-edits');
      编.样式[键] = 点选.读覆盖(ex && ex.textContent);
    }
    编.文档.push({ doc, 属, offs });
  },
  外() { // 记着来路, 里() 原路回去
    const 编 = 点选.编, s = 编.选, p = s && s.el.parentElement;
    if (!p || p === p.ownerDocument.body) return;
    编.里.push(s.el);
    点选.选(p, s.属);
  },
  里() {
    const 编 = 点选.编, s = 编.选, c = s && (编.里.pop() || s.el.firstElementChild);
    if (c) 点选.选(c, s.属);
  },
  选(el, 属, e) { // 换选、取消时交字
    const 编 = 点选.编, 旧 = 编.选;
    if (旧) {
      const s = 旧.el;
      if (s.isContentEditable && s.textContent !== 旧.原字) 点选.等 = 点选.记字(旧, s.textContent);
      s.removeAttribute('contenteditable');
      s.removeEventListener('input', 点选.打字);
      s.style.outline = 旧.原框;
    }
    编.选 = el ? { el, 属, 原字: el.textContent, 原框: el.style.outline, 信息: 点选.情况(el, 属, e) } : null;
    if (el) {
      el.style.outline = '2px solid #FF9500';
      if (编.选.信息.leaf) {
        try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
        el.addEventListener('input', 点选.打字);
      }
    }
    点选.面板();
  },
  打字() { // 同步到浮板; 正在框里打时不动
    const i = $('u-ed-ti');
    点选.编.改过 = true;
    if (i && document.activeElement !== i) i.value = 点选.编.选.el.textContent;
  },
  选择器(el) { // 唯一 id > 唯一 class > nth-of-type
    const doc = el.ownerDocument, seg = [], 独 = s => {
      try { return doc.querySelectorAll(s).length === 1; } catch (e) { return false; }
    };
    for (let n = el; n && n !== doc.body; n = n.parentElement) {
      if (n.id && 独('#' + CSS.escape(n.id))) return ['#' + CSS.escape(n.id)].concat(seg).join('>');
      const c = [...n.classList].find(k => 独('.' + CSS.escape(k)));
      if (c) return ['.' + CSS.escape(c)].concat(seg).join('>');
      let i = 1;
      for (let s = n; (s = s.previousElementSibling);) if (s.tagName === n.tagName) i++;
      seg.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
    }
    return ['body'].concat(seg).join('>');
  },
  情况(el, 属, e) { // 应用有 pick(x, y) 就问它点的这一点画的是什么(画布上光看元素看不出)
    const r = el.getBoundingClientRect(), w = el.ownerDocument.defaultView, cs = w.getComputedStyle(el);
    let 画 = '';
    try {
      画 = e && w.pick ? String(w.pick(e.clientX, e.clientY) ?? '') : '';
    } catch (x) { 画 = 'pick 出错: ' + x.message; }
    const b = 属.kind === 'colony' && el.closest('[data-block-id]'), block = b
      ? b.getAttribute('data-block-id') : null;
    return {
      selector: 点选.选择器(el), tag: el.tagName.toLowerCase(), block,
      属: 属.kind === 'colony' ? block || 'Stem' : `miniapp:${属.id}${属.kind === '内层' ? ' 里再开的窗' : ''}`,
      text: 视图.名(el).slice(0, 200), leaf: !el.children.length
        && !!(el.textContent || '').trim(),
      画,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: { color: cs.color, 'background-color': cs.backgroundColor, 'font-size': cs.fontSize,
        'border-radius': cs.borderRadius },
    };
  },
  async 段文(id) { // 借来的段不算
    const b = await ctx.call('stem.block', { id }), out = [];
    for (const s of b.segs || []) {
      if (!s.map) out.push({ name: s.name,
        text: (await ctx.call('stem.block', { id, segment: s.name })).segment.text });
    }
    return out;
  },
  async 记字(旧, now) { // 源码里恰好一处才记(宁可不改), 不然还原说明白
    const 编 = 点选.编, 信 = 旧.信息, 键 = 点选.键(旧.属), 同 = 编.文字.find(t => t.键 === 键 && t.selector === 信.selector);
    if (同) {
      同.now = now;
      同.repl = 同.包 ? `>${now}<` : now;
    } else {
      const 否 = why => {
        旧.el.textContent = 旧.原字;
        对话框.提示(why + (colony.has('agent.attach') ? '; 📮 发给 agent' : ''));
      };
      if (旧.属.kind === '内层') return 否('应用里再开的窗, 字存不回去');
      if (旧.属.kind === 'colony' && !信.block) return 否('这个元素不归哪个块管, 字改不了');
      if (旧.属.kind === 'colony' && 在Colony() !== true) return 否('单独打开时块里的字存不回源码, 放进 Colony 才能改');
      const 段 = 旧.属.kind === 'app'
        ? [{ text: (await 应用登记.get({ id: 旧.属.id })).code || '' }] : await 点选.段文(信.block);
      const 数 = x => 段.reduce((n, d) => n + d.text.split(x).length - 1, 0), 包 = 数(`>${旧.原字}<`) === 1;
      if (!包 && 数(旧.原字) !== 1) return 否(数(旧.原字) ? `这段字在源码里有 ${数(旧.原字)} 处, 分不清改哪处`
        : '这段字是程序拼出来的, 源码里没有原样');
      编.文字.push({ 键, selector: 信.selector, block: 信.block, old: 旧.原字, now, 包,
        needle: 包 ? `>${旧.原字}<` : 旧.原字, repl: 包 ? `>${now}<` : now });
    }
    编.改过 = true;
    编.动.add(键);
    点选.面板();
    对话框.提示('字改了, 💾 保存才写进源码');
  },
  面板() {
    const 编 = 点选.编;
    if (!编) return;
    let h = $('u-ed');
    if (!h) {
      h = document.createElement('div');
      h.id = 'u-ed';
      h.className = 'u-ed';
      ctx.root.appendChild(h);
      h.onpointerdown = e => {
        if (!e.target.closest('.u-ed-h b')) return;
        const r = h.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        try { h.setPointerCapture(e.pointerId); } catch (x) { }
        h.onpointermove = m => {
          点选.位置 = [Math.max(0, Math.min(innerWidth - 80, m.clientX - dx)),
            Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))];
          点选.摆(h);
        };
        h.onpointerup = () => { h.onpointermove = h.onpointerup = null; };
        e.preventDefault();
      };
      点选.摆(h);
    }
    const s = 编.选 && 编.选.信息, 规 = s && 编.样式[点选.键(编.选.属)][s.selector] || {}, 值 = p => 规[p] || s.style[p];
    const 色 = c => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
      return m ? '#'
        + m.slice(1, 4).map(x => (+x).toString(16).padStart(2, '0')).join('') : /^#[0-9a-f]{6}$/i.test(c)
          ? c : '#000000';
    };
    const 取色 = (p, 名) => `<label class="u-lab">${名} <input type="color" data-p="${p}" value="`
      + 色(值(p)) + '"></label>';
    const 滑 = (p, 名, lo, hi) => `<label class="u-lab">${名} <span>${esc(值(p))}`
      + '</span><input type="range" data-p="'
      + `${p}" min="${lo}" max="${hi}" value="${parseInt(值(p)) || 0}"></label>`;
    h.innerHTML = '<div class="u-ed-h"><b title="按住拖动, 挡住要改的地方就挪开">⠿ ✎ 点选编辑</b>'
      + `<button data-e="清单">改动 ${点选.条数(编)} 处</button><button data-e="撤">↺ 原版</button>`
      + '<button data-e="保存">💾 保存</button><button data-e="关">✕</button></div>'
      + (s ? `<p class="u-hint">属于 ${esc(s.属)} · ${esc(s.selector)}${s.画 ? '<br>画面上: ' + esc(s.画) : ''}</p>`
        + (s.leaf ? '<label class="u-lab">文字</label><input class="u-field" id="u-ed-ti" value="'
          + esc(编.选.el.textContent) + '">'
          + '<p class="u-hint">这里或元素上改都行, 回车确认</p>' : '')
        + 取色('color', '文字色') + 取色('background-color', '背景色') + 滑('font-size', '字号', 9, 64)
          + 滑('border-radius', '圆角', 0, 40)
        + (编.选.属.kind === '内层' ? '<p class="u-hint">应用里再开的窗: 改了只能看, 存不回去</p>' : '')
        + '<div class="u-row"><button class="u-btn" data-e="外">↑ 外一层</button>'
        + '<button class="u-btn" data-e="里">↓ 里一层</button></div>'
        + '<div class="u-row"><button class="u-btn" data-e="清样式">清掉这个元素的样式</button>'
        + '<button class="u-btn u-pri" data-e="发送">📮 发给 agent</button></div>'
        : '<p class="u-hint">点一下选中最里层(菜单、弹窗、应用窗里的都行), 连点两下 = 照常用, 右键照常, ↑↓ 换层, 长按 = 发给 agent, Esc 一层层退</p>');
    const ti = $('u-ed-ti');
    if (ti) {
      ti.oninput = () => {
        编.改过 = true;
        if (编.选 && 编.选.el.isContentEditable) 编.选.el.textContent = ti.value;
      };
      ti.onkeydown = e => { if (e.key === 'Enter') 点选.选(null); };
    }
    h.querySelectorAll('[data-p]').forEach(i => { i.oninput = () => 点选.改(i.dataset.p, i.type === 'range'
      ? i.value + 'px' : i.value, i); });
    h.querySelectorAll('[data-e]').forEach(b => { b.onclick = () => 点选[b.dataset.e](b); });
  },
  摆(h) {
    if (!点选.位置) return;
    Object.assign(h.style, { left: 点选.位置[0] + 'px', top: 点选.位置[1] + 'px', right: 'auto' });
  },
  改(p, v, i) {
    const 编 = 点选.编, 键 = 点选.键(编.选.属), 样 = 编.样式[键], s = 编.选.信息.selector;
    (样[s] = 样[s] || {})[p] = v;
    if (i.previousElementSibling) i.previousElementSibling.textContent = v;
    编.动.add(键);
    点选.上屏();
  },
  上屏() {
    const 编 = 点选.编, b = $('u-ed') && $('u-ed').querySelector('[data-e="清单"]');
    编.改过 = true;
    点选.皮肤().textContent = 点选.css(编.样式.colony);
    编.文档.forEach(({ doc, 属 }) => {
      if (属.kind === 'colony') return;
      let st = doc.getElementById('petri-ui-edits');
      if (!st) (doc.head
        || doc.body).appendChild(st = Object.assign(doc.createElement('style'), { id: 'petri-ui-edits' }));
      st.textContent = 点选.css(编.样式[点选.键(属)]);
    });
    if (b) b.textContent = `改动 ${点选.条数(编)} 处`;
  },
  清样式() {
    const 编 = 点选.编, 键 = 点选.键(编.选.属);
    delete 编.样式[键][编.选.信息.selector];
    编.动.add(键);
    点选.上屏();
    点选.面板();
  },
  async 发送() {
    const s = 点选.编 && 点选.编.选 && 点选.编.选.信息;
    if (!s) return;
    const text = ['选择器: ' + s.selector, '归属: ' + s.属, s.text ? '文字: ' + s.text : '',
      s.画 && '画面上: ' + s.画, `盒: x${s.box.x} y${s.box.y} w${s.box.w} h${s.box.h}`]
      .filter(Boolean).join('\n');
    try {
      await ctx.call('agent.attach', { name: `界面元素 ${(s.画 || s.text).slice(0, 14) || s.tag}`, text });
      对话框.提示('已放进 agent 输入框, 补一句话再发');
    } catch (e) {
      对话框.提示(/无此能力/.test(e.message) ? 'agent 不在, 发不出去' : e.message);
    }
  },
  清单() {
    const 编 = 点选.编, 行 = [];
    Object.entries(编.样式).forEach(([k,
      o]) => Object.keys(o).filter(s => Object.keys(o[s]).length).forEach(s => 行.push([k, s])));
    const o = 对话框.开('<h2>改动清单</h2>'
      + (行.length ? 行.map(([k, s], i) => '<div class="u-row"><code class="u-hint" style="flex:1">'
      + esc(`${k} · ${s} {${Object.entries(编.样式[k][s]).map(e => e.join(': ')).join('; ')}}`)
        + '</code>'
      + '<button class="u-btn" data-i="' + i
        + '">删</button></div>').join('') : '<p class="u-hint">没有样式改动。</p>')
      + `<p class="u-hint">字改了 ${编.文字.length} 处`
        + 编.文字.map(t => `; ${esc(t.old)} → ${esc(t.now)}`).join('') + '</p>', true);
    o.dataset.ed = 1;
    o.querySelectorAll('[data-i]').forEach(b => {
      b.onclick = () => {
        const [k, s] = 行[+b.dataset.i];
        delete 编.样式[k][s];
        编.动.add(k);
        点选.上屏();
        o.querySelector('[data-x]').click();
        点选.清单();
      };
    });
  },
  async 撤(b) { // 选中的归应用: 回点选前的原版(之后点选改的样式和字都退掉); 否则清空 Colony 皮肤(字不受影响); 都点两下
    const 编 = 点选.编, 属 = 编.选 ? 编.选.属 : { kind: 'colony' };
    if (属.kind === '内层') return 对话框.提示('应用里再开的窗没有存过的改动');
    if (属.kind === 'app') {
      const m = await 应用登记.get({ id: 属.id });
      if (!m.orig) return 对话框.提示('这个应用还没用点选改过, 没有原版可回');
      if (!对话框.两下(b, ': 退回点选前的原版')) return;
      await 应用登记.update({ id: 属.id, patch: { code: m.orig, orig: undefined } });
      编.选 = null;
      delete 编.样式['app:' + 属.id];
      编.文字 = 编.文字.filter(t => t.键 !== 'app:' + 属.id);
      运行窗.重开(属.id);
      return 点选.面板();
    }
    if (!对话框.两下(b, ': 清空存过的样式')) return;
    await ctx.kv.del(点选.皮肤键);
    编.样式.colony = {};
    点选.上屏();
    点选.面板();
  },
  async 保存() { // 字要写进块源码(块会重启)时点两下
    const 编 = 点选.编, 话 = [], 应用 = new Set([...编.动].filter(k => k.startsWith('app:')));
    if (编.选) 点选.选(null);   // 换掉浮板之后再找键
    await 点选.等;
    const 块们 = [...new Set(编.文字.filter(t => t.键 === 'colony').map(t => t.block))].sort((x,
      y) => (x === ctx.id) - (y === ctx.id));
    if (块们.length && !对话框.两下($('u-ed').querySelector('[data-e="保存"]'), ': 写进块源码, '
      + (块们.includes(ctx.id) ? '界面块重启会退出点选' : '块会重启'))) return;
    for (const k of 应用) {
      const m = await 应用登记.get({ id: k.slice(4) }), css = 点选.css(编.样式[k]),
        RE = /<style id="petri-ui-edits">[\s\S]*?<\/style>\n?/;
      const 块 = css ? `<style id="petri-ui-edits">\n${css}\n</style>\n` : '';
      let code = 编.文字.filter(t => t.键 === k).reduce((c, t) => c.split(t.needle).join(t.repl), m.code || '');
      code = RE.test(code) ? code.replace(RE, () => 块) : !块 ? code
        : /<\/head>/i.test(code) ? code.replace(/<\/head>/i, x => 块 + x) : code + '\n' + 块;
      if (code === m.code) continue;
      await 应用登记.update({ id: m.id, patch: { code, orig: m.orig || m.code } });
      话.push(`应用「${m.name}」`);
    }
    const 皮 = {};
    Object.keys(编.样式.colony).forEach(s => { if (Object.keys(编.样式.colony[s]).length) 皮[s] = 编.样式.colony[s]; });
    await ctx.kv.set(点选.皮肤键, 皮);
    话.push(`Colony 样式 ${Object.keys(皮).length} 条`);
    for (const id of 块们) {
      const 段 = await 点选.段文(id), edits = [];
      编.文字.filter(t => t.键 === 'colony' && t.block === id).forEach(t => {
        const d = 段.find(x => x.text.includes(t.needle));
        let e = d && edits.find(x => x.name === d.name);
        if (d && !e) edits.push(e = { name: d.name, replace: [] });
        if (e) e.replace.push({ old: t.needle, new: t.repl });
      });
      try {
        await ctx.call('stem.setBlock', { id, edits });
        if (id === ctx.id) return;   // 界面块自己重启了
        话.push(`「${id}」的字`);
      } catch (e) {
        对话框.提示(`「${id}」的字没写进去: ${e.message}`);
      }
    }
    编.文字 = [];
    编.改过 = false;
    点选.面板();
    对话框.提示(`存好了: ${话.join(', ')}${[...编.动].some(k => k.startsWith('内层')) ? '; 应用里再开的窗的样式存不回去' : ''}`);
  },
  关(b) { // 有没存的改动: 点两下(Esc 两下)才丢
    if (点选.编 && 点选.编.改过 && !对话框.两下(b || $('u-ed').querySelector('[data-e="关"]'), ': 丢掉没存的')) return;
    点选.退();
  },
  退(不还原) { // 进过、改过的应用窗重开回到隔离; 没存的 Colony 改动还原
    const 编 = 点选.编;
    if (!编) return;
    const s = 编.选;
    if (s) {
      if (!不还原 && s.el.isContentEditable) s.el.textContent = s.原字;
      s.el.removeAttribute('contenteditable');
      s.el.style.outline = s.原框;
    }
    clearInterval(编.钟);
    编.文档.forEach(x => x.offs.forEach(f => f()));
    点选.编 = null;
    if ($('u-ed')) $('u-ed').remove();
    if (不还原) return;
    new Set([...编.开过, ...[...编.动].filter(k => k.startsWith('app:')).map(k => k.slice(4))]).forEach(运行窗.重开);
    编.文字.filter(t => t.键 === 'colony').forEach(t => {
      const el = document.querySelector(t.selector);
      if (el) el.textContent = t.old;
    });
    点选.用皮肤().catch(() => { });
  },
};
// ═ 自报 ═
// Colony 的桌面: 小应用、文件夹、窗口, 块的开关和导出、组装新 Colony; 人和 agent 用同一套动作
// 数据 {"prefix": "miniapp:", "label": "小应用", "kind": "data", "edit": "apps.update"}
// 数据 {"prefix": "appstore:", "label": "小应用存的数据", "kind": "data"}
// 数据 {"prefix": "settings:ui.skin", "label": "点选改的样式", "kind": "config"}
// 数据 {"prefix": "settings:ui.", "label": "桌面布局和界面样式", "kind": "config", "edit": "ui.do"}
// 现在 ui.state
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【像人一样看和点】要看用户眼前有什么、替他点桌面上的东西时: 先 ui.state 看眼前是什么、有哪些东西(每样一个对象名)、
//   每类东西能做什么。再 ui.do {target, action, value}:
//   target 用 ui.state 里的对象名(app:<id>、folder:<id>、win:<窗>、block:<id>、desk、colony), action 用「能做」里列的名字,
//   带括号的要给 value。做完再 ui.state 看变化; 界面上会提示用户你做了什么。
// 【应用里面】要点、填小应用窗里的按钮和输入框时: 它们归应用自己, 用 ui.state 窗口里的 frame 去 frame.snapshot 看、
//   frame.click / frame.input 点和填, 看不清就 frame.screenshot。
// 【写小应用】要新建或改小应用时: 约定写在 apps.create 的说明里。新建的一律隔离运行; 「完全访问」只有用户在应用窗上点才开得了。
// 【点选编辑】收到用户点选后「发给 agent」的卡片时: 卡片写着 选择器 和 归属, 归属是块就改那块的源码, 是 miniapp:<id> 就 apps.update 它的代码,
//   是「里再开的窗」就去改外层那个应用。Colony 的样式也可以直接写库里 settings:ui.skin({选择器: {属性: 值}}),
//   写完 ui.do {target: 'desk', action: '重画皮肤'}。
// 【组装和装回】要导出块、拼新 Colony 或装回本体时: 设置里「导出 Stem」出一份底座, 块页「导出到桌面」出 petri;
//   ui.do {target: 'desk', action: '组装成 Colony', value: {底座: 应用 id, petris: [应用 id], 名字}} 拼出新 Colony;
//   好了对它 ui.do「装回本体」: 块马上换上, Stem 变了才要刷新。
// ═ 反馈 · 跟着: 状态, 对话框 ═
// 在发生的地方给一下: 钉标签、抖、亮、飞、长、比位置。人主题色, agent 青色; 要"减少动效"只留颜色和标签
const 反馈 = {
  谁: {},   // 最近谁动的
  标: new Map(),   // 一个东西头上只留一个标签
  标记(人) { 反馈.谁 = { 人, at: Date.now() }; },
  人吗: () => Date.now() - 反馈.谁.at < 2e3 && 反馈.谁.人,
  少: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  色: (人, 坏) => 坏 ? 'var(--danger)' : 人 ? 'var(--accent)' : '#5CE1E6',
  框(el) {
    const r = el && el.getBoundingClientRect();
    return r && r.width ? r : null;
  },
  中: r => [r.left + r.width / 2, r.top + r.height / 2],
  球: () => 反馈.框(document.getElementById('agent-dock')),   // agent 停靠栏, 收起时就是那个球
  数: el => +((el.querySelector('.u-count') || {}).textContent || 0),
  找(k) {
    k = String(k);
    const [类, id] = k.split(/:(.*)/), q = (s, v) => ctx.root.querySelector(`${s}="${CSS.escape(v)}"]`);
    return 类 === 'desk' ? $('u-grid') : 类 === 'colony' ? $('u-set') : 类 === 'win' ? q('.u-win[data-k', id)
      : 类 === 'block' ? q('.u-tile[data-id', id) : q('.u-card[data-k', k) || q('.u-win[data-k', k);
  },
  说(k, text, 人, 坏, r0) { // 钉在它上方, 在挪就等挪完; 找不到就只给底部提示
    const el = 反馈.找(k);
    if (!反馈.框(el) && !r0) return 对话框.提示(text);
    对话框.提示((人 ? '' : 'agent: ') + text, true);
    Promise.race([Promise.all(el ? el.getAnimations().map(a => a.finished.catch(() => 0)) : []),
      new Promise(ok => setTimeout(ok, 500))]).then(() => 反馈.钉(k, text, 人, 坏, r0));
  },
  钉(k, text, 人, 坏, r0) { // 等的时候桌面可能又画了一遍, 重新找
    const el = 反馈.找(k), r = 反馈.框(el) || r0, t = document.createElement('div');
    if (!r) return;
    (反馈.标.get(k) || t).remove();
    反馈.标.set(k, t);
    t.className = 'u-chip';
    t.textContent = text;
    t.style.setProperty('--c', 反馈.色(人, 坏));
    ctx.root.appendChild(t);
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    t.style.top = `${r.height > 160 ? r.top + 12 : r.top > h + 12 ? r.top - h - 6 : r.bottom + 6}px`;
    if (坏 && el) 反馈.抖(el);
    setTimeout(() => t.classList.add('u-out'), 坏 ? 3500 : 1800);
    setTimeout(() => t.remove(), 坏 ? 3800 : 2100);
  },
  亮(el, 人, 坏) {
    el = el && (el.querySelector(':scope>.u-ico') || el);
    if (el) el.animate([{ boxShadow: '0 0 0 0 ' + 反馈.色(人, 坏) }, { boxShadow: '0 0 0 12px transparent' }],
      { duration: 700, iterations: 反馈.少() ? 1 : 3 });
  },
  抖(el) {
    if (!反馈.少()) el.animate([0, -7, 6, -4, 3, 0].map(x => ({ translate: x + 'px' })), 380);
    反馈.亮(el, 0, 1);
  },
  弹: (el, 迟) => el.animate([{ scale: .3, opacity: 0 }, {}],
    { duration: 420, delay: 迟 || 0, fill: 'backwards', easing: 'cubic-bezier(.34,1.56,.64,1)' }),
  点(x, y, 人) {
    if (反馈.少()) return;
    const d = document.createElement('i');
    d.className = 'u-rip';
    d.style.cssText = `left:${x}px;top:${y}px;--c:${反馈.色(人)}`;
    ctx.root.appendChild(d);
    setTimeout(() => d.remove(), 600);
  },
  飞(a, b, 字, 人) { // 沿弧线, 半空最大, 像离镜头近了
    if (反馈.少()) return Promise.resolve();
    const g = document.createElement('div'), [x0, y0] = 反馈.中(a), [x2, y2] = 反馈.中(b);
    g.className = 'u-fly';
    g.textContent = 字;
    g.style.cssText = `--c:${反馈.色(人)};offset-path:path("M${x0} ${y0}Q${(x0 + x2) / 2} `
      + `${Math.min(y0, y2) - 60 - Math.abs(x2 - x0) / 4} ${x2} ${y2}")`;
    ctx.root.appendChild(g);
    return g.animate([{ offsetDistance: '0%' }, { scale: 1.6 }, { offsetDistance: '100%' }],
      { duration: 650, easing: 'ease-in-out' }).finished.then(() => g.remove());
  },
  async 指(x, y) { // agent 的光标从球那儿滑到 (x, y) 点一下: ui.do 和眼手动手前都先到这
    if (x == null || 反馈.少()) return;
    let p = 反馈.光标;
    if (!p || !p.isConnected) {
      const [sx, sy] = 反馈.中(反馈.球() || { left: innerWidth, top: innerHeight, width: 0, height: 0 });
      p = 反馈.光标 = document.createElement('div');
      p.className = 'u-ptr';
      p.innerHTML = '<svg width="20" height="20"><path d="M2 1l6 17 2.4-6.8L17 9z"/></svg><b>agent</b>';
      p.style.cssText = `left:${sx}px;top:${sy}px`;
      ctx.root.appendChild(p);
      p.getBoundingClientRect();   // 先落在起点, 改位置才会滑
    }
    clearTimeout(反馈.藏);
    p.classList.remove('u-out');
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    await new Promise(ok => setTimeout(ok, 450));
    反馈.点(x, y);
    反馈.藏 = setTimeout(() => p.classList.add('u-out'), 2500);
  },
  长(el, k, 收) { // 窗从图标长出来, 关时缩回去
    if (反馈.少()) return Promise.resolve();
    const a = 反馈.框(ctx.root.querySelector(`.u-card[data-k="${CSS.escape(k)}"]>.u-ico`)),
      b = el.getBoundingClientRect(), f = [{ opacity: 0, transformOrigin: '0 0', transform: !a
        ? 'translate(3%,3%) scale(.94)' : `translate(${a.left - b.left}px,${a.top - b.top}`
        + `px) scale(${a.width / b.width},${a.height / b.height})` }, { transformOrigin: '0 0' }];
    return el.animate(收 ? f.reverse() : f, { duration: 收 ? 220 : 300, easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 收 ? 'forwards' : 'none' }).finished;
  },
  记: grid => new Map([...grid.querySelectorAll('.u-card[data-k]')]
    .map(el => [el.dataset.k, { el, r: el.getBoundingClientRect(), n: 反馈.数(el) }])),
  比(grid, 前, 旧) { // 挪了的滑过去, 新的弹出来, 走了的缩掉或飞进文件夹, 改过的亮一下
    const 人 = 反馈.人吗(), 首 = !反馈.画过, 少 = 反馈.少(), 夹 = [...grid.querySelectorAll('.u-folder')];
    const 变 = d => 夹.find(el => d * (反馈.数(el) - ((前.get(el.dataset.k) || {}).n || 0)) > 0);
    const 进 = 变(1), 出 = 反馈.框(变(-1)), 球 = !人 && 反馈.球();
    let i = 0;
    反馈.画过 = true;
    grid.querySelectorAll('.u-card[data-k]').forEach(el => {
      const k = el.dataset.k, o = 前.get(k), r = el.getBoundingClientRect(), a = UI.apps.get(k.slice(4)),
        b = 旧.get(k.slice(4));
      前.delete(k);
      if (a && b && a.updatedAt !== b.updatedAt) {
        反馈.说(k, '刚改过', 人);
        [el, (UI.wins.get(k) || {}).el].forEach(x => 反馈.亮(x, 人));
      }
      if (少) return;
      if (o) {
        const dx = o.r.left - r.left, dy = o.r.top - r.top;
        if (dx || dy) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
          { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
        if (el === 进) el.animate([{}, { scale: 1.2 }, {}], { duration: 360, delay: 260 });   // 文件夹吞了一下
        return;
      }
      const 从 = !首 && (出 || k.startsWith('app:') && 球);   // 从文件夹出来的、agent 建的
      if (!从) return 首 ? 反馈.弹(el, Math.min(i++ * 30, 600)) : 反馈.弹(el) && 反馈.亮(el, 人);
      el.style.opacity = 0;
      反馈.飞(从, r, (el.querySelector('.u-ico') || el).textContent, 人).then(() => {
        el.style.opacity = '';
        反馈.弹(el);
        反馈.亮(el, 人);
      });
    });
    if (!少) 前.forEach(o => { // 走了的: 旧节点当影子
      const g = o.el, c = 反馈.框(进);
      const t = c ? `translate(${c.left - o.r.left}px,${c.top - o.r.top}px)` : '';
      g.removeAttribute('data-k');
      g.style.pointerEvents = 'none';
      grid.appendChild(g);
      g.animate([{}, { opacity: 0, transform: t + 'scale(.3)' }], { duration: 380, easing: 'ease-in' })
        .finished.then(() => g.remove());
    });
  },
  块(bs) { // 块改了、重启了、出错了: 顶栏它的亮框亮一下
    const 签 = b => JSON.stringify([b.enabled, b.error, (b.segs || []).map(s => s.name + s.use + s.lines)]);
    const 新 = new Map(bs.map(b => [b.id, 签(b)])), 旧 = 反馈.块签 || 新, 人 = 反馈.人吗();
    反馈.块签 = 新;
    bs.forEach(b => {
      const o = 旧.get(b.id), 坏 = !!b.error && b.enabled !== false, k = 'block:' + b.id;   // 禁用的块 Stem 也记一条错
      if (o === 新.get(b.id)) return;
      反馈.说(k, 坏 ? '出错: ' + b.error : !o ? '新块' : JSON.parse(o)[0] !== b.enabled
        ? (b.enabled === false ? '已禁用' : '已启用') : '改了, 已重启', 人, 坏);
      反馈.亮(反馈.找(k), 人, 坏);
    });
  },
  样式: `.u-chip{position:fixed;z-index:120;pointer-events:none;max-width:min(360px,80vw);padding:5px 10px;
    border-radius:8px;background:var(--c);color:#0a0a0a;font:600 12px/1.4 var(--sans);
    border:2px solid #0a0a0a;box-shadow:3px 3px 0 #0a0a0a;transition:.3s;
    animation:u-pop .36s cubic-bezier(.34,1.56,.64,1)}.u-chip.u-out{opacity:0;translate:0 -8px}
    @keyframes u-pop{from{scale:.4;opacity:0}}.u-fly{position:fixed;left:0;top:0;z-index:121;
    pointer-events:none;offset-rotate:0deg;font-size:30px;filter:drop-shadow(0 0 10px var(--c))}
    .u-rip{position:fixed;z-index:400;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;
    border-radius:50%;border:2px solid var(--c);animation:u-rip .5s ease-out forwards}
    @keyframes u-rip{from{scale:.2}to{scale:1.4;opacity:0}}.u-ptr{position:fixed;z-index:400;
    pointer-events:none;display:flex;gap:1px;transition:.45s cubic-bezier(.3,.7,.2,1)}
    .u-ptr.u-out{opacity:0}.u-ptr path{fill:#5CE1E6;stroke:#0a0a0a;stroke-width:1.4}
    .u-ptr b{margin-top:15px;padding:1px 5px;border-radius:4px;background:#5CE1E6;color:#0a0a0a;
    font:600 10px var(--sans)}.u-btn,.u-round,.u-tile,.u-mi,.u-ico{transition:scale .12s}
    .u-btn:active,.u-round:active,.u-tile:active,.u-mi:active,.u-card:active .u-ico{scale:.93}`,
};
// ═ 演示 · 跟着: 状态, 应用登记, 动作, 反馈 ═
// 照脚本在桌面上真演一遍(宣传片、教人用): 片头、字幕、做事(同 ui.do)、调能力; 可录成桌面上的视频。
// 字幕交给语音模型念(开演前都合成好), 念完才走下一步; 画面加旁白和音乐一起录。
const 演示 = {
  键: ['title', 'sub', 'say', 'do', 'call', 'wait'],
  async 演(a) {
    const 步 = a.steps, 能 = '每步可给: ' + 演示.键.join('、');
    if (!Array.isArray(步) || !步.length) throw new Error('steps 要是非空数组, ' + 能);
    步.forEach((s, i) => {
      const 坏 = Object.keys(s || {}).filter(k => !演示.键.includes(k));
      if (坏.length) throw new Error(`第 ${i + 1} 步认不出: ${坏.join('、')}。${能}`);
    });
    if (演示.场) throw new Error('正在演一场, 等它演完或点「■ 停」');
    const 场 = 演示.场 = {}, 幕 = ctx.root.appendChild(document.createElement('div'));
    幕.className = 'u-stage';
    幕.innerHTML = '<button class="u-btn u-stop">■ 停</button><div class="u-say"></div>';
    幕.firstChild.onclick = () => { 场.停 = true; };
    const 声 = 演示.开声(a, 步);
    let 录, n = 0;
    try {
      if (a.record) 录 = await 演示.开录(幕, 场, 声).catch(e => ({ 没录成: e.message }));   // 录不成照样演
      const 音 = await Promise.all(声.念.concat(声.曲));
      for (const [i, s] of 步.entries()) {
        if (场.停) break;
        const 头 = s.title && 幕.appendChild(document.createElement('div'));
        if (头) {
          头.className = 'u-title';
          头.textContent = s.title;
          if (s.sub) 头.appendChild(document.createElement('small')).textContent = s.sub;
        }
        if (s.say !== undefined) 演示.说(幕.children[1], s.say);   // 幕里: 停键、字幕、片头
        const 念完 = 演示.要念(a, s) && 演示.念(声, String(s.say), 音[i]);
        if (s.do) await 动作.做(s.do.target, s.do.action, s.do.value).catch(e => e);   // 演砸的那一下也是戏
        if (s.call) await ctx.call(s.call.path, s.call.args || {}).catch(e => e);
        const 停 = s.wait !== undefined ? s.wait : 头 ? 2600 : 1600;
        await Promise.all([念完, new Promise(ok => setTimeout(ok, 停))]);
        if (头) 头.remove();
        n++;
      }
    } finally {
      clearInterval(演示.打);
      幕.remove();
      演示.场 = null;
      声.关();
    }
    return Object.assign({ ok: true, 演了: `${n} / ${步.length} 步`, 声音: 声.浏览器
      ? '旁白是浏览器朗读(录不进视频; 要录进去, 给「语音」选一家模型)' : 声.模 ? '旁白用语音模型合成' : '没有旁白' },
    场.停 ? { 停了: true } : {}, 录 && 录.r ? await 演示.收录(录, a.name || '宣传片') : 录);
  },
  要念: (a, s) => s.say !== undefined && a.voice !== false,
  开声(a, 步) {   // 旁白和音乐都进「总」, 总 → 喇叭和录像那一路; 念的先合成, 合成不了是 null
    const ac = new AudioContext(), 总 = ac.createGain(), 乐 = ac.createGain();
    const 出 = ac.createMediaStreamDestination();
    const 解 = r => (r.data ? Promise.resolve(Uint8Array.from(atob(r.data), c => c.charCodeAt(0)).buffer)
      : fetch(r.url).then(x => x.arrayBuffer())).then(b => ac.decodeAudioData(b));
    总.connect(ac.destination);
    总.connect(出);
    乐.connect(总);
    乐.gain.value = 0.5;
    ac.resume().catch(() => { });
    const 声 = { ac, 总, 出, 乐, 念: 步.map(s => 演示.要念(a, s)
      && ctx.call('ai.speak', { text: String(s.say) }).then(解).catch(() => null)) };
    const 自 = () => { 声.拍 = 演示.乐(ac, 乐); };
    // 写了一句话就交给音乐模型做, 循环放; 做不成就用自己合成的
    声.曲 = a.music === false ? null : typeof a.music !== 'string' ? 自()
      : ctx.call('ai.music', { prompt: a.music }).then(解).then(b => {
        const x = Object.assign(ac.createBufferSource(), { buffer: b, loop: true });
        x.connect(乐);
        x.start();
      }, 自);
    声.关 = () => {
      clearInterval(声.拍);
      ac.close();
      if (声.浏览器) speechSynthesis.cancel();
    };
    return 声;
  },
  乐(ac, 到) {   // 页面自己合成的背景音乐; 回停的定时器
    const 和 = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
    let i = 0, t = ac.currentTime + 0.1;
    const 排 = () => {
      for (; t < ac.currentTime + 4; t += 2) 和[i++ % 4].forEach(f => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.1, t + 0.6);
        g.gain.linearRampToValueAtTime(0, t + 2.2);
        o.connect(g).connect(到);
        o.start(t);
        o.stop(t + 2.3);
      });
    };
    排();
    return setInterval(排, 1000);
  },
  async 念(声, t, 音) {   // 模型合成的在页面里放(录得进), 念的时候音乐压低; 没有就浏览器朗读(只现场听得到)
    if (音) {
      const x = Object.assign(声.ac.createBufferSource(), { buffer: 音 });
      声.模 = true;
      x.connect(声.总);
      声.乐.gain.setTargetAtTime(0.15, 声.ac.currentTime, 0.1);
      await new Promise(ok => { x.onended = ok; x.start(); });
      return 声.乐.gain.setTargetAtTime(0.5, 声.ac.currentTime, 0.3);
    }
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'zh-CN';
    声.浏览器 = true;
    await new Promise(ok => {
      u.onend = u.onerror = ok;
      speechSynthesis.speak(u);
      setTimeout(ok, [...t].length * 300 + 1500);   // 有的浏览器念完不报
    });
  },
  说(el, t) {
    const 字 = [...String(t)];
    let i = 反馈.少() ? 字.length : 0;
    clearInterval(演示.打);
    el.textContent = 字.slice(0, i).join('');
    演示.打 = setInterval(() => {
      el.textContent = 字.slice(0, ++i).join('');
      if (i >= 字.length) clearInterval(演示.打);
    }, 45);
  },
  开录: (幕, 场, 声) => new Promise((ok, no) => { // 浏览器录屏必须人点: 摆个按钮等, 点了浏览器弹框问录哪
    const b = 幕.appendChild(document.createElement('button')), 查 = setInterval(() => {
      if (!场.停) return;
      clearInterval(查);
      no(new Error('没开始录就停了'));
    }, 200);
    b.className = 'u-btn u-pri u-rec';
    b.textContent = '🎬 点这里开始录, 弹框里选「这个标签页」';
    b.onclick = async () => {
      clearInterval(查);
      b.remove();
      声.ac.resume();   // 人点了这一下, 声音才放得出来
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 },
          preferCurrentTab: true, selfBrowserSurface: 'include' }), 块 = [];
        const r = new MediaRecorder(new MediaStream(s.getVideoTracks().concat(声.出.stream.getAudioTracks())));
        r.ondataavailable = e => 块.push(e.data);
        r.start();
        ok({ r, s, 块 });
      } catch (e) {
        no(new Error(e.message + '; 可以用系统录屏, Windows 按 Win+Alt+R'));
      }
    };
  }),
  async 收录({ r, s, 块 }, 名) { // 停录, 做成一个放视频的应用
    await new Promise(ok => {
      r.onstop = ok;
      r.stop();
    });
    s.getTracks().forEach(t => t.stop());
    const v = new Blob(块, { type: r.mimeType }), url = await new Promise(ok => {
      const f = new FileReader();
      f.onload = () => ok(f.result);
      f.readAsDataURL(v);
    });
    const m = await 应用登记.create({ name: 名, icon: '🎬', code: '<!doctype html><html><head><title>' + esc(名)
      + '</title></head><body style="margin:0;background:#000">'
      + '<video id="v" controls autoplay style="width:100%;height:100vh"></video>'
      + '<script>colony.store.get({key:"video"}).then(x=>document.getElementById("v").src=x)<\/script>'
      + '</body></html>' });
    await ctx.kv.set(`appstore:${m.id}:video`, url);   // 录像存在这个应用自己的存储里, 源码只留播放器
    return { 视频: 'app:' + m.id, 字节: v.size };
  },
  // ─ 常开录屏: 人点一次授权(浏览器规定必须人点), 之后 agent 随时开录、停录, 一段段存进次元口袋 ─
  get 常() { return window.__colonyRec || null; },   // 授权流挂在页面上: 界面块改源码重启后还在, 不用人再点一次
  set 常(v) { window.__colonyRec = v; },
  错: '',
  备() {
    if (演示.常 && 演示.常.s.active) return { ok: true, 已授权: true };
    if (ctx.root.querySelector('.u-arm')) return { ok: true, 等人点: true };
    演示.错 = '';
    const b = ctx.root.appendChild(document.createElement('button'));
    b.className = 'u-btn u-pri u-arm';
    b.textContent = '🎬 点这里授权录屏 · 弹框里选「这个标签页」· 之后 agent 自己录, 不用再点';
    b.onclick = async () => {
      b.remove();
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
        演示.常 = { s, 段: null };
        s.getVideoTracks()[0].onended = () => { 演示.常 = null; };
      } catch (e) { 演示.错 = '没授权: ' + e.message; }
    };
    return { ok: true, 等人点: true };
  },
  状态() {
    const c = 演示.常, t = c && c.s.getVideoTracks()[0], st = t ? t.getSettings() : {};
    return { 已授权: !!(c && c.s.active), 在录: !!(c && c.段), 秒: c && c.段 ? +((Date.now() - c.段.t0) / 1000).toFixed(1) : 0,
      尺寸: st.width ? st.width + '×' + st.height : '', 来源: st.displaySurface || '', 等人点: !!ctx.root.querySelector('.u-arm'), 错: 演示.错 };
  },
  开(a) {
    const c = 演示.常;
    if (!c || !c.s.active) throw new Error('还没授权: 先 ui.rec.arm, 等人点一下');
    if (c.段) throw new Error('正在录, 先 ui.rec.stop');
    const 块 = [], mt = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(c.s, { mimeType: mt, videoBitsPerSecond: 12e6 });
    r.ondataavailable = e => e.data.size && 块.push(e.data);
    r.start(1000);
    const 面 = a.hideAgent !== false && document.getElementById('agent-dock'), 父 = 面 && 面.parentElement;
    if (父) { 父.dataset.recHide = 父.style.display; 父.style.display = 'none'; dispatchEvent(new Event('resize')); }
    c.段 = { r, 块, t0: Date.now(), 父 };
    return { ok: true, 格式: mt };
  },
  async 停(a) {
    const c = 演示.常, d = c && c.段;
    if (!d) throw new Error('没在录');
    await new Promise(ok => { d.r.onstop = ok; d.r.stop(); });
    c.段 = null;
    if (d.父) { d.父.style.display = d.父.dataset.recHide || ''; dispatchEvent(new Event('resize')); }
    const v = new Blob(d.块, { type: d.r.mimeType });
    const url = await new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(v); });
    const key = 'media:' + (a.name || '录屏 ' + new Date().toLocaleString()) + '.webm';
    await ctx.call('data.set', { key, value: url });
    return { ok: true, key, 秒: +((Date.now() - d.t0) / 1000).toFixed(1), 字节: v.size };
  },
  收() {
    const c = 演示.常;
    if (c) { if (c.段) c.段.r.stop(); c.s.getTracks().forEach(t => t.stop()); }
    演示.常 = null;
    return { ok: true };
  },
  样式: `.u-stage{position:fixed;inset:0;z-index:125;pointer-events:none}
    .u-arm{position:fixed;z-index:300;left:50%;top:38%;translate:-50%;font-size:20px;padding:16px 28px}
    .u-stage button{position:absolute;pointer-events:auto}.u-stop{right:16px;top:16px}
    .u-rec{left:50%;top:40%;translate:-50%;font-size:18px}
    .u-say,.u-title{position:absolute;text-align:center;font:700 24px/1.4 var(--sans)}.u-say{left:50%;
    bottom:10%;translate:-50%;max-width:80vw;padding:12px 24px;border-radius:12px;background:#FFE14D;
    color:#0a0a0a;border:2px solid #0a0a0a;box-shadow:5px 5px 0 #0a0a0a;text-wrap:balance}
    .u-say:empty{display:none}.u-title{inset:0;display:grid;place-content:center;
    background:rgba(10,10,10,.85);color:var(--accent);font-size:56px;
    animation:u-pop .5s cubic-bezier(.34,1.56,.64,1)}
    .u-title small{margin-top:14px;color:var(--text);font-size:22px}`,
};
// ═ 皮肤 · 跟着: 状态, 窗口, 动作, 设置, 对话框 ═
// 皮肤只换长相和摆放, 不碰逻辑: 同一套 DOM(侧栏、顶栏、窗、亮框)按 data-skin 换样式, 「视窗」多挂一条任务栏和开始菜单。
// 存 settings:ui.styles.skin; 想加一套: 在「套」里加一项 {名, css, 装?(挂额外 DOM), 卸?}
const 皮肤 = {
  当前: '经典',
  套: {
    经典: { 名: '经典', css: '' },
    视窗: {
      名: '视窗',
      css: `.u-shell[data-skin="视窗"]{--u-tb:52px}
  .u-shell[data-skin="视窗"] .u-side{display:none}
  .u-shell[data-skin="视窗"] .u-head{display:none}
  .u-shell[data-skin="视窗"] .u-page{padding:14px 14px calc(var(--u-tb) + 16px)}
  .u-shell[data-skin="视窗"] .u-main{background:linear-gradient(135deg,rgba(8,14,26,.35),rgba(0,0,0,.1)),
    var(--u-wall,radial-gradient(ellipse 60% 70% at 62% 58%,rgba(120,170,255,.55),transparent 60%),
    radial-gradient(ellipse 45% 55% at 40% 70%,rgba(90,110,255,.5),transparent 62%),
    radial-gradient(ellipse 35% 40% at 75% 30%,rgba(170,120,255,.35),transparent 65%),
    linear-gradient(160deg,#0b1a3a,#0a2a6b 45%,#071233)) center/cover no-repeat}
  .u-shell[data-skin="视窗"] .u-nm{color:#fff}
  .u-shell[data-skin="视窗"] .u-ico{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.22);backdrop-filter:blur(10px)}
  body[data-skin="视窗"] .u-win:not(.u-w){left:0;bottom:var(--u-tb,52px)}
  body[data-skin="视窗"] .u-win.u-w{border-radius:14px;border-color:rgba(255,255,255,.22)}
  body[data-skin="视窗"] .u-win .u-bar{background:rgba(32,38,52,.92)}
  body[data-skin="视窗"] .u-bar [data-min]{display:inline-block}
  body[data-skin="视窗"] #agent-dock{bottom:64px!important}
  .u-task{position:fixed;left:0;right:0;bottom:0;height:52px;z-index:96;display:flex;align-items:center;gap:8px;
    padding:6px 10px;box-sizing:border-box;background:rgba(14,18,26,.72);border-top:1px solid rgba(255,255,255,.1);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);font-family:var(--sans);animation:u-tbin .35s ease-out}
  @keyframes u-tbin{from{transform:translateY(100%)}}
  .u-tb{height:38px;min-width:38px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.08);color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;
    white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;font-family:inherit}
  .u-tb:hover{background:rgba(255,255,255,.16)}.u-tb.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
  .u-tb.u-min{opacity:.55}.u-tb-start{font-weight:600}
  .u-tb-wins{display:flex;gap:6px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;align-items:center}
  .u-task .u-tclock{margin-left:auto;margin-right:84px;color:#fff;font-size:12px;line-height:1.25;text-align:right}
  .u-start{position:fixed;left:10px;bottom:60px;width:360px;max-height:min(640px,calc(100vh - 80px));z-index:97;display:none;
    flex-direction:column;overflow:hidden;background:rgba(20,26,38,.9);border:1px solid rgba(255,255,255,.18);border-radius:18px;
    color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);font-family:var(--sans)}
  .u-start.on{display:flex;animation:u-pop2 .14s ease-out}@keyframes u-pop2{from{opacity:0;transform:translateY(8px) scale(.98)}}
  .u-st-h{padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.1)}
  .u-st-h b{font-size:16px}.u-st-h b i{color:var(--accent);margin-right:6px}.u-st-h small{display:block;font-size:11px;opacity:.68}
  .u-st-b{padding:12px;overflow-y:auto;flex:1}
  .u-start .u-tiles{flex-direction:column;align-items:stretch;gap:2px}
  .u-start .u-tile{background:transparent;color:#fff;border-radius:10px;padding:9px 10px 9px 36px;font-weight:500;font-size:13px}
  .u-start .u-tile:hover{background:rgba(255,255,255,.12);filter:none}
  .u-start .u-tile::before{content:"🧩";position:absolute;left:10px;top:50%;translate:0 -50%;font-size:14px}
  .u-st-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.1)}
  .u-st-g button{padding:10px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:10px;cursor:pointer;font-family:inherit}`,
      装() { // 任务栏 + 开始菜单; 顶栏的亮框挪进开始菜单(同一批元素, 点了照旧)
        const shell = ctx.root.querySelector('.u-shell');
        const tb = document.createElement('div'); tb.className = 'u-task'; tb.id = 'u-task';
        tb.innerHTML = '<button class="u-tb u-tb-start" id="u-start">⊞ 开始</button><div class="u-tb-wins" id="u-task-wins"></div><span class="u-tclock" id="u-tclock"></span>';
        const sm = document.createElement('div'); sm.className = 'u-start'; sm.id = 'u-startmenu';
        sm.innerHTML = '<div class="u-st-h"><b><i>Colony</i>开始</b><small>各块与桌面设置</small></div><div class="u-st-b" id="u-st-b"></div>'
          + '<div class="u-st-g"><button data-st="设置">⚙ 设置</button><button data-st="桌面">🖥 看桌面</button><button data-st="壁纸">🎲 随机壁纸</button>' + (colony.has('ai.image') ? '<button data-st="画">🎨 AI 画壁纸</button>' : '') + '</div>';
        shell.appendChild(tb); shell.appendChild(sm);
        $('u-st-b').appendChild($('u-tiles'));
        $('u-start').onclick = e => { e.stopPropagation(); sm.classList.toggle('on'); };
        sm.onclick = e => { const b = e.target.closest('[data-st]'); if (!b) return; sm.classList.remove('on');
          ({ 设置: () => 动作.人做('colony', '设置'), 桌面: () => $('u-desk').click(), 壁纸: () => 壁纸.随机(), 画: () => 动作.人做('colony', '设置') })[b.dataset.st](); };
        皮肤.点外 = e => { if (!e.target.closest('#u-startmenu,#u-start')) sm.classList.remove('on'); };
        document.addEventListener('pointerdown', 皮肤.点外, true);
        $('u-task-wins').onclick = e => { const k = e.target.closest('[data-k]'); if (!k || !UI.wins.has(k.dataset.k)) return;
          const w = UI.wins.get(k.dataset.k); w.el.classList.contains('u-min') ? 窗口.前(w.el) : 窗口.收(w); };
        皮肤.刷 = () => { // 任务栏: 开着的窗一窗一键 + 时钟; 照侧栏的窗列表画
          const box = $('u-task-wins'); if (!box) return; const 顶 = (窗口.序()[0] || [])[0];
          box.innerHTML = [...UI.wins].map(([k, w]) => '<button class="u-tb' + (w.el.classList.contains('u-min') ? ' u-min' : k === 顶 ? ' on' : '')
            + '" data-k="' + esc(k) + '">' + esc(w.el.querySelector('[data-t]').textContent) + '</button>').join('');
          const d = new Date(); $('u-tclock').innerHTML = d.toTimeString().slice(0, 5) + '<br>' + (d.getMonth() + 1) + '/' + d.getDate();
        };
        皮肤.表 = setInterval(皮肤.刷, 800); 皮肤.刷();
      },
      卸() {
        clearInterval(皮肤.表); document.removeEventListener('pointerdown', 皮肤.点外, true);
        ctx.root.querySelector('.u-acts').appendChild($('u-tiles'));
        ['u-task', 'u-startmenu'].forEach(id => $(id) && $(id).remove());
      },
    },
  },
  async 用(名) {
    const v = (await ctx.kv.get('settings:ui.styles')) || {};
    名 = 名 || v.skin || '经典'; if (!皮肤.套[名]) 名 = '经典';
    const 旧 = 皮肤.套[皮肤.当前]; if (旧 && 旧.卸 && 皮肤.当前 !== 名) 旧.卸();
    let st = $('u-skin-css'); if (!st) { st = document.createElement('style'); st.id = 'u-skin-css'; document.head.appendChild(st); }
    st.textContent = Object.values(皮肤.套).map(s => s.css).join('\n');
    const shell = ctx.root.querySelector('.u-shell'); shell.dataset.skin = 名; document.body.dataset.skin = 名;
    const 新 = 皮肤.套[名]; if (新.装 && 皮肤.当前 !== 名) 新.装();
    皮肤.当前 = 名; return 名;
  },
  async 换(名) {
    if (!皮肤.套[名]) throw new Error('没有这套皮肤: ' + 名 + '(有: ' + Object.keys(皮肤.套).join('、') + ')');
    const v = (await ctx.kv.get('settings:ui.styles')) || {}; v.skin = 名; await ctx.kv.set('settings:ui.styles', v);
    return 皮肤.用(名);
  },
  卸掉() { const s = 皮肤.套[皮肤.当前]; if (s && s.卸) s.卸(); $('u-skin-css') && $('u-skin-css').remove(); delete document.body.dataset.skin; },
};

// 壁纸: 存 settings:ui.styles.wall(图片网址; AI 画的存进次元口袋, 这里只记 media: 键), 设置.用 把它铺上; 载得出才换, 载不出保留原来的
const 壁纸 = {
  载: url => new Promise(ok => { const i = new Image(); Object.assign(i, { referrerPolicy: 'no-referrer', onload: () => ok(true), onerror: () => ok(false), src: url }); }),
  async 存(墙) {
    const v = (await ctx.kv.get('settings:ui.styles')) || {}; v.wall = 墙; await ctx.kv.set('settings:ui.styles', v); await 设置.用();
    const inp = document.querySelector('.u-set [data-k="wall"]'); if (inp) inp.value = inp.defaultValue = 墙.startsWith('media:') ? '' : 墙;
    return 墙;
  },
  async 换(url) { // 空 = 纯色底
    if (url && !(await 壁纸.载(url))) { 对话框.提示('这张图载不出来, 壁纸没换'); throw new Error('壁纸载不出来: ' + url); }
    return 壁纸.存(url);
  },
  随机: () => 壁纸.换('https://picsum.photos/seed/' + Date.now().toString(36) + '/1920/1080'),   // 同一个种子总是同一张, 存下的网址下次还是它
  async 画(话) {
    if (!colony.has('ai.image')) throw new Error('没有出图能力: 先在 AI 配置里给「图片」选个模型');
    对话框.提示('🎨 正在画: ' + 话);
    const r = await ctx.call('ai.image', { prompt: 话 + '。用作电脑桌面壁纸: 16:9 横幅, 画面中央和底部留出干净的空间, 不要文字和水印', size: '1792x1024' });
    let 图 = r.url && !r.data ? r.url : 'data:' + (r.mimeType || 'image/png') + ';base64,' + r.data;
    图 = 图.replace(/^data:image\/png;base64,(?=\/9j\/)/, 'data:image/jpeg;base64,');   // 有的模型把 jpeg 标成 png
    const k = (await ctx.call('data.set', { key: 'media:', value: { name: '壁纸 · ' + 话.slice(0, 20) + (图.startsWith('data:image/jpeg') ? '.jpg' : '.png'), dataUrl: 图 } })).key;
    await 壁纸.存(k); 对话框.提示('🖼 换上了, 原图在次元口袋'); return k;
  },
};
// ═ 装配 ═
// ui.host: Stem 靠它撤掉裸壳页; 卸载时样式、窗和对页面的改动都撤掉
登记('apps.list', async () => (await 应用登记.list()).map(应用登记.简), '列出桌面上的小应用(不带代码; 要代码用 apps.get)', {});
登记('apps.get', 应用登记.get, '读一个小应用的完整记录(含 code)', { id: 'string' });
登记('apps.create', a => (a && a.来源 ? 应用登记.存来源(a.来源, a.code, a.name, a.icon) : 应用登记.create(a))
  .then(应用登记.简), '新建小应用: 一份完整 HTML, 放上桌面, 点开在隔离窗里跑。写法: 要有 <head>'
  + '(Colony 的桥从这里注进去); 存数据用 colony.store.set({key, value}) / colony.store.get({key}), 按应用分开存'
  + '(隔离窗里读不到 localStorage); 写好 <title> 当名字、<meta name="description"> 当简述(写它能做什么、怎么用); '
  + '画布这类点选看不出画了啥的, 在 window 上放 pick(x, y) 回那一点是什么(一句话, x, y 同点击的 clientX, clientY)。回摘要',
  { code: 'string', name: 'string?', desc: 'string?', icon: 'string?(一个 emoji)', color: 'string?(#rrggbb)',
    来源: 'string?(同一来源再建就只更新那一个图标)' });
登记('apps.update', async a => {
  const m = await 应用登记.update(a);
  if (a.replace || 'code' in (a.patch || {})) 运行窗.重开(m.id);
  return 应用登记.简(m);
}, '改小应用: 改几处用 replace [{old, new}](和改块一样); patch 给要改的字段(name、desc、code、icon、color); '
  + '源码改了开着的窗会重开。回摘要', { id: 'string', replace: '[{old, new}]?', patch: 'object?' });
登记('apps.shared', async a => { // 人拖进来的应用: 代码 + 它存的数据有哪些键(值另取, 视频素材可能很大)
  const id = 拖放.凭条(a), m = await 应用登记.get({ id });
  const keys = (await ctx.kv.list(`appstore:${id}:`)).map(e => e.key.slice(`appstore:${id}:`.length));
  return { id, name: m.name, icon: m.icon, desc: m.desc, code: m.code, keys };
}, '读人拖进本应用窗的那个桌面应用: 代码和它存的数据的键名。token 来自拖放数据 text/x-colony-share(人拖图标时生成, 6 小时内有效)',
  { token: 'string' }, true);
登记('apps.sharedGet', async a => ctx.kv.get(`appstore:${拖放.凭条(a)}:${a.key}`),
  '读人拖进来的那个应用存的一个值(只读)', { token: 'string', key: 'string' }, true);
登记('apps.remove', 应用登记.remove, '删除小应用, 连它存的数据、桌面位置、文件夹里那一项一起清', { id: 'string' });
登记('store.get', (a, meta) => ctx.kv.get(小应用存储(a, meta, 'store.get')),
  '给小应用读自己存的数据(按应用分开): 小应用里写 colony.store.get({key}) 或 colony.store.get(键)',
  { key: 'string?', app: 'string?(不在小应用里调时: 应用 id)' }, true);
登记('store.set', async (a, meta) => {
  await ctx.kv.set(小应用存储(a, meta, 'store.set'), a.value);
  return { ok: true };
}, '给小应用存数据(按应用分开): 小应用里写 colony.store.set({key, value})',
  { key: 'string', value: 'any', app: 'string?(不在小应用里调时: 应用 id)' }, true);
登记('ui.card', a => 自报卡.挂(a.el, a.id, a), '把一块的自报画成一张卡放进 el: 用处、技能、能力、占的数据、此刻的样子'
  + '(次元口袋、代码解读借它画)', { id: 'string', el: 'Element', 点技能: 'function?(第几行)', 点数据: 'function?(前缀)',
    此刻: 'boolean?(画完就看此刻的样子)' });
if (typeof document === 'undefined' || !ctx.root) return {};
const 样式表 = document.createElement('style');
样式表.textContent = 设计变量 + 样式 + 框样式 + 反馈.样式 + 演示.样式 + 自报卡.样式;
document.head.appendChild(样式表);
const 原溢出 = document.body.style.overflow;
document.body.style.overflow = 'hidden';   // 桌面铺满一屏, 不让页面滚
ctx.root.innerHTML = 骨架;
ctx.cleanup(() => {
  点选.退(true);
  皮肤.卸掉();
  if ($('u-skin')) $('u-skin').remove();
  [...UI.wins.keys()].forEach(k => 窗口.关(k));
  菜单.收();
  样式表.remove();
  document.body.style.overflow = 原溢出;
  ['--sans', '--radius-lg', '--u-zoom'].forEach(p => document.documentElement.style.removeProperty(p));
});
$('u-set').onclick = () => 动作.人做('colony', colony.has('stem.panel') ? 'Stem 面板' : '设置');
$('u-desk').onclick = () => { // 看桌面 = 窗都收到左栏; 没有开着的窗也说一声
  const 开 = [...UI.wins.values()].filter(w => !w.el.classList.contains('u-min'));
  开.forEach(w => 窗口.收(w));
  if (!开.length) 对话框.提示('桌面上没有开着的窗');
};
$('u-wins').onclick = e => {
  const k = e.target.closest('[data-k]');
  if (k && UI.wins.has(k.dataset.k)) 窗口.前(UI.wins.get(k.dataset.k).el);
};
const 钟 = () => { // 顶栏时钟
  const d = new Date(), c = $('u-clock');
  if (c) c.innerHTML = `${d.toTimeString().slice(0, 5)}<br>${d.getMonth() + 1}/${d.getDate()} 周`
    + '日一二三四五六'[d.getDay()];
};
钟();
const 钟表 = setInterval(钟, 10000);
ctx.cleanup(() => clearInterval(钟表));
听(window, 'resize', () => UI.wins.forEach(w => { // 屏幕变窄: 窗整个挪回屏幕里
  const e = w.el;
  if (!窗口.大(w.类)) 窗口.定(w, { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }, true);
}));
桌面.接($('u-grid'));
拖放.装();
听(ctx.root, 'pointerdown', e => { // 人点在哪, 那儿冒一圈(agent 眼手发的不算)
  if (!e.isTrusted) return;
  反馈.标记(true);
  反馈.点(e.clientX, e.clientY, true);
}, true);
听(document, 'click', e => { if (!e.target.closest('.u-menu')) 菜单.收(); });
听(document, 'keydown', e => { // Esc: 菜单、弹窗、窗一层层关
  if (e.key !== 'Escape' || 点选.编 || 对话框.关一层()) return;
  const 窗 = 窗口.序().find(([, w]) => !w.el.classList.contains('u-min'));   // 收起的看不见, 不关它
  if (窗) 窗口.关(窗[0]);
});
听(document, 'colony:apps', 桌面.画);
听(document, 'colony:blocks', 装配台.亮框);
听(document, 'colony:blocks', 装配台.接);
登记('ui.point', (a, m) => { // 窗里调的是窗里的坐标, 加上窗在页面上的位置
  const r = m.frame ? m.frame.getBoundingClientRect() : { left: 0, top: 0 };
  return 反馈.指(r.left + +a.x, r.top + +a.y);
}, 'agent 的光标滑到 (x, y) 点一下(眼手动手前自己会调)', { x: 'number', y: 'number' }, true);
登记('ui.host', () => ({ id: ctx.id }), '界面块在场(Stem 靠这个名字撤掉裸壳页)', {});
登记('ui.state', () => 视图.state(), '用户眼前是什么: 弹窗、开着的窗、桌面图标、块、点选编辑、最近的提示, '
  + '每样一个对象名, 还有每类东西能做的动作(用 ui.do 做); 应用里面的按钮用 frame.snapshot', {}, false, true);
登记('ui.do', a => 动作.做(a.target, a.action, a.value), '像人一样做一件事, 和点界面走同一条路: target = ui.state 里的对象名, '
  + 'action = 它「能做」里的一项, 带括号的给 value。用法细节见本块的「技能」段',
  { target: 'string', action: 'string', value: 'any?' }, false, true);
登记('ui.play', 演示.演, '照脚本在桌面上真演一遍, 可以录成视频放上桌面(做宣传片、教人用)。steps 每步可给: title 和 sub(片头大字)、'
  + 'say(字幕)、do {target, action, value}(同 ui.do)、call {path, args}(调能力)、wait(停几毫秒, 默认 1600, 片头 2600); '
  + 'record: true 要人先点「开始录」, 录完回视频应用的对象名。字幕默认念出来(有语音模型用它, 录得进; 没有用浏览器朗读, 录不进), '
  + '背景音乐默认页面自己合成', { steps: 'array', record: 'boolean?', name: 'string?(视频名)', voice: 'boolean?(false 不念)',
  music: 'boolean|string?(false 不放; 写一句话就交给音乐模型做)' });
登记('ui.rec.arm', () => 演示.备(), '录屏授权(只要人点一次): 屏幕中间摆个按钮, 人点了并在弹框里选「这个标签页」后, 本页一直可录; '
  + '之后 ui.rec.start / ui.rec.stop 随时录, 不用再点。立即返回, 用 ui.rec.status 看授权了没', {});
console.log('rec ok');
登记('ui.rec.status', () => 演示.状态(), '录屏状态: 已授权、在录、录了几秒、画面尺寸、按钮还在不在等人点', {});
登记('ui.rec.start', a => 演示.开(a || {}), '开始录一段(先 ui.rec.arm 授权过); hideAgent 默认 true: 录时藏起 agent 对话栏, 停了放回',
  { hideAgent: 'boolean?' });
登记('ui.rec.stop', a => 演示.停(a || {}), '停录, 这段存成 media:<name>.webm(次元口袋能看), 回 {key, 秒, 字节}', { name: 'string?' });
登记('ui.rec.release', () => 演示.收(), '收回录屏授权(停掉共享)', {});
窗口.载().then(桌面.画);
设置.用();
皮肤.用().catch(e => 对话框.提示('界面皮肤没上: ' + e.message));
点选.用皮肤().catch(e => 对话框.提示('皮肤没上: ' + e.message));
装配台.亮框();
return {};
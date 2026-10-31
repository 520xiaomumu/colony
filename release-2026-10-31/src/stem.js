
// ✂ 跑块
(function (g) {
'use strict';
// ✂ 跑块 完
// ═ 基础 ═
// 「跑块」只圈单独打开要的: 找块、给 ctx 和块的 colony、跑; 只在几块同船时有用的不圈, 夹在函数里的用「单独时不带」挖掉。
// BOOT 单独打开时只有开库、再导出用到, 圈在键值库、换段里
// ✂ 跑块
const SCR = 'scr' + 'ipt';
const doc = typeof document !== 'undefined' ? document : null;
const norm = s => String(s ?? '').replace(/^\s*\n/, '').replace(/\s+$/, '');
const fail = msg => { throw new Error(msg); };
const emit = (name, detail) => doc?.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
// ✂ 跑块 完
const LS = (() => { try { return localStorage; } catch (e) { return null; } })(); // 隔离窗里一碰就抛错
// API 是各段往外交东西的唯一口; 只在测试/调试时挂到 window, 平时块只能走能力树
const API = {};
const X = o => Object.assign(API, o);
// ✂ 换段 · 要: 跑块
const hash = s => {
  s = String(s ?? '');
  let a = 5381, b = 2166136261;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = Math.imul(b ^ c, 16777619) >>> 0;
  }
  return [a, b].map(n => n.toString(16).padStart(8, '0')).join('');
};
// ✂ 键值库
const BOOT = g.__stemBoot || { id: 'dev', lineage: null, safe: false, edited: false, key: 'stem.dev' };
// ✂ 换段 完
// ✂ 键值库 完
const DEBUG = BOOT.id === 'test'
  || !!(doc && typeof location !== 'undefined' && /[?&]debug=1/.test(location.search));
const isIdent = n => /^[\p{ID_Start}_$][\p{ID_Continue}_$]*$/u.test(String(n));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
X({ norm, LS, hash, isIdent });
// ═ 块格式 · 跟着: 基础 ═
// 块 = /*BLOCK*/{清单}/*CODE*/ + 函数体(不带 function 外壳)。块住在 <script> 里, 所以代码里不能出现能提前关掉标签的序列
const checkManifest = m => {
  if (typeof m.id !== 'string' || !/^[^"<>\/\s]+$/.test(m.id))
    fail('清单 id 不合法(不能含引号、尖括号、斜杠、空白; 斜杠是"块/段"的分隔): ' + JSON.stringify(m.id));
  if (m.version !== undefined && typeof m.version !== 'number')
    fail('清单 version 必须是数字: ' + JSON.stringify(m.version));
  if (m.name !== undefined && typeof m.name !== 'string') fail('清单 name 必须是字符串');
  if (m.caps && !(Array.isArray(m.caps) && m.caps.every(x => typeof x === 'string')))
    fail('清单 caps 必须是字符串数组');
};
// 单独打开的文件是门禁查过才导出的, 不再查清单
// ✂ 跑块
const parseBlock = text => {
  const m = /\/\*BLOCK\*\/([\s\S]*?)\/\*CODE\*\//.exec(text) || fail('块缺少 /*BLOCK*/{清单}/*CODE*/ 头'),
    manifest = JSON.parse(m[1].trim());
  // ✂ 单独时不带 · 号: 读块查清单
  checkManifest(manifest);
  // ✂ 单独时不带 完
  return { manifest, code: norm(text.slice(m.index + m[0].length)) };
};
// ✂ 跑块 完
// ✂ 换段
const DOUBLE_ESC = new RegExp('<!--[\\s\\S]*?<' + SCR, 'i');
const checkCode = (code, id) => {
  if (/<\/script/i.test(code)) fail(`块 ${id} 含字面闭合标签, 请写成 <\\/${SCR}>`);
  if (DOUBLE_ESC.test(code)) fail(`块 ${id} 里 <!-- 与 <${SCR} 同现会打乱 HTML 解析, 请写成 "<!" + "--"`);
};
const blockText = (manifest, code) =>
  `\n/*BLOCK*/${JSON.stringify(manifest)}/*CODE*/\n${norm(code)}\n`;
const blockTag = (manifest, code, disabled) => {
  // ✂ 单独时不带 · 号: 拼块查清单
  checkManifest(manifest);
  // ✂ 单独时不带 完
  checkCode(code, manifest.id);
  return `<${SCR} type="colony/petri" data-id="${manifest.id}"`
    + `${disabled ? ' data-disabled="1"' : ''}>${blockText(manifest, code)}</${SCR}>`;
};
// ✂ 换段 完
const findBlockTags = (html, onError) => {
  const re = new RegExp(`<${SCR}(\\s[^>]*type="colony/petri"[^>]*)>([\\s\\S]*?)</${SCR}>`, 'g');
  const out = [];
  for (const m of html.matchAll(re)) {
    try {
      const b = parseBlock(m[2]);
      if (/data-disabled=/.test(m[1])) b.tagDisabled = true;
      out.push(b);
    } catch (e) {
      if (!onError) throw e;
      onError(e, (/data-id="([^"]*)"/.exec(m[1]) || [])[1] || '?');
    }
  }
  return out;
};
const findLineage = html => {
  const m = /<!--COLONY-LINEAGE ([\s\S]*?)-->/.exec(html);
  return m ? JSON.parse(m[1]) : null;
};

X({ parseBlock, checkManifest, checkCode, blockText, blockTag, findBlockTags, findLineage });
// ═ 能力树 · 跟着: 基础, 块接口, 装载 ═
// 块、miniapp、agent 之间都走这一张表。call 总回 Promise(里面抛的错就是拒绝); 撞名报错; 变动发 colony:cap 事件; frames:false
// 的不接隔离窗的调用; 参数形状里括号前没写 ? 的是必填, 少给了调用前就报。common: 提供者标的常用, agent 给成工具, 别的进目录。
// 外: 自己跑在别的 Colony 的窗里时外面那座桥, 本机没有的问它(函数、中止信号过不了窗, 只回整段)
// 能力归哪块看路径头一截(前缀): 块清单 caps 写它有哪些前缀, 没写就是 id 最后一个冒号后那截(stem 的是 stem)。登记的不是自己的
// 前缀(别的块的代码剪了进来: 单独打开, 或那块停用了、坏了), 就只记在自己名下, 只有自己调得到(块调能力先找自己名下的); 别人
// 调, 认这个前缀的块没在跑就说「「它」块停用了」
const 主 = p => L.factory.find(b => 认(b.manifest).includes(头(p)));
// ✂ 跑块
const CAP = {}, 私 = {}, 外 = g.colony?.expose ? g.colony : null, 头 = p => String(p).split('.')[0],
  认 = m => m.caps || [m.id.split(':').pop()];
const provide = (path, fn, m, by) => {
  m = m || {};
  const c = { fn, by, schema: m.schema || null, desc: m.desc || '', frames: m.frames !== false,
      common: m.common === true || undefined },
    T = 认(blockOf(by)?.manifest || { id: by }).includes(头(path)) ? CAP : 私[by] ||= {};
  // ✂ 单独时不带 · 号: 撞名
  if (T[path] && T[path].by !== by) fail(`能力撞名: ${path} 已由 ${T[path].by} 提供`);
  // ✂ 单独时不带 完
  T[path] = c;
  emit('colony:cap', { path, by, type: 'add' });
};
const 找 = (path, by) => 私[by]?.[path] || CAP[path];
const call = (path, args, meta) => new Promise(res => {
  const c = 找(path, meta?.by);
  if (!c && 外)
    return res(外.call(path, JSON.parse(JSON.stringify({ ...args, stream: false }))));
  if (!c) {
    let 话 = '无此能力: ' + path;
    // ✂ 单独时不带 · 号: 停了的块
    const o = 主(path), near = Object.keys(CAP).filter(p => 头(p) === 头(path)).sort();
    if (o && !L.inst[o.manifest.id]) fail('「' + (o.manifest.name || o.manifest.id) + '」块停用了, 调不了 ' + path);
    话 += near.length ? '。同名空间下有: ' + near.join(', ') : '。用 stem.capabilities 看清单';
    // ✂ 单独时不带 完
    fail(话);
  }
  // ✂ 隔离窗
  // 完全访问的应用(用户在窗上点开, 挂载方写进 context.trust; 应用自己改不了)和块一样能调全部能力
  if (meta?.frame && !c.frames && !meta.context?.trust) fail('隔离窗里不能调用 ' + path + '(要用就在应用窗上点「🔒 隔离运行」换成完全访问)');
  // ✂ 隔离窗 完
  const a = args ?? {}, s = c.schema || {}, 缺 = Object.keys(s).filter(k => a[k] === undefined
    && typeof s[k] === 'string' && !/\?$/.test(s[k].split('(')[0].trim()));
  if (缺.length) fail(`${path} 缺 ${缺.join(', ')}。参数形状: ${JSON.stringify(s)}`);
  res(c.fn(a, meta || {}));
});
const has = (path, by) => !!找(path, by);
// ✂ 跑块 完
const revoke = by => [CAP, 私[by] || {}].forEach(T => Object.keys(T).forEach(p => {
  if (T[p].by === by) { delete T[p]; emit('colony:cap', { path: p, by, type: 'remove' }); }
}));
// Stem 自己的能力: 写在实现它的那段末尾, 用它登记。会改宿主的(frames: false)不接隔离窗的调用
const P = (path, fn, desc, schema, frames) => provide(path, fn, { desc, schema, frames: frames !== false,
  common: /^stem\.(block|setBlock|capabilities)$/.test(path) }, 'stem');
const capList = by => { // 公开的, 加上 by 名下的
  const T = { ...CAP, ...私[by] };
  return Object.keys(T).sort().map(path => {
    const { fn, ...c } = T[path];
    return { path, ...c };
  });
};
X({ provide, revoke, has, capList, call, CAP });
// ═ 存储 · 跟着: 基础 ═
// 键值库: 借了「键值库」才有 ctx.kv(IndexedDB, 打不开退到内存: 能看不能存); 不用 kv 的块单独打开没有 kv
// 内存版存取都是拷贝, 同 IndexedDB
// ✂ 键值库 · 要: 跑块
const memStore = () => {
  const m = new Map(), 拷 = structuredClone;
  return {
    get: async k => 拷(m.get(k)), set: async (k, v) => { m.set(k, 拷(v)); }, del: async k => { m.delete(k); },
    clear: async () => { m.clear(); },
    list: async p => [...m].filter(([k]) => !p || String(k).startsWith(p))
      .map(([key, value]) => ({ key, value: 拷(value) })),
    keys: async p => [...m.keys()].filter(k => !p || String(k).startsWith(p))
  };
};
const idbStore = name => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const op = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('kv', mode), s = t.objectStore('kv'), q = fn(s);
    t.onerror = () => rej(t.error);
    if (q && 'onsuccess' in q) {
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    } else t.oncomplete = () => res(q);
  })), w = fn => op('readwrite', fn).then(() => { });
  return {
    get: k => op('readonly', s => s.get(k)), set: (k, v) => w(s => s.put(v, k)),
    del: k => w(s => s.delete(k)), clear: () => w(s => s.clear()),
    list: p => op('readonly', s => {
      const r = p ? IDBKeyRange.bound(p, p + '\uffff') : undefined; // 只读这个前缀的那一段
      return { ks: s.getAllKeys(r), vs: s.getAll(r) };
    }).then(r => r.ks.result.map((k, i) => ({ key: k, value: r.vs.result[i] }))),
    // 只要名单不读值: 大库里快几百倍(口袋先拿它画地图, 大小再补)
    keys: p => op('readonly', s => s.getAllKeys(p ? IDBKeyRange.bound(p, p + '\uffff') : undefined))
  };
};
const openStore = name => typeof indexedDB !== 'undefined' ? idbStore(name) : memStore();
// ✂ 键值库 完
X({ idbStore, memStore });
// ═ 块接口 · 跟着: 能力树, 存储 ═
// 块代码是 块参 这几个参数的函数体, 接口全在 ctx(id, root, kv, provide, call, cleanup)和它自己的 colony(call, has, 单独):
// 能不能调、去调都先找自己名下的, 不是页面上那个全局(单独 照页面上的); Colony 里还有一问 停着(见装载)。kv 是全库共享,
// 只有块记录不让直接写, 因为那是 setBlock 的地盘(单独打开的文件不读块记录, 不用守)
// ✂ 跑块
const L = { store: null, factory: [] }, 块参 = ['ctx', '__seg', 'colony'];
const ctxFor = id => {
  const cleanups = [];
  let root = null;
  if (doc) {
    root = doc.createElement('div');
    root.setAttribute('data-block-id', id);
    doc.getElementById('colony-root').appendChild(root);
    cleanups.push(() => root.remove());
  }
  const ctx = { id, root, kv: L.store, provide: (path, fn, meta) => provide(path, fn, meta, id),
    call: (path, args) => call(path, args, { by: id }), cleanup: fn => { cleanups.push(fn); } };
  // ✂ 单独时不带 · 号: 守块记录
  ctx.kv = guardKv(L.store);
  // ✂ 单独时不带 完
  const colony = { call: ctx.call, has: path => has(path, id), get 单独() { return g.colony.单独; } };
  return { ctx, cleanups, colony };
};
// ✂ 跑块 完
Object.assign(L, { safe: false, recs: {}, inst: {}, errors: {}, broken: [],
  head: '', launcher: '', stemFactory: '' });
const guardKv = store => {
  const chk = k => String(k).startsWith('block:')
    ? Promise.reject(new Error('块记录只能经 stem.setBlock 改, 不能直接写 kv: ' + k)) : Promise.resolve();
  return { get: k => store.get(k), set: (k, v) => chk(k).then(() => store.set(k, v)),
    del: k => chk(k).then(() => store.del(k)), list: p => store.list(p), keys: p => store.keys(p) };
};
// 块代码顶上又声明了块参的名字(const colony = …), 引擎只说重名, 这里说清那是 Stem 给的。重名: 引擎说重名的是哪个名字
const 重名 = e => /(?:Identifier '|redeclaration of (?:formal parameter |\S+ )?|twice: ')([^'\s]+)/
  .exec(e?.message)?.[1],
  块参错 = (e, n = 重名(e)) => 块参.includes(n) ? '块里不能再声明 ' + n + '(Stem 给每块自己的 ' + n + ')' : '';
X({ L, ctxFor, 块参, 重名, 块参错 });
// ═ 装载 · 跟着: 块接口, 块记录, 段值表, 能力树, 段解析 ═
// 借来的段懒取值, 服务晚到靠 colony:cap 事件接上; 块因此不能在装载期同步调别的块。先后只管一件事: 被借的先装
const isEnabled = b => {
  const r = L.safe ? null : L.recs[b.manifest.id];
  return r?.enabled !== undefined ? !!r.enabled : !b.adopted && !b.tagDisabled;
};
// 单独打开的文件里只有一块, 没有改版、借用和启停, 出厂代码原样跑
// ✂ 跑块
const blockOf = id => L.factory.find(b => b.manifest.id === id);
const instantiate = b => {
  const id = b.manifest.id;
  // ✂ 单独时不带 · 号: 装过没有
  if (L.inst[id]) return;
  if (!isEnabled(b)) { L.errors[id] = '已禁用'; return; }
  // ✂ 单独时不带 完
  const o = ctxFor(id);
  let code = b.code, seg = null;
  // ✂ 单独时不带 · 号: 跑哪份
  try {
    const r = 跑码(b); // 源头没在跑的剪一份进来, 见段值表
    // 剪来的代码认不出源头那边的东西时问 停着(源头 id): 源头停用了或坏了回它的名, 不然回假
    o.colony.停着 = x => 停(x) && (blockOf(x).manifest.name || x);
    code = b._run = r.code;
    checkCode(code, id);
    seg = {
      set: (n, get) => Object.defineProperty(SEG, id + '/' + n,
        { get, enumerable: true, configurable: true }),
      ref: k => segRef(k, SEG, r.不[k]),
      clear: () => Object.keys(SEG).forEach(k => { if (k.startsWith(id + '/')) delete SEG[k]; })
    };
    // ✂ 单独时不带 完
    const ret = new Function(...块参, code)(o.ctx, seg, o.colony);
    // ✂ 单独时不带 · 号: 装上记账
    L.inst[id] = Object.assign(o, { dispose: ret?.dispose || null });
    delete L.errors[id];
  } catch (e) {
    o.cleanups.forEach(f => { try { f(); } catch (_) { } });
    revoke(id);
    if (seg) seg.clear();
    L.errors[id] = 块参错(e) || e.message;
    throw e;
  }
  // ✂ 单独时不带 完
};
const tryRun = b => { try { instantiate(b); } catch (e) { console.error('[block]', b.manifest.id, e); } };
const assembleAll = async () => {
  // ✂ 单独时不带 · 号: 开机记账
  L.booting = true;
  L.errors = {};
  L.broken = [];
  // ✂ 单独时不带 完
  L.factory = [];
  if (doc) doc.querySelectorAll(SCR + '[type="colony/petri"]').forEach(el => {
    // ✂ 单独时不带 · 号: 认坏块
    try {
      // ✂ 单独时不带 完
      const b = parseBlock(el.textContent);
      // ✂ 单独时不带 · 号: 认重块
      if (blockOf(b.manifest.id)) fail('块 id 重复: ' + b.manifest.id);
      if (el.getAttribute('data-disabled')) b.tagDisabled = true;
      // ✂ 单独时不带 完
      L.factory.push(b);
      // ✂ 单独时不带 · 号: 记坏块
    } catch (e) {
      L.broken.push({ id: el.getAttribute('data-id') || '?', error: e.message });
    }
    // ✂ 单独时不带 完
  });
  let 序 = L.factory;
  // ✂ 单独时不带 · 号: 记录和先后
  L.recs = {};
  for (const e of await L.store.list('block:')) {
    const id = String(e.key).slice(6);
    L.recs[id] = e.value;
    if (!L.safe && e.value?.adopted && !blockOf(id)) {
      try {
        L.factory.push(Object.assign(parseBlock(e.value.adopted), { adopted: true }));
      } catch (err) {
        L.broken.push({ id, error: '收养记录损坏: ' + err.message });
      }
    }
  }
  序 = L.factory.slice().sort((a, b) => a.manifest.id < b.manifest.id ? -1 : 1);
  被借的先(序);
  // ✂ 单独时不带 完
  序.forEach(tryRun);
  // ✂ 单独时不带 · 号: 重剪
  await 重剪();
  L.booting = false;
  // ✂ 单独时不带 完
  emit('colony:blocks');
};
// ✂ 跑块 完
const dispose = id => {
  const i = L.inst[id];
  if (!i) return;
  try { if (i.dispose) i.dispose(); } catch (e) { console.error('[dispose]', id, e); }
  i.cleanups.forEach(f => { try { f(); } catch (_) { } });
  revoke(id);
  delete L.inst[id];
};
const stemUse = () => LS?.getItem(BOOT.key + '.use') || 'factory';
const stemEdited = () => LS?.getItem(BOOT.key + '.edited') || '';
const stemTextNow = () => (stemUse() === 'edited' && stemEdited()) || L.stemFactory;
const stemBlock = () => ({ manifest: { id: 'stem', name: 'Stem' }, code: stemTextNow() }); // Stem 也当一块来读、来改
// 基线号: 读时带出去, 写时用 expected 带回来, 对不上就拒绝, 免得盖掉别人的改动
const revOf = id => hash(id === 'stem' ? stemUse() + stemEdited() : JSON.stringify(L.recs[id] || null));
const parsedOf = b => b._p?.src === b.code // 出厂代码只解析一次; 列块、找借用者会反复要它
  ? b._p
  : (b._p = Object.assign(parseSegs(b.code), { src: b.code }));
const effectiveOf = b => effective(parsedOf(b), L.safe ? null : L.recs[b.manifest.id]);
// 被借的先装: 源头坏了先露出来, 借它的装时就剪一份; 转着圈借的照原先后
const 被借的先 = 序 => {
  const 剩 = 序.splice(0), 借着 = b => effectiveOf(b).segs.some(s => 剩.some(x => x !== b
    && x.manifest.id === s.map?.block));
  while (剩.length) 序.push(...剩.splice(Math.max(0, 剩.findIndex(b => !借着(b))), 1));
};
const 块 = id => blockOf(id) || fail('无此块: ' + id);
const borrowTable = () => { // 谁借了谁, 一次算完一张表; 逐段现算会随块数和段数平方变慢
  const t = {};
  L.factory.forEach(b => effectiveOf(b).segs.forEach(s => {
    const k = s.map && s.map.block !== b.manifest.id && s.map.block + '/' + s.map.name;
    if (k) (t[k] ||= []).push(b.manifest.id);
  }));
  return t;
};
const borrowersOf = (id, name, t) => (t || borrowTable())[id + '/' + name] || [];
// 谁要一块的哪些名字 {名: [块 id]}: 借它的每行点的、要的, 照剪法连一路到的; 它自己的范围要的、段跟着的算它要。
// 范围用宽的排法: 写坏了的旧记录也读得出来, 才好去改
const 谁要 = id => {
  const q = id === 'stem' ? parseSegs(stemTextNow()) : effectiveOf(块(id)), R = lay(q, id, 1), out = {},
    记 = (ns, by) => ns.forEach(n => (out[n] ||= []).includes(by) || out[n].push(by));
  [stemBlock()].concat(L.factory).forEach(y => effectiveOf(y).segs.forEach(s => {
    if (s.map?.block !== id || y.manifest.id === id) return;
    const [r, g] = 连(R, [s.map.name].concat(s.want));
    记([...r].concat([...g].map(i => q.segs[i].name)), y.manifest.id);
  }));
  Object.values(R.need).concat(q.segs.map(s => s.follows)).forEach(ns => 记(ns, id));
  return out;
};
// 块的「自报」「技能」两段只有注释, 给人和 agent 看。自报: 头一句写用处, 「// 数据 {…}」认一个前缀,
// 「// 现在 能力」看它此刻的样子, 「// 打开 能力」点开这块时调; 技能: 「// 【名】什么时候读: …」开一条, 到下一条为止
const aboutOf = eff => {
  const o = { desc: '', data: [], skills: [] }, 段 = n => eff.segs.find(s => s.name === n)?.lines || [];
  段('自报').slice(1).forEach(l => {
    const [, k, v] = /^\/\/ (数据|现在|打开) (.*)/.exec(l) || [];
    if (k === '数据') try { o.data.push(JSON.parse(v)); } catch (e) { o.data.push({ error: l }); }
    else if (k) o[k === '现在' ? 'show' : 'open'] = v.trim();
    else if (!o.data.length && /^\/\/ \S/.test(l)) o.desc += l.slice(3);
  });
  段('技能').forEach((l, i) => {
    const m = /^\/\/ 【(.+?)】(.*)/.exec(l);
    if (m) o.skills.push({ name: m[1], when: m[2].split(/[:：。] ?/)[0].slice(0, 40), line: i });
  });
  return o;
};
const outline = (b, t) => { // t: 借用表, 列很多块时传同一张进来
  const id = b.manifest.id, eff = effectiveOf(b), inst = L.inst[id], tab = t || borrowTable();
  return { id, name: b.manifest.name || id, icon: b.manifest.icon || '', about: aboutOf(eff),
    version: b.manifest.version || 0, enabled: isEnabled(b), adopted: !!b.adopted, running: !!inst,
    hidden: inst?.ctx.root?.style.display === 'none', error: L.errors[id] || null,
    deleted: eff.deleted, segs: eff.segs.map(s => ({ name: s.name, v: s.v, lines: s.lines.length, use: s.use,
      hasEdit: s.hasEdit, map: s.map, from: s.from, follows: s.follows,
      borrowers: borrowersOf(id, s.name, tab) })) };
};
P('stem.blocks', () => {
  const t = borrowTable();
  return L.factory.map(b => outline(b, t))
    .concat(L.broken.map(x => ({ id: x.id, error: x.error, broken: true })));
}, '列块, 含每块的段目录; broken 是解析不了的块', {});
P('stem.block', a => { // Stem 也当一块读, 读一段只回这一段
  const id = a.id, stem = id === 'stem', b = stem ? stemBlock() : 块(id), eff = effectiveOf(b),
    o = { id, revision: revOf(id) };
  if (a.segment) {
    const s = eff.segs.find(x => x.name === a.segment) || fail('无此段: ' + a.segment);
    o.segment = { name: s.name, text: s.text, use: stem ? stemUse() : s.use };
    // 要了才给原版: 一给就翻倍, 配置版的原版里还有别人的 Key
    if (a.factory && s.factoryText !== s.text) o.segment.factory = s.factoryText;
    return o;
  }
  Object.assign(o, outline(b), { need: 谁要(id) },
    stem ? { running: true, use: stemUse(), hasEdit: !!stemEdited() } : {});
  if (a.full) Object.assign(o, { code: joinSegs(eff), factory: stem ? L.stemFactory : b.code });
  return o;
}, '读一块: 默认段目录(need 谁要哪个名字), full 取全文, segment 只回那一段(factory: true 同时要原版); id 可为 stem。'
  + 'revision 是基线号',
{ id: 'string', full: 'boolean?', segment: 'string?', factory: 'boolean?' });
P('stem.capabilities', (a, m) => capList(m.by).filter(c => !a.path || c.path.startsWith(a.path)),
  '能力清单与参数形状(块调时带上它自己名下的); 给 path 只列这个前缀的', { path: 'string?' });
P('stem.lineage', () => ({ id: BOOT.id, lineage: BOOT.lineage, safe: L.safe, stemUse: stemUse() }),
  '本文件的指纹、父指纹、块清单', {});
P('stem.reboot', async () => {
  Object.keys(L.inst).forEach(dispose);
  await assembleAll();
  return { running: Object.keys(L.inst) };
}, '软重启: 卸全部块再装', {}, false);
X({
  blockOf, effectiveOf, borrowTable, borrowersOf, 谁要, isEnabled, instantiate, dispose, aboutOf, outline,
  assembleAll, stemUse, stemEdited, stemTextNow, stemBlock, parsedOf, tryRun, revOf
});
// ═ 段解析 · 跟着: 基础, 块接口 ═
// 标记行一个写法「// 记号 名 · 键: 值」: 段头 ═ 管到下一段头; 借 ↦ 一行一段; 范围 ✂ 头尾一对(可跨段、段内、套、交叉)
//   // ↦ 借 petri:x 的 名 · 要: a · 按需: 段.项   名是那边的段或范围; 借 Stem 的写 stem, 名是 Stem 的范围
//   // ✂ 名 · 要: a … // ✂ 名 完   「跟着」「要」都是我要用它; 同名可圈几处, 不能没收尾又开同名的
//   // ✂ 单独时不带 · 号: 名         单独导出只留空头尾, 导回按号从这边那块找回; 一块里每处一个号, 不能重
// 段到下一段头为止, 不要段尾: 一行代码必属于且只属于一段, 拆开再拼回才能一字不差。老写法的 v 几照样认、照样写回
// ✂ 换段
const MARK = /^\s*\/\/\s*(?:═\s*(.+?)\s*═|(↦|✂)\s*(.+?))\s*$/,
  KEY = { 跟着: 'follows', 源自: 'from', 要: 'want', 按需: 'ask', 带了: 'got', 指纹: 'sum', 借用者: 'borrowers',
    号: 'tag' };
const blank = name => ({ name, v: 0, follows: [], want: [], got: [], borrowers: [], from: null, map: null });
const mark = line => { // 认一行标记(段头、借、范围头尾), 不是标记回 null
  const m = MARK.exec(line), [n, ...f] = m ? (m[1] || m[3]).split(/\s*·\s*/) : [],
    b = m && m[2] && (m[2] === '↦' ? /^借\s+(\S+)\s+的\s+(.+)$/ : /^(.+?)(\s+完)?$/).exec(n);
  if (!m || m[2] && !b) return null;
  const s = blank(!b ? n : m[2] === '↦' ? b[2] : b[1]);
  if (m[2] === '↦') s.map = { block: b[1], name: b[2] };
  if (m[2] === '✂') Object.assign(s, { cut: true, end: !!b[2] });
  f.forEach(x => {
    const [, k, v] = /^(\S+?)\s*[:：]\s*(.*)$/.exec(x) || [], key = KEY[k],
      o = key === 'from' && /^(\S+?)\/(.+?)(?:\s+v(\d+))?$/.exec(v);
    if (/^v\d+$/.test(x)) s.v = +x.slice(1);
    else if (o) s.from = { block: o[1], name: o[2], v: +(o[3] || 0) };
    else if (key && key !== 'from') s[key] = /ask|sum|tag/.test(key) ? v
      : v.split(/\s*[,，]\s*/).filter(Boolean);
    else fail('标记认不出: "' + x + '"(' + s.name + ')。允许: v数字 / ' + Object.keys(KEY).join(' / '));
  });
  return s;
};
const parseSegs = code => {
  const out = { prologue: [], segs: [] };
  let cur = null;
  String(code).split('\n').forEach(line => {
    const h = mark(line);
    if (h && !h.cut) out.segs.push(cur = Object.assign(h, { lines: [line] }));
    else if (cur) cur.lines.push(line);
    else out.prologue.push(line);
  });
  out.segs.forEach(s => { s.text = s.lines.join('\n'); });
  return out;
};
const joinSegs = p => p.prologue.concat(...p.segs.map(s => s.lines)).join('\n');
// ✂ 换段 完
const headLine = s => (s.map ? '// ↦ 借 ' + s.map.block + ' 的 ' + s.map.name : '// ═ ' + s.name)
  + (s.v ? ' · v' + s.v : '') + Object.entries(KEY).map(([k, key]) => {
    const f = s.from, v = key === 'from' ? f && f.block + '/' + f.name + (f.v ? ' v' + f.v : '') : s[key];
    return v?.length ? ' · ' + k + ': ' + [].concat(v).join(', ') : '';
  }).join('') + (s.map ? '' : ' ═');
const checkSegs = (p, where) => {
  const seen = {};
  p.segs.forEach(s => {
    if (seen[s.name]) fail('段名重复: ' + where + '/' + s.name);
    seen[s.name] = 1;
  });
  return p;
};
const bodyOf = s => s.lines.slice(1).join('\n');
const segKey = s => headLine(Object.assign({}, s, { borrowers: [] })) + '\n' + bodyOf(s); // 借用者是导出时写的, 不算改动
// 排开: 每行在第几段(前言 -1)、在哪些范围里(标记行算上它自己)、是哪个范围的标记、另一头在第几行, 能借的范围要什么(need,
// 单独时不带不是给人借的, 不算); 顺带查写坏。单独导出连单独时不带里的标记一起去掉, 别的范围头尾得在同一个它里面或都不在。
// L.处 = {号: 单独时不带的头在第几行}。
// 宽: 写坏了不报错, 第一处记进 L.坏
const 不带 = '单独时不带', lay = (p, where, 宽) => {
  const L = { p, where, lines: p.prologue.concat(...p.segs.map(s => s.lines)), seg: [], in: [], cut: [],
    pair: [], need: { __proto__: null }, 处: { __proto__: null } }, open = [],
    在 = () => open.find(o => o[0] === 不带)?.[1], 坏 = m => 宽 ? L.坏 ||= m : fail(m);
  let n = -1;
  L.lines.forEach((l, i) => {
    const m = mark(l), at = '第 ' + (i + 1) + ' 行: ',
      k = m?.cut ? open.findLastIndex(o => o[0] === m.name) : -1;
    if (m && !m.cut && 在() >= 0) 坏(at + '「' + 不带 + '」不能圈段头');
    L.seg.push(m && !m.cut ? ++n : n);
    L.in.push(new Set(open.map(o => o[0]).concat(m?.cut ? m.name : [])));
    if (!m?.cut) return;
    L.cut[i] = m.name;
    if (m.end) {
      if (k < 0) return 坏(at + '「' + m.name + ' 完」前面没有开头');
      const [, h, 头在] = open.splice(k, 1)[0];
      if (头在 !== 在()) 坏(at + '「' + m.name + '」(第 ' + (h + 1) + ' 行开头)和「' + 不带 + '」交叉: '
        + 不带 + '只能整个包住别的范围, 或者一头都不碰');
      return L.pair[L.pair[i] = h] = i;
    }
    if (k >= 0) 坏(at + '「' + m.name + '」没收尾又开了一个同名的');
    if (m.name !== 不带) L.need[m.name] = (L.need[m.name] || []).concat(m.want);
    else if (!m.tag) 坏(at + '「' + 不带 + '」要起个名字, 写成 // ✂ ' + 不带 + ' · 号: 名');
    else if (m.tag in L.处) 坏(at + '「' + 不带 + '」的号「' + m.tag + '」重了, 第 ' + (L.处[m.tag] + 1) + ' 行也叫它');
    else L.处[m.tag] = i;
    open.push([m.name, i, 在()]);
  });
  if (open.length) 坏('范围「' + open[0][0] + '」没有收尾');
  return L;
};
const 连 = (L, names) => { // 名单连一路「跟着」「要」到的 [范围名, 段号, 没有的名字]; 剪和算谁要都用它
  const R = new Set(), S = new Set(), 缺 = [], by = { __proto__: null };
  L.p.segs.forEach((s, i) => { by[s.name] = i; });
  const add = n => n in L.need ? R.has(n) || (R.add(n), L.need[n].forEach(add))
    : n in by ? S.has(by[n]) || (S.add(by[n]), L.p.segs[by[n]].follows.forEach(add)) : 缺.push(n);
  names.forEach(add);
  return [R, S, 缺];
};
// 剪: 名单 = 点到的, 连一路「跟着」「要」到的, 名字先认范围再认段。圈着的行, 圈它的范围有一个在名单上就留(交叉的两边
// 谁点到都留); 没圈的行和段头, 它那段在名单上就留; 「单独时不带」圈的不留; 头尾只剩一个的标记行不留。
// names 给 null = 整份都要, 只去掉「单独时不带」圈的, 它的头尾留着占位。skip(i): 第 i 行借用方已经有了
const 没名 = (L, n) => L.where + ' 没有叫「' + n + '」的段或范围, 范围有: ' + Object.keys(L.need).join(', ');
const pick = (L, names, skip) => {
  const [R, S, 缺] = 连(L, names || []);
  if (缺.length) fail(没名(L, 缺[0]));
  const k = L.lines.map((l, i) => !skip?.(i) && (L.in[i].has(不带)
    ? !names && L.cut[i] === 不带 : !names || [...L.in[i]].some(r => R.has(r))
    || (!L.in[i].size || L.seg[i] !== L.seg[i - 1]) && S.has(L.seg[i])));
  return k.map((x, i) => x && !(L.cut[i] && !k[L.pair[i]]));
};
const 纹 = s => hash(norm(s)).slice(0, 8); // 指纹: 正文算的 8 位
// 单独导出时 Stem 的位置; names 见 pick; 号: 留了第几行
const cutCode = (code, names, where, 号 = []) => {
  const L = lay(parseSegs(code), where), k = pick(L, names);
  k.forEach((x, i) => x && 号.push(i));
  return L.lines.filter((l, i) => k[i]).join('\n');
};
// 剪一份带走: g = 借同一个源头的几行 [[借用行, 源头那边的名]]。名字(点的 + 要 + 带了)合起来剪成一份放在第一行, 后面几行
// 各留一个空的复制段头, 导回时一行对一行。段头写源自(原来借的)、要、按需、带了、指纹(正文算的 8 位); 别的段来的行前写
// // ─ 名 ─, 段头不抄。have: 借用方另外有的「块/名」(借的、复制来的, 连复制里 // ─ 名 ─ 带进来的), 那几段不带。
// 号: 正文每行是源头第几行(// ─ 名 ─ 记段头那行)。带了只留源头真有的名字(范围或段)。带不走(源头写坏了、名字没有、
// 要的段也是借来的、按需出错): 给了 不 就记下原因回 null, 不然报错
const 有 = p => new Set(p.segs.flatMap(s => {
  const o = s.map || s.from;
  return !o ? [] : [o.name].concat(s.from ? s.lines.map(l => (/^\/\/ ─ (.+) ─$/.exec(l) || [])[1]) : [])
    .filter(Boolean).map(n => o.block + '/' + n);
}));
const copyOf = (src, id, g, have, 号 = [], 不) => {
  const L = lay(src, id, 不), 错 = g.map(([s]) => s.got).find(x => x instanceof Error), out = [];
  g.forEach(([s]) => {
    s.got = 错 ? [] : s.got.filter(n => Object.hasOwn(L.need, n) || src.segs.some(x => x.name === n));
  });
  const 名 = g.flatMap(([s, n]) => [n].concat(s.want, s.got)), 缺 = 连(L, 名)[2],
    别 = n => !名.includes(n) && have.has(id + '/' + n),
    k = !L.坏 && !错 && !缺.length && pick(L, 名, i => 别(src.segs[L.seg[i]]?.name)),
    t = k && src.segs[L.seg[k.findIndex((x, i) => x && src.segs[L.seg[i]]?.map)]],
    why = L.坏 || 错?.message || (缺.length ? 没名(L, 缺[0]) : t && '它要用的「' + t.name + '」也是借来的, 请让借用方自己借 '
      + t.map.block + '/' + t.map.name);
  if (why && !不) fail('带不走 ' + id + '/' + g[0][1] + ': ' + why);
  if (why) return g.forEach(([s]) => { 不[s.map.block + '/' + s.map.name] = why; }), null;
  let last = null;
  k.forEach((x, i) => {
    const n = L.seg[i], t = src.segs[n] || { name: '(前言)' };
    if (!x) return;
    if (t !== last && t.name !== g[0][1]) out.push('// ─ ' + t.name + ' ─'), 号.push(L.seg.indexOf(n));
    last = t;
    if (n < 0 || n === L.seg[i - 1]) out.push(L.lines[i]), 号.push(i);
  });
  return g.map(([s], i) => {
    const body = i ? '' : out.join('\n');
    return headLine(Object.assign(blank(), s, { map: null, from: s.from || Object.assign({ v: s.v }, s.map),
      sum: 纹(body) })) + (i ? '' : '\n' + body);
  });
};
const syntax = (code, what, args) => { // 语法先过一遍, 不过就说是谁; 块代码(args 是块参)重声明了块参, 说清那是 Stem 给的
  try {
    new Function(...(args || []), code);
  } catch (e) {
    fail(what + '有语法错误: ' + (args && 块参错(e) || e.message));
  }
};
X({ mark, headLine, parseSegs, joinSegs, checkSegs, bodyOf, segKey, blank, lay, 连, pick, 纹, cutCode,
  有, copyOf, syntax });
// ═ 块记录 · 跟着: 段解析 ═
// 一块一条记录 {enabled?, adopted?, segs:{名:{edited, active}}, prologue?, order?, layoutActive?}。
// 原版永远在出厂文本里, 改版在记录里, active 说哪份显性; 前言与段序的改动也是两份一个开关
const recKey = id => 'block:' + id;
const effective = (factory, rec) => { // factory 是出厂代码文本, 或已解析好的 {prologue, segs}(装载段缓存后传进来)
  const fp = typeof factory === 'string' ? parseSegs(factory) : factory, byName = {},
    segsRec = rec?.segs || {}, useLayout = rec?.layoutActive === 'edited',
    names = useLayout && rec.order ? rec.order.slice() : fp.segs.map(s => s.name), segs = [], deleted = [];
  fp.segs.forEach((s, i) => {
    byName[s.name] = s;
    if (!names.includes(s.name)) names.splice(Math.min(i, names.length), 0, s.name);
  });
  Object.keys(segsRec).forEach(n => { // 新段排在最后一段(装配, 有 return)之前, 排后面永不执行
    if (!names.includes(n)) names.splice(Math.max(names.length - 1, 0), 0, n);
  });
  names.forEach(n => {
    const r = segsRec[n], f = byName[n], hasEdit = !!r?.edited;
    if (r?.active === 'edited' && r.edited != null) {
      if (r.edited === '') return deleted.push(n);
      const lines = r.edited.split('\n');
      segs.push(Object.assign(mark(lines[0]) || blank(n), {
        name: n, text: r.edited, lines, use: 'edited', hasEdit, factoryText: f ? f.text : null
      }));
    } else if (f) segs.push(Object.assign({}, f, { use: 'factory', hasEdit, factoryText: f.text }));
  });
  return { prologue: useLayout && typeof rec.prologue === 'string' ? rec.prologue.split('\n') : fp.prologue,
    segs, deleted };
};
X({ effective, recKey });

// ═ 段值表 · 跟着: 基础, 块接口, 装载, 段解析, 导出 ═
// 借用方拿到的是懒取值的代理, 值不靠装载顺序(先后见装载)。源头停用了或坏了, 借用方跑导出一个没有它的 Colony 时的那份(见 跑码)
const SEG = {};
const segRef = (key, table, why) => { // why: 源头没在跑、又剪不出一份来的原因(见 跑码)
  const T = table || SEG, peek = () => { try { return T[key]; } catch (e) { } }, get = () => {
    const v = peek();
    if (v === undefined) {
      const src = key.split('/')[0], b = blockOf(src), 开 = b && isEnabled(b);
      fail(b && 停(src) ? '源头块 ' + src + (开 ? ' 坏了' : ' 已禁用') + ', 借不到 ' + key
        + (why ? '; 剪不出一份来: ' + why : '') + ': ' + (开 ? '修好' : '启用') + '它, 或把这段复制过来'
        : '借的段还没就位: ' + key + '(源头块从未装载, 或它没有这个名字的段)');
    }
    if (Object(v) !== v) fail('借的 ' + key + ' 是单个的值(' + String(v).slice(0, 20) + '), 借过来是个代理, 用不了: 请包成对象');
    return v;
  };
  return new Proxy(function () { }, { // 方法不绑定 this: 经代理调用时 this 就是代理, 读写照样转发, 且 ref.f === ref.f
    apply: (_, t, a) => get().apply(t, a),
    construct: (_, a) => Reflect.construct(get(), a),
    get: (_, p) => {
      if (typeof p !== 'string' || p === 'then' || p === 'toJSON') {
        const v = peek();
        return v == null ? undefined : v[p];
      }
      return get()[p];
    },
    set: (_, p, v) => {
      get()[p] = v;
      return true;
    },
    has: (t, p) => p in get() || p in t
  });
};
// 段名、范围名都登记: 装载时不知道谁会来借; 映射也登记, 二级借用才能转发。范围用宽的排法: 跑不靠它成不成对。
// 段头不带借用者: 那是导出时照谁借它写的, 跑的代码不跟着变
const forRun = (id, eff) => {
  const out = eff.prologue.slice();
  // 用时才取(取不到当还没就位): 同名的量可能后面的段才声明, 装载时就取会抛
  new Set(eff.segs.map(s => s.name).concat(Object.keys(lay(eff, id, 1).need))).forEach(n => {
    if (isIdent(n)) out.push('__seg.set(' + JSON.stringify(n) + ', () => ' + n + ');');
  });
  eff.segs.forEach(s => {
    if (s.map) {
      if (!isIdent(s.name)) fail('段名「' + s.name + '」不是合法标识符, 不能映射');
      out.push(
        s.lines[0],
        'const ' + s.name + ' = __seg.ref(' + JSON.stringify(s.map.block + '/' + s.map.name) + ');',
        ...s.lines.slice(1)
      );
    } else out.push(headLine({ ...s, borrowers: [] }), ...s.lines.slice(1));
  });
  return out.join('\n');
};
const 停 = x => (x = blockOf(x)) && !(isEnabled(x) && !L.errors[x.manifest.id]); // 船上有, 但禁用了或坏了
const 问来 = {}; // 按需问来的: 借用方跑起来才问得到
// 停用一块(或它坏了) = 导出一个没有它的 Colony: 借它的块跑那时导出件里自己的代码, 用导出的同一个「换」剪(真源头在跑的
// 改指它, 船上没有的照旧借), 按需用它自己问来的。剪不出来的照旧借, 原因记进 不, 一碰就报。回 {code, 不}
const 跑码 = b => {
  const id = b.manifest.id, eff = checkSegs(effectiveOf(b), id), 不 = {};
  return { 不, code: forRun(id, eff.segs.some(s => s.map && 停(s.map.block))
    ? parseSegs(换(joinSegs(eff), id, { has: x => !停(x) }, 问来, {}, 不).code) : eff) };
};
// 跑着的借用方照现在谁在跑、自己问来的按需再剪一遍, 不一样的才重开(源头又能用了, 剪出来就是借用行: 换回映射)。
// 开机后(按需要等借用方跑起来才问得到, 还有转着圈借的)、每次改块后各一遍
const 重剪 = async () => {
  const bs = L.factory.filter(b => L.inst[b.manifest.id]
    && effectiveOf(b).segs.some(s => s.map && blockOf(s.map.block)));
  Object.assign(问来, await 问(bs.filter(b => effectiveOf(b).segs.some(s => s.ask && 停(s.map?.block)))));
  const re = bs.filter(b => L.inst[b.manifest.id] && b._run !== 跑码(b).code);
  re.forEach(b => { dispose(b.manifest.id); tryRun(b); });
  if (re.length) emit('colony:blocks');
};
X({ segRef, forRun, SEG, 停, 跑码, 重剪 });

// ═ 改块 · 跟着: 装载, 能力树, 收养, 段值表, 段解析, 块接口 ═
// 全系统唯一写入口, 地图对齐、回滚、通知都收在这里。安全模式只读, 因为此时记录被忽略, 写会盖掉它
const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));
const 改版 = edited => ({ edited, active: 'edited' });
// 记一段: 和出厂一字不差就不算改过(删掉改版; 留作隐性的本来就没在用, 照留), 否则存成显性的改版
const 记 = (b, rec, s) => parsedOf(b).segs.some(f => f.name === s.name && segKey(f) === segKey(s))
  ? rec.segs[s.name]?.active === 'factory' || delete rec.segs[s.name] : rec.segs[s.name] = 改版(s.text);
const applyCode = (b, rec, code) => {
  code = norm(code);
  checkCode(code, b.manifest.id);
  const fp = parsedOf(b), np = checkSegs(parseSegs(code), b.manifest.id), segs = rec.segs,
    fnames = fp.segs.map(s => s.name), nnames = np.segs.map(s => s.name), pn = np.prologue.join('\n'),
    sameOrder = nnames.join('\u0001') === fnames.join('\u0001'), samePro = pn === fp.prologue.join('\n');
  np.segs.forEach(s => 记(b, rec, s));
  new Set(fnames.concat(Object.keys(segs))).forEach(n => {
    if (!nnames.includes(n)) fnames.includes(n) ? segs[n] = 改版('') : delete segs[n];
  });
  if (sameOrder && samePro) ['order', 'prologue', 'layoutActive'].forEach(k => delete rec[k]);
  else Object.assign(rec, { order: sameOrder ? undefined : nnames, prologue: samePro ? undefined : pn,
    layoutActive: 'edited' });
};
const 回 = (b, x) => { // 写完回的: 用着改版的段、删掉的段, 不带整块目录
  const e = effectiveOf(b), id = b.manifest.id;
  return Object.assign({ id, error: L.errors[id] || null, deleted: e.deleted,
    edited: e.segs.filter(s => s.use === 'edited').map(s => s.name) }, x);
};
const pushCopies = async (srcId, removed, oldEff) => { // 源头段没了 → 借用方自动得到一份复制并变显性
  for (const b of L.factory) {
    const id = b.manifest.id;
    if (id === srcId) continue;
    const rec = L.recs[id] || { segs: {} }, eff = effectiveOf(b), have = 有(eff),
      cut = eff.segs.filter(s => s.map?.block === srcId && removed.includes(s.map.name)
        && oldEff.segs.some(x => x.name === s.map.name));
    rec.segs = rec.segs || {};
    if (!cut.length) continue;
    copyOf(oldEff, srcId, cut.map(s => [s, s.map.name]), have).forEach((t, i) => {
      rec.segs[cut[i].name] = 改版(t);
    });
    L.recs[id] = rec;
    await L.store.set(recKey(id), rec);
    dispose(id);
    tryRun(b);
  }
};
const checkRev = a => {
  if (a.expected !== undefined && a.expected !== revOf(a.id)) fail(a.id + ' 在你读过之后被改过了, 请重新读一遍再改');
};
const EDIT = ['name', 'text', 'replace', 'active'];
const only = (o, ok, what) => { // 认不出的字段报出来, 并列出允许的
  const bad = Object.keys(o).filter(k => !ok.includes(k));
  if (bad.length) fail(what + bad.join(', ') + '。允许: ' + ok.join(', '));
};
const 开关 = (v, what) => v === 'edited' || v === 'factory' || fail(what + " 只能是 'edited' 或 'factory'");
const editsOf = a => {
  if (a.segment && a.edits) fail('segment 和 edits 只能给一个');
  return a.edits || (a.segment ? [a.segment] : []);
};
const applyEdits = (b, rec, edits, id) => { // 块和 Stem 共用。replace 只换对上的那一处: 模型整段重写会把旧内容带回来
  if (!Array.isArray(edits)) fail('edits 要是数组');
  edits.forEach(sg => {
    if (!sg || typeof sg.name !== 'string') fail('segment 要有 name');
    only(sg, EDIT, 'segment 里认不出: ');
    const cur = effective(parsedOf(b), rec).segs.find(s => s.name === sg.name);
    let text = sg.text;
    if (sg.replace !== undefined) {
      if (text !== undefined) fail('text(整段重写)和 replace(只换几处)只能给一个');
      text = (cur || fail('无此段: ' + sg.name)).text;
      [].concat(sg.replace).forEach(r => {
        if (!r || typeof r.old !== 'string' || !r.old || typeof r.new !== 'string')
          fail('replace 每项要 {old, new}, 都是字符串, old 不能空');
        const n = text.split(r.old).length - 1;
        if (n !== 1) fail(`段 ${sg.name} 里${n ? `有 ${n} 处` : '找不到'}「${r.old.slice(0, 40)}`
          + '」: old 要和原文一字不差, 且只对上一处');
        text = text.replace(r.old, () => r.new);
      });
    }
    if (typeof text === 'string') {
      text = norm(text);
      checkCode(text, id);
      const p = parseSegs(text);
      if (p.prologue.length || p.segs.length !== 1 || p.segs[0].name !== sg.name)
        fail('段文本必须以这段自己的段头开头, 且只含这一段: ' + sg.name);
      记(b, rec, p.segs[0]);
    } else if (text === null) {
      if (!rec.segs[sg.name] && !parsedOf(b).segs.some(s => s.name === sg.name)) fail('无此段: ' + sg.name);
      rec.segs[sg.name] = 改版('');
    }
    if (sg.active !== undefined && 开关(sg.active, 'segment.active'))
      (rec.segs[sg.name] || fail(`段 ${sg.name} 没有改版, 无从切换`)).active = sg.active;
  });
};
const WRITES = ['code', 'enabled', 'segment', 'edits', 'remove', 'hidden'],
  FIELDS = ['id', 'active', 'preview', 'expected'].concat(WRITES);
const setBlockNow = async a => {
  only(a, FIELDS, '认不出的字段: ');
  const id = a.id || fail('缺 id');
  if (id === 'stem') return setStem(a);
  if (!WRITES.some(k => a[k] !== undefined)) fail(`没有要改的内容: 给 ${WRITES.join(' / ')} 之一`);
  const b = 块(id);
  checkRev(a);
  if (a.hidden !== undefined && !a.preview) {
    const inst = L.inst[id];
    if (inst && inst.ctx.root) inst.ctx.root.style.display = a.hidden ? 'none' : '';
    if (Object.keys(a).length === 2) {
      emit('colony:blocks');
      return 回(b);
    }
  }
  if (L.safe) fail('安全模式只读, 改块无效(去掉 ?safe=1 或修好改版 Stem 后重载)');
  const oldEff = effectiveOf(b), on0 = isEnabled(b);
  if (a.remove) {
    if (!b.adopted) fail('只有收养块能移除; 出厂块用 enabled:false 禁用');
    if (a.preview) return { id, preview: true, removed: true };
    dispose(id);
    delete L.recs[id];
    await L.store.del(recKey(id));
    L.factory = L.factory.filter(x => x !== b);
    delete L.errors[id];
    await pushCopies(id, oldEff.segs.filter(s => !s.map).map(s => s.name), oldEff);
    emit('colony:blocks');
    return { id, removed: true };
  }
  const prev = clone(L.recs[id]), rec = clone(L.recs[id]) || { segs: {} };
  rec.segs = rec.segs || {};
  if (a.code === null) {
    Object.values(rec.segs).forEach(s => { s.active = 'factory'; });
    if (rec.order !== undefined || rec.prologue !== undefined) rec.layoutActive = 'factory';
  } else if (typeof a.code === 'string') applyCode(b, rec, a.code);
  else if (a.code !== undefined) fail('code 只能是字符串(整块改写)或 null(恢复出厂)');
  applyEdits(b, rec, editsOf(a), id);
  if (a.enabled !== undefined) rec.enabled = !!a.enabled;
  const eff = effective(parsedOf(b), rec), run = forRun(id, lay(checkSegs(eff, id), id).p), // 范围写坏的不存
    revision = revOf(id), on1 = rec.enabled === undefined ? on0 : rec.enabled,
    changed = JSON.stringify(prev || { segs: {} }) !== JSON.stringify(rec),
    restart = run !== forRun(id, oldEff) || on0 !== on1 || (on1 && !L.inst[id]); // 该跑却没在跑也重装
  checkCode(run, id);
  syntax(run, '没有改动: 新版本', 块参); // 语法不过就不动正在跑的那份
  if (a.preview) return Object.assign({ id, preview: true, revision, changed, restart },
    await 预览(oldEff, eff));
  if (!changed && !restart) return 回(b, { revision, changed, restarted: false });
  L.recs[id] = rec;
  const was = !!L.inst[id];
  if (restart) {
    dispose(id);
    try {
      instantiate(b); // 禁用的块它自己会记"已禁用"然后返回
    } catch (e) {
      if (prev) L.recs[id] = prev;
      else delete L.recs[id];
      dispose(id);
      let back = '';
      if (was || !isEnabled(b)) try { instantiate(b); } catch (e2) { back = '; 回滚旧版也失败: ' + e2.message; }
      fail('新版本初始化失败, 已回滚: ' + e.message + back);
    }
  }
  if (!on0 && on1) await 认亲([id]); // 刚启用 = 导回它: 别的块里源自它的复制换回借用行(它们重开)
  await L.store.set(recKey(id), rec);
  const removed = oldEff.segs.filter(s => !s.map && !eff.segs.some(n => n.name === s.name)).map(s => s.name);
  if (removed.length) await pushCopies(id, removed, oldEff);
  emit('colony:blocks');
  return 回(b, { revision: revOf(id), changed, restarted: restart });
};
const QUEUE = {};
const setBlock = a => { // 同一块的写入排队, 基线号排到了才核对; 预览不写, 不排
  a = a || {};
  if (a.preview) return setBlockNow(a);
  return QUEUE[a.id] = (QUEUE[a.id] || Promise.resolve()).catch(() => { }).then(() => setBlockNow(a))
    .finally(重剪); // 写完照现在谁在跑重剪借用方: 源头可能停了、又能用了
};
const setStem = async a => { // Stem 的双倍体是整段文本, 因为酶自己还没起来时启动器只能拿文本; 改完要重载
  if (!LS) fail('此环境没有 localStorage, 不能改 Stem');
  checkRev(a);
  const K = BOOT.key, edits = editsOf(a);
  let edited = stemEdited(), use = stemUse();
  if (a.code === undefined && a.active === undefined && !edits.length)
    fail('改 Stem 要给 code(字符串或 null)、segment / edits 或 active');
  if (a.code === null) use = 'factory';
  else if (typeof a.code === 'string') [edited, use] = [a.code, 'edited'];
  else if (a.code !== undefined) fail('code 只能是字符串或 null');
  if (edits.length) { // 在正在用的那份上改这几段, 再拼回整段文本
    const b = stemBlock(), rec = { segs: {} };
    applyEdits(b, rec, edits, 'stem');
    [edited, use] = [joinSegs(effective(parsedOf(b), rec)), 'edited'];
  }
  if (a.active !== undefined && 开关(a.active, 'active')) {
    if (a.active === 'edited' && !edited) fail('Stem 没有改版, 无从切换');
    use = a.active;
  }
  if (norm(edited) === norm(L.stemFactory)) [edited, use] = ['', 'factory'];
  if (use === 'edited') {
    checkCode(edited, 'stem');
    lay(parseSegs(edited), 'stem');
    syntax(edited, '没有保存: 改版 Stem'); // 存了坏的要连崩三次才退回原版
  }
  const changed = edited !== stemEdited() || use !== stemUse();
  if (a.preview) return Object.assign({ id: 'stem', preview: true, revision: revOf('stem'), changed },
    await 预览(parseSegs(stemTextNow()), parseSegs(use === 'edited' ? edited : L.stemFactory)));
  if (edited !== stemEdited()) LS.setItem(K + '.edited', edited);
  LS.setItem(K + '.use', use);
  return { id: 'stem', needReload: changed, use, hasEdit: !!edited, changed, revision: revOf('stem') };
};
const 字节 = s => new TextEncoder().encode(s || '').length;
const 预览 = async (A, B) => { // 逐段的改动和字节差; 逐行对比归代码解读块(code.diff), 它在才带上
  const list = e => [{ name: '(前言)', text: e.prologue.join('\n') }].concat(e.segs), a = list(A), b = list(B),
    文 = (xs, n) => xs.find(s => s.name === n)?.text || '', changes = [];
  for (const name of new Set(a.concat(b).map(s => s.name))) {
    const before = 文(a, name), after = 文(b, name);
    if (before !== after) changes.push(Object.assign({ name, bytes: 字节(after) - 字节(before) },
      has('code.diff') ? await call('code.diff', { before, after, context: 3 }) : {}));
  }
  return { changes, bytes: changes.reduce((n, c) => n + c.bytes, 0) };
};
P('stem.setBlock', setBlock,
  '唯一写入口。回 changed(变了没) / restarted(重启了没) / revision(新基线号); edited / deleted 是和出厂版比', {
    id: 'string', code: 'string|null?(整块改写; null = 恢复出厂)', enabled: 'boolean?',
    segment: '{name, text?: string|null, replace?: [{old, new}], active?: edited|factory}?(replace 只换段里'
      + '和 old 一字不差的那一处, 比整段重写稳; text 整段重写, null 删段)',
    edits: '[{name, text?, replace?, active?}]?(一次改几段, 全成或全不动)',
    preview: 'boolean?(只回每段的改动, 有代码解读块才带逐行对比; 不写不重启)',
    expected: 'string?(读到的 revision; 对不上就拒绝)', remove: 'boolean?', hidden: 'boolean?',
    active: 'edited|factory?(仅 id=stem)'
  }, false);
X({ setBlock, setStem, applyCode });
// ═ 收养 · 跟着: 改块, 装载, 段解析, 导出, 能力树 ═
// 未知 id 零执行落库、默认禁用; 已知 id 导入版上岗、原来的退成隐性。复制用「换」换回借用行, 换不回的保留
const 在场 = ids => new Set(L.factory.filter(b => isEnabled(b) && (!ids || ids.includes(b.manifest.id)))
  .map(b => b.manifest.id));
// 空的「单独时不带」占位按头上的号从这边那块找回同号的那一处, 连头带内容填上; 两边别处、先后、内容改没改过都不管;
// 这边没有这个号的算少了, 说号。导进来的范围写坏了在这就报, 不收; 这边的只拿来找, 用宽的排法(写坏了的旧记录也能被好文件换掉)
const 补 = (code, old) => {
  const L = lay(parseSegs(code), ''), O = lay(parseSegs(old ?? ''), '', 1), at = {}, 缺 = [];
  Object.entries(L.处).forEach(([n, i]) => {
    const j = O.处[n];
    if (L.pair[i] !== i + 1) return;   // 导进来的这处有内容: 照它的
    if (O.pair[j] > j) at[i] = O.lines.slice(j, O.pair[j]);
    else 缺.push(n);
  });
  return { code: L.lines.flatMap((l, i) => at[i] || [l]).join('\n'), 缺 };
};
// 换回的复制存成隐性改版; 和出厂一样的、出厂没有这段的不存
const 隐了 = (b, 隐) => 隐.filter(x => parsedOf(b).segs.some(f => f.name === x.name
  && segKey(f) !== segKey(parseSegs(x.text).segs[0])));
// 反过来认亲: 别的块里源自这几块的复制也换回借用行
const 认亲 = async ids => {
  const out = [];
  for (const b of L.factory.slice()) {
    const id = b.manifest.id, e = effectiveOf(b), code = joinSegs(e), r = !ids.includes(id)
      && e.segs.some(s => s.from && ids.includes(s.from.block)) && 换(code, id, 在场(ids), null);
    if (!r || r.code === code) continue;
    await setBlock({ id, code: r.code, edits: 隐了(b, r.隐) });
    out.push({ id, result: '源自 ' + ids + ' 的复制换回了借用行, 复制留作隐性改版' });
  }
  return out;
};
const adopt = async a => {
  const text = a && a.text;
  if (typeof text !== 'string') fail('adopt 要 {text: 文件内容}');
  const out = [], bs = findBlockTags(text, (e, id) => out.push({ id, result: '✗ 无法解析: ' + e.message }));
  if (!bs.length && !out.length) fail('未发现 Petri 块(需要 colony/petri 标签)');
  for (const b of bs) {
    const id = b.manifest.id, old = blockOf(id);
    try {
      checkCode(b.code, id);
      checkSegs(parseSegs(b.code), id);
      const 前 = old && joinSegs(effectiveOf(old)), f = 补(b.code, 前), r = 换(f.code, id, 在场(), null),
        note = (r.隐.length ? '; ' + r.隐.length + ' 段复制换回了借用行, 复制留作隐性改版' : '')
          + (r.留.length ? '; 段 ' + r.留.map(([s, w]) => s.name + '(' + w + ')').join('、') + ' 保留复制' : '')
          + (f.缺.length ? '; 少了 ' + f.缺.length + ' 处只在 Colony 里用的代码(' + f.缺.join('、')
            + '), 要完整的请导出带 Stem 的一代' : '');
      if (old) { // 变没变看有效代码
        const pr = L.recs[id],
          hadEdit = !!(pr && pr.segs && Object.values(pr.segs).some(s => s.edited));
        await setBlock({ id, code: r.code, edits: 隐了(old, r.隐) });
        out.push({
          id,
          result: (joinSegs(effectiveOf(old)) !== 前
            ? (hadEdit ? '已导入为显性(原改版已被替换, 出厂原版仍为隐性)' : '已导入为显性(原来的退为隐性)')
            : '与现有一致, 未变') + note
        });
      } else {
        const rec = { adopted: blockText(b.manifest, r.code), enabled: false, segs: {} };
        r.隐.forEach(x => { rec.segs[x.name] = { edited: x.text, active: 'factory' }; });
        L.recs[id] = rec;
        await L.store.set(recKey(id), rec);
        L.factory.push({ manifest: b.manifest, code: norm(r.code), adopted: true });
        L.errors[id] = '已收养(禁用)';
        out.push({ id, result: '已收养(禁用, 启用后上岗)' + note });
      }
    } catch (e) {
      out.push({ id, result: '✗ 导入失败: ' + e.message });
    }
  }
  out.push(...await 认亲(bs.map(b => b.manifest.id)));
  emit('colony:blocks');
  return out;
};
P('stem.adopt', a => adopt(a), '导入 Petri: 未知 id 收养禁用, 已知 id 导入为显性', { text: 'string' }, false);
X({ adopt, 补 });
// ═ 导出 · 跟着: 装载, 段解析, 段值表, 能力树, 块接口, 改块 ═
// 导出: 给一张名单(Stem 也是一员), 只带显性。外层: 每块(连 Stem)过「换」和门禁; 里层「换段」照原文拼新文件
const 源 = id => id === 'stem' ? parseSegs(stemTextNow()) : blockOf(id) && effectiveOf(blockOf(id)),
  真 = (o, 在) => { // 往上找真源头, 最多 9 层
    for (let n = 9, t; n-- && !在(o.block) && (t = 源(o.block)?.segs.find(x => x.name === o.name))?.map;)
      o = t.map;
    return o;
  };
// 换: 导出时真源头在场(在场.has, Stem 总在)就改指, 不在就同源几行合剪一份; 导回(带 = null)时对得上的复制整组换回
// 借用行。不: 见 copyOf
const 换 = (code, id, 在场, 带, 号 = {}, 不) => {
  const p = parseSegs(code), have = 有(p), 组 = {}, 隐 = [], 留 = [], 回 = 带 === null,
    在 = x => x === 'stem' || 在场.has(x),
    映 = (s, o) => [headLine({ ...blank(s.name), map: o, v: o.v, want: s.want, ask: s.ask })],
    由 = (s, o, q = 源(o.block)) => !q ? '源头不在' : !在(o.block) ? '源头已禁用'
      : !q.segs.some(x => x.name === o.name) && !Object.hasOwn(lay(q, o.block, 1).need, o.name) ? '源头没这名字了'
      : s.name !== o.name ? '名字和源头的不同' : !s.sum ? '老格式, 请从新版重新导出'
      : 纹(bodyOf(s)) !== s.sum ? '改过, 已分叉' : '';
  p.segs.forEach(s => {
    const o = 回 ? s.from : s.map, t = o && o.block !== id && 真(o, 回 ? () => 0 : 在);
    if (!t) return;
    if (回 && s.map) { if (在(o.block)) s.lines = 映(s, o); }
    else if (回 || !在(t.block)) (组[t.block] ||= []).push([s, 回 ? 由(s, o) : t.name]);
    else if (t !== o) s.lines = [headLine({ ...s, map: t, from: s.from || { v: s.v, ...o } })];
  });
  Object.entries(组).forEach(([k, g]) => {
    if (!回) {
      const se = 源(k) || fail('导出 ' + id + ': 借的 ' + k + '/' + g[0][1] + ' 在本 Colony 里不存在, 无法复制');
      g.forEach(([s]) => { s.got = 带[id + '/' + s.name] || []; });
      copyOf(se, k, g, have, 号[id + '/' + g[0][0].name] = [], 不)
        ?.forEach((t, i) => { g[i][0].lines = t.split('\n'); });
    } else if (g.some(x => x[1])) g.forEach(([s, w]) => 留.push([s, w || '同组有别的换不回']));
    else g.forEach(([s]) => {
      隐.push({ name: s.name, text: s.text, active: 'factory' });
      s.lines = 映(s, s.from);
    });
  });
  return { code: joinSegs(p), 隐, 留 };
};
const 剪 = (code, solo) => solo ? cutCode(code, null) : code; // 单独导出时块和启动器去掉「单独时不带」圈的; 门禁照这个比
const exportBlocks = (sel, 在场, 带, solo, st = '', 号) => { // 借用者按导出后的映射重写
  const by = {}, out = sel.map(b => {
    const code = 换(joinSegs(effectiveOf(b)), b.manifest.id, 在场, 带 || {}, 号).code;
    return { manifest: b.manifest, code: 剪(code, solo), disabled: !isEnabled(b) };
  });
  [{ manifest: { id: 'stem' }, code: st }].concat(out).forEach(e => parseSegs(e.code).segs.forEach(s => {
    if (s.map) (by[s.map.block + '/' + s.map.name] ||= []).push(e.manifest.id);
  }));
  out.forEach(e => {
    const p = parseSegs(e.code);
    p.segs.forEach(s => s.map || (s.lines[0] = headLine(Object.assign({}, s,
      { borrowers: (by[e.manifest.id + '/' + s.name] || []).sort() }))));
    e.code = joinSegs(p);
  });
  return out;
};
// ✂ 换段
// 里层: 照开机时记下的原文拼新文件, swap {id, name, text} 换掉一块的一段
const 拼 = (stemText, blocks, swap, head = L.head, 启 = L.launcher) => {
  blocks = blocks.map(b => {
    const p = swap?.id === b.manifest.id && parseSegs(b.code),
      s = p && p.segs.find(x => x.name === swap.name), h = s && mark(String(swap.text).split('\n')[0]);
    if (!s) return b;
    if (!h || h.cut || h.name !== s.name) fail('swap.text 第一行得是「' + s.name + '」的段头');
    s.lines = [swap.text];
    return Object.assign({}, b, { code: joinSegs(p) });
  });
  const lin = { id: '', parent: BOOT.id,
      blocks: blocks.map(b => ({ id: b.manifest.id, version: b.manifest.version || 0 })) },
    body = raw => buildHtml(head, raw, stemText, 启, blocks);
  lin.id = hash(body(''));
  return body(JSON.stringify(lin));
};
const buildHtml = (head, lineageRaw, stemText, launcher, blocks) => [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  head,
  '<body>',
  '<!--COLONY-LINEAGE ' + lineageRaw + '-->',
  '<div id="colony-root"></div>',
  '<' + SCR + ' id="stem" type="colony/stem">' + stemText + '</' + SCR + '>',
  '<' + SCR + ' id="stem-launcher">' + launcher + '</' + SCR + '>'
].concat(blocks.map(b => blockTag(b.manifest, b.code, b.disabled || b.tagDisabled)), ['</body>', '</html>'])
  .join('\n');
// 单独文件里 stem.molt 只照原样再拼(换掉 swap 那段); 整份 Stem 里下面「导出」的盖掉它
provide('stem.molt', a => 拼(L.stemFactory, L.factory, a.swap), { frames: false }, 'stem');
// ✂ 换段 完
const parts = html => {
  const grab = (re, what) => {
    const m = re.exec(html);
    if (!m) fail('文件里找不到 ' + what);
    return m[1];
  };
  return {
    head: grab(/(<head>[\s\S]*?<\/head>)/, '<head>'),
    lineageRaw: grab(/<!--COLONY-LINEAGE ([\s\S]*?)-->/, '血统'),
    stemText: grab(
      new RegExp('<' + SCR + ' id="stem" type="colony/stem">([\\s\\S]*?)</' + SCR + '>'),
      'Stem'
    ),
    launcher: grab(new RegExp('<' + SCR + ' id="stem-launcher">([\\s\\S]*?)</' + SCR + '>'), '启动器'),
    blocks: findBlockTags(html)
  };
};
const gates = (html, swap, solo) => { // solo 见 molt
  const errs = [], p = parts(html), ids = new Set(), dup = new Set(), 名 = {},
    认 = (id, code) => { // 能借的 = 段名和范围名; 语法不过、撞名都在这报
      try {
        const q = checkSegs(parseSegs(code), id);
        名[id] = new Set(q.segs.map(s => s.name).concat(Object.keys(lay(q).need)));
        try { new Function(...(id === 'stem' ? [] : 块参), code); } catch (e) {
          const n = 重名(e), 参 = id !== 'stem' && 块参错(e);
          errs.push(id + (参 ? ': ' + 参 : n ? ': 剪进来的代码和它自己的撞名「' + n + '」, 请改掉一边' : ' 有语法错误: ' + e.message));
        }
        return q;
      } catch (e) {
        errs.push(id + ': ' + e.message);
      }
    };
  if (buildHtml(p.head, p.lineageRaw, p.stemText, p.launcher, p.blocks) !== html)
    errs.push('拆开再拼回不一致: 文件里有拼装规则之外的内容');
  [['stem', 认('stem', p.stemText)]].concat(p.blocks.map(b => {
    const id = b.manifest.id;
    if (ids.has(id)) dup.add(id);
    ids.add(id);
    return [id, 认(id, b.code)];
  })).forEach(([id, q]) => (q ? q.segs : []).forEach(s => {
    if (!s.map) return;
    const at = id + ' 借 ' + s.map.block + '/' + s.map.name;
    if (!名[s.map.block]) errs.push('悬空映射: ' + at + ', 但文件里没有 ' + s.map.block);
    else if (!名[s.map.block].has(s.map.name)) errs.push('悬空映射: ' + at + ', 但它没有这段或范围');
    if (!isIdent(s.name)) errs.push('映射段名不合法: ' + id + '/' + s.name);
    if (s.ask && !名[id].has(s.ask.split('.')[0])) errs.push('按需写错: ' + at + ' · 按需: ' + s.ask + ', 它没有这段或范围');
    if (s.lines.slice(1).some(l => l.trim())) errs.push('映射段只能有那一行, 后面不能跟代码: ' + id + '/' + s.name);
  }));
  dup.forEach(d => errs.push('块 id 重复: ' + d));
  p.blocks.forEach(b => { // 开关切到哪份, 导出里就得有哪份的正文(和导出一样剪过再比)
    const id = b.manifest.id, rec = L.recs[id], ob = blockOf(id);
    if (!rec || !ob || !rec.segs || L.safe) return;
    const fps = parseSegs(剪(joinSegs(effectiveOf(ob)), solo)).segs;
    Object.keys(rec.segs).forEach(n => {
      const f = swap?.id === id && swap.name === n ? null : fps.find(s => s.name === n);
      if (f && !b.code.includes(norm(bodyOf(f))))
        errs.push('开关说用' + (rec.segs[n].active === 'edited' ? '改版' : '原版') + ', 导出的却不是: ' + id + '/' + n);
    });
  });
  const lin = JSON.parse(p.lineageRaw), linIds = (lin.blocks || []).map(x => x.id).sort().join(),
    tagIds = [...ids].sort().join();
  if (linIds !== tagIds) errs.push('块清单与血统不一致: 血统 [' + linIds + '] 文件 [' + tagIds + ']');
  if (errs.length) fail('门禁未过:\n' + errs.join('\n'));
  return true;
};
const molt = a => { // ids: 名单上的块(不给 = 启用着的); stem: false = 名单里没有 Stem; swap 见拼; 带 见换; 号 见下
  const { ids, swap, 带 = {} } = a || {}, solo = a?.stem === false, 号 = {};
  (ids || []).forEach(i => blockOf(i) || fail('无此块: ' + i));
  const sel = L.factory.filter(b => ids ? ids.includes(b.manifest.id) : isEnabled(b)),
    在场 = new Set(solo ? [] : sel.map(b => b.manifest.id)), // 没有 Stem 就没有借用的机关, 块之间借的也带成复制
    门 = (st, bs, n) => { // n: 标签页标题
      const h = 拼(st, bs, swap, n ? L.head.replace(/<title>[^<]*/, () => '<title>' + n.replace(/[<&]/g, ''))
        : L.head, 剪(L.launcher, solo));
      gates(h, swap, solo);
      return h;
    };
  if (!solo) {
    const st = 换(stemTextNow(), 'stem', 在场, 带).code;
    return 门(st, exportBlocks(sel, 在场, 带, false, st), !sel.length && 'Stem');
  }
  const bs = exportBlocks(sel, 在场, 带, true, '', 号), want = new Set();
  bs.forEach(e => parseSegs(e.code).segs.forEach(s => {
    if (s.map && s.map.block === 'stem') [s.map.name].concat(s.want).forEach(n => want.add(n));
  }));
  if (!want.size) fail('名单里没有 Stem, 块也没借 Stem 的代码, 这样的文件打开跑不起来。在块里加一行: // ↦ 借 stem 的 跑块');
  const stem = 换(cutCode(stemTextNow(), [...want], 'Stem', 号.stem = []), 'stem', 在场, 带).code;
  syntax(stem, 'Stem 只留 [' + [...want] + '] 剪出来的那份');
  bs.forEach(x => { x.disabled = false; }); // 没有 Stem 就没有面板去点启用, 块必须是启用的, 不然打开是空页
  const h = 门(stem, bs, bs.map(b => b.manifest.name || b.manifest.id).join(' + '));
  return a.号 ? { html: h, 号 } : h;
};
// 「按需: 段.项」从借用方自己的段值表取, 函数就调用、Promise 就等; 没在跑的当空。没这项、问出错的那一行回错, 导出报它
const 问 = async bs => {
  const 带 = {};
  for (const b of bs) for (const s of effectiveOf(b).segs) {
    const id = b.manifest.id, [d, n] = (s.ask || '').split('.');
    if (s.map && s.ask && L.inst[id]) 带[id + '/' + s.name] = await Promise.resolve().then(() => {
      const v = SEG[id + '/' + d];
      if (v == null || !(n in Object(v))) fail(id + ' 没有 ' + s.ask);
      return typeof v[n] === 'function' ? v[n]() : v[n];
    }).then(x => [].concat(x || []), e => new Error('按需 ' + id + '/' + s.ask + ': ' + e.message));
  }
  return 带;
};
// 假如: 当这块已经照 edits(同 setBlock)改了再导出, 导完换回(剪切工具写之前试借用方)
P('stem.molt', async a => {
  const 带 = await 问(L.factory), x = a.假如, 原 = x && L.recs[x.id];
  if (x) {
    const rec = clone(原) || { segs: {} };
    rec.segs ||= {};
    applyEdits(块(x.id), rec, x.edits, x.id);
    L.recs[x.id] = rec;
  }
  try {
    return molt(Object.assign({}, a, { 带 }));
  } finally {
    if (x) 原 ? L.recs[x.id] = 原 : delete L.recs[x.id];
  }
}, '导出: 给一张名单, 返回 HTML, 门禁不过则报错。stem: false = 名单里没有 Stem, 只带名单上的块借的那几个 Stem 范围', {
  ids: 'string[]?(不给 = 启用着的块)',
  stem: 'boolean?',
  swap: '{id, name, text}?(这一块的这一段在导出件里换成 text, 本机什么都不动)',
  号: 'boolean?(stem: false 时回 {html, 号}: 号[块/借的段]、号.stem: 剪进来的是源头第几行)',
  假如: '{id, edits}?(当这块已经照 edits 改了再导出, 本机什么都不动)'
}, false);
X({ 换, 拼, exportBlocks, buildHtml, parts, gates, molt, 问 });
// ═ 协议 · 跟着: 基础 ═
// 宿主和 iframe 跑同一段代码, 流式因此天然双向。
// 消息: 请求 {seq,path,args} / 分片 {seq,chunk} / 结束 {seq,done,result|error} / 握手 {hello}
// ✂ 隔离窗 · 要: 跑块
function peer(chan, post, onCall, onHello) {
  let seq = 0, disposed = false;
  const wait = {}, end = (s, o) => post(Object.assign({ __colony: chan, seq: s, done: true }, o));
  const call = (path, args, onChunk) => new Promise((res, rej) => {
    if (disposed) return rej(new Error('实例已卸载'));
    const s = ++seq;
    wait[s] = { res, rej, onChunk };
    try {
      post({ __colony: chan, seq: s, path, args: args ?? {}, stream: !!onChunk });
    } catch (e) {
      delete wait[s];
      rej(e);
    }
  });
  const recv = async d => {
    if (!d || d.__colony !== chan || disposed) return;
    if (d.hello) return onHello && onHello();
    if (d.path) {
      try {
        let r = await onCall(d.path, d.args);
        if (r && typeof r[Symbol.asyncIterator] === 'function') {
          const it = r[Symbol.asyncIterator]();
          for (; ;) {
            if (disposed) {
              try { await it.return(); } catch (_) { }
              return end(d.seq, { error: '实例已卸载, 流已取消' });
            }
            const n = await it.next();
            if (n.done) { r = n.value; break; }
            post({ __colony: chan, seq: d.seq, chunk: n.value });
          }
        }
        end(d.seq, { result: r ?? null });
      } catch (e) {
        try { end(d.seq, { error: e?.message || String(e) }); } catch (_) { }
      }
      return;
    }
    const w = wait[d.seq];
    if (!w) return;
    if (!d.done) return w.onChunk && w.onChunk(d.chunk);
    delete wait[d.seq];
    if (d.error) w.rej(new Error(d.error)); else w.res(d.result);
  };
  return {
    call, recv, hello: () => post({ __colony: chan, hello: true }),
    dispose: () => {
      disposed = true;
      Object.keys(wait).forEach(s => { wait[s].rej(new Error('实例已卸载')); delete wait[s]; });
    }
  };
}
// 窗里那一头: 照 peer 收发; colony.某.某(参数) 就是 call('某.某', 参数)。整个函数连同 peer 按原文注进窗里
function glue(chan, context) {
  const exposed = {}, p = peer(chan, m => parent.postMessage(m, '*'), (path, args) => {
      const f = exposed[path];
      if (!f) throw new Error('miniapp 未暴露: ' + path);
      return f(args);
    }), call = (path, args, onChunk) => p.call(path, args, onChunk), go = () => p.hello(),
    no = k => typeof k !== 'string' || k === 'then' || k === 'toJSON';
  window.addEventListener('message', e => { if (e.source === parent) p.recv(e.data); });
  window.colony = new Proxy({ call, callStream: call, expose: (n, f) => { exposed[n] = f; }, context }, {
    get: (t, ns) => no(ns) || ns in t ? t[ns] : new Proxy({}, {
      get: (_, m) => no(m) || m === 'toString' || m === 'valueOf' ? undefined
        : (a, c) => call(ns + '.' + m, a, c)
    })
  });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', go); else go();
  window.dispatchEvent(new Event('colony:ready'));
}
const iframeGlue = (chan, context) => `(function(){${peer};(${glue})(${JSON.stringify(chan)},`
  + `${JSON.stringify(context || {}).replace(/</g, '\\u003c')})})();`;
// ✂ 隔离窗 完
X({ peer, iframeGlue });

// ═ 隔离窗 · 跟着: 协议, 能力树 ═
// 权限增量归调用方, 同源也是(stem.mount 不接隔离窗的调用, 应用给不了自己); 挂载收到握手才算就绪(握手在正文解析完才发,
// 所以就绪 = 能看能点); iframe 元素本身就是登记表, 不另存
// ✂ 隔离窗
const mount = async opts => {
  const f = doc.createElement('iframe'), chan = 'c' + Math.random().toString(36).slice(2, 9),
    context = opts.context || {}, attrs = {}, ms = opts.timeout || 5000;
  Object.keys(opts.attrs || {}).forEach(k => { attrs[k.toLowerCase()] = opts.attrs[k]; });
  f.setAttribute('sandbox', [...new Set(['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups',
    'allow-downloads'].concat(String(attrs.sandbox || '').split(/\s+/)))].filter(Boolean).join(' '));
  Object.keys(attrs).forEach(k => { if (k !== 'sandbox') f.setAttribute(k, String(attrs[k])); });
  f.dataset.colonyApp = chan;
  if (context.miniappId) f.dataset.miniapp = context.miniappId;
  f.style.cssText = opts.hidden ? 'display:none' : 'border:0;width:100%;height:100%';
  let ready = false, done;
  const p = peer(chan, m => { if (f.contentWindow) f.contentWindow.postMessage(m, '*'); },
      (path, args) => call(path, args, { frame: f, context }), () => { ready = true; if (done) done(); }),
    onMsg = e => { if (e.source === f.contentWindow) p.recv(e.data); };
  g.addEventListener('message', onMsg);
  f.colony = { call: p.call, context, destroy: () => {
    g.removeEventListener('message', onMsg);
    p.dispose();
    f.remove();
  } };
  const extra = has('frame.inject') ? String(await call('frame.inject', { context })) : '',
    script = `<${SCR}>${iframeGlue(chan, context)}${extra}</${SCR}>`,
    html = String(opts.code); // 注入脚本放在 doctype 或 <head> 后面, 没有就放最前, 保证它先于页面脚本跑
  f.srcdoc = /^\s*<!doctype|<head[\s>]/i.test(html)
    ? html.replace(/^\s*<!doctype[^>]*>|<head(\s[^>]*)?>/i, m => m + script) : script + html;
  (opts.host || doc.body).appendChild(f);
  await new Promise((res, rej) => {
    done = res;
    setTimeout(() => ready || rej(Object.assign(new Error('miniapp 未就绪(' + ms / 1000
      + 's 内没有握手): 它的脚本可能在注入代码之前就出错了'), { frame: f })), ms);
  });
  return f;
};
// 挂能力这一行也圈进范围: 单独打开的块(比如界面块)借了隔离窗, 照样能开应用窗
provide('stem.mount', a => mount(a), { desc: '在隔离窗里跑一段 HTML, 握手后返回 iframe', frames: false, schema: {
  code: 'string', host: 'Element?', hidden: 'boolean?', attrs: 'object?', context: 'object?',
  timeout: 'number?' } }, 'stem');
// ✂ 隔离窗 完
const apps = () => doc ? [...doc.querySelectorAll('iframe[data-colony-app]')] : [];
const frames = () => apps().map(f => ({ frame: f.dataset.colonyApp, miniappId: f.dataset.miniapp || null,
  alive: f.isConnected, context: f.colony?.context || {} }));
const frameOf = id => apps().find(f => f.dataset.colonyApp === id)
  || apps().filter(f => f.dataset.miniapp === id).pop() || null;
const 帧 = a => frameOf(a.frame) || fail(`无此运行帧: ${a.frame}(用 stem.frames 里的 frame 或 miniappId)`);
P('stem.unmount', a => { 帧(a).colony.destroy(); return true; }, '销毁隔离窗', { frame: 'string' }, false);
P('stem.frames', frames, '活着的隔离窗', {}, false);
P('stem.invoke', a => 帧(a).colony.call(a.path, a.args), '反向调用 iframe 暴露的能力',
  { frame: 'string', path: 'string', args: 'object?' }, false);
X({ mount, frames, frameOf });

// ═ 裸壳页 · 跟着: 装载 ═
// 没有界面块(没人提供 ui.host)时的兜底面板: 只走能力树, 和块一样听事件; 界面块的 ⚙ 用 stem.panel 把它请进一个窗
// 面板的样式跟着面板走, 画面板时才放进页面; head 里只留页面底色和横幅
const PANEL_CSS = [
  '.k-panel{max-width:720px;margin:48px auto;padding:0 20px}',
  '.k-panel.in{margin:0 auto;padding:16px 20px}',
  '.k-panel h1{font-size:20px;margin:0 0 4px}',
  '.k-sub{color:#8a8a8a;font-size:12px;margin-bottom:24px}',
  '.k-block{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 14px;' +
    'border:1px solid rgba(255,255,255,.09);border-radius:10px;margin-bottom:10px;font-size:13px}',
  '.k-block .nm{font-weight:600}',
  '.k-block .meta{color:#8a8a8a;font-size:11px}',
  '.k-block .sp{flex:1}',
  '.k-tag{font-size:10px;padding:2px 7px;border-radius:4px;' +
    'background:rgba(181,255,0,.12);color:#B5FF00}',
  '.k-tag.warn{background:rgba(245,166,35,.12);color:#f5a623}',
  '.k-tag.err{background:rgba(255,87,87,.12);color:#ff5757}',
  '.k-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#fafafa;' +
    'border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap}',
  '.k-btn:hover{border-color:#B5FF00;color:#B5FF00}',
  '.k-btn:disabled{opacity:.35;cursor:not-allowed;border-color:rgba(255,255,255,.12);color:#fafafa}',
  '.k-acts{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}',
  '.k-msg{margin-top:14px;font-size:12px;color:#8a8a8a;white-space:pre-wrap}',
  '.k-msg.err{color:#ff5757}'
].join('');
const hasUi = () => has('ui.host');
const hasPage = id => { // 这块在页面上画了东西(有界面): 空的根藏了也看不出
  const r = doc && doc.querySelector('#colony-root > [data-block-id="' + id + '"]');
  return !!(r && r.childElementCount);
};
const btn = (act, id, text, off, title) =>
  '<button class="k-btn" data-act="' + act + '" data-id="' + esc(id) + '"' + (off ? ' disabled' : '') +
  (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</button>';
const tag = (cls, text) => '<span class="k-tag' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>';
const PANEL = {
  el: null,
  host: null,   // 界面块给的窗: 有就画在里面, 没有就只在没界面块时铺满页面
  collapsed: false,
  msg: '',
  msgErr: false,
  armed: 0,   // 「清空」点过第一下的时刻, 6 秒内再点才真做
  armedUi: 0,   // 禁用界面块也一样: 整个桌面会关掉
  download(name, content) {
    const u = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' })),
      a = doc.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 800);
  },
  say(text, err) {
    this.msg = text;
    this.msgErr = !!err;
    this.render();
  },
  async wipe() { // 恢复纯净: 卸掉全部块, 键值库清空(块的改版和收养、会话、设置、Key 全没), Stem 切回原版, 重新打开
    Object.keys(L.inst).forEach(dispose);
    await L.store.clear();
    ['.edited', '.use', '.crash'].forEach(k => { try { LS && LS.removeItem(BOOT.key + k); } catch (_) { } });
    doc.location.reload();
  },
  async render() {
    if (!doc) return;
    if (!doc.getElementById('k-css')) doc.head.appendChild(Object.assign(doc.createElement('style'),
      { id: 'k-css', textContent: PANEL_CSS }));
    this.el = this.el || Object.assign(doc.createElement('div'), { className: 'k-panel' });
    const at = this.host || doc.getElementById('colony-root');
    if (this.el.parentNode !== at) at.prepend(this.el);
    this.el.classList.toggle('in', !!this.host);
    const el = this.el, list = await call('stem.blocks'), safe = L.safe,
      stemEd = stemUse() === 'edited' || !!stemEdited(), armed = Date.now() - this.armed < 6000;
    const rows = list.map(b => b.broken
      ? '<div class="k-block"><span class="nm">' + esc(b.id) + '</span>' + tag('err', b.error) + '</div>'
      : (() => {
        const changed = b.segs.some(s => s.hasEdit) || b.deleted.length > 0,
          state = b.error
            ? tag('err', b.error)
            : b.adopted
              ? tag('warn', '收养')
              : (b.segs.some(s => s.use === 'edited') || b.deleted.length) ? tag('warn', '已修改')
              : tag('', '出厂');
        return '<div class="k-block"><input type="checkbox" class="k-sel" data-id="' + esc(b.id) + '"' +
          (b.enabled ? ' checked' : '') + ' title="勾选 = 新生时带入下一代"><span class="nm">' + esc(b.name) +
          '</span><span class="meta">' + esc(b.id) + ' · v' + esc(b.version) + ' · ' + b.segs.length +
          ' 段' + (b.enabled ? '' : ' · 禁用') + '</span>' + state + '<span class="sp"></span>' +
          (b.hidden || b.running && !(this.host && (CAP['ui.host'] || {}).by === b.id) && hasPage(b.id)
            ? btn('vis', b.id, b.hidden ? '显示界面' : '隐藏界面') : '') +   // 藏了界面块这个窗也没了; 没界面的块藏了也看不出
          (safe ? '' : btn('toggle', b.id, b.enabled ? '禁用' : '启用')) +
          (safe ? '' : btn('reset', b.id, '恢复原版', !changed, changed ? '代码切回原版, 改版留作备用' : '没改过, 跑的就是原版')) +
          (!safe && b.adopted ? btn('remove', b.id, '移除收养') : '') +
          btn('wrap', b.id, '导出 Petri') + '</div>';
      })()).join('');
    el.innerHTML = '<h1><span style="color:#B5FF00;font-style:italic">Colony</span> · Stem' +
      (safe ? ' · 安全模式' : '') + (BOOT.edited ? ' · 改版' : '') +
      ' · <span data-act="collapse" title="收起或展开下面的块清单" ' +
      'style="cursor:pointer;font-size:13px;color:#8a8a8a">块 ' +
      (this.collapsed ? '▸' : '▾') + '</span></h1>' +
      (this.collapsed
        ? ''
        : '<div class="k-sub">指纹 ' + esc(BOOT.id) +
          (BOOT.lineage && BOOT.lineage.parent ? ' · 父 ' + esc(BOOT.lineage.parent) : '') + ' · ' +
          (safe ? '已忽略全部改版与收养' : this.host ? 'Colony 的内核: 管块、导入导出、恢复'
            : rows ? '无界面 Petri 在岗, Stem 兜底页' : '空白种子, 导入 Petri 开始组装') +
          '</div>' + rows +
          '<div class="k-acts">' +
          (safe ? '' : btn('import', '', '⬆ 导入 Petri')) +
          btn('molt', '', '🌱 新生导出(勾选)') +
          (safe ? '' : btn('stemreset', '', 'Stem 恢复原版', !stemEd,
            stemEd ? 'Stem 切回原版, 刷新生效' : 'Stem 没改过, 跑的就是原版')) +
          (safe ? '' : '<span class="sp"></span>' + btn('wipe', '', armed ? '再点一次就清空' : '🧹 清空',
            false, '恢复纯净: 自带的块和 Stem 回原版, 收养的块卸掉, 键值库全清(会话、设置、Key 都没了)')) + '</div>') +
      (this.msg
        ? '<div class="k-msg' + (this.msgErr ? ' err' : '') + '">' + esc(this.msg) + '</div>'
        : '');
    el.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id, act = b.dataset.act;
        try {
          if (act === 'collapse') {
            PANEL.collapsed = !PANEL.collapsed;
            PANEL.render();
          }
          else if (act === 'vis') await call('stem.setBlock', { id, hidden: b.textContent === '隐藏界面' });
          else if (act === 'toggle') {
            const on = b.textContent === '启用';
            if (!on && (CAP['ui.host'] || {}).by === id && Date.now() - PANEL.armedUi > 6000) {
              PANEL.armedUi = Date.now();
              return PANEL.say('禁用界面块会关掉整个桌面、开着的窗全关, 换成这个简易页(在这里能再启用); 6 秒内再点一次才做', true);
            }
            await call('stem.setBlock', { id, enabled: on });
            PANEL.say(id + (on ? ' 已启用' : ' 已禁用'));   // 顺带换掉上一句(比如导入时的「点启用让它上岗」)
          }
          else if (act === 'reset') {
            await call('stem.setBlock', { id, code: null });
            PANEL.say(id + ' 已恢复原版(改版留作备用)');
          }
          else if (act === 'remove') {
            await call('stem.setBlock', { id, remove: true });
            PANEL.say(id + ' 已移除');
          }
          else if (act === 'wrap') // 单独导出 = 名单只有这一块、没有 Stem 的同一个导出动作
            PANEL.download(id.replace(/[^\w-]/g, '_') + '.standalone.html',
              await call('stem.molt', { ids: [id], stem: false }));
          else if (act === 'molt') {
            const ids = [...el.querySelectorAll('.k-sel')].filter(x => x.checked).map(x => x.dataset.id);
            const html = await call('stem.molt', { ids });
            PANEL.download('colony-' + findLineage(html).id.slice(0, 8) + '.html', html);
            PANEL.say('已导出下一代, 含 ' + ids.length + ' 块');
          }
          else if (act === 'stemreset') {
            await call('stem.setBlock', { id: 'stem', code: null });
            PANEL.say('已切回原版 Stem, 刷新页面生效');
          }
          else if (act === 'wipe') {
            if (Date.now() - PANEL.armed < 6000) return PANEL.wipe();
            PANEL.armed = Date.now();
            PANEL.say('清空会把改版、收养的块、会话、设置和 Key 全部删掉, Stem 回原版; 6 秒内再点一次才做', true);
            setTimeout(() => { if (Date.now() - PANEL.armed >= 6000) PANEL.say(''); }, 6200);
          }
          else if (act === 'import') {
            const inp = doc.createElement('input');
            inp.type = 'file';
            inp.accept = '.html,.htm,.txt';
            inp.multiple = true;
            inp.onchange = async () => {
              const msgs = [];
              for (const f of inp.files) {
                try {
                  (await call('stem.adopt', { text: await f.text() }))
                    .forEach(r => msgs.push(r.id + ' → ' + r.result));
                } catch (e) {
                  msgs.push(f.name + ' ✗ ' + e.message);
                }
              }
              PANEL.say('导入结果:\n' + msgs.join('\n') + '\n收养块为禁用态, 点「启用」让它上岗');
            };
            inp.click();
          }
        } catch (e) {
          PANEL.say(e.message, true);
        }
      };
    });
  },
};
if (doc) { // 装完块或能力变了就看一眼: 在窗里或没有界面块就画(块变了重画); 有界面块又没请它就撤; 装块中途不看
  const 看 = e => {
    if (L.booting || !L.store) return;
    if (PANEL.host && !PANEL.host.isConnected) PANEL.host = null;   // 窗被关了
    if (PANEL.host || !hasUi()) { if (e.type === 'colony:blocks' || !PANEL.el) PANEL.render(); }
    else if (PANEL.el) {
      PANEL.el.remove();
      PANEL.el = null;
    }
  };
  doc.addEventListener('colony:blocks', 看);
  doc.addEventListener('colony:cap', 看);
  provide('stem.panel', a => { // 界面块的 ⚙: 面板搬进它给的窗; 不给 el(关窗时)就还回去
    PANEL.host = a.el || null;
    看({ type: 'colony:blocks' });
    return !!PANEL.host;
  }, { desc: '把 Stem 自己的面板画进给的元素(界面块的 ⚙ 开的窗); 不给 el 就收回', frames: false,
    schema: { el: 'Element?' } }, 'stem');
}
X({ PANEL, hasUi });
// ═ 启动 · 跟着: 装载 ═
// 启动器已选好 Stem 文本、算好安全信号(单独打开时不数崩溃)。文件骨架在装块前缓存: 导出要的是文件原样, 不是块改过的 DOM
// ✂ 换段
// 浏览器扩展注进 head 的样式、隔离窗注入的桥(以 function peer 开头)都不留, 不然会进导出件和指纹, 旧桥还会盖掉新桥
const GLUE = new RegExp(`<${SCR}>\\(function\\(\\)\\{function peer[\\s\\S]*?</${SCR}>\\s*`, 'g');
const cleanHead = h => h.replace(/<style\b[^>]*>[\s\S]*?<\/style>\s*/gi, m => m.includes('裸壳页自用样式') ? m : '')
  .replace(GLUE, '');
// ✂ 换段 完
// 库在但打不开(隐私模式、系统关了网站数据、文档预览窗): 退到内存, 能看不能存。开完机外面(别的 Colony 的窗)才能调里面
// (组装、试跑用): 没露出来就是还没好。页面上的全局 colony 单独文件也要有, 所以圈在跑块里
// ✂ 跑块
const banner = text => doc?.body.prepend(Object.assign(doc.createElement('div'),
  { className: 'k-banner', textContent: text }));
const boot = async () => {
  try {
    // ✂ 跑块 完
    // ✂ 键值库
    L.store = openStore('colony@' + BOOT.id);
    try { await L.store.get(''); } catch (e) {
      L.store = memStore();
      banner(`存储打不开(${e?.message || e}), 这次的改动不会保存`);
    }
    // ✂ 键值库 完
    // ✂ 换段
    if (doc) { // 开机时记下文件原文: 导出、单独文件里再导出都照它拼
      L.head = cleanHead(doc.head.outerHTML);
      L.launcher = (doc.getElementById('stem-launcher') || {}).textContent || '';
      L.stemFactory = (doc.getElementById('stem') || {}).textContent || '';
    }
    // ✂ 换段 完
    // ✂ 跑块
    // ✂ 单独时不带 · 号: 安全模式
    L.safe = !!BOOT.safe;
    if (L.safe) banner('安全模式: 已忽略全部改版与收养, 跑的是原版 Stem' +
      (BOOT.crashed ? `(连续启动失败 3 次${BOOT.revertedStem ? ', 改版 Stem 已切回原版' : ''})` : '(?safe=1)'));
    // ✂ 单独时不带 完
    await assembleAll();
    if (外) 外.expose('call', a => call(a.path, a.args));
    // ✂ 单独时不带 · 号: 崩溃计数
    try { LS.setItem(BOOT.key + '.crash', '0'); } catch (_) { }
    // ✂ 单独时不带 完
  } catch (e) { banner('启动失败: ' + e.message); throw e; }
};
g.colony = { call, has, 单独: true };
// ✂ 跑块 完
g.colony.单独 = false; // 不圈在任何范围里, 只有整份 Stem 才有这一行: 单独打开的文件里 colony.单独 是 true
if (DEBUG) g.__stem = Object.assign(API, { boot, cleanHead });
// ✂ 跑块
if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot(); }
})(typeof window !== 'undefined' ? window : globalThis);
// ✂ 跑块 完
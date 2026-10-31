'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 stem 的 换段
// ↦ 借 petri:ai 的 网络请求 · 要: 转发
// ═ 认 ═
// 按内容认一个值, 不看键名。口袋的文件、磁盘上的、网上下来的都存成 agent 引用的样子:
// {name, mimeType, from, at, text 或 dataUrl}
const 编 = new TextEncoder();
const 认 = {
  mime(src, name) { // data 网址看头, 别的看后缀; 认不出回 ''
    if (/^data:/.test(src)) return src.slice(5, src.search(/[;,]/));
    const e = ((/\.(\w+)$/.exec(String(name || src).split(/[?#]/)[0]) || [])[1] || '').toLowerCase();
    return /^(png|gif|webp|jpe?g|svg)$/.test(e) ? `image/${{ jpg: 'jpeg', svg: 'svg+xml' }[e] || e}`
      : /^(mp3|wav|ogg|m4a)$/.test(e) ? `audio/${e === 'mp3' ? 'mpeg' : e}`
      : /^(mp4|webm|mov)$/.test(e) ? `video/${e === 'mov' ? 'quicktime' : e}`
      : /^html?$/.test(e) ? 'text/html'
      : /^(txt|md|json|csv|m?js|ts|py|css|xml|ya?ml|log|sh|sql)$/.test(e) ? 'text/plain' : '';
  },
  型: m => (/^(image|audio|video)\//.exec(m) || [])[1]
    || (/html/.test(m) ? 'html' : /^text|json|xml|script/.test(m) ? 'text' : ''),
  桶: e => /^miniapp:/.test(e.key) ? '应用' : { text: '文本', html: '网页', image: '图片', audio: '音视频',   // 按类型筛
    video: '音视频', chat: '对话', json: '数据', dir: '文件夹' }[e.类] || '其它',
  出(v) { // → {类, mime, src 或 text, name, from, at}; 类: image audio video html text chat json file
    const o = v && typeof v === 'object' ? v : {}, 末 = Array.isArray(v) && v[v.length - 1];
    const r = { name: o.name, from: o.from || o.来源, at: [o.at, o.updatedAt, 末 && 末.at].find(x => x > 0) };
    const 件 = typeof v === 'string' && (/^data:/.test(v) || /^https?:\/\/\S+$/.test(v) && 认.型(认.mime(v)));
    const src = [o.dataUrl, o.url, o.src].find(x => typeof x === 'string') || (件 ? v : '');
    if (src) {
      const mime = o.mimeType || 认.mime(src, o.name);
      return Object.assign(r, { 类: 认.型(mime) || 'file', mime, src });
    }
    const t = [v, o.text, o.code].find(x => typeof x === 'string');
    if (t !== undefined) {
      const mime = o.mimeType || (/^\s*<(!doctype|html)/i.test(t) ? 'text/html' : 'text/plain');
      return Object.assign(r, { 类: 认.型(mime) || 'text', mime, text: t });
    }
    return Object.assign(r, { 类: 末 && v.every(m => m && m.role) ? 'chat' : 'json' });
  },
  叶(v, p, out) { // 值里每个字 → [位置, 字]; 位置像 12.content, 交给 data.get 的 path 就能只取那一处
    out = out || [];
    if (typeof v === 'string') out.push([p || '', v]);
    else if (v && typeof v === 'object') for (const k in v) 认.叶(v[k], p ? `${p}.${k}` : k, out);
    return out;
  },
  字节(v) { // 真字节: 按 UTF-8 数; data 网址按解开后的大小
    if (v === undefined) return 0;
    let n = 编.encode(typeof v === 'string' ? v : JSON.stringify(v)).length;
    认.叶(v).forEach(([, s]) => {
      if (/^data:[^,]*;base64,/.test(s)) n -= s.length - ((s.length - s.indexOf(',') - 1) * 3 / 4 | 0);
    });
    return n;
  },
  大小: n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`,
  图标: { image: '🖼️', audio: '🎵', video: '🎬', html: '🌐', text: '📝', chat: '💬',
    json: '🗂️', file: '📎', dir: '📁' },
  显: s => String(s).replace(/\bsk-[\w-]{8,}/g, k => `sk-…${k.slice(-4)}`),   // Key 只在给人看时写成末四位
  async 记录(b, name, from) { // 文件 → 记录: 像文字的存字(能搜能改), 别的存 data 网址
    const 泛 = !b.type || b.type === 'application/octet-stream';   // 服务器没说清就按文件名认
    const mimeType = (泛 ? 认.mime('', name) : b.type) || 'application/octet-stream';
    const 字 = /text|html/.test(认.型(mimeType));
    const 值 = await (字 ? b.text() : new Promise(ok =>
      Object.assign(new FileReader(), { onload() { ok(this.result); } }).readAsDataURL(b)));
    return { name, mimeType, from, at: Date.now(), [字 ? 'text' : 'dataUrl']: 值 };
  },
};
// ═ 归属 ═
// 谁的由各块在自己的「自报」段里说(Stem 解析好放在 stem.blocks 的 about.data), 最长的前缀算数。写了 edit 的前缀
// 只有主人能经口袋写(主人没在跑就放行); 两块认同一个前缀的谁都不能写; 人在口袋里删不拦。block: 是 Stem 的地盘, 在这里照实标出
const 归属 = {
  表: [],
  块: [],   // 地图「谁的」照它列: 每块一项, 没数据的也在
  async 载() {
    const 自 = { id: ctx.id, name: '次元口袋', icon: '🎒', running: true,   // 单独打开没有块清单: 照自报段认自己
        about: { desc: '看、搜、改、删存着的数据; 放文件和笔记; 连电脑上的文件夹', data: [
          { prefix: 'media:', label: '文件和笔记', kind: 'data' },
          { prefix: 'settings:porter.', label: '转发地址、连着的文件夹、搬没搬过上一代', kind: 'config' }] } },
      bs = (colony.单独 ? [自] : await ctx.call('stem.blocks')).filter(b => !b.broken),
      块 = b => ({ owner: b.id, 块: b.name || b.id, icon: b.icon || '▪', running: b.running }),
      stem = { owner: 'stem', 块: 'Stem', icon: '🧬', running: true };
    归属.块 = bs.map(b => Object.assign(块(b), { about: b.about || {} }))
      .concat(Object.assign({ about: {} }, stem));
    const ns = [Object.assign({ prefix: 'block:', label: '块的改版', edit: 'stem.setBlock' }, stem)];
    bs.forEach(b => ((b.about || {}).data || [])
      .forEach(n => n && n.prefix && ns.push(Object.assign({}, n, 块(b)))));
    const 建 = (await ctx.kv.get('settings:porter.mine').catch(() => null)) || [],   // 经口袋写进没人认领的地方的
      我 = 块(bs.find(b => b.id === ctx.id) || 自);
    建.forEach(prefix => ns.push(Object.assign({ prefix, label: `经口袋新建的 · ${prefix}`, kind: 'data' }, 我)));
    ns.forEach(n => {
      const 家 = [...new Set(ns.filter(x => x.prefix === n.prefix).map(x => x.owner))];
      n.两家 = 家.length > 1 ? 家 : null;
    });
    归属.表 = ns.sort((a, b) => b.prefix.length - a.prefix.length);
  },
  of: k => 归属.表.find(n => k.startsWith(n.prefix)),
  认: k => 归属.队 = Promise.resolve(归属.队).catch(() => { }).then(async () => { // 写之前: 没人认领就把开头
    // 那一截记到口袋名下。排着队记: agent 同一轮的几次写是一起跑的, 一起读改写会丢掉一个
    const 建 = (await ctx.kv.get('settings:porter.mine')) || [], h = (/^[^:.]+[:.]?/.exec(k) || [k])[0];
    if (归属.of(k) || 建.includes(h)) return;
    await ctx.kv.set('settings:porter.mine', 建.concat(h));
    await 归属.载();
  }),
  守(k, by, 删) { // 报错给 agent 看(写该走哪个能力); 人话给界面用, 不带能力名
    // 删: 人在口袋里亲手点的删(by 是口袋自己)不拦, 归谁管都能删; agent 删别人的走主人的能力或 data.clean
    if (删 && by === ctx.id) return;
    const n = 归属.of(k), 拒 = (m, 人) => { throw Object.assign(new Error(m), { 人话: 人 }); };
    if (n && n.两家) 拒(`「${k}」${n.两家.join('、')} 两块都认, 经口袋谁都不能写`, '两块都认它, 这里改不了');
    if (n && n.edit && by !== n.owner && n.running) {
      拒(`「${k}」归${n.块}管, 改它走 ${n.edit}`, `归「${n.块}」管, 这里改不了`);
    }
  },
};
// ═ 磁盘 · 跟着: 认 ═
// 用户亲手选的文件夹, 键写 disk:<文件夹名>/<路径>, 目录以 / 结尾。选文件夹、浏览器重开后「接上」都要人亲手点,
// 所以只在口袋的按钮里做; 句柄存在库里(IndexedDB 能直接存句柄)
const 磁盘 = {
  键: 'settings:porter.dirs',
  夹: [],   // [{name, handle}]
  async 载() { 磁盘.夹 = (await ctx.kv.get(磁盘.键)) || []; },
  async 连() {
    const h = await showDirectoryPicker({ mode: 'readwrite' }).catch(e => {
      throw new Error(e.name === 'AbortError' ? '没选文件夹' : `连不上文件夹: ${e.message}`);
    });
    const name = 磁盘.找(h.name) ? `${h.name} ${Date.now() % 1e4}` : h.name;
    磁盘.夹.push({ name, handle: h });
    await ctx.kv.set(磁盘.键, 磁盘.夹);
    return name;
  },
  async 断(n) { // 只忘掉这个文件夹, 电脑上的文件不动
    磁盘.夹 = 磁盘.夹.filter(f => f.name !== n);
    await ctx.kv.set(磁盘.键, 磁盘.夹);
  },
  找: n => 磁盘.夹.find(f => f.name === n),
  好: (f, 接) => f.handle[接 ? 'requestPermission' : 'queryPermission']({ mode: 'readwrite' })   // 接: 请人点「允许」
    .then(p => p === 'granted', () => false),
  async 到(k, 建) { // 'disk:夹/a/b.txt' → [目录, 'b.txt']; 目录键(以 / 结尾)尾巴是 ''
    await 磁盘.载();
    const [名, ...段] = k.slice(5).split('/'), f = 磁盘.找(名), 尾 = 段.pop();
    if (!f) throw new Error(`没连文件夹「${名}」; 连着的: ${磁盘.夹.map(x => x.name).join('、') || '没有'}`);
    if (!await 磁盘.好(f)) throw new Error(`文件夹「${名}」要用户在次元口袋里点一下接上(浏览器要人亲手点)`);
    let d = f.handle;
    for (const s of 段.filter(Boolean)) d = await d.getDirectoryHandle(s, { create: !!建 });
    return [d, 尾];
  },
  async list(k) {
    const out = [], [d] = await 磁盘.到(k);
    for await (const h of d.values()) {
      const f = h.kind === 'file' && await h.getFile(), n = h.name;
      out.push(f ? { key: k + n, name: n, 类: 认.型(f.type || 认.mime('', n)) || 'file', bytes: f.size,
        at: f.lastModified, 叶: [] } : { key: k + n + '/', name: n, 类: 'dir', bytes: 0, 叶: [] });
    }
    return out;
  },
  文件: k => 磁盘.到(k).then(([d, n]) => d.getFileHandle(n)).then(h => h.getFile()),
  get: k => 磁盘.文件(k).then(f => 认.记录(f, f.name, k)),
  async set(k, v) { // v: 字、data 网址或 Blob; 同名文件会被盖掉
    const [d, n] = await 磁盘.到(k, 1), w = await (await d.getFileHandle(n, { create: true })).createWritable();
    await w.write(/^data:/.test(v) ? await (await fetch(v)).blob() : v);
    await w.close();
  },
  async del(k) { // 文件夹只删空的, 免得一下删掉一整个目录
    const [d, n] = await 磁盘.到(k.replace(/\/$/, ''));
    await d.removeEntry(n).catch(e => {
      throw /modif|empty/i.test(e.name + e.message) ? new Error('文件夹不是空的, 先删里面的') : e;
    });
  },
};
// ═ 数据 · 跟着: 认, 归属, 磁盘, 网络请求 ═
// 库、连着的文件夹、网址一套动词: 普通键在库里, disk:… 在文件夹里, http(s)://… 在网上(读)。
// 大东西用 copy 在三处之间直传, 不经过调用方; 写进口袋自己的前缀时记下从哪来、什么时候
const 数据 = {
  盘: k => /^disk:/.test(k),
  网: k => /^https?:\/\//.test(k),
  条: (key, v) => Object.assign(认.出(v), { key, bytes: 认.字节(v), 主: 归属.of(key),
    叶: 认.叶(v).filter(([, s]) => !/^data:/.test(s)) }),
  找(e, q) { // 键或值里有 q: 回在值里的哪一处和前后文; 没有回 undefined
    if (e.key.toLowerCase().includes(q)) return { where: '', 摘录: '' };
    for (const [p, t] of e.叶) {
      const i = t.toLowerCase().indexOf(q);
      if (i >= 0) return { where: p, 摘录: 认.显(t.slice(Math.max(0, i - 40), i + q.length + 80)) };
    }
  },
  搜: (条, q) => 条.flatMap(e => { // 每次搜都另抄一份带命中处的, 不往条目上写: 写上去下回搜不到也会留着
    const h = 数据.找(e, q);
    return h ? [Object.assign({}, e, h)] : [];
  }),
  async 全(p) {
    await 归属.载();
    return (await ctx.kv.list(p || '')).map(e => 数据.条(e.key, e.value));
  },
  // 先列后称: 只要名单(几毫秒)就能画地图和列表; 大小、类型、时间要读值, 后台一批批补。
  // 称过的按键记着, 库没变的键下回不再称; 口袋自己写、删的那条当场忘掉重称
  称过: new Map(),
  忘: k => 数据.称过.delete(k),
  async 名单(p) {
    await 归属.载();
    const ks = ctx.kv.keys ? await ctx.kv.keys(p || '') : (await ctx.kv.list(p || '')).map(e => e.key);
    return ks.map(k => 数据.称过.get(k) || { key: k, bytes: 0, 叶: [], 主: 归属.of(k), 待称: 1 });
  },
  async 称(条, 每批) { // 把待称的一批批读值补上; 每批补完回调一次(画布跟着涨)
    const 待 = 条.filter(e => e.待称);
    for (let i = 0; i < 待.length; i += 20) {
      for (const e of 待.slice(i, i + 20)) {
        const 补 = 数据.条(e.key, await ctx.kv.get(e.key));
        Object.keys(e).forEach(x => delete e[x]);
        数据.称过.set(补.key, Object.assign(e, 补));
      }
      if (每批) 每批(Math.min(i + 20, 待.length), 待.length);
      await new Promise(r => setTimeout(r));   // 让一让, 点击和滚动不卡
    }
    return 条;
  },
  图(条) { // 地图: 每块占多少(再分到它说的每个前缀); 没数据的块也列; 没人认领的按开头那一截归堆
    const 主 = {}, 散 = {}, 加 = (o, b) => { o.count++; o.bytes += b; };
    for (const b of 归属.块) {
      主[b.owner] = { owner: b.owner, label: b.块, icon: b.icon, running: b.running, count: 0, bytes: 0,
        ns: {} };
    }
    for (const n of 归属.表) {
      主[n.owner].ns[n.prefix] = { prefix: n.prefix, label: n.label, kind: n.kind || 'data', edit: n.edit,
        两家: n.两家, count: 0, bytes: 0 };
    }
    for (const e of 条) {
      const n = e.主, h = (/^[^:.]+[:.]?/.exec(e.key) || [e.key])[0];
      if (!n) { 加(散[h] = 散[h] || { prefix: h, count: 0, bytes: 0 }, e.bytes); continue; }
      加(主[n.owner], e.bytes);
      加(主[n.owner].ns[n.prefix], e.bytes);
    }
    Object.values(主).forEach(o => { o.ns = Object.values(o.ns); });
    return { count: 条.length, bytes: 条.reduce((s, e) => s + e.bytes, 0), owners: Object.values(主),
      unclaimed: Object.values(散), disks: 磁盘.夹.map(f => f.name) };
  },
  async list(a) {
    const k = a.in || '', q = String(a.q || '').toLowerCase();
    if (k === 'disk:') {
      await 磁盘.载();
      const items = 磁盘.夹.map(f => ({ key: `disk:${f.name}/`, name: f.name, type: 'dir', bytes: 0 }));
      return { count: items.length, bytes: 0, items };
    }
    const 条 = 数据.盘(k) ? await 磁盘.list(k) : await 数据.称(await 数据.名单(k));
    if (!k && !q) return 数据.图(条);
    const 中 = q ? 数据.搜(条, q) : 条;
    const items = 中.sort((x, y) => y.bytes - x.bytes).slice(0, a.n || 50)
      .map(e => ({ key: e.key, name: e.name, type: e.类, bytes: e.bytes, at: e.at, where: e.where,
        摘录: e.摘录 }));
    return { count: 中.length, bytes: 中.reduce((s, e) => s + e.bytes, 0), items };
  },
  注(v, k) { // 大的 data 网址不进上下文, 换成一行说明; 要原件给 path
    const 引 = /^(ref|media):/.test(k), 说 = s => `‹${认.mime(s)} ${认.大小(认.字节(s))}: 原件没给, `
      + `${引 ? `交给别的能力写 {"$ref":"${k}"}, 给人看写 [[show:${k}]]` : '先 data.copy 到 media: 再引用'}, 要原件给 path›`;
    const 走 = x => typeof x === 'string' ? /^data:/.test(x) && x.length > 2048 ? 说(x) : x
      : x && typeof x === 'object' ? Array.isArray(x) ? x.map(走)
        : Object.fromEntries(Object.entries(x).map(([a, b]) => [a, 走(b)])) : x;
    return 走(v);
  },
  async 下(url, a) { // 网上的读成记录; 被浏览器拦了、是 GET/HEAD、又填了转发地址, 才经转发再试一次
    const 法 = String(a.method || 'GET').toUpperCase(), 对象 = a.body && typeof a.body === 'object';
    const 头 = Object.assign(对象 ? { 'Content-Type': 'application/json' } : {}, a.headers);
    const 发 = 转发 => 网络请求(url, { method: 法, headers: 头, body: 对象 ? JSON.stringify(a.body) : a.body,
      retries: 0, 转发 });
    let r = await 发().catch(async e => {
      const 转 = e.retry && /^(GET|HEAD)$/.test(法) && await ctx.kv.get('settings:porter.proxy');
      if (!转) throw new Error(e.message + (e.retry ? '; 跨域的站可以请用户在次元口袋 ⚙ 里填转发地址' : ''));
      return 发(转);
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}: ${(await r.text()).slice(0, 300)}`);
    const 名 = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '') || '下载的';
    return 认.记录(await r.blob(), 名, url);
  },
  async get(a) {
    const k = a.key;
    let v = 数据.网(k) ? await 数据.下(k, a) : 数据.盘(k) ? await 磁盘.get(k) : await ctx.kv.get(k);
    if (a.path == null) return v === undefined ? null : 数据.注(v, k);
    String(a.path).split('.').filter(Boolean).forEach(s => { v = v == null ? v : v[s]; });
    return v === undefined ? null : v;
  },
  async set(a, by, 来) { // 来: copy 时的来源
    let k = a.key, v = a.value;
    if (数据.网(k)) throw new Error('网址只能读: data.get 读, data.copy 存下来');
    if (数据.盘(k)) { // 落到文件夹的是能用的东西: 媒体是原件, 字是字, 别的是排好的 JSON
      const r = 认.出(v), json = !r.src && r.text === undefined;
      if (json && !/\.\w+$/.test(k)) k += '.json';
      await 磁盘.set(k, json ? JSON.stringify(v, null, 2) : r.src || r.text);
      return { key: k };
    }
    await 归属.载();
    if (k.endsWith(':')) k += `${Date.now().toString(36)}:${v && v.name || '未命名'}`;
    归属.守(k, by);
    await 归属.认(k);
    if (/^media:/.test(k) && v && v.constructor === Object)   // 别处的值原样存, 不往里添字段
      v = Object.assign({}, v, { from: 来 || v.from || by || '用户', at: Date.now() });
    await ctx.kv.set(k, v);
    数据.忘(k);
    return { key: k };
  },
  async del(a, by) {
    if (数据.网(a.key)) throw new Error('网址删不了');
    if (数据.盘(a.key)) return 磁盘.del(a.key).then(() => ({ key: a.key }));
    await 归属.载();
    归属.守(a.key, by, 1);
    await (by === ctx.id ? 体检.删一(a.key) : ctx.kv.del(a.key));   // 人在口袋里删应用、块的改版: 走它们的正路
    数据.忘(a.key);
    return { key: a.key };
  },
  async copy(a, by) { // to 是以 / 结尾的文件夹就用原名
    let v = await 数据.get({ key: a.from, path: '' });
    if (v === null) throw new Error(`没有这个: ${a.from}`);
    const 名 = a.from.split(/[:/]/).pop();
    if (typeof v === 'string' && a.to === 'media:') { // 值就是一串字或 data 网址: 包成记录, 名字取原键末尾加扩展名
      const r = 认.出(v);
      v = { name: 名 + (r.src ? `.${r.mime.split('/')[1].split('+')[0]}` : '.txt'), mimeType: r.mime,
        [r.src ? 'dataUrl' : 'text']: v };
    }
    const to = /^disk:.*\/$/.test(a.to) ? a.to + (v.name || 名) : a.to;
    return Object.assign(await 数据.set({ key: to, value: v }, by, a.from), { bytes: 认.字节(v) });
  },
};
// ═ 带的数据 ═
// 出厂是空。「导出口袋」时这一段换成口袋的数据(和 AI 块打包配置同一个办法), 导出的文件打开时播进它自己的库
const 带的数据 = null;
// ═ 继承 · 跟着: 归属, 界面, 带的数据 ═
// 导出的下一代打开是空库(库名跟着血统换)。同一个浏览器里上一代的库还在, 就提示一条, 人点了才搬。
// 不搬 block:(上一代的改版会盖掉新的出厂版)、只属于一次运行(state)或能重算(cache)的(kind 写在各块的自报段);
// file:// 和网页不同源, 开不到。
// 换电脑走「导出口袋」: 单独导出本块, 导出件里「带的数据」段换成数据; 打开导出件、或把它放进别的口袋, 都走 播
const 继承 = {
  新: (a, b) => (认.出(a).at || 0) > (认.出(b).at || 0),   // 看值里自带的时间
  计划(父, 子) { // 父、子: {键: 值}; 回 {搬: [[键, 值]], 盖: [键]}。两边都有时谁新留谁
    const 不搬 = k => /^block:|^settings:porter\.moved$/.test(k)
      || /^(state|cache)$/.test((归属.of(k) || {}).kind);
    const 搬 = Object.entries(父).filter(([k, v]) => !不搬(k) && JSON.stringify(v) !== JSON.stringify(子[k])
      && !(k in 子 && 继承.新(子[k], v)));
    return { 搬, 盖: 搬.filter(([k]) => k in 子).map(([k]) => k) };
  },
  async 读父(名) {
    const db = await new Promise(ok => { // 只读地开; 库不在就中止, 不顺手建一个空库
      const q = indexedDB.open(名);
      q.onupgradeneeded = () => q.transaction.abort();
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ok(null);
    });
    if (!db || !db.objectStoreNames.contains('kv')) return db && db.close();
    const s = db.transaction('kv').objectStore('kv'),
      取 = q => new Promise(ok => { q.onsuccess = () => ok(q.result); });
    const [ks, vs] = [await 取(s.getAllKeys()), await 取(s.getAll())];
    db.close();
    return Object.fromEntries(ks.map((k, i) => [k, vs[i]]));
  },
  async 开机() { // 开机看一回: 有可搬的、又没记过, 就在左下提示, 口袋左栏顶上也有
    if (colony.单独) return;   // 单独打开没有血统, 也就没有上一代
    const { lineage: l } = await ctx.call('stem.lineage');
    if (!l || !l.parent || typeof indexedDB === 'undefined'
      || await ctx.kv.get('settings:porter.moved')) return;
    const 父 = await 继承.读父(`colony@${l.parent}`);
    if (!父) return;
    await 归属.载();
    const 子 = Object.fromEntries((await ctx.kv.list('')).map(e => [e.key, e.value]));
    继承.案 = Object.assign(继承.计划(父, 子), { 从: l.parent });
    if (继承.案.搬.length) 界面.提示();
  },
  async 搬() {
    for (const [k, v] of 继承.案.搬) await ctx.kv.set(k, v);
    await 继承.记('搬了');
    ctx.call('stem.reboot');   // 各块重开, 读到搬来的数据
  },
  async 记(结果) {
    const 案 = 继承.案;
    await ctx.kv.set('settings:porter.moved', { from: 案.从, n: 案.搬.length, at: Date.now(), 结果 });
    继承.案 = null;
    界面.提示();
  },
  // 带不走的: 块的改版、文件夹的授权(换台电脑要重新连)、搬家和导入的记号、正在跑的记号
  不带: k => /^block:|^settings:porter\.(dirs|moved|导入过)$/.test(k) || (归属.of(k) || {}).kind === 'state',
  async 出(全) { // 全: 连别的块的数据也带上; 回 {n, html}
    await 归属.载();
    const 条 = (await ctx.kv.list(全 ? '' : 'media:')).filter(e => !继承.不带(e.key));
    if (!条.length) throw new Error('口袋里还没有文件和笔记, 没东西可导出');
    const 带 = JSON.stringify({ at: Date.now(), 条: Object.fromEntries(条.map(e => [e.key, e.value])) });
    // 尖括号转义, 不然进不了 script 标签
    const text = `// ═ 带的数据 ═\n// 导出口袋时带上的\nconst 带的数据 = ${带.replace(/</g, '\\u003c')};`;
    const html = await ctx.call('stem.molt', { ids: [ctx.id], stem: false,
      swap: { id: ctx.id, name: '带的数据', text } });
    return { n: 条.filter(e => !/^datamap:/.test(e.key)).length, html };   // 自报跟着走(那边好分组), 不算项数
  },
  读包(t) { // 导出的口袋文件 → 它带的数据; 不是就回 null
    const m = /\nconst 带的数据 = (\{[^\n]*\});\n/.exec(t);
    try { return m && JSON.parse(m[1]); } catch (e) { return null; }
  },
  async 播(带) { // 这边没有的、或带来的更新的才写; 同一份只放一回(打开导出件后改过的不会被盖回去)。
    // 回 {n: 放进了几项, 刷新: 有别的块正开着的数据(它们要重开才读到)}, 早就放过回 null
    if (!带 || !带.条) return null;
    const 过 = (await ctx.kv.get('settings:porter.导入过')) || [], 写 = [];
    if (过.includes(带.at)) return null;
    await 归属.载();
    for (const [k, v] of Object.entries(带.条)) {
      const 有 = await ctx.kv.get(k);
      if (继承.不带(k) || 有 !== undefined && !继承.新(v, 有)) continue;
      await ctx.kv.set(k, v).then(() => 写.push(k), () => { });
    }
    await ctx.kv.set('settings:porter.导入过', 过.concat(带.at));
    // 不替人重开: 重开会关掉所有窗, 口袋自己也在里面
    const 别人 = k => { const n = 归属.of(k); return n && n.running && n.owner !== ctx.id; };
    return { n: 写.length, 刷新: 写.some(别人) };
  },
};
// ═ 样式 ═
// 类名带 pk-, 颜色照界面块的设计变量取。宽窄看这块自己多宽(容器查询): 放进窗、弹窗、裸页都能用。
// 底色两层: 口袋 --bg, 卡片和内容框 --surface / --bg-2; 行和地图都是圆角卡片, 选中青柠边加浅底, 底下一道大小条。
// pk-in 是 1ms 的动画: root 每被搬去显示一次它就重播一次, 装配段靠它知道口袋露出来了。
// 关了窗 root 回到 #colony-root 收着: 缩成 1 像素藏起来(界面块靠高度不为 0 认它有页面), 不然表头会漏到桌面上
const 样式 = ((a, d, m, l, k, t, g, f, s, b, o) => `@keyframes pk-in{from{opacity:.99}to{opacity:1}}
[data-block-id="petri:porter"]{container-type:inline-size;height:100%;animation:pk-in 1ms}
.pk-solo{height:100vh}
#colony-root>[data-block-id="petri:porter"]:not(.pk-solo){height:1px;overflow:hidden;visibility:hidden}
.pk{display:grid;grid-template-columns:210px 300px 1fr;height:100%;min-height:min(56vh,520px);
position:relative;font:13px ${s};color:${t};background:${b}}
.pk *{box-sizing:border-box}.pk:focus{outline:0}
.pk>div{overflow:auto;min-width:0;border-right:1px solid ${l}}
.pk button,.pk input,.pk textarea{font:inherit;color:inherit;background:var(--surface,#222);
border:1px solid ${k};border-radius:8px;padding:4px 10px}
.pk button{cursor:pointer;font-weight:600;color:var(--text-muted,#aaa)}
.pk button:hover{border-color:${a};color:${t}}
.pk-t,.pk-r{border:1px solid #0000;cursor:pointer}
.pk-t:hover,.pk-r:hover{border-color:${k}}
.pk .on,.pk-r.sel{border-color:${a};background-color:${o}}
.pk :focus-visible{outline:2px solid ${a};outline-offset:1px}
.pk-q{margin:8px;width:calc(100% - 16px);height:32px;background:${d}}
.pk-q:focus{outline:0;border-color:${a};
box-shadow:0 0 0 3px ${o}}
.pk-t{display:flex;gap:6px;margin:1px 6px;padding:5px 8px;border-radius:7px;white-space:nowrap;
background:linear-gradient(${a},${a}) 
8px 100%/calc(var(--w,0%) - 16px) 2px no-repeat}/* 底下那道细线 = 占全库多少 */
.pk-t b{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis}.pk-t.in{padding-left:26px}
.pk-t.off{opacity:.45}.pk-t.two b{color:#f66}.pk-t[data-in^="@"]{color:${a}}/* @ 开头的是块 */
.pk-h,.pk small,.pk-k{color:${g};font-size:11px}.pk-h{padding:10px 10px 2px;margin:0}
.pk-k{font:11px ${m};word-break:break-all}.pk-k:has(mark){color:${t}}
.pk-list{scroll-padding-top:44px;padding-bottom:64px}
.pk-lh{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:4px;align-items:center;
padding:8px 10px;background:${b};border-bottom:1px solid ${l}}
.pk-lh b{margin-right:auto}.pk-tp{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px}.pk .pk-tp button{
padding:2px 9px;font-weight:500}
.pk-sel{position:absolute;inset:0;display:flex;align-items:center;gap:6px;padding:0 10px;/* 盖在表头上 */
background:${d};border-bottom:1px solid ${a}}
.pk-sel b{margin-right:auto}
.pk input[type=checkbox]{width:16px;height:16px;padding:0;vertical-align:middle;
accent-color:${a}}.pk-tools{display:flex;flex-wrap:wrap;gap:4px}
.pk-r{display:grid;grid-template-columns:32px 1fr auto;gap:0 8px;margin:4px 8px;padding:7px 10px 9px;
border-radius:9px;background:linear-gradient(${a},
${a}) 10px 100%/calc(var(--w,0%) - 20px) 2px no-repeat,${f}}
.pk-r>i{grid-row:span 2;font:20px/32px sans-serif;text-align:center}
.pk-r b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-r .pk-k{grid-column:2/4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-list.q .pk-r .pk-k{white-space:normal}.pk-r.sel{border-style:dashed}
.pk mark{background:${a};color:#111;border-radius:2px;padding:0 1px}
.pk .pk-del{color:var(--danger,#f66);border-color:#f446}.pk .pk-sure{background:var(--danger,#f44);
color:#fff}.pk [data-do=选文件],.pk [data-act=存],.pk [data-act=跑]{background:${a};
border-color:${a};color:#111}
.pk-one{display:flex;flex-direction:column;padding:12px 16px}.pk-one h3{margin:0;font-size:16px;
font-weight:600}.pk-0{margin:auto;text-align:center;font-size:13px;line-height:2}
.pk-list .pk-0{padding:40px 0}.pk-src{margin:10px 0;padding:8px 10px;border-radius:8px;
background:${f};line-height:1.8}
.pk a{color:${a};cursor:pointer;font-family:${m};margin-right:6px}
.pk-acts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.pk-tabs{display:inline-flex;gap:2px;padding:2px;border:1px solid ${l};border-radius:9px;
background:${d}}.pk .pk-tabs button{border:0;background:none;padding:3px 12px}
.pk .pk-tabs .on{color:${a}}
.pk-view{flex:1 0 200px;overflow:auto;padding:14px;border:1px solid ${l};
border-radius:11px;
background:${d}}.pk-view:has(>img,>video,>audio){display:grid;place-items:center}
.pk-view img,.pk-view video{max-width:100%;max-height:60vh;border-radius:8px;background:#000}
.pk-view audio,.pk-view textarea,.pk-name{width:100%}.pk-name{margin-bottom:8px}
.pk-view:has(>iframe){padding:0}.pk-view iframe{width:100%;height:100%;min-height:60vh;border:0;
border-radius:10px;background:#fff}.pk-view textarea{min-height:calc(100% - 50px);border:0;
background:none;padding:0;resize:none}.pk-view pre,.pk-view textarea{white-space:pre-wrap;
word-break:break-word;font:12px/1.6 ${m};margin:0}
.pk-acts:empty{display:none}.pk-view:focus-within{border-color:${a}}
.pk-view>details{font:12px/1.6 ${m}}.pk-view details{display:inline-block;
vertical-align:top}.pk-view details div{padding-left:16px}
.pk-view summary{cursor:pointer;color:${g}}
.pk-m{border-bottom:1px solid var(--border,#222);padding:4px 0}.pk .hit{background:#443}
.pk-msg{position:absolute;left:50%;bottom:56px;transform:translateX(-50%);z-index:4;max-width:90%;
padding:8px 16px;border:1px solid ${k};border-radius:9px;
background:var(--bg-3,#1a1a1a);
box-shadow:0 6px 24px #0008;pointer-events:none;color:${a}}.pk-msg:empty{display:none}
.pk.drop::after{content:"松手放进这里";position:absolute;inset:8px;z-index:5;display:grid;place-items:center;
border:2px dashed ${a};border-radius:12px;background:#0a0a0ae6;
color:${a};font:16px ${m};pointer-events:none}
.pk-menu,.pk-back{display:none}.pk-tip{position:fixed;left:16px;bottom:16px;z-index:300;max-width:360px;
padding:10px 12px;border-radius:10px;background:${d};
border:1px solid ${a};
color:${t};font:13px ${s}}.pk-tip button{margin:6px 6px 0 0}
@container (max-width:900px){.pk{grid-template-columns:176px 236px 1fr}/* 窄了: 大小挪到第二行 */
.pk-r b{grid-column:2/4}.pk-r small{grid-row:2;grid-column:3}.pk-r .pk-k{grid-column:2}}
@container (max-width:720px){.pk{grid-template-columns:260px 1fr}.pk-rail{display:none}
.pk-menu{display:inline}.pk.rail .pk-rail{display:block;position:absolute;inset:0 auto 0 0;width:240px;
z-index:3;background:${d};box-shadow:0 0 0 100vmax #0008}}/* 抽屉外面压暗, 点暗处就关 */
@container (max-width:600px){.pk{grid-template-columns:1fr}
.pk.one .pk-list,.pk:not(.one) .pk-one{display:none}
.pk-back{display:inline;align-self:flex-start;margin-bottom:8px}}`)(
  'var(--accent,#b5ff00)', 'var(--bg-2,#131313)', 'var(--mono,monospace)', 'var(--border,#333)',
  'var(--border-strong,#444)', 'var(--text,#eee)', 'var(--text-muted,#888)', 'var(--surface,#1a1a1a)',
  'var(--sans,sans-serif)', 'var(--bg,#0a0a0a)', 'var(--accent-soft,#2a3a00)');
// ═ 界面 · 跟着: 认, 归属, 磁盘, 数据, 继承, 看 ═
// 左边地图(谁的、没人认领、磁盘、工具), 中间条目, 右边看一条。全库扫一遍放在 S.条, 地图、列表、搜索、被引用都用它。
// 库没有「变了」的事件: 露出来、手移进来(隔 5 秒)、自己写完、别的块发事件时重扫; 没露出来不扫, 开机不花这个钱。
// 中栏除了库里的一处, 还有两种特别的列: '旧!' 上一代要搬过来的, '清!' 清理
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const 界面 = {
  S: { 处: '', 条: [], 选: '', q: '', 多: new Set(), 盘条: [], 好: {}, 型: '', 勾: new Set() },
  $: s => ctx.root.querySelector(s),
  露: () => ctx.root.parentNode && ctx.root.parentNode.id !== 'colony-root' || !colony.has('ui.host'),
  尾: k => k.replace(/\/$/, '').split(/[:./]/).pop(),
  时: t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit',
    minute: '2-digit' }),
  错: x => 界面.说(x.人话 || x.message, 1),
  画: () => (界面.地图(), 界面.列()),
  下载: (href, download) => Object.assign(document.createElement('a'), { href, download }).click(),
  装() {
    ctx.root.innerHTML = '<div class="pk"><div class="pk-rail"><input class="pk-q" placeholder="搜全部数据: 键和内容">'
      + `<div class="pk-tree"></div></div><div class="pk-list"></div><div class="pk-one">${界面.空}`
      + '</div><div class="pk-msg"></div></div>';
    const pk = 界面.pk = 界面.$('.pk');
    pk.tabIndex = -1;   // 点过的行之后 ↑↓ 能换条: 键盘事件要落在口袋上
    pk.onclick = e => 界面.点(e).catch(界面.错);
    pk.oninput = e => {
      if (!e.target.classList.contains('pk-q')) return;
      clearTimeout(界面.等);
      界面.等 = setTimeout(() => { 界面.S.q = e.target.value.trim().toLowerCase(); 界面.画(); }, 200);
    };
    ['dragover', 'dragleave', 'drop'].forEach(t => pk.addEventListener(t, e => 界面.拖(e).catch(界面.错)));
    pk.ondragstart = e => {
      const r = e.target.closest('.pk-r');
      if (r) e.dataTransfer.setData('text/x-porter', r.dataset.k);
    };
    pk.onkeydown = 界面.键;
    pk.onpointerenter = () => Date.now() - (界面.S.扫于 || 0) > 5000 && 界面.露() && 界面.扫(1).catch(界面.错);
  },
  async 扫(静) { // 静: 手移进来那种顺手扫, 数据没变就不重画(重画会吞掉正按下去的那一下点击)
    const S = 界面.S;
    S.扫于 = Date.now();
    await 磁盘.载();
    for (const f of 磁盘.夹) S.好[f.name] = await 磁盘.好(f);
    // 各块的自报(datamap:)左边地图已经按块分好了, 列表里不再占行; 口袋记的「哪些是经口袋新建的」也不给人删,
    // 先列后称: 名单一到就画(地图有条数, 大小先写 …), 再在后台一批批称, 每批补画一次
    const 条 = await 数据.名单(), 签 = 条.map(e => e.key).join();
    if (静 && 签 === S.签 && !条.some(e => e.待称)) return;   // 顺手扫: 名单没变也都称过, 不动
    const 第几 = S.扫号 = (S.扫号 || 0) + 1;
    [S.签, S.条, S.图, S.称着] = [签, 条, 数据.图(条), 条.some(e => e.待称)];
    S.stem = colony.单独 ? {} : await ctx.call('stem.block', { id: 'stem' });
    界面.画();
    if (S.称着) await 数据.称(条, () => { if (第几 === S.扫号) [S.图, S.检] = [数据.图(条)], 界面.画(); });
    if (第几 !== S.扫号) return;   // 称着的时候又扫了一次: 交给新的那次
    S.称着 = false;
    界面.画();
    if (看.k && !数据.盘(看.k) && !看.旧) 看.开(看.k, 1).catch(() => { 看.k = ''; });
  },
  旧: () => 界面.露() ? 界面.扫() : (界面.S.扫于 = 0),
  回: '<button class="pk-back" data-do="回">← 回列表</button>',
  空: '<p class="pk-h pk-0">🎒<br>文件拖进来就放进口袋<br>点左边一处看它有什么<br><button data-do="选文件">＋ 放文件进来</button> '
    + '<button data-do="笔记">＋ 新笔记</button></p>',
  名(处) { // 列表头上的人话名: 块写它的名字, 前缀写它自报的说法
    const g = 界面.S.图, o = g && 处[0] === '@' && g.owners.find(x => x.owner === 处.slice(1)),
      n = g && g.owners.flatMap(x => x.ns).find(x => x.prefix === 处);
    return !处 ? '全部' : o ? `${o.icon} ${o.label}` : n ? n.label : 处.replace(/^disk:/, '📁 ');
  },
  叫: (k, n) => n || 界面.尾(k),   // 一条的人话名: 有 name 用 name, 没有用键的末一截
  提示() { // 上一代还有数据: 左下一条(口袋开着时藏起来), 口袋左栏顶上一个框
    const 案 = 继承.案, 有 = 案 && 案.搬.length, 话 = 有 && `上一代(${案.从.slice(0, 8)})的数据还在这个浏览器里: `
      + `${案.搬.length} 项${案.盖.length ? `, 其中 ${案.盖.length} 项两边都有(会用上一代的)` : ''}`;
    let t = document.querySelector('.pk-tip');
    if (!有 && 界面.S.处 === '旧!') { // 搬了或不用了, 「先看看」那一列和右边看着的上一代那条都撤掉
      界面.S.处 = '';
      if (看.旧) 看.空();
    }
    if (!有 || 界面.露()) return t && t.remove(), 界面.S.图 && 界面.画();
    if (!t) t = document.body.appendChild(Object.assign(document.createElement('div'),
      { className: 'pk-tip' }));
    t.innerHTML = `🎒 ${esc(话)}<br><button data-do="搬旧">搬过来</button><button data-do="不搬">不用了</button>`
      + '<small>想先看看就打开次元口袋</small>';
    t.onclick = e => 界面.点(e).catch(界面.错);
  },
  地图() {
    const S = 界面.S, g = S.图, 案 = 继承.案, 主 = e => e.主 ? e.主.owner : '?';
    const 找着 = S.q ? 数据.搜(S.条, S.q) : [], 命中 = f => S.q ? 找着.filter(f).length : null;
    const 行 = (处, 图, 名, o, 类, 数, 注) => `<div class="pk-t${类 || ''}${S.处 === 处 ? ' on' : ''}`
      + `${数 === 0 ? ' off' : ''}" data-in="${esc(处)}" title="${esc(名)}" style="--w:`
      + `${处 && o && g.bytes ? o.bytes / g.bytes * 100 : 0}%">${图 || '▪'}<b>${esc(名)}`
      + `</b><small>${注 || ''}${数 != null ? `命中 ${数}` : o ? `${o.count} · ${S.称着 ? '…' : 认.大小(o.bytes)}` : ''}`
      + '</small></div>';
    const 子 = o => o.ns.filter(n => !/^datamap:/.test(n.prefix)).map(n => 行(n.prefix, ' ',
      n.两家 ? `两家都认: ${n.两家.join('、')}` : n.label, n, ` in${n.两家 ? ' two' : ''}`)).join('')
      + (o.owner === 'stem' && (S.stem || {}).hasEdit ? 行('stem!', ' ', 'Stem 改版 · 在浏览器本地存储', 0, ' in') : '');
    const 块 = o => 行(`@${o.owner}`, o.icon, o.label, o, o.running ? '' : ' off', 命中(e => 主(e) === o.owner),
      o.running ? '' : '没在跑 · ')   // 放小字里: 名字长了会被截掉
      + (S.处 === `@${o.owner}` || o.ns.some(n => n.prefix === S.处) ? 子(o) : '');
    界面.$('.pk-tree').innerHTML = (案 && 案.搬.length ? `<div class="pk-src">上一代有 ${案.搬.length} 项: `
      + `${案.搬.length - 案.盖.length} 项这边没有, ${案.盖.length} 项两边都有(会用上一代的)<br>`
      + '<button data-do="搬旧">搬过来</button> <button data-do="看旧">先看看</button> '
      + '<button data-do="不搬">不用了</button></div>' : '')
      + 行('', '🗃️', '全部', g, '', S.q ? 找着.length : null)
      + (colony.单独 ? '' : 行('系统!', '📖', '系统资料', 0))
      + '<p class="pk-h">谁的</p>' + g.owners.map(块).join('')
      + (g.unclaimed.length ? '<p class="pk-h">没人认领(只列出来, 不会自动清)</p>' : '')
      + g.unclaimed.map(u => 行(u.prefix, '❔', u.prefix, u, '', 命中(e => !e.主 && e.key.startsWith(u.prefix))))
        .join('') + '<p class="pk-h">磁盘</p>'
      + 磁盘.夹.map(f => 行(`disk:${f.name}/`, '📁', f.name + (S.好[f.name] ? '' : ' · 点一下接上'))).join('')
      + (self.showDirectoryPicker ? '<div class="pk-t" data-do="连">＋ 连一个文件夹</div>'
        : '<p class="pk-h">这个浏览器连不了文件夹(要 Chrome 或 Edge)</p>')
      + '<p class="pk-h pk-tools"><button data-do="新建">＋ 新建</button><button data-do="清理">🧹 清理</button>'
      + '<button data-do="导出">📦 导出口袋</button><button data-do="扫">⟳ 重扫</button>'
      + '<a data-k="settings:porter.proxy">⚙ 转发地址</a></p>';
  },
  async 去(处) { // '' 全部, '@块' 那块的全部(右边出它的自报卡), 前缀, disk:夹/…, 'stem!' Stem 改版,
    // '旧!' 上一代的, '清!' 清理, '系统!' 系统资料
    const S = 界面.S, f = 数据.盘(处) && 磁盘.找(处.slice(5).split('/')[0]);
    if (处 === 'stem!') return 看.开('stem!');
    Object.assign(S, { 处, q: '', 型: '' }).多.clear();
    if (处 === '清!') S.勾 = new Set(体检.选(界面.清单(), 0).map(e => e.key));   // 默认只勾轻清里判得准的
    界面.$('.pk-q').value = '';
    if (处[0] !== '@') 界面.pk.classList.remove('rail');   // 点的是一块: 抽屉留着, 好看它下面的前缀
    if (f && !S.好[f.name] && !(S.好[f.name] = await 磁盘.好(f, 1)))
      return 界面.说('没接上: 浏览器要你点「允许」才能读写这个文件夹', 1);
    if (f) S.盘条 = await 磁盘.list(处);
    界面.画();
    if (处 === '@stem') [看.k, 界面.$('.pk-one').innerHTML] = ['', 界面.空];   // Stem 没有自报卡
    else if (处[0] === '@') await 界面.卡(处.slice(1));
  },
  async 卡(id, 此刻) { // 右边画这块的自报卡(界面块画), 点它占的数据去那个前缀; 界面块不在只写一句用处
    const b = 归属.块.find(x => x.owner === id) || { icon: '', 块: id, about: {} }, el = 界面.$('.pk-one');
    [看.k, 界面.S.选, 界面.S.卡] = ['', '', id];
    ctx.root.querySelectorAll('.pk-r.on').forEach(r => r.classList.remove('on'));
    el.innerHTML = `${界面.回}<div></div>`;
    if (!colony.has('ui.card')) return (el.lastChild.textContent = `${b.块}: ${b.about.desc || ''}`);
    await ctx.call('ui.card', { id, el: el.lastChild, 此刻, 点数据: p => 界面.去(p) });
  },
  资料() { // 系统资料: 每块一行, 点了右边出它的自报卡连此刻的样子(全能 agent 的就是系统提示)
    const bs = 归属.块.filter(b => b.owner !== 'stem'), 技 = b => (b.about.skills || []).length;
    界面.$('.pk-list').innerHTML = '<div class="pk-lh"><button class="pk-menu" data-do="栏">☰</button>'
      + `<b>📖 系统资料 <small>${bs.length} 块</small></b></div><p class="pk-h">点一块看它的用处、技能、能力、数据; `
      + '全能 agent 那块还有它每轮真发给模型的系统提示和工具</p>'
      + bs.map(b => `<div class="pk-r${界面.S.卡 === b.owner ? ' on' : ''}" data-card="${esc(b.owner)}`
        + `" title="${esc(b.about.desc)}`
        + `"><i>${esc(b.icon)}</i><b>${esc(b.块)}</b><small>${技(b) ? `${技(b)} 条技能` : ''}`
        + `</small><span class="pk-k">${esc(b.about.desc)}</span></div>`).join('');
  },
  get 档名() { return 体检.档名; },
  清单() { // 三档见体检; 扫一次库只算一次
    const S = 界面.S;
    return S.检 && S.检.条 === S.条 ? S.检.l : (S.检 = { 条: S.条, l: 体检.跑(S.条) }).l;
  },
  列() { // 每行: 图标、人话名、大小和时间、原始键(搜着时换成命中处前后文); 底下一道大小条, 按这一栏最大的一项算
    const S = 界面.S, 处 = S.处, 清 = 处 === '清!', 旧 = 处 === '旧!', 放 = 数据.盘(处) || 处 === 'media:';
    if (处 === '系统!' && !S.q) return 界面.资料();
    const 全 = 旧 ? 继承.案.搬.map(([k, v]) => Object.assign(数据.条(k, v), { 注: 继承.案.盖.includes(k)
      ? '会盖掉这边的 · ' : '这边没有 · ' })) : 清 ? 界面.清单() : 数据.盘(处) ? S.盘条 : S.q ? 数据.搜(S.条, S.q)
      : S.条.filter(e => !处 || (处[0] === '@' ? e.主 && e.主.owner === 处.slice(1) : e.key.startsWith(处)));
    const 桶 = 清 || 旧 ? [] : [...new Set(全.map(认.桶))];
    if (!桶.includes(S.型)) S.型 = '';
    const l = 全.filter(e => !S.型 || 认.桶(e) === S.型).sort((a, b) => (a.档 || 0) - (b.档 || 0)
      || (b.类 === 'dir') - (a.类 === 'dir') || (S.新 ? (b.at || 0) - (a.at || 0) : b.bytes - a.bytes));
    const 大 = Math.max(1, ...l.map(e => e.bytes || 0)), 勾着 = l.filter(e => S.勾.has(e.key)),
      按 = (a, t, c, 多) => `<button data-do="${a}"${c ? ` class="${c}"` : ''}${多 || ''}>`
        + `${t}</button>`, 谁 = e => e.主 && (!处 || S.q) ? `${e.主.icon} ` : '';   // 全部和搜索里, 第二行先写是哪块的
    界面.$('.pk-list').classList.toggle('q', !!S.q);   // 搜着的时候键那一行换成命中处前后文, 能折行
    界面.$('.pk-list').innerHTML = '<div class="pk-lh"><button class="pk-menu" data-do="栏">☰</button><b>'
      + `${esc(旧 ? '上一代要搬过来的' : 清 ? '🧹 清理' : S.q ? `找「${S.q}」` : 界面.名(处))} <small>${l.length} 项</small></b>`
      + (清 ? [['轻清', 0], ['深清', 1], ['重置', 2]].map(([t, n]) => 按('档', `${t} · ${认.大小(体检.量(体检.选(全, n)))}`, '', ` data-n="${n}"`))
        .join('') + 按('清', `🧹 清掉勾上的 ${勾着.length} 项 · ${认.大小(勾着.reduce((s, e) => s + e.bytes, 0))}`,
        'pk-del') : 旧 ? '' : 按('排', S.新 ? '新的在前' : '大的在前') + (放 ? 按('选文件', '＋ 文件') + 按('笔记', '＋ 笔记') : '')
        + (/^disk:[^/]+\/$/.test(处) ? 按('断开', '断开这个文件夹') : ''))
      + (桶.length > 1 ? `<div class="pk-tp">${['全部'].concat(桶).map(t => 按('型', t,
        (S.型 || '全部') === t ? 'on' : '', ` data-t="${t}"`)).join('')}</div>` : '')
      + `${S.多.size ? `<div class="pk-sel"><b>已选 ${S.多.size} 项</b>${按('删选', '🗑 删选中的', 'pk-del')}`
        + `${按('不选', '取消')}</div>` : ''}</div>`   // 盖在表头上, 不把下面的行往下挤
      + (清 ? '<p class="pk-h">轻清只清没人用的; 深清再清对话、记忆、成品、应用、工作流; 重置连代码改动和 AI 配置都回出厂(先下载一份备份)。'
        + '❓ 是判不准的, 轻清不勾。勾好了点两下「清掉」</p>' : '')
      + l.slice(0, 300).map((e, i) => `${清 && e.档 !== (l[i - 1] || {}).档 ? `<p class="pk-h">${界面.档名[e.档]}`
        + '</p>' : ''}<div class="pk-r${e.key === S.选 ? ' on' : ''}${S.多.has(e.key) ? ' sel' : ''}`
        + `"${清 || 旧 ? '' : ' draggable="true"'} data-k="${esc(e.key)}" data-w="`
        + `${esc(S.q && e.where)}" title="${esc(e.key)}" style="--w:${(e.bytes || 0) / 大 * 100}%"><i>`
        + `${清 ? `<input type="checkbox" data-勾="${esc(e.key)}"${S.勾.has(e.key) ? ' checked' : ''}>`
          : 认.图标[e.类] || '·'}</i><b>${esc(界面.叫(e.key, e.name))}</b><small>`
        + `${e.类 === 'dir' ? '' : e.待称 ? '…' : 认.大小(e.bytes)}${e.at ? ` · ${界面.时(e.at)}` : ''}</small><span class="pk-k">`
        + `${e.注 || ''}${谁(e)}${S.q && e.摘录 ? 看.亮(esc(e.摘录)) : esc(e.key)}</span></div>`).join('')
      + (l.length ? '' : `<p class="pk-h pk-0">${S.q ? `没找到「${esc(S.q)}」` : 清 ? '没有能清的'
        : `这里还没有东西${放 ? '<br>文件拖进来就放进这里' : ''}`}</p>`)
      + (l.length > 300 ? `<p class="pk-h">还有 ${l.length - 300} 项没列: 搜一下, 或换个排法</p>` : '');
  },
  async 点(e) { // 只认口袋里面的: 往上找会越过口袋, 找到界面块窗上同名的 data-k
    const t = e.target, S = 界面.S, 里 = e.currentTarget,
      找 = s => { const x = t.closest(`[${s}]`); return x && 里.contains(x) && x; },
      抽 = 界面.$('.pk.rail');
    if (抽 && !t.closest('.pk-rail,.pk-menu')) return 抽.classList.remove('rail');   // 抽屉开着, 点外面的暗处就关
    const d = 找('data-do'), 处 = 找('data-in'), 勾 = 找('data-勾'), 卡 = 找('data-card'),
      r = t.closest('.pk-r'), a = 找('data-k'), 页 = 找('data-页'), 做 = 找('data-act');
    if (d) return 界面.做[d.dataset.do](d);
    if (处) return 界面.去(处.dataset.in);
    if (卡) {
      界面.pk.classList.add('one');
      await 界面.卡(卡.dataset.card, true);
      return 卡.classList.add('on');
    }
    if (页) return 看.画(看.页 = 页.dataset.页);
    if (做) return 看.做[做.dataset.act](做);
    if (勾) return S.勾[勾.checked ? 'add' : 'delete'](勾.dataset.勾), 界面.列();
    if (r && (e.ctrlKey || e.metaKey) && !/!$/.test(S.处)) { // 删不了的不让选, 当场说为什么
      const k = r.dataset.k, 不 = !S.多.has(k) && 看.不能(k, 1);
      if (不) return 界面.说(`「${r.querySelector('b').textContent}」${不}`, 1);
      S.多[S.多.has(k) ? 'delete' : 'add'](k);
      return 界面.列();
    }
    if (a) {
      e.currentTarget.focus({ preventScroll: true });
      return a.dataset.k.endsWith('/') ? 界面.去(a.dataset.k) : 看.开(a.dataset.k, 0, a.dataset.w);
    }
  },
  做: {
    扫: () => 界面.扫().then(() => 界面.说(`重扫好了: ${界面.S.条.length} 项`)),   // 多数时候它自己会扫, 人点了要看得出扫过
    栏: () => 界面.pk.classList.toggle('rail'),
    排: () => (界面.S.新 = !界面.S.新, 界面.列()),
    型: b => (界面.S.型 = b.dataset.t === '全部' ? '' : b.dataset.t, 界面.列()),
    不选: () => (界面.S.多.clear(), 界面.列()),
    回: () => 界面.pk.classList.remove('one'),
    连: async () => 界面.去(`disk:${await 磁盘.连()}/`),
    async 断开() {
      const n = 界面.S.处.slice(5, -1);
      await 磁盘.断(n);
      await 界面.去('');
      界面.说(`断开了「${n}」: 电脑上的文件都还在, 要用再连`);
    },
    选文件() {
      const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
      inp.onchange = () => 界面.收([...inp.files], 数据.盘(界面.S.处) ? 界面.S.处 : 'media:', '从电脑里选的');
      inp.click();
    },
    async 笔记() { // 新建一条 .md 直接进「改」
      const 处 = 界面.S.处, 名 = `笔记 ${界面.时(Date.now()).replace(/[/:\s]/g, '-')}.md`;
      const { key } = await 数据.set({ key: 数据.盘(处) ? 处 + 名 : 'media:', value: { name: 名, text: '' } }, ctx.id);
      await 界面.扫();
      await 界面.去(数据.盘(处) ? 处 : 'media:');
      看.页 = '改';
      await 看.开(key, 1);
      const t = 界面.$('.pk-ed');
      if (t) t.focus();
    },
    新建: () => 看.新(),
    清理: () => 界面.去('清!'),
    档: b => {
      界面.S.勾 = new Set(体检.选(界面.清单(), +b.dataset.n).map(e => e.key));
      界面.列();
    },
    async 清(b) { // 点两下; 勾了重置那一档的: 先下载一份备份, 清完软重启
      const l = 界面.清单().filter(e => 界面.S.勾.has(e.key)), 重 = l.some(e => e.档 === 2);
      if (!l.length) return 界面.说('先勾上要清的', 1);
      if (b.classList.toggle('pk-sure')) {
        const 原 = b.textContent;
        b.textContent = 重 ? '再点一次: 先下载备份, 再全部回到出厂' : '再点一次: 删了找不回';
        return setTimeout(() => { b.classList.remove('pk-sure'); b.textContent = 原; }, 3000);
      }
      if (重) {
        const { html } = await 继承.出(true);
        界面.下载(URL.createObjectURL(new Blob([html], { type: 'text/html' })),
          `Colony 重置前的备份 ${界面.时(Date.now()).replace(/[/:\s]/g, '-')}.html`);
      }
      const r = await 体检.清(l.map(e => e.key), 重);
      看.空();
      await 界面.扫();
      界面.说(`清掉了 ${r.n} 项 · ${认.大小(体检.量(l))}${r.错.length ? `; 没清成 ${r.错.length} 项: ${r.错[0]}` : ''}${重 ? '; 马上重启' : ''}`, r.错.length);
      if (重) setTimeout(() => ctx.call('stem.reboot').catch(界面.错), 1500);
    },
    导出: () => 看.出面(),
    删选: b => 看.删([...界面.S.多], b),
    搬旧: () => 继承.搬(),
    不搬: () => 继承.记('不用了'),
    看旧: () => 界面.去('旧!'),
  },
  async 拖(e) { // 外面的文件放进来; 条目拖到左边的文件夹或口袋上 = 复制过去。都拦住, 别让桌面也收
    const ts = [...e.dataTransfer.types], 外 = ts.includes('Files');
    if (!外 && !ts.includes('text/x-porter')) return;
    e.preventDefault();
    e.stopPropagation();
    界面.pk.classList.toggle('drop', e.type === 'dragover' && 外);
    if (e.type !== 'drop') return;
    const 落 = e.target.closest('[data-in^="disk:"],[data-in="media:"]'), 处 = 界面.S.处;
    const 到 = 落 ? 落.dataset.in : 数据.盘(处) ? 处 : 'media:';
    if (外) return 界面.收([...e.dataTransfer.files], 到, '从电脑拖进来的');
    await 数据.copy({ from: e.dataTransfer.getData('text/x-porter'), to: 到 }, ctx.id);
    界面.说(`复制到了 ${界面.名(到)}`);
    await (到 === 处 && 数据.盘(处) ? 界面.去(处) : 界面.扫());
  },
  async 收(fs, 到, 从) { // 从: 写进「从哪来」; 导出的口袋文件不当网页收, 把它带的数据放进来
    let 末 = '', 包, n = 0;   // 包: 没选导出的口袋 undefined / 早放过 null / {n, 刷新}
    for (const f of fs) {
      const 带 = !数据.盘(到) && /\.html?$/i.test(f.name) && 继承.读包(await f.text());
      if (带) { 包 = await 继承.播(带); continue; }
      末 = (await (数据.盘(到) ? 磁盘.set(到 + f.name, f).then(() => ({ key: 到 + f.name }))
        : 数据.set({ key: 'media:', value: await 认.记录(f, f.name, 从) }, ctx.id))).key;
      n++;
    }
    await 界面.扫();
    await 界面.去(数据.盘(到) ? 到 : 'media:');   // 清掉搜索, 看得到刚放进来的
    if (末) await 看.开(末);
    界面.说([n && `放进了 ${n} 个文件`, 包 === null && '这份导出的口袋早就放进来过了',
      包 && `从导出的口袋里放进了 ${包.n} 项(这边已有、又不比它旧的没动)`
        + (包.刷新 ? '; 有别的块的数据, 刷新页面后那几块才用上' : '')].filter(Boolean).join('; '));
  },
  键(e) { // ↑↓ 挪, Ctrl+S 存; 搜索框里有字时 Esc 只清搜索; 别的键照常给界面块(Esc 关窗)
    const rs = [...ctx.root.querySelectorAll('.pk-r[data-k]')], i = rs.findIndex(r => r.dataset.k === 界面.S.选);
    if (e.key === 'Escape' && e.target.classList.contains('pk-q') && e.target.value) {
      e.target.value = 界面.S.q = '';
      界面.画();
      return e.stopPropagation();
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey) && e.target.closest('.pk-view')) 看.做[看.k ? '存' : '建']();
    else if (e.target.closest('input,textarea')) return;
    else if (/^Arrow(Up|Down)$/.test(e.key) && rs.length) {
      const r = rs[Math.max(0, Math.min(rs.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))];
      r.scrollIntoView({ block: 'nearest' });
      看.开(r.dataset.k);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  说(t, 错) {
    const m = 界面.$('.pk-msg');
    if (!m) return;
    m.textContent = t;
    m.style.color = 错 ? 'var(--danger,#f44)' : '';
    clearTimeout(界面.说时);
    界面.说时 = setTimeout(() => { m.textContent = ''; }, 4000);
  },
};
// ═ 看 · 跟着: 认, 归属, 磁盘, 数据, 继承, 界面 ═
// 右边看一条: 名字和键; 追溯(谁的、从哪来、被谁引用; 它提到的键在预览里直接能点); 一排能做的事; 预览 / 改。
// 能做的事放在上面: agent 对话栏展开时会盖住窗口下半截。网页不自动跑(看一眼不该执行), 点了才在隔离的小窗里跑。
// 右边也放「新建」和「导出口袋」这两张单子
const 看 = {
  k: '', v: null, r: {}, 页: '预览', where: '', 旧: false,
  不能(k, 删) { // 为什么改不了(删: 删不了), 说人话; 能就回 ''
    if (数据.网(k)) return '是网址, 只能读';
    if (k === 'stem!') return '在浏览器本地存储里, 这里改不了';
    try { 归属.守(k, ctx.id, 删); return ''; } catch (e) { return e.人话 || e.message; }
  },
  能写: k => !看.不能(k),
  能删: k => !看.不能(k, 1),
  能改: k => 看.能写(k) && !看.r.src && !看.旧,
  async 开(k, 留页, where) {
    Object.assign(看, { k, where: where || '' }, 留页 ? {} : { 页: '预览' });
    ctx.root.querySelectorAll('.pk-r').forEach(r => r.classList.toggle('on', r.dataset.k === (界面.S.选 = k)));
    界面.pk.classList.add('one');
    const 媒 = 数据.盘(k) && !/text|html/.test(认.型(认.mime('', k)));   // 磁盘上的媒体不读进来, 给浏览器直接放
    const 旧 = 界面.S.处 === '旧!' && 继承.案 && 继承.案.搬.find(([x]) => x === k);   // 「先看看」上一代的
    看.旧 = !!旧;
    看.v = 旧 ? 旧[1] : k === 'stem!' ? null
      : 媒 ? { name: 界面.尾(k), from: k, url: URL.createObjectURL(await 磁盘.文件(k)) }
        : await 数据.get({ key: k, path: '' });
    看.r = k === 'stem!' ? { 类: 'text', name: 'Stem 改版' } : 认.出(看.v);
    看.画();
  },
  亮: h => !界面.S.q ? h : h.replace(new RegExp(`(${esc(界面.S.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>'),   // 搜着的词在预览里也亮; 不碰标签里面
  链: (k, t, w) =>`<a data-k="${esc(k)}" data-w="${esc(w)}">${esc(t || k)}</a>`,
  字(s) { // 字里正好是库里的键就能点; data 网址只写类型和大小; Key 写成末四位; 太长只露头
    if (/^data:/.test(s)) return `‹${esc(认.mime(s))} ${认.大小(认.字节(s))}›`;
    const 有 = w => w !== 看.k && 界面.S.条.some(e => e.key === w), 词 = /[^\s"'`<>()[\]{},]+|[^]/g;
    return 认.显(String(s).slice(0, 5000)).replace(词, w => 有(w.replace(/^show:/, ''))
      ? 看.链(w.replace(/^show:/, '')) : esc(w)) + (s.length > 5000 ? `…(共 ${s.length} 字)` : '');
  },
  谁(k) { // 追溯框第一行: 谁的, 改它去哪
    if (k === 'stem!') return '🧬 Stem';
    if (数据.盘(k)) return '📁 磁盘上的文件';
    const n = 归属.of(k);
    if (!n) return '没人认领';
    const r = document.querySelector(`[data-block-id="${n.owner}"]`),   // 和界面块判断「有页面」同一个办法
      有页 = r && r.offsetHeight > 0 && !r.contains(ctx.root);
    const 开 = n.owner !== ctx.id && 有页 ? ` <button data-act="主" data-o="${esc(n.owner)}">打开 ${esc(n.块)}`
      + '</button>' : '';   // 没有自己页面的块、口袋自己, 都不给这个键
    return `${n.icon || ''} ${esc(`${n.块} · ${n.label}`)}${n.两家 ? ' · 两家都认, 经口袋谁都不能改'
      : !n.edit ? '' : !n.running ? ' · 主人没在跑, 可以直接改' : ` · 要改去「${esc(n.块)}」${开}`}`;
  },
  画() {
    const k = 看.k, r = 看.r, 链 = 看.链, 条 = 界面.S.条.find(e => e.key === k);
    const 反 = 界面.S.条.filter(x => x.key !== k && x.叶.some(([, t]) => t.includes(k))).slice(0, 20);
    const 块 = r.from && 归属.表.find(n => n.owner === r.from), 有 = r.from && 界面.S.条.some(e => e.key === r.from);
    const 来 = 块 ? `${esc(块.块)} 新建的` : r.from && (/^(https?:|disk:)/.test(r.from) || 有) ? 链(r.from)
      : esc(r.from);   // 来源是块 id 写块名; 网址、文件、库里真有的键才能点
    const 源 = `${看.旧 ? `上一代的, 还没搬过来${继承.案.盖.includes(k) ? '; 这边也有一份, 搬了会用上一代的' : ''}`
      + '<br>' : ''}谁的: ${看.谁(k)}${来 ? `<br>从哪来: ${来}${r.at ? ` · ${界面.时(r.at)}` : ''}`
      : r.at ? `<br>放进来的时候: ${界面.时(r.at)}` : ''}`
      + (k === 'stem!' || 看.旧 || !反.length ? '' : `<br>被引用 ${反.length} 处 `
        + 反.map(x => 链(x.key, x.name || x.key, 数据.找(x, k.toLowerCase()).where)).join(''));
    const 可改 = 看.能改(k), 页 = (可改 ? ['预览', '改'] : r.类 === 'html' ? ['预览'] : [])   // 只一个就不画
      .map(t => `<button data-页="${t}"${看.页 === t ? ' class="on"' : ''}>${t}</button>`)
      .join('');
    const 内 = 看.页 === '改' && 可改 ? 看.改() : 看.预览(), 有值 = 看.v != null;
    const 钮 = k === 'stem!' ? [] : 看.旧 ? [['下', '⤓ 下载']] : [   // 还没有值的只能改
      看.页 === '改' && 可改 && ['存', '保存 (Ctrl+S)'], 有值 && ['下', '⤓ 下载'],
      !/^(media|disk):/.test(k) && (r.src || r.text !== undefined) && ['收', '📥 收进口袋'],
      有值 && colony.has('agent.attach') && ['给', '🤖 给 agent'], 有值 && 看.能删(k) && ['删', '🗑 删掉']];
    钮.unshift(/<details[^]*<details/.test(内) && ['全', '展开 / 收回']);   // 树不止一层才给
    界面.$('.pk-one').innerHTML = `${界面.回}<h3>${认.图标[r.类] || ''}`
      + ` ${esc(界面.叫(k, r.name))}</h3><div class="pk-k">${esc(k)}${条 ? ` · ${认.大小(条.bytes)}` : ''}`
      + `</div><div class="pk-src">${源}</div><div class="pk-acts">${页 && `<span class="pk-tabs">${页}`
        + '</span>'}${钮.filter(Boolean).map(([a, t]) => `<button data-act="${a}"`
        + `${a === '删' ? ' class="pk-del"' : ''}>${t}</button>`).join('')}`
      + `</div><div class="pk-view">${内}</div>`;
    const hit = 界面.$('.pk-view .hit');
    if (hit) hit.scrollIntoView({ block: 'center' });
  },
  树(v, p) { // 对象、数组能收起; 定位到的那一处展开并亮出来
    const 中 = 看.where && `${看.where}.`.startsWith(`${p}.`);
    if (!v || typeof v !== 'object') {
      return `<span${中 && p ? ' class="hit"' : ''}>${看.字(String(v))}</span>`;
    }
    const 里 = Object.keys(v).slice(0, 300)
      .map(x => `<div><b>${esc(x)}</b>: ${看.树(v[x], p ? `${p}.${x}` : x)}</div>`).join('');
    return `<details${!p || 中 ? ' open' : ''}><summary>`
      + `${Array.isArray(v) ? `[${v.length}]` : '{…}'}</summary>${里}</details>`;
  },
  预览() {
    const r = 看.r, v = 看.v, 到 = 看.where ? +看.where.split('.')[0] : -1;
    if (看.k === 'stem!') return '<p>Stem 改版在这个浏览器的本地存储里, 不在库里, 换浏览器或清站点数据就没了; 正在用'
      + `${界面.S.stem.use === 'edited' ? '改版' : '原版'}。要换回原版, 可以跟 agent 说「把 Stem 换回原版」, 然后重新打开页面。</p>`;
    if (r.src && /image|audio|video/.test(r.类)) return r.类 === 'image' ? `<img src="${esc(r.src)}">`
      : `<${r.类} controls src="${esc(r.src)}"></${r.类}>`;
    if (r.src) return `<p>${esc(r.mime || '文件')}: 下载下来用</p>`;
    if (r.类 === 'html') return `<button data-act="跑">▶ 在隔离的小窗里跑</button><pre>${esc(r.text)}</pre>`;
    if (r.text !== undefined) return `<pre>${看.亮(看.字(r.text))}</pre>`;
    if (v == null) return `<p class="pk-h">还没有值。${esc((归属.of(看.k) || {}).label)}</p>`;
    const 说 = m => [].concat(m.content).map(x => x && x.text || (typeof x === 'string' ? x
      : `[${x && x.name || '片'}]`)).concat((m.toolCalls || []).map(c => `⚙ ${c.name}`)).join(' ');
    if (r.类 === 'chat') return v.map((m, i) => `<div class="pk-m${i === 到 ? ' hit' : ''}"><small>`
      + `${esc(m.role)}${m.at ? ` · ${界面.时(m.at)}` : ''}</small><pre>${看.字(说(m))}</pre></div>`)
      .join('');
    return 看.树(v, '');
  },
  改() { // 有字的记录(笔记、网页)只改字和名字, 别的改整份 JSON; 存时 JSON 不合格就不写, 不悄悄变成字符串
    const v = 看.v, f = v && typeof v === 'object' && ['text', 'code'].find(x => typeof v[x] === 'string');
    看.改的 = f;
    const 原 = typeof v === 'string' || v == null ? v : f ? v[f] : JSON.stringify(v, null, 2);
    return (f && 'name' in v ? `<input class="pk-name" value="${esc(v.name)}">` : '')
      + `<textarea class="pk-ed" spellcheck="false" placeholder="${esc((归属.of(看.k) || {}).label)}`
      + `">${esc(原)}</textarea>`;
  },
  空(h, 内) { // 右边不对着哪一条: 给 h 就放一张单子(新建、导出口袋), 不给就回到空白的提示
    Object.assign(看, { k: '', 旧: false });
    界面.pk.classList.toggle('one', !!h);   // 窄屏: 有单子就翻到右边, 左边抽屉收起
    界面.pk.classList.remove('rail');
    界面.$('.pk-one').innerHTML = h ? `${界面.回}<h3>${h}</h3>${内}`
      : 界面.空;
  },
  新() { // 键名自己起; 内容以 { [ " 开头就按 JSON 存, 不合格不建
    看.空('＋ 新建一条', '<div class="pk-src">键名像「notes:购物」, 冒号前面是哪一类。内容直接写字就存成文字; '
      + '以 { 或 [ 开头的按 JSON 存, 写错了不建, 会说错在哪</div><input class="pk-name pk-nk" placeholder="键名">'
      + '<div class="pk-acts"><button data-act="建">建好 (Ctrl+S)</button></div><div class="pk-view">'
      + '<textarea class="pk-ed" spellcheck="false" placeholder="内容"></textarea></div>');
    界面.$('.pk-nk').focus();
  },
  出面() { // 导出口袋: 先说清带什么、这种文件能不能发给别人
    const 可 = 界面.S.条.filter(e => !继承.不带(e.key)), 己 = 可.filter(e => /^media:/.test(e.key)),
      计 = l => `${l.length} 项, ${认.大小(l.reduce((s, e) => s + e.bytes, 0))}`;
    看.空('📦 导出口袋', `<div class="pk-src">把文件和笔记(${计(己)})装进一个网页文件。换台电脑双击它就能看、`
      + '能改, 改完还能再导出; 在别的 Colony 里用口袋的「＋ 放文件进来」选它, 里面的东西就放进那边的口袋。<br>'
      + `<label><input type="checkbox" class="pk-all"> 连别的块的数据也带上(${计(可)}; 会带上 AI 配置里的 Key, `
      + '这样的文件别发给别人)</label></div><div class="pk-acts"><button data-act="导出">📦 导出</button></div>');
  },
  async 删(ks, b, 词) { // 点两下才删(删了找不回): 第一下按钮自己变红字说清后果, 3 秒不点就复原; 多条时照实报删成几项
    if (b.classList.toggle('pk-sure')) { // 第一下
      const 原 = b.textContent;
      b.textContent = '再点一次: 删了找不回';
      return setTimeout(() => { b.classList.remove('pk-sure'); b.textContent = 原; }, 3000);
    }
    const 错 = [];
    for (const k of ks) {
      await 数据.del({ key: k }, ctx.id).catch(e => 错.push(e.人话 ? `「${界面.叫(k)}」${e.人话}` : e.message));
    }
    界面.S.多.clear();
    看.空();
    await (数据.盘(ks[0]) ? 界面.去(界面.S.处) : 界面.扫());
    界面.说(`${词 || '删了'} ${ks.length - 错.length} 项${错.length ? `; 没删成 ${错.length} 项: ${错[0]}` : ''}`, 错.length);
  },
  做: {
    下() { // 下到的是能用的东西: 媒体是原件, 字是字(网页是 .html), 别的是 JSON
      const r = 看.r, 字 = r.text !== undefined;
      界面.下载(r.src || URL.createObjectURL(new Blob([字 ? r.text : JSON.stringify(看.v, null, 2)],
        { type: r.mime })),
        r.name || 界面.叫(看.k) + (字 ? r.类 === 'html' ? '.html' : '.txt' : r.src ? '' : '.json'));
    },
    async 收() {
      const { key } = await 数据.copy({ from: 看.k, to: 'media:' }, ctx.id);
      界面.说('收进口袋了: 复制了一份放在「文件和笔记」里');
      await 界面.扫();
      看.开(key);
    },
    给: () => ctx.call('agent.attach', { name: 界面.叫(看.k, 看.r.name),
      text: `库里的 ${看.k}: 读用 data.get {key}; `
      + '原件交给能力写 {"$ref": 键}; 给人看写 [[show:键]]' }).then(() => 界面.说('放到 agent 输入框上面了, 补一句话再发')),
    删: b => 看.删([看.k], b),
    全() { // 有收着的就全展开, 都开着就全收回(最外层留着)
      const d = [...ctx.root.querySelectorAll('.pk-view details')], 开 = d.some(x => !x.open);
      d.forEach((x, i) => { x.open = 开 || !i; });
    },
    主: b => ctx.call('ui.do', { target: `block:${b.dataset.o}`, action: '打开' }),
    跑: () => 界面.$('.pk-view').replaceChildren(Object.assign(document.createElement('iframe'),
      { sandbox: 'allow-scripts', srcdoc: 看.r.text })),
    async 存() {
      const v = 看.v, t = 界面.$('.pk-ed').value, nm = 界面.$('.pk-name');
      let nv = t;
      if (看.改的) nv = Object.assign({}, v, { [看.改的]: t }, nm ? { name: nm.value } : {});
      else if (typeof v !== 'string' && v != null) {
        try { nv = JSON.parse(t); } catch (e) { return 界面.说(`没存: JSON 不合格, ${e.message}`, 1); }
      }
      await 数据.set({ key: 看.k, value: nv }, ctx.id);
      await (数据.盘(看.k) ? 看.开(看.k, 1) : 界面.扫());
      界面.说('存好了');
    },
    async 建() {
      const k = 界面.$('.pk-nk').value.trim(), t = 界面.$('.pk-ed').value;
      const 不 = !k || /:$/.test(k) ? '键名要写全, 比如 notes:购物' : /^(disk:|https?:)/.test(k)
        ? '这里只建库里的; 文件夹里的用「＋ 文件」放' : 界面.S.条.some(e => e.key === k)
          ? `已经有「${k}」了, 在列表里点它去改` : '';
      if (不) return 界面.说(不, 1);
      let v = t;
      if (/^\s*[[{"]/.test(t)) {
        try { v = JSON.parse(t); } catch (e) { return 界面.说(`没建: JSON 不合格, ${e.message}`, 1); }
      } else if (/^media:/.test(k)) v = { name: k.slice(6), text: t };   // 口袋自己的文件和笔记都是带名字的记录
      await 数据.set({ key: k, value: v }, ctx.id);
      await 界面.扫();
      await 看.开(k);
      界面.说('建好了');
    },
    async 导出() {
      const { n, html } = await 继承.出(界面.$('.pk-all').checked);
      界面.下载(URL.createObjectURL(new Blob([html], { type: 'text/html' })),
        `次元口袋 ${界面.时(Date.now()).replace(/[/:\s]/g, '-')}.html`);
      界面.说(`导出了 ${n} 项, 文件 ${认.大小(编.encode(html).length)}`);
    },
  },
};

// ── 体检(清理三档, 用到 认, 归属, 数据, 继承) ──
// 清理分三档, 后一档包含前一档:
//   轻清 = 没人用的(过程文件、重复的副本、删掉的应用和对话留下的、旧版自报); 对话、记忆、成品、应用连它读的素材、工作流都留着
//   深清 = 再清对话、记忆、成品、应用、工作流; 留 code:(代码解读和改动记录)、settings:(AI 配置、各块设置、连着的文件夹)、
//          block:(块的改版)和 agent 用哪家模型(agent.brain、agent.voice)
//   重置 = 全清, 块的改版和 Stem 恢复出厂, 再软重启: 回到刚拿到这个文件的样子
// 「有人用」= 在跑的块自报认领的(那块自己管), 或键(应用存的用短名)出现在根的字里。根: 应用源码和它存的、成品、工作流、设置、记忆; 对话记录不算根(什么都提过),
// 只保住自己的附件 ref:<会话>:。应用源码里拼出来的键('a.' + k)判不准, 标 ❓, 轻清不勾。
// 不另读库: 用扫库时每条已有的字(叶)和媒体原件(src)算, 一百来条十几毫秒
const 体检 = {
  档名: ['轻清 · 没人用的过程文件和残留(对话、成品、应用都还完整能用)',
    '深清 · 对话、记忆、成品、应用、工作流(代码解读和改动、AI 配置和设置、连着的文件夹留着)',
    '重置 · 代码解读和改动、AI 配置和设置、连着的文件夹也清掉, 块恢复出厂'],
  级: { light: 0, deep: 1, reset: 2 },
  留: k => /^(code:|settings:|block:)/.test(k) || /^agent\.(brain|voice)$/.test(k),
  家: /^(chat\.|agent\.|miniapp:|media:|workflow:|wfout:|wfrun:|settings:|code:|block:)/,
  根: k => /^(miniapp:|appstore:|media:|workflow:|wfout:|wfrun:|settings:|agent\.)/.test(k),
  跑(条) { // → 每条加上 档(0 轻清 1 深清 2 重置)、疑、注(为什么)
    const 有 = new Set(条.map(e => e.key)), 文 = {}, 店 = {}, 同 = new Map();
    for (const e of 条) {
      文[e.key] = (e.叶 || []).map(x => x[1]).join('\n');
      const m = /^appstore:([^:]+):/.exec(e.key);
      if (m) (店[m[1]] = 店[m[1]] || []).push(e);
      if (e.src && e.bytes > 65536) 同.set(e.src, (同.get(e.src) || []).concat(e.key));
    }
    const 根文 = 条.filter(e => 体检.根(e.key)).map(e => 文[e.key]).join('\n');
    const 判 = e => { // → [没人用, 理由, 判不准]
      const k = e.key; let m;
      if (/^datamap:/.test(k)) return [1, '旧版自报, 已经不用'];
      if ((m = /^appstore:([^:]+):(.+)$/.exec(k))) {
        const [, id, 短] = m, 源 = 文['miniapp:' + id];
        if (源 === undefined) return [1, '应用已删, 它存的东西还留着'];
        if (源.includes(短) || 根文.includes(k)) return [0];
        if (店[id].some(x => x.key !== k && 文[x.key].includes(短))) return [0];
        const 段 = 短.split('.'), 引 = x => ['"', "'", '`'].some(q => 源.includes(q + x + q));
        for (let i = 段.length - 1; i > 0; i--) { // 源码 'a.' + k 拼键: 后半截(m.p2)写在源码里就是在读; 只拼没写才判不准
          const p = 段.slice(0, i).join('.') + '.', 后 = 段.slice(i).join('.');
          if (!new RegExp('[\'"`]' + p.replace(/\./g, '\\.') + '[\'"`]\\s*\\+|`' + p.replace(/\./g, '\\.') + '\\$\\{').test(源)) continue;
          if (引(后)) return [0];
          return [1, `应用源码用 '${p}' + … 拼键读, 可能在用`, 1];
        }
        return [1, '应用的源码和它存的东西里都没读它'];
      }
      if ((m = /^ref:([^:]+):/.exec(k))) return 有.has('chat.transcript.' + m[1]) ? [0] : [1, '所在的对话已删'];
      if (/^wfasset:/.test(k)) return 根文.includes(k.slice(8)) ? [0] : [1, '工作流和成果里都没用到'];
      if (体检.家.test(k)) return [0];
      // 在跑的块在自报里认领了的前缀(配置、数据、状态)由那块自己管着: 它自己清自己的, 轻清不替它判
      if (e.主 && e.主.owner !== 'stem' && (归属.块.find(x => x.owner === e.主.owner) || {}).running) return [0];
      return 根文.includes(k) ? [0] : [1, '哪里都没引用它(多半是做东西时的中间文件)'];
    };
    const 判过 = new Map(条.map(e => [e.key, 判(e)]));
    for (const ks of 同.values()) { // 同一份存了几处: 留一处在用的(应用读的优先), 别的都是多出来的副本, 轻清
      if (ks.length < 2) continue;
      const 用 = k => /^appstore:/.test(k) && !判过.get(k)[0];   // 应用在读的那份各留各的(应用只读自己存的)
      const 留 = ks.find(用) || ks.find(k => /^media:/.test(k)) || ks[0];
      for (const k of ks) if (k !== 留 && !用(k)) 判过.set(k, [1, `和 ${留} 是同一份, 留那一份`]);
    }
    return 条.filter(e => e.key !== 'chat.running' && e.key !== 'settings:porter.mine').map(e => {
      const [没, 由, 疑] = 判过.get(e.key), 副 = 没 && e.src && !/同一份/.test(由) && (同.get(e.src) || []).find(x => x !== e.key);
      return Object.assign({}, e, { 档: 没 ? 0 : 体检.留(e.key) ? 2 : 1, 疑: !!疑,
        注: 由 ? `${疑 ? '❓ ' : ''}${由}${副 ? `; 和 ${副} 是同一份` : ''} · ` : '' });
    });
  },
  选: (l, n) => l.filter(e => e.档 <= n && !(n === 0 && e.疑)),
  量: l => l.reduce((s, e) => s + (e.bytes || 0), 0),
  报(l) { // data.audit 回的: 各档多少; 轻清逐条带理由, 深清和重置按开头那一截归堆
    const 堆 = x => Object.values(x.reduce((o, e) => {
      const h = (/^[^:.]+[:.]?/.exec(e.key) || [e.key])[0], d = o[h] = o[h] || { prefix: h, count: 0, bytes: 0 };
      d.count++; d.bytes += e.bytes || 0; return o;
    }, {})).sort((a, b) => b.bytes - a.bytes);
    return { count: l.length, bytes: 体检.量(l),
      档: ['light', 'deep', 'reset'].map((level, n) => {
        const x = 体检.选(l, n);
        return { level, 名: 体检.档名[n], count: x.length, bytes: 体检.量(x) };
      }),
      light: l.filter(e => e.档 === 0).map(e => ({ key: e.key, bytes: e.bytes, why: e.注.replace(/ · $/, ''), 判不准: e.疑 || undefined })),
      deep: 堆(l.filter(e => e.档 === 1)), reset: 堆(l.filter(e => e.档 === 2)) };
  },
  async 删一(k) { // 应用走 apps.remove(桌面图标、它存的一起清), 块的改版走恢复出厂, 别的直接删
    let m;
    if ((m = /^miniapp:(.+)$/.exec(k)) && colony.has('apps.remove')) return ctx.call('apps.remove', { id: m[1] });
    if ((m = /^block:(.+)$/.exec(k))) return ctx.call('stem.setBlock', { id: m[1], code: null });
    return ctx.kv.del(k);
  },
  async 清(ks, 重置) { // 块的改版放最后(恢复出厂会重启那块); 重置时 Stem 改过也换回出厂
    const 错 = [], 序 = [...ks].sort((a, b) => /^block:/.test(a) - /^block:/.test(b));
    for (const k of 序) await 体检.删一(k).catch(e => 错.push(`${k}: ${e.message}`));
    if (重置) {
      const l = await ctx.call('stem.lineage').catch(() => ({}));
      if (l.stemUse === 'edited') await ctx.call('stem.setBlock', { id: 'stem', active: 'factory' }).catch(e => 错.push('Stem: ' + e.message));
    }
    return { n: ks.length - 错.length, 错 };
  },
  async clean(a) {
    const n = 体检.级[a.level];
    if (n === undefined) throw new Error('level 只认 light / deep / reset');
    if (n === 2 && !a.dryRun && a.confirm !== '重置') throw new Error('重置会清掉全部数据、块的改动和 AI 配置: 先和用户确认, 再带 confirm: "重置"');
    const l = 体检.跑(await 数据.全()), 只 = a.keys && new Set(a.keys);
    const x = 只 ? l.filter(e => e.档 <= n && 只.has(e.key)) : 体检.选(l, n), bytes = 体检.量(x);
    if (a.dryRun) return { 会清: x.length, bytes, keys: x.map(e => e.key) };
    const r = await 体检.清(x.map(e => e.key), n === 2);
    if (n === 2) setTimeout(() => ctx.call('stem.reboot').catch(() => { }), 300);
    return Object.assign(r, { bytes, 重启: n === 2 || undefined });
  },
};
// ═ 自报 ═
// 看、搜、改、删 Colony 存的全部数据(按哪块的分好); 放文件和笔记; 连电脑上的文件夹; 搬上一代的数据
// 数据 {"prefix": "media:", "label": "文件和笔记", "kind": "data"}
// 数据 {"prefix": "settings:porter.", "label": "转发地址、连着的文件夹、搬没搬过上一代", "kind": "config"}
// 数据 {"prefix": "datamap:", "label": "旧版自报, 可以删", "kind": "cache"}
// 现在 data.list
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【找数据】要找、读、改库里或连着的文件夹里的东西时: data.* 一套管三处: 库、用户连着的文件夹(disk:<文件夹名>/<路径>,
//   目录以 / 结尾)、网址(只读, 可带 method/headers/body)。data.list {q: 键} 就是反向链接(谁引用了它), 回每条在值里的
//   位置 where, data.get {key, path: where} 只取那一处。不给 path 时超过 2 KB 的 data 网址只回一行说明, 给 path 才给原件。
// 【别人的】写别的块的数据被拒时: 块在自报段里认的前缀写了 edit 的, 只有主人能写(主人没在跑时放行), 报错里写着该走哪。
//   block: 只归 stem.setBlock。
// 【文件】要存文件、笔记, 或把模型给的媒体留下来时: 口袋的文件和笔记在 media:, 形状同 agent 的引用, 所以 {"$ref": 键}、
//   ref.read、[[show:键]] 都能直接用。新建: data.set {key: 'media:', value: {name, text 或 dataUrl}}, 回新键。
//   模型给的图、音、视频网址会过期: data.copy {from: 网址, to: 'media:'} 收下来(直传, 不经过你)。
// 【被拦】读网址被跨域拦了时: 请用户在口袋 ⚙ 里填转发地址({url} 占位; 转发方看得到网址和内容);
//   口袋不猜钥匙, 带钥匙的接口走 ai.fetch。
// 【要人点】要连文件夹、浏览器重开后「接上」文件夹、搬上一代的数据时: 只能用户在口袋里亲手点; 写 disk: 会盖掉同名文件。
// 【清理】用户嫌数据多、要清理时: 先 data.audit 一次拿到三档各多少和轻清的逐条理由, 照实讲给用户; 他定了档再
//   data.clean {level}(先 dryRun 看也行)。轻清不动对话、成品、应用和它读的素材; 深清清对话、记忆、成品、应用、工作流;
//   reset 全部回出厂, 必须用户明说要重置才带 confirm: "重置"。判不准(应用源码拼键读的)的轻清不清, 要清用 keys 点名。
// ═ 装配 ═
// 能力都不接隔离窗: 库里有厂商密钥、改的是全库。调用方是哪块 Stem 会带来(meta.by), 有主人的前缀靠它判
const 能 = (p, fn, desc, schema) => ctx.provide(p, (a, m) => {
  ['key', 'from', 'to'].forEach(k => {
    if (k in schema && (typeof a[k] !== 'string' || !a[k])) throw new Error(`缺 ${k}(字符串)`);
  });
  return fn(a, (m || {}).by);
}, { desc, schema, frames: false });
能('data.list', 数据.list, '看全部数据: 不给参数回地图(每块占多少、没人认领的、连着的文件夹); in 给前缀或 disk:<文件夹>/ '
  + '列那一处(大的在前); q 在键和内容里找, 回值里的位置 where 和前后文(找一个键 = 谁引用了它)',
  { in: 'string?(前缀或 disk:<文件夹>/…)', q: 'string?', n: 'number?(最多几条, 默认 50)' });
能('data.get', 数据.get, '读一个键, 没有回 null; 也读 disk:<文件夹>/<路径> 和 http(s) 网址(回 {name, mimeType, from, '
  + 'text 或 dataUrl}); path 只取值里的一处(如 12.content, 空串 = 整个原样); 不给 path 时大的 data 网址只回一行说明',
  { key: 'string', path: 'string?', method: 'string?(读网址用)', headers: 'object?', body: 'any?' });
能('data.set', 数据.set, '写一个键, value 原样存(null 也是值); key 以 : 结尾就在这个前缀下新建(回新键); '
  + 'disk:… 写成文件(同名会盖掉); 别的块认领并写了 edit 的前缀写不了, 报错里写着该走哪', { key: 'string', value: 'any' });
能('data.del', 数据.del, '删一个键, 或 disk:… 的文件(文件夹只删空的)', { key: 'string' });
能('data.copy', 数据.copy, '复制一份, 直传不经过你: from 是键、disk:… 或网址; to 是键、以 : 结尾的前缀(新建)或 disk:…'
  + '(以 / 结尾用原名)。模型给的媒体网址会过期, 用它收进 media:', { from: 'string', to: 'string' });
能('data.audit', async () => 体检.报(体检.跑(await 数据.全())), '体检: 一次回清理三档各多少(light 轻清 = 没人用的, '
  + 'deep 深清 = 再加对话、记忆、成品、应用、工作流, reset 重置 = 全部回出厂); 轻清逐条带理由, 判不准的标 判不准', {});
能('data.clean', 体检.clean, '按档清理: level light / deep / reset; keys 只清这几条(须在这一档内); dryRun 只报会清什么; '
  + 'reset 要先和用户确认再带 confirm: "重置", 清完软重启', { level: 'string', keys: 'string[]?', dryRun: 'boolean?', confirm: 'string?' });

if (typeof document === 'undefined' || !ctx.root) return {};
const 表 = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: 样式 }));
const 事 = ['colony:apps', 'colony:blocks', 'ai:providers'], 变 = () => 界面.旧();
const 露了 = e => { // root 被搬去显示、关窗搬回去时 pk-in 都重播: 露出来才扫库
  if (e.target !== ctx.root) return;
  ctx.root.classList.toggle('pk-solo', !colony.has('ui.host'));   // 没有界面块: 口袋自己占满整页
  界面.提示();
  if (界面.露()) 界面.扫().catch(界面.错);
};
事.forEach(t => document.addEventListener(t, 变));
ctx.root.addEventListener('animationstart', 露了);
ctx.cleanup(() => {
  表.remove();
  事.forEach(t => document.removeEventListener(t, 变));
  const t = document.querySelector('.pk-tip');
  if (t) t.remove();
});
界面.装();
(带的数据 ? 继承.播(带的数据) : 继承.开机()).then(r => r && 界面.露() && 界面.扫()).catch(界面.错);   // 导出的口袋: 先放带来的
return {};
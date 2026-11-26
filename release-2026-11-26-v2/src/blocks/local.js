'use strict';
// ═ 自报 ═
// 让 agent 用这台电脑(或装了 Termux 的手机): 跑命令(长的转后台, 能看输出、能停、能往里打字)、读写改任意文件;
// 连的是电脑上运行的 colony-local.cjs, 它自己的源码也能在这里改、留快照、退回、重启
// 数据 {"prefix": "settings:local.", "label": "连哪台本机(地址)", "kind": "config"}
// 现在 local.info
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【用电脑】要在用户电脑(或装了 Termux 的手机)上跑命令、装东西、跑脚本时: 先 local.info 看系统和默认 shell
//   (Windows 是 PowerShell, 别的是 sh), 命令照那种写, 再 local.run {cmd}; 相对路径从用户目录算, 要在别处跑给 cwd。
//   跑得久的(装包、编译、起服务): wait 内没跑完回 {done:false, id}, 进程留在后台; local.job {id} 接着看新输出
//   (它等到有新输出才回, 不用自己隔一会儿问), 不要了 local.stop {id}; 要往它输入里打字用 local.input {id, text}。
// 【改文件】先 local.read(按行, 大文件给 offset/limit 分段读) → 改一处用 local.edit {path, old, new}
//   (old 逐字一样且唯一, 不唯一会报出现几次) → 整份重写才用 local.write; 改完读一遍或跑一下验证。
// 【改本机脚本】要给本机脚本加功能或修它时: local.src.list → local.src.read → local.src.edit / local.src.write
//   (写前自动快照, 每个文件留 5 版) → local.restart 才生效。新版起不来会自动退回能跑的版本, 回报错的最后几行;
//   要回到更早的版本: local.src.backups 看快照, local.src.revert {file, ts}, 再 local.restart。
// 【没连上】local.* 报「本机没连上」时: 告诉用户在电脑上运行 node colony-local.cjs(开机自启加 --install),
//   做法在「本机」面板里; 用户说本机换了地址或端口, 用 local.connect {url}。
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ═ 连接 ═
// 连电脑上的 colony-local.cjs: 地址存在 settings:local.url; 开机连一次, 没连上时每次调用先再试一次, 不轮询
const 连 = {
  键: 'settings:local.url',
  url: 'http://127.0.0.1:4130',
  ok: false,
  info: null,   // 上次 info 的回答
  错: '',   // 没连上的原因
  听: [],   // 连上、断开时叫谁(面板重画)
  话: '本机没连上：先在电脑上运行 node colony-local.cjs（见「本机」面板）',
  变() { 连.听.forEach(f => f()); },
  async 发(op, a, ms) { // 原样发给本机脚本; 网络不通的错带「断」
    const ac = new AbortController(), t = ms && setTimeout(() => ac.abort(), ms);
    let r;
    try {   // text/plain 不用预检
      r = await fetch(连.url + '/', { method: 'POST', body: JSON.stringify(Object.assign({}, a, { op })),
        headers: { 'Content-Type': 'text/plain' }, signal: ac.signal });
    } catch (e) {
      throw Object.assign(new Error(ac.signal.aborted ? ms / 1000 + ' 秒没回音' : '连不上 ' + 连.url), { 断: true });
    } finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({ error: '回的不是 JSON(' + r.status + '): ' + 连.url + ' 是本机脚本吗?' }));
    if (j.error) throw new Error(j.error);
    return j;
  },
  async 试(url) {
    if (url) {
      url = String(url).trim().replace(/\/+$/, '');
      连.url = /^https?:\/\//.test(url) ? url : 'http://' + url;
      await ctx.kv.set(连.键, 连.url);
    }
    try {
      连.info = await 连.发('info', {}, 4000);
      Object.assign(连, { ok: true, 错: '' });
    } catch (e) { Object.assign(连, { ok: false, 错: e.message }); }
    连.变();
    return 连.ok;
  },
  async 要(op, a, ms) { // 能力都走这里
    if (!连.ok && !await 连.试()) throw new Error(连.话 + '。' + 连.错);
    try { return await 连.发(op, a, ms); } catch (e) {
      if (!e.断) throw e;
      Object.assign(连, { ok: false, 错: e.message });
      连.变();
      throw new Error(连.话 + '。' + e.message);
    }
  },
};
// ═ 能力 · 跟着: 连接 ═
// 都不接隔离窗(小应用调不到); 标常用的 6 个 agent 直接当工具, 别的在它的目录里用 call 调
const 登 = (path, fn, desc, schema, common) => ctx.provide(path, fn, { desc, schema, frames: false, common });
const 久 = (a, d) => Math.min(Math.max(a.wait == null ? d : +a.wait || 0, 0), 590000) + 20000;   // 等回话的上限
const 换 = (t, a) => { // 数 old 出现几次再换; CRLF 的文件照它的换行再找一次
  if (typeof a.old !== 'string' || !a.old) throw new Error('old 不能空');
  if (typeof a.new !== 'string') throw new Error('new 要是字符串');
  let o = a.old, n = a.new, k = t.split(o).length - 1;
  if (!k && t.includes('\r\n') && o.includes('\n')) {
    [o, n] = [o, n].map(s => s.replace(/\r?\n/g, '\r\n'));
    k = t.split(o).length - 1;
  }
  if (!k) throw new Error('找不到 old: 先读原文, 空白、缩进、换行要逐字一样');
  if (k > 1 && !a.all) throw new Error('old 出现了 ' + k + ' 次: 多带点上下文让它唯一, 或给 all:true 全换');
  return { text: a.all ? t.split(o).join(n) : t.replace(o, () => n), replaced: a.all ? k : 1 };
};
const 路 = 'string(绝对路径, 或从用户目录算的相对路径; ~ 是用户目录)', 件 = 'string(本机脚本目录里的相对路径, 如 colony-local.cjs)';
// 同一个文件的写排队: 一轮里并行发两个 local.edit 改同一个文件, 不排队就都读到原文、后写的盖掉先写的(两条都报成功)
const 锁 = new Map(), 键 = p => String(p || '').replace(/\\/g, '/').toLowerCase();
const 排 = (p, f) => {
  const k = 键(p), 前 = 锁.get(k) || Promise.resolve(), 这 = 前.catch(() => { }).then(f);
  锁.set(k, 这);
  这.catch(() => { }).then(() => { if (锁.get(k) === 这) 锁.delete(k); });
  return 这;
};
const 差 = async (before, after) => { // 改了哪几行: 给模型和人核对, 只留改动前后 2 行, 太长只给统计
  const d = await ctx.call('code.diff', { before, after, context: 2 }).catch(() => null);
  if (!d) return undefined;
  const h = (d.hunks || []).map(x => x.t === '…' ? '…' : x.t + ' ' + x.a).join('\n');
  return h.length > 6000 ? { stats: d.stats, 说明: '改动太长不列了' } : { stats: d.stats, diff: h };
};
const 读封顶 = 18000;   // 一次最多给这么多字: 引擎一条结果过 2 万字会被截断、存成引用, 要多跑一轮才读得到
// 默认等 20 秒: 要比 agent 的「前台等」(30 秒)短, 不然两层都转后台, 模型先收到「已转后台」, 再收到「进程还在跑」
登('local.run', a => 连.要('run', a.wait == null ? { ...a, wait: 20000 } : a, 久(a, 20000)), '在用户电脑上跑一条命令: Windows 默认 PowerShell, 别的系统 sh -c'
  + '(先 local.info 看是哪种)。wait 毫秒内跑完回 {done:true, code, out, err, ms}; 没跑完回 {done:false, id, out, err},'
  + ' 进程留在后台接着跑: local.job {id} 看新输出, local.stop {id} 停。每路输出留头 1 万字 + 尾 2 万字',
{ cmd: 'string', cwd: 'string?(在哪个目录跑, 不给是用户目录)', wait: 'number?(毫秒, 默认 20000, 最多 590000; 超过 25000 会被 agent 转后台)',
  shell: 'string?(powershell、pwsh、cmd、sh、bash, 或 shell 的路径)' }, true);
登('local.job', a => 连.要('job', a, 久(a, 10000)), '看后台进程从上次看到现在的新输出: 等到有新输出、跑完'
  + '或 wait 毫秒到点才回; 回 {done, out, err}, 跑完了还有 code、ms',
{ id: 'string', wait: 'number?(毫秒, 默认 10000, 最多 590000)' }, true);
登('local.read', async a => {
  const r = await 连.要('read', { path: a.path, offset: a.offset || 1, limit: a.limit || 2000 });
  if (!a.limit && r.text.length > 读封顶) { // 没指定 limit 时按字数封顶, 整行截
    const L = r.text.split('\n');
    let n = 0, 字 = 0;
    while (n < L.length && 字 + L[n].length + 1 <= 读封顶) 字 += L[n++].length + 1;
    n = Math.max(n, 1);
    Object.assign(r, { text: L.slice(0, n).join('\n'), count: n });
  }
  if (a.numbers) { // 加了行号会变长: 加完还超就再少给几行
    const L = r.text.split('\n').map((l, i) => (r.offset + i) + '\t' + l);
    let n = L.length, 字 = L.reduce((s, l) => s + l.length + 1, 0);
    while (!a.limit && n > 1 && 字 > 读封顶) 字 -= L[--n].length + 1;
    Object.assign(r, { text: L.slice(0, n).join('\n'), count: n });
  }
  const 末 = r.offset + r.count - 1;
  if (末 < r.lines) r.more = '还有 ' + (r.lines - 末) + ' 行没读: 下一段 offset: ' + (末 + 1);
  return r;
}, '读文件(UTF-8), 按行: offset 从第几行起(默认 1), limit 读几行(默认 2000, 没给时一次最多约 1.8 万字); numbers:true 每行前加行号和制表符;'
  + ' 回 {path, lines(总行数), offset, count, text}, 没读完会给 more 说下一段从哪行起; 二进制和超过 50MB 的不读',
{ path: 路, offset: 'number?', limit: 'number?', numbers: 'boolean?(带行号)' }, true);
登('local.write', a => 排(a.path, async () => {
  // 原来没有 = null(新建); 有但读不出字(二进制、太大) = undefined(不列改动, 也不当新建)
  const 旧 = await 连.要('read', { path: a.path }).then(r => r.text, e => /ENOENT|no such/i.test(e && e.message) ? null : undefined);
  const r = await 连.要('write', a);
  if (旧 === null) r.新建 = true;
  else if (typeof 旧 === 'string' && 旧 !== a.text) r.改动 = await 差(旧, a.text);
  return r;
}), '整份写文件(UTF-8, 先写临时文件再换名, 写到一半崩了不坏原文件), 缺的上级目录自动建; 覆盖已有文件时回改动 diff; 只改一处用 local.edit',
  { path: 路, text: 'string' }, true);
登('local.edit', a => 排(a.path, async () => {
  const r = await 连.要('read', { path: a.path }), x = 换(r.text, a);
  await 连.要('write', { path: r.path, text: x.text });
  return { path: r.path, replaced: x.replaced, 改动: await 差(r.text, x.text) };
}), '改文件里的一处: old 换成 new。old 要逐字一样(空白、缩进都算)且只出现一次; 出现多次会报几次, 带上下文让它唯一,'
  + ' 或 all:true 全换。同一个文件的改动自动排队, 一轮里并行改同一个文件也不丢。回 {path, replaced, 改动(diff)}',
{ path: 路, old: 'string', new: 'string', all: 'boolean?' }, true);
登('local.rm', a => 排(a.path, () => 连.要('rm', a)), '删一个文件(不删文件夹); 不存在也算成功, 回 {ok, path, existed}',
  { path: 路 });
登('local.ls', a => 连.要('ls', a), '列目录: 名字、类型(file/dir/link)、大小、改动时间; depth 往下几层(默认 1),'
  + ' 不往 .git、node_modules 里钻; 最多 2000 条', { path: 'string?(不给是用户目录)', depth: 'number?' }, true);
登('local.info', () => 连.要('info').then(i => (连.info = i)), '这台电脑: 系统、架构、默认 shell、用户目录、默认工作目录、'
  + 'node 版本、本机脚本的版本和目录; lastRestart 是上次重启没成的报错', {});
登('local.jobs', () => 连.要('jobs'), '列后台进程: id、命令、跑着没有(running)、退出码', {});
登('local.stop', a => 连.要('stop', a), '停一个后台进程, 连它的子进程一起杀; 回最后的输出', { id: 'string' });
登('local.input', a => 连.要('input', a), '往后台进程的输入里写一段字(要回车就带 \\n); end:true 写完关掉它的输入',
  { id: 'string', text: 'string?', end: 'boolean?' });
登('local.src.list', () => 连.要('src.list'), '列本机脚本(colony-local.cjs)所在目录里的文件: 改本机脚本先看这个', {});
登('local.src.read', a => 连.要('src.read', a), '读本机脚本目录里的一个文件', { file: 件 });
登('local.src.write', a => 连.要('src.write', a), '整份写本机脚本目录里的一个文件: 写前自动快照(每个文件留 5 版);'
  + ' local.restart 后才生效', { file: 件, text: 'string' });
登('local.src.edit', async a => {
  const x = 换((await 连.要('src.read', { file: a.file })).text, a);
  return Object.assign(await 连.要('src.write', { file: a.file, text: x.text }), { replaced: x.replaced });
}, '改本机脚本里的一处(规矩同 local.edit, 写前自动快照); local.restart 后才生效',
{ file: 件, old: 'string', new: 'string', all: 'boolean?' });
登('local.src.backups', a => 连.要('src.backups', a), '列一个文件的快照 [{ts, bytes}], 新的在前', { file: 件 });
登('local.src.revert', a => 连.要('src.revert', a), '把文件退回到一版快照(不给 ts 是最近一版); local.restart 后才生效',
  { file: 件, ts: 'number?' });
登('local.restart', async () => {
  const 前 = await 连.要('info');
  await 连.要('restart');
  for (let i = 0; i < 60; i++) {   // 等它回来: 换了进程是新版起来了, 还是原来那个又带着新的报错回来了
    await new Promise(r => setTimeout(r, 500));
    const x = await 连.发('info', {}, 2000).catch(() => null);
    if (!x) continue;
    Object.assign(连, { info: x, ok: true, 错: '' });
    连.变();
    if (x.pid !== 前.pid) return { ok: true, version: x.version, was: 前.version };
    const L = x.lastRestart;
    if (L && JSON.stringify(L) !== JSON.stringify(前.lastRestart))
      return { ok: false, reverted: true, version: x.version, error: L.why, tail: L.tail };
  }
  throw new Error('30 秒没等到本机脚本回来: 去电脑上看看它还在不在');
}, '重启本机脚本让改动生效, 等它回来: 新版起得来回 {ok:true, version, was}; 起不来它自己退回能跑的版本,'
  + ' 回 {ok:false, reverted:true, error, tail(报错的最后几行)}', {});
登('local.connect', async a => {
  await 连.试(a.url);
  return Object.assign({ connected: 连.ok, url: 连.url }, 连.ok ? { info: 连.info } : { error: 连.错 });
}, '改连哪台(默认 http://127.0.0.1:4130)并马上重连; 不给 url 就按原地址重连; 回 {connected, url, info 或 error}',
{ url: 'string?' });
// ═ 面板 · 跟着: 连接 ═
// 画在 ctx.root, 界面块打开本块时把它搬进窗; 看不见时不画, 露出来再画。退回、重启点两下才做
const 面板 = {
  脏的: true,
  开: {},   // 展开了哪几行: j:后台进程 id、f:文件
  出: {},   // 后台进程 id → 看到的输出
  话: '',   // 头上那句, ! 开头是错
  两: null,   // 点了第一下的那个键 {k, t}
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
  时: t => new Date(t).toLocaleString('zh-CN', { hour12: false }),
  样式: `.lc{--m:var(--text-muted,#8a8a8a);--a:var(--accent,#B5FF00);--l:var(--border,#ffffff14);
    padding:16px;color:var(--text,#fafafa);min-height:200px;
    font:13px/1.5 var(--sans,-apple-system,"PingFang SC",sans-serif)}
    .lc h3{font-size:12px;color:var(--m);font-weight:500;margin:18px 0 8px;display:flex;gap:8px}
    .lc-hint{font-size:12px;color:var(--m);margin:4px 0 8px}.lc-sp{flex:1}.lc-sub{margin:4px 0 0 14px}
    .lc-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .lc-row{border:1px solid var(--l);border-radius:10px;padding:6px 10px;margin:6px 0;
    background:var(--bg-2,#131313)}.lc-d{color:var(--m);font-size:12px;flex:1;min-width:0;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lc-tag{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--l);color:var(--m)}
    .lc-tag.ok{color:var(--a);border-color:var(--a)}.lc-tag.bad,.lc-msg.bad{color:var(--danger,#f44)}
    .lc button{background:var(--bg,#0a0a0a);color:inherit;border:1px solid var(--l);border-radius:8px;
    padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}.lc button:hover{border-color:var(--a)}
    .lc button:disabled{opacity:.5}.lc input{flex:0 1 240px;background:var(--bg,#0a0a0a);color:inherit;
    border:1px solid var(--l);border-radius:8px;padding:4px 8px;font:12px var(--mono,monospace)}
    .lc-msg{font-size:12px;color:var(--a);min-height:18px;margin:4px 0;white-space:pre-wrap}
    .lc-cmd{display:flex;gap:8px;align-items:center;margin:4px 0 8px}.lc-cmd code{flex:1;padding:6px 10px;
    border-radius:8px;background:var(--bg-2,#131313);font:12px var(--mono,monospace)}
    .lc-t td{padding:2px 14px 2px 0;font-size:12px;vertical-align:top;word-break:break-all}
    .lc-t td:first-child{color:var(--m);white-space:nowrap}.lc-pre{white-space:pre-wrap;color:var(--m);
    font:11px/1.5 var(--mono,monospace);max-height:260px;overflow:auto;margin:6px 0 0;padding-top:6px;
    border-top:1px solid var(--l)}`,
  看得见: () => !!(ctx.root && ctx.root.isConnected && ctx.root.offsetParent !== null
    && (ctx.root.parentNode.id !== 'colony-root' || !colony.has('ui.do'))),   // 没有界面块就直接在页上
  脏() {
    面板.脏的 = true;
    if (面板.看得见()) 面板.画().catch(e => { ctx.root.textContent = '本机面板没画出来: ' + e.message; });
  },
  说(t, 坏) {
    面板.话 = (坏 ? '!' : '') + t;
    const m = ctx.root.querySelector('.lc-msg');
    if (m) { m.textContent = t; m.classList.toggle('bad', !!坏); }
  },
  命令(加) {
    const p = (/:(\d+)$/.exec(连.url) || [])[1];
    return 'node colony-local.cjs' + (p && p !== '4130' ? ' --port ' + p : '') + (加 || '');
  },
  async 画() {
    if (!ctx.root) return;
    面板.脏的 = false;
    const e = 面板.esc, i = 连.info || {}, 有 = 连.ok, 开 = 面板.开, 快 = {};
    const [js, 源们] = 有 ? await Promise.all([连.发('jobs', {}, 5000).then(r => r.jobs, () => []),
      连.发('src.list', {}, 5000).then(r => r.files, () => [])]) : [[], []];
    for (const f of 源们) if (开['f:' + f.file])
      快[f.file] = await 连.发('src.backups', { file: f.file }, 5000).then(r => r.backups, () => []);
    const 钮 = (a, v, t, 加) => `<button data-a="${a}" data-v="${e(v)}" data-t="${e(t)}"${加 || ''}>`
      + e(t) + '</button>';
    const 码 = t => `<div class="lc-cmd"><code>${e(t)}</code>${钮('copy', t, '复制')}</div>`;
    let h = `<div class="lc"><style>${面板.样式}</style><div class="lc-top"><b>💻 本机</b>` + (有
      ? `<span class="lc-tag ok">已连上 · ${e(i.osName)} · 版本 ${e(i.version)}</span>`
      : '<span class="lc-tag bad">没连上</span>') + '<i class="lc-sp"></i>'
      + `<input data-f="url" value="${e(连.url)}" spellcheck="false">${钮('conn', '', '重连')}</div>`
      + `<div class="lc-msg${面板.话[0] === '!' ? ' bad' : ''}">${e(面板.话.replace(/^!/, ''))}</div>`;
    if (!有) h += `<p class="lc-hint">${e(连.错)}</p><h3>怎么连上</h3><p class="lc-hint">`
      + '把 colony-local.cjs 放进一个单独的文件夹(它能改那个文件夹里的文件), 装好 Node 18 以上,'
      + ' 在那个文件夹里打开终端运行:</p>' + 码(面板.命令()) + '<p class="lc-hint">关了终端它就停了。'
      + '想开机自动在后台跑(Windows 放进「启动」文件夹, 不要管理员; 手机 Termux 要先装 Termux:Boot):</p>'
      + 码(面板.命令(' --install')) + `<p class="lc-hint">撤掉自启: ${e(面板.命令(' --uninstall'))}。`
      + 'Colony 是 https 网址打开的, 第一次连时 Chrome 会问能不能访问本机, 点允许。起好了点上面的「重连」。</p>';
    else {
      const 表 = [['系统', i.osName + ' · ' + i.arch + (i.termux ? ' · Termux' : '')], ['shell', i.shell],
        ['用户目录', i.home], ['默认工作目录', i.cwd], ['Node', i.node], ['进程号', i.pid], ['本机脚本', i.dir],
        ['控制面', i.host + ':' + i.port + '（锁死仅本机）']], L = i.lastRestart, g = i.gateway;
      h += '<h3>这台电脑</h3><table class="lc-t">'
        + 表.map(([k, v]) => `<tr><td>${k}</td><td>${e(v)}</td></tr>`).join('') + '</table>';
      if (g) {
        const gt = g.running
          ? (g.expose ? '局域网外放中 · 需密码' : '仅本机免密') + (g.mode === 'full' ? ' · 聚合网关' : ' · 仅 /proxy')
          : '未启动' + (g.error ? ' · ' + g.error : '');
        h += '<h3>同进程聚合网关（:4135 数据面 · 物理隔离无命令行）</h3><div class="lc-row"><div class="lc-top">'
          + `<span class="lc-tag${g.running ? ' ok' : ' bad'}">${e(gt)}</span>`
          + (g.running ? `<code>${e(g.localEndpoint || ('http://127.0.0.1:' + g.port + '/v1'))}</code>`
            + 钮('copy', g.localEndpoint || ('http://127.0.0.1:' + g.port + '/v1'), '复制地址') : '')
          + '<i class="lc-sp"></i>'
          + (colony.has('ui.do') ? 钮('openAi', '', '打开 AI 配置管理订阅与外放') : '')
          + '</div>'
          + (g.running ? `<p class="lc-hint" style="margin:6px 0 0">常规厂商已同步 ${g.syncedProviderCount || 0} 家 · 网页模型反桥 ${g.webBridgeOnline ? ('在线(' + (g.webModelCount || 0) + ' 个模型)') : '离线'} · 支持 OpenAI /v1、Anthropic /v1/messages 与 /proxy 免跨域</p>` : '')
          + '</div>';
      }
      if (L) h += `<p class="lc-msg bad">上次重启没成(${面板.时(L.at)}): ${e(L.why)}, 已退回能跑的版本</p>`
        + `<pre class="lc-pre">${e(L.tail)}</pre>`;
      h += `<h3>后台进程 · ${js.length}${钮('jobs', '', '刷新')}</h3>` + (js.map(j => '<div class="lc-row">'
        + `<div class="lc-top"><code>#${e(j.id)}</code><span class="lc-d" title="${e(j.cmd)}">${e(j.cmd)}`
        + `</span><span class="lc-tag${j.running ? ' ok' : ''}">${j.running
          ? '跑着 ' + Math.round(j.ms / 1000) + ' 秒' : '退出码 ' + e(j.code)}</span>`
        + 钮('out', j.id, 开['j:' + j.id] ? '收起输出' : '看输出') + (j.running ? 钮('stop', j.id, '停') : '')
        + '</div>' + (开['j:' + j.id] ? `<pre class="lc-pre">${e(面板.出[j.id] || '(还没有输出)')}</pre>` : '')
        + '</div>').join('') || '<p class="lc-hint">没有。命令在 wait 内没跑完才会留在这里</p>');
      h += `<h3>本机脚本 · ${源们.length} 个文件</h3>` + 源们.map(f => '<div class="lc-row"><div class="lc-top">'
        + `<code>${e(f.file)}</code><span class="lc-d">${f.bytes} B · ${面板.时(f.mtime)}</span>`
        + 钮('bk', f.file, (开['f:' + f.file] ? '▾' : '▸') + ' 快照') + '</div>' + (!快[f.file] ? ''
          : 快[f.file].map(b => '<div class="lc-top lc-sub">'
            + `<span class="lc-d">${面板.时(b.ts)} · ${b.bytes} B</span>`
            + 钮('revert', f.file, '退回这一版', ` data-ts="${b.ts}"`) + '</div>').join('')
            || '<p class="lc-hint lc-sub">还没有快照: 经 Colony 写过才有</p>') + '</div>').join('')
        + `<div class="lc-top" style="margin-top:10px">${钮('restart', '', '重启本机脚本')}`
        + '<span class="lc-hint">改了源码、退回了快照, 重启才生效; 新版起不来会自动退回</span></div>';
    }
    ctx.root.innerHTML = h + '</div>';
  },
  两下(b, 话) { // 第一下这个键换成「再点一下…」, 3 秒内再点才做, 不点就复原
    const k = b.dataset.a + ':' + b.dataset.v + ':' + (b.dataset.ts || '');
    if (面板.两 && 面板.两.k === k && Date.now() - 面板.两.t < 3000) return !(面板.两 = null);
    面板.两 = { k, t: Date.now() };
    b.textContent = '再点一下' + 话;
    setTimeout(() => { if (面板.两 && 面板.两.k === k) { 面板.两 = null; b.textContent = b.dataset.t; } }, 3000);
    return false;
  },
  复制(t, b) {
    const 好了 = () => { b.textContent = '复制了'; setTimeout(() => { b.textContent = '复制'; }, 1500); };
    const 旧法 = () => {
      const x = Object.assign(document.createElement('textarea'), { value: t });
      ctx.root.appendChild(x);
      x.select();
      document.execCommand('copy');
      x.remove();
      好了();
    };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(好了, 旧法);
    else 旧法();
  },
  async 点(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b || !ctx.root.contains(b)) return;
    const a = b.dataset.a, v = b.dataset.v, 开 = 面板.开;
    const 忙 = async fn => {
      b.disabled = true;
      try { 面板.说(await fn()); } catch (x) { 面板.说(x.message, true); }
      await 面板.画();
    };
    if (a === 'copy') return 面板.复制(v, b);
    if (a === 'openAi') return ctx.call('ui.do', { target: 'block:petri:ai', action: '打开' })
      .catch(() => ctx.call('ui.do', { target: 'win:block:petri:ai', action: '到最前' })).catch(() => {});
    if (a === 'jobs') return 面板.画();
    if (a === 'conn') return 忙(async () => {
      if (await 连.试(ctx.root.querySelector('[data-f="url"]').value)) return '连上了';
      throw new Error('还是没连上: ' + 连.错);
    });
    if (a === 'out') {
      开['j:' + v] = !开['j:' + v];
      if (开['j:' + v]) 面板.出[v] = await 连.要('job', { id: v, peek: true, wait: 0 })
        .then(r => r.out + (r.err ? '\n── 错误输出 ──\n' + r.err : ''), x => x.message);
      return 面板.画();
    }
    if (a === 'stop') return 忙(async () => '停了 #' + v + ', 退出码 '
      + (await ctx.call('local.stop', { id: v })).code);
    if (a === 'bk') { 开['f:' + v] = !开['f:' + v]; return 面板.画(); }
    if (a === 'revert' && 面板.两下(b, ': 退回这一版')) return 忙(async () => {
      await ctx.call('local.src.revert', { file: v, ts: +b.dataset.ts });
      return '已把 ' + v + ' 退回到 ' + 面板.时(+b.dataset.ts) + ' 那一版; 点「重启本机脚本」才生效';
    });
    if (a === 'restart' && 面板.两下(b, ': 重启本机脚本')) return 忙(async () => {
      面板.说('重启中, 等它回来…');
      const r = await ctx.call('local.restart');
      if (!r.ok) throw new Error('新版起不来, 已退回能跑的版本: ' + r.error);
      return '重启好了: 版本 ' + r.was + ' → ' + r.version;
    });
  },
};
// ═ 装配 · 跟着: 连接, 面板 ═
// 开机连一次本机(不等它, 装载期不卡)。面板在界面块把 root 搬进窗(或搬回去)时重画, 窗从收起里露出来时补画
连.听.push(面板.脏);
if (ctx.root) {
  ctx.root.addEventListener('click', 面板.点);
  const 看 = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && 面板.脏的) 面板.脏(); });
  let 在 = null;
  const 挪 = new MutationObserver(() => {
    if (ctx.root.parentNode !== 在) { 在 = ctx.root.parentNode; 面板.脏(); }
  });
  看.observe(ctx.root);
  if (ctx.root.parentNode) 挪.observe(ctx.root.parentNode, { childList: true });
  ctx.cleanup(() => { 看.disconnect(); 挪.disconnect(); });
  // 先同步画个壳: 界面块打开本块时量 root 高度, 是 0 就当没界面
  ctx.root.innerHTML = '<div style="padding:16px;min-height:200px;color:#8a8a8a">本机 · 载入中…</div>';
  在 = ctx.root.parentNode;
}
ctx.kv.get(连.键).then(u => { if (u) 连.url = u; return 连.试(); }).catch(() => { });
return {};
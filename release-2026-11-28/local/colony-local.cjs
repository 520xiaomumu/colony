#!/usr/bin/env node
// colony-local.cjs: Colony「本机」块连的小程序, 只做哑管道(跑命令、读写文件、改自己的源码)。Node 18+, 零依赖
//   node colony-local.cjs [--port 4130] [--host 127.0.0.1] [--cwd 目录]   GET /ping, POST / 收 {op, ...}
//   node colony-local.cjs --install | --uninstall                          开机自动在后台跑 / 撤掉
// 没有密码: 默认只听 127.0.0.1; 别改成 0.0.0.0, 除非信得过同一网络里的每个人
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const cp = require('child_process'), { createHash } = require('crypto');
const { StringDecoder } = require('string_decoder');
const { pathToFileURL } = require('url');
const ME = __filename, DIR = __dirname, BAK = path.join(DIR, '.colony-local');
const LOG = path.join(BAK, 'out.log');
const WIN = process.platform === 'win32', TERMUX = /com\.termux/.test(process.env.PREFIX || '');
const HOME = os.homedir(), argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const PORT = +opt('port', 4130), CWD = path.resolve(opt('cwd', HOME));
// 控制面(:4130 具备本机命令/文件读写权限)强制死锁 127.0.0.1, 严禁外放 0.0.0.0
const RAW_HOST = opt('host', '127.0.0.1');
const HOST = /^(127\.0\.0\.1|localhost|::1)$/i.test(RAW_HOST) ? RAW_HOST : '127.0.0.1';
if (HOST !== RAW_HOST) console.warn('[colony-local] 控制面禁止绑定 ' + RAW_HOST + ', 已强制锁定 127.0.0.1');
const GW_PORT = +opt('gateway-port', process.env.COLONY_SUB_PORT || 4135) || 4135;
const NO_GW = argv.includes('--no-gateway');
const PING = 'http://127.0.0.1:' + PORT + '/ping';
const VER = createHash('sha256').update(fs.readFileSync(ME)).digest('hex').slice(0, 12);
const 睡 = ms => new Promise(r => setTimeout(r, ms));
const 错 = m => { throw new Error(m); };
const 路 = p => path.resolve(CWD, String(p == null || p === '' ? '.' : p).replace(/^~(?=$|[\\/])/, HOME));

// ── 输出: 每路留头 1 万字 + 尾 2 万字, 中间省掉的标出来; 终端颜色、光标这些控制码去掉(模型读不懂, 只占地方)
const 缓 = () => ({ h: '', t: '', cut: 0 });
const 去色 = s => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '');
const 收 = (b, s) => {
  s = 去色(s);
  if (b.h.length < 10000) { const n = 10000 - b.h.length; b.h += s.slice(0, n); s = s.slice(n); }
  b.t += s;
  if (b.t.length > 20000) { b.cut += b.t.length - 20000; b.t = b.t.slice(-20000); }
};
const 文 = b => b.h + (b.cut ? '\n…[中间省略 ' + b.cut + ' 字]…\n' : '') + b.t;

// ── 文件: 读有上限、认得出二进制; 写先写临时文件再换名, 写到一半崩了原文件也不坏
const 读上限 = 50 << 20;
const 读文 = f => {
  const s = fs.statSync(f);
  if (s.isDirectory()) 错('这是文件夹, 要列目录用 ls');
  if (s.size > 读上限) 错('文件 ' + (s.size / 1048576).toFixed(1) + ' MB, 超过 ' + (读上限 >> 20) + ' MB 不整份读: 用命令看(比如 Get-Content -Tail 200)');
  const b = fs.readFileSync(f);
  if (b.subarray(0, 8192).includes(0)) 错('这是二进制文件(图片、压缩包、程序之类), 不能当文字读');
  return b.toString('utf8');
};
const 写文 = (f, text) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let 链 = false;
  try { 链 = fs.lstatSync(f).isSymbolicLink(); } catch (e) { }
  if (链) return fs.writeFileSync(f, text);   // 符号链接照旧直接写: 换名会把链接换成普通文件
  const tmp = f + '.colony-tmp-' + process.pid + '-' + Date.now();
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (_) { } throw e; }
};

// ── 后台进程: 全 = 从头到现在(面板看), 新 = 上次取到现在(job 取了就清)
const 表 = new Map();
let 号 = 0;
const PRE = "$ProgressPreference='SilentlyContinue';$global:LASTEXITCODE=0;[Console]::InputEncoding="
  + '[Console]::OutputEncoding=$OutputEncoding=New-Object Text.UTF8Encoding $false\n';
const SUF = '\n$s=$?;if(!$s -and !$LASTEXITCODE){exit 1};exit $LASTEXITCODE';   // 退出码照最后一条命令
const 壳 = (sh, cmd) => {
  sh = sh || (WIN ? 'powershell' : 'sh');
  if (/(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(sh))
    return [sh, ['-NoProfile', '-NonInteractive', '-Command', PRE + cmd + SUF]];
  if (/(^|[\\/])cmd(\.exe)?$/i.test(sh))   // cmd 自己的输出按开头的代码页: 换成 UTF-8 后再套一层跑
    return [sh, ['/d', '/s', '/c', '"chcp 65001>nul & cmd /d /s /c "' + cmd + '""'], true];
  return [sh, ['-c', cmd]];
};
const ENV = Object.assign({}, process.env,
  WIN && !process.env.PYTHONIOENCODING && { PYTHONIOENCODING: 'utf-8' });
const 醒 = j => [...j.等].forEach(f => f());
const 完 = j => {
  if (j.完) return;
  j.完 = true;
  j.ms = Date.now() - j.at;
  醒(j);
  const 旧 = [...表.values()].filter(x => x.完);
  while (旧.length > 30) 表.delete(旧.shift().id);
};
function 起(a) {
  const cmd = String(a.cmd || '');
  if (!cmd.trim()) 错('要 cmd: 要跑的命令');
  const [exe, args, 原样] = 壳(a.shell, cmd), id = String(++号);
  const c = cp.spawn(exe, args, { cwd: 路(a.cwd), env: ENV, windowsHide: true, detached: !WIN,
    windowsVerbatimArguments: !!原样 });
  const j = { id, cmd, pid: c.pid, c, at: Date.now(), code: null, 完: false, 全: [缓(), 缓()],
    新: [缓(), 缓()], 等: new Set() };
  ['stdout', 'stderr'].forEach((k, i) => {
    const d = new StringDecoder('utf8');
    c[k].on('data', x => { const s = d.write(x); 收(j.全[i], s); 收(j.新[i], s); 醒(j); });
  });
  c.stdin.on('error', () => { });
  c.on('error', e => { 收(j.全[1], e.message); 收(j.新[1], e.message); j.code = -1; 完(j); });
  c.on('exit', (code, sig) => { j.code = code == null ? sig : code; setTimeout(() => 完(j), 300); });   // 等收尾
  c.on('close', () => 完(j));
  表.set(id, j);
  return j;
}
const 等 = (j, ms, 有新就回) => new Promise(ok => {
  const 有 = () => j.完 || 有新就回 && (j.新[0].h || j.新[1].h);
  if (有()) return ok();
  const 收尾 = () => { clearTimeout(t); j.等.delete(f); ok(); }, t = setTimeout(收尾, ms);
  const f = () => { if (有()) { j.等.delete(f); setTimeout(收尾, j.完 ? 0 : 150); } };   // 来了新输出再等一下凑一批
  j.等.add(f);
});
const 交 = (j, 全) => {
  const b = 全 ? j.全 : j.新, r = { id: j.id, done: j.完, out: 文(b[0]), err: 文(b[1]) };
  if (!全) j.新 = [缓(), 缓()];
  if (j.完) Object.assign(r, { code: j.code, ms: j.ms });
  return r;
};
const 毫秒 = (v, d) => v == null ? d : Math.min(Math.max(+v || 0, 0), 590000);
const 杀树 = pid => WIN ? cp.spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true })
  : process.kill(-pid, 'SIGKILL');
const 杀 = j => {
  if (!j.完) try { 杀树(j.pid); } catch (e) { try { j.c.kill('SIGKILL'); } catch (_) { } }
};
const 取 = id => 表.get(String(id)) || 错('没有这个后台进程: ' + id + '(jobs 看有哪些)');

// ── 自己的源码: 写前快照, 每个文件留 5 版; 启动时记一份「能跑的版本」, 重启起不来就退回它(跳过运行态凭证与依赖)
const 禁源 = /(^|\/)(\.colony-local|node_modules|\.git|tokens|\.state|package-lock\.json)(\/|$)/;
const 源 = f => {
  f = String(f || '').replace(/\\/g, '/');
  if (!f || f.split('/').includes('..') || path.isAbsolute(f) || 禁源.test(f))
    错('file 要是本机脚本目录里的源码相对路径, 如 colony-local.cjs');
  return path.join(DIR, f);
};
const 列源 = () => {
  const out = [], 走 = (d, rel, k) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel + e.name, p = path.join(d, e.name);
      if (out.length >= 200 || 禁源.test(r)) continue;
      if (e.isDirectory() && k < 2) 走(p, r + '/', k + 1);
      else if (e.isFile()) {
        const s = fs.statSync(p);
        out.push({ file: r, bytes: s.size, mtime: s.mtime.toISOString() });
      }
    }
  };
  走(DIR, '', 0);
  return out;
};
const 名 = f => f.replace(/\//g, '__') + '.';
const 快照们 = f => (fs.existsSync(BAK) ? fs.readdirSync(BAK) : []).filter(n => n.startsWith(名(f)))
  .map(n => ({ n, ts: +n.slice(名(f).length).split('.')[0] })).filter(x => x.ts).sort((a, b) => b.ts - a.ts);
const 快照 = f => {
  const p = 源(f);
  let ts = Date.now();
  if (!fs.existsSync(p)) return null;
  fs.mkdirSync(BAK, { recursive: true });
  while (快照们(f).some(x => x.ts === ts)) ts++;   // 同一毫秒写两次也各留一版
  fs.copyFileSync(p, path.join(BAK, 名(f) + ts + '.bak'));
  快照们(f).slice(5).forEach(x => fs.rmSync(path.join(BAK, x.n), { force: true }));
  return ts;
};
const 好 = {};
for (const x of 列源()) if (x.bytes <= 1 << 20) try { 好[x.file] = fs.readFileSync(path.join(DIR, x.file)); }
catch (e) { }
let 上次 = null, 重启中 = false;   // 上次重启没成: {at, why, tail}

// ── 数据面(:4135): 与控制面同进程双端口物理隔离(路由表零 shell/文件能力), 内嵌 sub/gateway.mjs 聚合网关
let 数据面 = null, 数据面模式 = 'off', 数据面错 = '';
function 数据面状态() {
  if (NO_GW) return { port: GW_PORT, running: false, mode: 'off' };
  const s = 数据面 && 数据面.status;
  return s ? Object.assign({ running: true, mode: 数据面模式 }, s)
    : { port: GW_PORT, running: false, mode: 数据面模式, error: 数据面错 || '未启动' };
}
async function 起数据面() {
  if (NO_GW || 数据面) return;
  数据面错 = '';
  const gwFile = path.join(DIR, 'sub', 'gateway.mjs');
  if (!fs.existsSync(gwFile)) { 数据面模式 = 'off'; 数据面错 = '缺少 sub/gateway.mjs'; return; }
  for (let i = 0; i < 5; i++) {
    try {
      const mod = await import(pathToFileURL(gwFile).href);
      数据面 = await mod.startGateway({ port: GW_PORT, embedded: true });
      数据面模式 = 'full';
      数据面错 = '';
      return;
    } catch (e) {
      数据面 = null; 数据面模式 = 'off'; 数据面错 = e.message;
      if (/EADDRINUSE/.test(e.message) && i < 4) { await 睡(300); continue; }
      console.warn('[colony-local] 数据面 :' + GW_PORT + ' 未能启动(' + e.message + '), 控制面 :' + PORT + ' 照常运行');
      return;
    }
  }
}
async function 关数据面() {
  if (!数据面) return;
  const g = 数据面; 数据面 = null;
  try { await g.stop(); } catch (e) { }
}

// ── op 表
const OPS = {
  info: () => ({ name: 'colony-local', version: VER, os: process.platform,
    osName: os.type() + ' ' + os.release(), arch: process.arch, shell: WIN ? 'powershell' : 'sh', home: HOME,
    cwd: CWD, node: process.version, pid: process.pid, dir: DIR, port: PORT, host: HOST,
    termux: TERMUX || undefined, gateway: 数据面状态(), lastRestart: 上次, ops: Object.keys(OPS) }),
  async run(a) {
    const j = 起(a);
    await 等(j, 毫秒(a.wait, 30000));
    if (!j.完) return 交(j);
    表.delete(j.id);
    const r = 交(j);
    delete r.id;
    return r;
  },
  async job(a) { const j = 取(a.id); await 等(j, 毫秒(a.wait, 10000), !a.peek); return 交(j, a.peek); },
  jobs: () => ({ jobs: [...表.values()].map(j => ({ id: j.id, cmd: j.cmd.slice(0, 200), pid: j.pid,
    running: !j.完, code: j.code, at: j.at, ms: j.完 ? j.ms : Date.now() - j.at })) }),
  async stop(a) { const j = 取(a.id); 杀(j); await 等(j, 3000); return 交(j); },
  input(a) {
    const j = 取(a.id);
    if (j.完) 错('它已经跑完了');
    if (a.text != null) j.c.stdin.write(String(a.text));
    if (a.end) j.c.stdin.end();
    return { ok: true };
  },
  read(a) {
    const f = 路(a.path), t = 读文(f), L = t.split('\n'), o = Math.max(1, +a.offset || 1);
    const n = t === '' ? 0 : L.length - (t.endsWith('\n') ? 1 : 0), 全 = !a.offset && !a.limit;
    const k = +a.limit > 0 ? +a.limit : n;
    return { path: f, lines: n, offset: o, count: 全 ? n : Math.max(0, Math.min(n - o + 1, k)),
      text: 全 ? t : L.slice(o - 1, o - 1 + k).join('\n') };
  },
  write(a) {
    if (typeof a.text !== 'string') 错('text 要是字符串');
    const f = 路(a.path);
    写文(f, a.text);
    return { ok: true, path: f, bytes: Buffer.byteLength(a.text) };
  },
  rm(a) { // 删一个文件(撤回新建的文件用; 不删文件夹, 免得一下删太多)
    const f = 路(a.path);
    let s = null;
    try { s = fs.lstatSync(f); } catch (e) { return { ok: true, path: f, existed: false }; }
    if (s.isDirectory()) 错('这是文件夹, rm 只删文件');
    fs.rmSync(f, { force: true });
    return { ok: true, path: f, existed: true };
  },
  ls(a) {
    const root = 路(a.path), d = Math.max(1, +a.depth || 1), items = [];
    const 走 = (dir, rel, k) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (items.length >= 2000) return;
        const p = path.join(dir, e.name), name = rel + e.name;
        const type = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'link' : 'other';
        let s = null;
        try { s = fs.lstatSync(p); } catch (x) { }
        items.push({ name, type, size: type === 'file' && s ? s.size : undefined,
          mtime: s && s.mtime.toISOString() });
        if (type === 'dir' && k < d && !/^(\.git|node_modules)$/.test(e.name))
          try { 走(p, name + '/', k + 1); } catch (x) { }
      }
    };
    走(root, '', 1);
    return { path: root, items, more: items.length >= 2000 || undefined };
  },
  'src.list': () => ({ dir: DIR, files: 列源() }),
  'src.read': a => ({ file: a.file, text: fs.readFileSync(源(a.file), 'utf8') }),
  'src.write': a => {
    if (typeof a.text !== 'string') 错('text 要是字符串');
    const p = 源(a.file), ts = 快照(a.file);
    写文(p, a.text);
    return { ok: true, file: a.file, bytes: Buffer.byteLength(a.text), backedUp: ts };
  },
  'src.backups': a => (源(a.file), { file: a.file,
    backups: 快照们(a.file).map(x => ({ ts: x.ts, bytes: fs.statSync(path.join(BAK, x.n)).size })) }),
  'src.revert': a => {
    const all = 快照们(a.file), x = a.ts ? all.find(y => y.ts === +a.ts) : all[0];
    if (!x) 错(all.length ? '没有 ts=' + a.ts + ' 的快照, 有: ' + all.map(y => y.ts) : '没有 ' + a.file + ' 的快照');
    fs.copyFileSync(path.join(BAK, x.n), 源(a.file));
    return { ok: true, file: a.file, revertedTo: x.ts };
  },
  restart: () => { if (重启中) 错('正在重启'); 重启中 = true; return { ok: true, version: VER, pid: process.pid }; },
  quit: () => ({ ok: true }),
};

// ── HTTP
const 头 = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true' };
const server = http.createServer((req, res) => {
  const 回 = (o, st) => {
    res.writeHead(st || 200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, 头));
    res.end(JSON.stringify(o));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, Object.assign({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Max-Age': '600' }, 头));
    return res.end();
  }
  if (req.method === 'GET' && /^\/ping\b/.test(req.url))
    return 回({ ok: true, version: VER, pid: process.pid });
  if (req.method !== 'POST') return 回({ error: '只认 GET /ping 和 POST / {op, ...}' }, 404);
  const ch = [];
  req.on('data', d => ch.push(d));
  req.on('end', async () => {
    let a;
    try { a = JSON.parse(Buffer.concat(ch).toString('utf8') || '{}'); }
    catch (e) { return 回({ error: '要 JSON' }, 400); }
    const f = OPS[a && a.op];
    if (!f) return 回({ error: '没有这个 op: ' + (a && a.op) + '。有: ' + Object.keys(OPS).join(', ') }, 400);
    try {
      const r = await f(a);
      if (a.op === 'restart') res.on('finish', () => 重启().catch(e => console.error(e)));
      if (a.op === 'quit') res.on('finish', () => { 表.forEach(杀); 关数据面().finally(() => process.exit(0)); });
      回(r);
    } catch (e) { 回({ error: e.message }, 400); }
  });
});
const 听 = (n = 0) => new Promise(ok => {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && n < 12) return setTimeout(() => 听(n + 1).then(ok), 250);
    console.error(e.code !== 'EADDRINUSE' ? '起不来: ' + e.message
      : '端口 ' + PORT + ' 被占了(多半已经有一个在跑: 打开 ' + PING + ' 看看)');
    process.exit(1);
  });
  server.listen(PORT, HOST, () => { server.removeAllListeners('error'); ok(); });
});
const 问 = (op, ms) => new Promise(ok => {   // 问正在跑的那个: ping 或发一个 op
  const 选 = { method: op ? 'POST' : 'GET', timeout: ms || 1000 };
  const q = http.request(op ? PING.slice(0, -4) : PING, 选, r => {
    let s = '';
    r.on('data', d => { s += d; });
    r.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { ok(null); } });
  });
  q.on('error', () => ok(null));
  q.on('timeout', () => { q.destroy(); ok(null); });
  q.end(op ? JSON.stringify({ op }) : undefined);
});
// 重启: 先停数据面与控制面 → 起新进程(输出写进 out.log) → 10 秒内回 /ping 自己就退出; 不然杀掉它、退回能跑的版本、重听
const 净参 = argv.filter(x => !/^(--(un)?install|--wake|colony:)/i.test(x));
async function 重启() {
  await 关数据面();
  await new Promise(r => { server.close(r); if (server.closeAllConnections) server.closeAllConnections(); });
  fs.mkdirSync(BAK, { recursive: true });
  const 起点 = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0, fd = fs.openSync(LOG, 'a');
  const c = cp.spawn(process.execPath, [ME].concat(净参), { cwd: DIR, detached: true,
    stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  let 退 = null;
  c.on('exit', code => { 退 = code == null ? '被杀' : code; });
  for (let i = 0; i < 40 && 退 === null; i++) {
    await 睡(250);
    const p = await 问();
    if (p && p.pid !== process.pid) {
      c.unref();
      表.forEach(杀);
      console.log('已换成新版 ' + p.version + ', 在后台跑, 输出写进 ' + LOG);
      process.exit(0);
    }
  }
  if (退 === null) try { 杀树(c.pid); } catch (e) { }
  for (const f in 好) {
    const p = path.join(DIR, f);
    try { if (fs.readFileSync(p).equals(好[f])) continue; } catch (e) { }
    fs.writeFileSync(p, 好[f]);
  }
  const tail = fs.readFileSync(LOG, 'utf8').slice(起点).trim().split('\n').slice(-15).join('\n');
  上次 = { at: Date.now(), why: 退 === null ? '新版 10 秒内没回 /ping' : '新版起来就退出了(退出码 ' + 退 + ')',
    tail, reverted: true };
  console.error('新版起不来, 已退回能跑的版本: ' + 上次.why + '\n' + tail);
  await 听();
  await 起数据面();
  重启中 = false;
}

// ── 后台静默唤醒与开机自启(免管理员注册 colony:// 网页一键唤醒协议)
function 后台起() {
  fs.mkdirSync(BAK, { recursive: true });
  const fd = fs.openSync(LOG, 'a');
  cp.spawn(process.execPath, [ME].concat(净参), { cwd: DIR, detached: true, stdio: ['ignore', fd, fd], windowsHide: true }).unref();
  fs.closeSync(fd);
}
async function 装(撤) {
  const 参 = [process.execPath, ME].concat(净参), q = s => '"' + s + '"', MAC = process.platform === 'darwin';
  const 在跑 = await 问(), 撤掉 = async f => {
    if (f) fs.rmSync(f, { force: true });
    if (WIN) cp.spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Classes\\colony', '/f'], { windowsHide: true });
    if (在跑) await 问('quit');
    console.log('已撤掉开机自启与网页唤醒' + (f ? ': ' + f : '') + (在跑 ? '\n正在跑的那个也停了' : ''));
  };
  if (WIN) {
    const f = path.join(process.env.APPDATA || HOME, 'Microsoft/Windows/Start Menu/Programs/Startup/colony-local.vbs');
    if (撤) return 撤掉(f);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const vbs = 'CreateObject("WScript.Shell").Run "' + 参.concat('--wake').map(s => '""' + s + '""').join(' ') + '", 0, False\r\n';
    fs.writeFileSync(f, '\ufeff' + vbs, 'utf16le');
    const reg = 'HKCU\\Software\\Classes\\colony';
    cp.spawnSync('reg.exe', ['add', reg, '/ve', '/d', 'URL:Colony Local', '/f'], { windowsHide: true });
    cp.spawnSync('reg.exe', ['add', reg, '/v', 'URL Protocol', '/d', '', '/f'], { windowsHide: true });
    cp.spawnSync('reg.exe', ['add', reg + '\\shell\\open\\command', '/ve', '/d', '"wscript.exe" "' + f + '"', '/f'], { windowsHide: true });
    if (!在跑) 后台起();
    console.log('已设好开机自启 + colony:// 网页唤醒: ' + f + '\n' + (在跑 ? '现在已在跑: ' : '已在后台启动: ') + PING);
  } else if (MAC) {
    const f = path.join(HOME, 'Library/LaunchAgents/fun.colony.local.plist');
    if (撤) { cp.spawnSync('launchctl', ['unload', '-w', f]); return 撤掉(f); }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.mkdirSync(BAK, { recursive: true });
    const xml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>fun.colony.local</string><key>ProgramArguments</key><array>${参.map(s => `<string>${xml(s)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(DIR)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(LOG)}</string><key>StandardErrorPath</key><string>${xml(LOG)}</string></dict></plist>\n`);
    cp.spawnSync('launchctl', ['unload', f]);
    cp.spawnSync('launchctl', ['load', '-w', f]);
    console.log('已设好 macOS 后台守护与开机自启: ' + f + '\n服务地址: ' + PING);
  } else if (TERMUX) {
    const f = path.join(HOME, '.termux/boot/colony-local.sh');
    if (撤) return 撤掉(f);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock\nnohup '
      + 参.map(q).join(' ') + ' >> ' + q(LOG) + ' 2>&1 &\n', { mode: 0o755 });
    if (!在跑) 后台起();
    console.log('已写好 ' + f + '\n要装 Termux:Boot 应用并打开它一次, 手机开机后才会自己跑');
  } else if (撤) return 撤掉('');
  else {
    if (!在跑) 后台起();
    console.log('已在后台启动: ' + PING + '\n开机自启可加 crontab -e:\n@reboot ' + 参.map(q).join(' ') + ' >/dev/null 2>&1');
  }
}

process.on('uncaughtException', e => console.error('出错了(服务还在):', e));
process.on('SIGINT', () => 关数据面().finally(() => process.exit(0)));
process.on('SIGTERM', () => 关数据面().finally(() => process.exit(0)));
if (argv.includes('--install') || argv.includes('--uninstall')) 装(argv.includes('--uninstall'));
else if (argv.some(x => /^(--wake|colony:)/i.test(x))) 问().then(p => { if (!p) 后台起(); process.exit(0); });
else 听().then(async () => {
  await 起数据面();
  const gs = 数据面状态();
  console.log('colony-local 在 ' + PING.slice(0, -4) + ' · 版本 ' + VER + ' · 目录 ' + DIR
    + (gs.running ? '\n数据面网关(' + gs.mode + ') 在 http://' + gs.host + ':' + gs.port : '')
    + '\n在 Colony 的「本机」面板里点「重连」。关掉这个窗口就停了; 开机自启用 --install');
});

#!/usr/bin/env node
/* colony-gateway.mjs — 把纯 CLI agent(claude code / codex / 任意命令行大脑)包成本地 OpenAI 端点。
 * 端点直连档的最后一块拼图: 有了它, 没有 OpenAI 口的 CLI 也变成"一条 URL 即群聊成员", 全家统一。
 *
 * 用法:
 *   node colony-gateway.mjs --preset claude              # 包 Claude Code CLI(--resume 续会话)
 *   node colony-gateway.mjs --preset claude,codex        # 同时包多个(各自是一个 model)
 *   node colony-gateway.mjs --config my-agent.json       # 陌生 CLI 五字段自定义(见下)
 *   node colony-gateway.mjs --preset claude --port 4123 --key 本地密码
 *   node colony-gateway.mjs --check --preset claude      # 自检(入口存在/起服自探)
 *   node colony-gateway.mjs --add codex                  # 4123 上已有网关: 把 codex 加进去(热加, 不另起进程)
 *
 * 一台电脑只跑一个网关(默认 4123), 多个 CLI 是它的不同 model: 起之前先 GET /v1/models 看在不在;
 * 在就 --add 加预设(或 POST /v1/agents {preset}); 端口被别的程序占了才换 --port。同端口再起一个会直接报错退出, 不会打架
 *
 * --config JSON 五字段(与 colony-agent.mjs 同构):
 *   { "name": "MyAgent",                                 ← model id(小写)
 *     "command": ["node", "cli.js", "-p", "{msg}"],      ← {msg} 会被替换为提示词
 *     "resumeArgs": ["--resume", "{session}"],           ← 可选: 有会话 id 时追加
 *     "parse": "claude-json",                            ← 可选: claude-json | 空(整段 stdout)
 *     "timeoutSec": 600 }
 *
 * 协议(OpenAI 兼容面):
 *   GET  /v1/models                → { data: [{id: 预设名}] }
 *   POST /v1/chat/completions      → 流式(SSE, 等待期 ": ka" 心跳)与非流式
 *   CORS 模范生: 放行一切来源与自定义头(含 X-Hermes-Session-Id), OPTIONS 204 → 浏览器可直连, 无需插件。
 *   鉴权: --key 时校验 Bearer, 错回 401 {error:{message,fix}}(诚实错误, 不伪造成功)。
 *
 * 会话: 请求带 X-Hermes-Session-Id(或 body.session_id)→ 映射 CLI 自己的会话(claude --resume):
 *   同一会话头 → 续接(只发最后一条 user 消息, CLI 自己记得上文), 状态持久化 cwd colony-gateway.state.json;
 *   无会话头 → 无状态(把 messages 全历史扁平化成一段提示词, 每次独立), 语义同 ollama。
 *   同一会话内请求串行(防两次 --resume 踩踏), 不同会话并行。
 *
 * Windows 三坑已内置(colony-agent.mjs 实测继承): 勿 spawn .ps1/.cmd 垫片(直调 node+真入口)/子进程显式 UTF-8/会话持久化。
 * 单文件自含, 零依赖, 拷到任何有 node 的机器直接用。 */
'use strict';
import http from 'node:http';
import { execFile, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* ── 参数 ── */
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const PORT = parseInt(arg('port', '4123'));
const KEY = typeof arg('key') === 'string' ? arg('key') : '';
const PIN = typeof arg('pin-session') === 'string' ? arg('pin-session') : ''; // 第一视角: 新会话一律从这个 CLI 会话续出(钉死会话, 显式开关)
const log = (...a) => console.log('[colony-gateway]', ...a);

/* ── 预设(与 colony-agent.mjs 同源拷贝: 本文件要单独分发, 不 import) ── */
function npmGlobalRoot() {
  const guess = process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : null;
  if (guess && fs.existsSync(guess)) return guess;
  try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; }
}
function codexExe() { // 桌面版 Codex 自带的原生 codex.exe(最新的那个) > npm 包里的原生 exe > PATH 上的 codex
  const cands = [];
  const la = process.env.LOCALAPPDATA;
  if (la) { const bin = path.join(la, 'OpenAI', 'Codex', 'bin');
    try { for (const d of fs.readdirSync(bin)) { const p = path.join(bin, d, 'codex.exe'); if (fs.existsSync(p)) cands.push(p); } } catch { }
    const top = path.join(bin, 'codex.exe'); if (fs.existsSync(top)) cands.push(top); }
  const root = npmGlobalRoot();
  if (root) { const vend = path.join(root, '@openai', 'codex', 'vendor');
    try { for (const d of fs.readdirSync(vend)) { const p = path.join(vend, d, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex'); if (fs.existsSync(p)) cands.push(p); } } catch { } }
  cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0] || 'codex';
}
const PRESETS = {
  claude: () => { // claude -p 非交互; JSON 输出含 result 与 session_id; npm 垫片是 .cmd → 直调 cli.js
    const root = npmGlobalRoot();
    const entry = root && path.join(root, '@anthropic-ai', 'claude-code', 'cli.js');
    const head = (entry && fs.existsSync(entry)) ? ['node', entry] : ['claude'];
    return { name: 'claude', command: head.concat(['-p', '{msg}', '--output-format', 'json']), resumeArgs: ['--resume', '{session}'], parse: 'claude-json', timeoutSec: 600 };
  },
  codex: () => { // 实测(codex-cli 0.163): exec --json 出 JSONL(thread.started 带 thread_id, item.completed/agent_message 是回复);
    // 续会话是子命令 exec resume <id>; 提示词经 stdin(-)喂, Windows 命令行里的中文会被 GBK 搅乱; npm 垫片是 .cmd, 优先桌面版原生 exe
    const exe = codexExe();
    const base = [exe, 'exec', '--skip-git-repo-check', '--json'];
    return { name: 'codex', command: base.concat(['-']), resume: s => [exe, 'exec', 'resume', s, '--skip-git-repo-check', '--json', '-'],
      stdin: true, parse: 'codex-jsonl', timeoutSec: 600 };
  },
};

function loadAgents() {
  const agents = new Map(); // model id → cfg
  const cfgPath = typeof arg('config') === 'string' ? arg('config') : null;
  if (cfgPath) {
    const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    agents.set((c.name || 'agent').toLowerCase(), c);
  }
  const presetArg = typeof arg('preset') === 'string' ? arg('preset') : (cfgPath ? '' : 'claude');
  for (const p of presetArg.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!PRESETS[p]) { console.error('未知预设: ' + p + '(可用: ' + Object.keys(PRESETS).join('|') + ', 或 --config 自定义)'); process.exit(1); }
    try { const c = PRESETS[p](); agents.set(c.name, c); } catch (e) { console.error('预设 ' + p + ' 不可用: ' + e.message); process.exit(1); }
  }
  return agents;
}

/* ── CLI 调用与解析(UTF-8 显式, 中文 Windows 默认 GBK 会搅乱输出) ── */
function runCli(cliArgv, timeoutSec, input) { // input: 有就从 stdin 喂(UTF-8), 没有就把 stdin 关掉(有的 CLI 会一直等 stdin)
  return new Promise((resolve) => {
    const cp = execFile(cliArgv[0], cliArgv.slice(1), { timeout: (timeoutSec || 240) * 1000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      if (err && !out) return resolve({ error: (err.killed ? 'CLI 超时(' + timeoutSec + 's)' : err.message) + (stderr ? ' | ' + String(stderr).slice(0, 300) : '') });
      resolve({ out, err: String(stderr || '') });
    });
    try { if (input != null) cp.stdin.end(input, 'utf8'); else cp.stdin.end(); } catch { }
  });
}
function extractReply(out, cfg, sess) {
  if (cfg.parse === 'claude-json') {
    try {
      const j = JSON.parse(out.slice(out.indexOf('{')));
      if (j.session_id) sess.cli = j.session_id;
      return (typeof j.result === 'string' && j.result.trim()) ? j.result : JSON.stringify(j).slice(0, 2000);
    } catch { return out || '[无回复内容]'; }
  }
  if (cfg.parse === 'codex-jsonl') {
    const msgs = [], errs = [];
    for (const line of out.split(/\r?\n/)) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'thread.started' && j.thread_id) sess.cli = j.thread_id;
      const it = j.item || {};
      if (j.type === 'item.completed' && it.type === 'agent_message' && it.text) msgs.push(it.text);
      if (j.type === 'turn.failed' || j.type === 'error') errs.push((j.error && j.error.message) || j.message || line);
    }
    if (msgs.length) return msgs.join('\n\n');
    if (errs.length) throw new Error(errs.join(' | ').slice(0, 500));
    return '[无回复内容]';
  }
  return out || '[无回复内容]';
}

/* ── 会话表: 会话头 → {cli: CLI侧会话id, chain: 串行链}; 持久化 cwd ── */
const STATE_PATH = path.join(process.cwd(), 'colony-gateway.state.json');
let persisted = {};
try { persisted = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { }
const sessions = new Map(Object.entries(persisted.sessions || {}).map(([k, v]) => [k, { cli: v, chain: Promise.resolve() }]));
const saveState = () => { try { fs.writeFileSync(STATE_PATH, JSON.stringify({ sessions: Object.fromEntries([...sessions].map(([k, v]) => [k, v.cli])) }, null, 1)); } catch (e) { log('⚠ 状态写不进: ' + e.message); } };

/* messages → 提示词: 续接本网关已有会话时只给"最后一条 assistant 之后的增量"(CLI 自己记得上文;
   增量可能不止一条 user — 引擎的工具结果/新 system 也在里面, 只发最后一条 user 会丢信息);
   首轮/无会话给扁平化全历史 */
function contentText(c) { // 数组内容归一(纯文本壳): 抽 text part, 附件/引用转占位标注 —— 否则整条消息变 [object Object]
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => !p ? '' : typeof p === 'string' ? p : p.type === 'text' ? (p.text || '') : p.type === 'ref' ? '[附件引用 ' + (p.addr || '') + (p.name ? ' ' + p.name : '') + ']' : p.data ? '[' + (p.type || '媒体') + '附件' + (p.name ? ' ' + p.name : '') + '(字节略)]' : '').filter(Boolean).join('\n');
  return String(c == null ? '' : c);
}
function renderPrompt(messages, delta) {
  if (delta) {
    let li = -1;
    for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant') li = i;
    let inc = messages.slice(li + 1);
    if (!inc.length) inc = messages.slice(-1);
    return inc.map(m => m.role === 'user' ? contentText(m.content) : '[' + m.role + '] ' + contentText(m.content)).join('\n');
  }
  const lines = [];
  for (const m of messages) {
    if (m.role === 'system') lines.push('[背景] ' + contentText(m.content));
    else if (m.role === 'user') lines.push('用户: ' + contentText(m.content));
    else if (m.role === 'assistant') lines.push('你之前答: ' + contentText(m.content));
  }
  return lines.join('\n');
}

/* ── HTTP ── */
const AGENTS = loadAgents();
const CORS = (req) => ({
  'Access-Control-Allow-Origin': (req.headers.origin || '*'),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Authorization, Content-Type, X-Hermes-Session-Id',
  'Access-Control-Max-Age': '600',
});
const sendJson = (req, res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS(req) }); res.end(JSON.stringify(obj)); };
const fail = (req, res, code, message, fix) => sendJson(req, res, code, { error: { message, fix } });

async function handleChat(req, res, body) {
  let payload;
  try { payload = JSON.parse(body || '{}'); } catch { return fail(req, res, 400, '请求体不是合法 JSON', 'POST application/json: {model, messages, stream}'); }
  const wanted = String(payload.model || '').toLowerCase();
  const cfg = AGENTS.get(wanted) || (!wanted && AGENTS.size === 1 ? [...AGENTS.values()][0] : null); // 只有"没填"才兜底单 agent; 填错必须如实 404, 不静默换模型
  if (!cfg) return fail(req, res, 404, '未知 model: ' + payload.model, '可用: ' + [...AGENTS.keys()].join(', ') + '(GET /v1/models 可查)');
  if (!Array.isArray(payload.messages) || !payload.messages.length) return fail(req, res, 400, 'messages 缺失或为空', 'messages: [{role, content}, ...]');
  const sid0 = req.headers['x-hermes-session-id'] || payload.session_id || null;
  const sid = sid0 && (AGENTS.size > 1 ? cfg.name + ':' + sid0 : sid0);   // 一个网关多个 CLI: 会话按 model 分开, claude 的会话 id 不会拿去续 codex
  const stream = payload.stream !== false;

  let ka = null;
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS(req) });
    ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { clearInterval(ka); } }, 15000); // 等待期心跳, SSE 注释行(消费端解析器天然忽略)
  }

  const work = async () => {
    const sess = sid ? (sessions.get(sid) || sessions.set(sid, { cli: null, chain: Promise.resolve() }).get(sid)) : { cli: null };
    const known = !!(sid && sess.cli);                       // 本网关已有 CLI 会话 → 发增量
    const resumeTarget = known ? sess.cli : (PIN || null);   // 没有则看钉死会话(第一视角): 首挂 PIN 仍发全量(引擎系统提示必须送达)
    const resuming = !!(resumeTarget && (cfg.resumeArgs || cfg.resume));
    const prompt = renderPrompt(payload.messages, known && resuming);
    let cliArgv = resuming && cfg.resume ? cfg.resume(resumeTarget) : cfg.command.map(a => a === '{msg}' ? prompt : a);
    if (resuming && cfg.resumeArgs) cliArgv = cliArgv.concat(cfg.resumeArgs.map(a => a === '{session}' ? resumeTarget : a));
    log('→ ' + cfg.name + (resuming ? ' 续 ' + String(resumeTarget).slice(0, 8) : ' 新会话') + ' · ' + prompt.length + ' 字');
    const r = await runCli(cliArgv, cfg.timeoutSec, cfg.stdin ? prompt : null);
    if (r.error) throw new Error(r.error);
    const reply = extractReply(r.out, cfg, sess);
    if (sid) saveState();
    return reply;
  };
  const run = sid && sessions.get(sid) ? (sessions.get(sid).chain = sessions.get(sid).chain.then(work, work)) : work(); // 同会话串行, 防 --resume 踩踏

  const id = 'gw-' + Date.now().toString(36), created = Math.floor(Date.now() / 1000), model = cfg.name;
  try {
    const reply = await run;
    if (!stream) return sendJson(req, res, 200, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] });
    clearInterval(ka);
    const chunk = (delta, fin) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: fin || null }] }) + '\n\n');
    chunk({ role: 'assistant' }); chunk({ content: reply }); chunk({}, 'stop');
    res.write('data: [DONE]\n\n'); res.end();
  } catch (e) {
    if (!stream) return fail(req, res, 502, 'CLI 执行失败: ' + e.message, '看 gateway 终端日志; --check 自检; 确认该 CLI 单独能跑');
    clearInterval(ka);
    res.write('data: ' + JSON.stringify({ error: { message: 'CLI 执行失败: ' + e.message } }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); // 流内诚实报错, 不伪造正常回复
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS(req)); return res.end(); }
  if (KEY) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + KEY) return fail(req, res, 401, '缺少或错误的 API key', "带 'Authorization: Bearer <key>'(key 是起 gateway 时 --key 设的那个)");
  }
  if (req.method === 'POST' && url === '/v1/agents') { // 热加预设: {preset} → 同一个网关多一个 model
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => { try { const p = String(JSON.parse(body || '{}').preset || ''); if (!PRESETS[p]) return fail(req, res, 404, '未知预设: ' + p, '可用: ' + Object.keys(PRESETS).join('|'));
      const c = PRESETS[p](); AGENTS.set(c.name, c); log('＋ 加了 model ' + c.name + ' → ' + c.command.slice(0, 2).join(' '));
      sendJson(req, res, 200, { ok: true, models: [...AGENTS.keys()] }); } catch (e) { fail(req, res, 500, e.message); } });
    return;
  }
  if (req.method === 'GET' && url === '/v1/models') return sendJson(req, res, 200, { object: 'list', data: [...AGENTS.keys()].map(id => ({ id, object: 'model', owned_by: 'colony-gateway' })) });
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => handleChat(req, res, body).catch(e => fail(req, res, 500, e.message)));
    return;
  }
  fail(req, res, 404, '没有这个端点: ' + req.method + ' ' + url, '可用: GET /v1/models | POST /v1/chat/completions');
});

/* ── 自检 ── */
if (arg('check')) {
  let ok = true;
  for (const [id, cfg] of AGENTS) {
    const exe = cfg.command[0] === 'node' ? cfg.command[1] : cfg.command[0];
    const exists = (cfg.command[0] !== 'node' && !/[\\/]/.test(exe)) || fs.existsSync(exe);
    console.log((exists ? '✓' : '✗') + ' model ' + id + ' → ' + cfg.command.join(' ').slice(0, 120));
    if (!exists) { ok = false; console.log('  入口不存在: ' + exe); }
  }
  server.listen(PORT, '127.0.0.1', async () => {
    const r = await fetch('http://127.0.0.1:' + PORT + '/v1/models', { headers: KEY ? { Authorization: 'Bearer ' + KEY } : {} }).then(x => x.json()).catch(e => ({ error: e.message }));
    console.log((r.data ? '✓' : '✗') + ' 自探 /v1/models → ' + JSON.stringify(r).slice(0, 150));
    console.log(ok && r.data ? '自检通过' : '自检有问题, 看上面 ✗ 项');
    process.exit(ok && r.data ? 0 : 1);
  });
} else if (arg('add')) { // 往已在跑的网关里加预设, 不另起进程
  const ps = String(arg('add')).split(',').map(x => x.trim()).filter(Boolean);
  (async () => {
    for (const p of ps) {
      const r = await fetch('http://127.0.0.1:' + PORT + '/v1/agents', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, KEY ? { Authorization: 'Bearer ' + KEY } : {}), body: JSON.stringify({ preset: p }) })
        .then(x => x.json()).catch(e => ({ error: { message: '连不上 ' + PORT + ' 上的网关: ' + e.message + '(先起一个: node colony-gateway.mjs --preset ' + p + ')' } }));
      console.log(r.ok ? '✓ 加好了, 现在的 model: ' + r.models.join(', ') : '✗ ' + (r.error && r.error.message));
      if (!r.ok) process.exit(1);
    }
    process.exit(0);
  })();
} else {
  server.on('error', async e => { // 端口被占: 看是不是已有的 Colony 网关, 是就把这次的预设加进去再退出, 不打架
    if (e.code !== 'EADDRINUSE') { log('✗ ' + e.message); process.exit(1); }
    const m = await fetch('http://127.0.0.1:' + PORT + '/v1/models').then(x => x.json()).catch(() => null);
    const ours = m && Array.isArray(m.data) && m.data.every(x => x.owned_by === 'colony-gateway');
    if (!ours) { log('✗ ' + PORT + ' 被别的程序占了, 换一个: --port 4124'); process.exit(1); }
    for (const id of AGENTS.keys()) {
      const r = await fetch('http://127.0.0.1:' + PORT + '/v1/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: id }) }).then(x => x.json()).catch(x => ({ error: { message: x.message } }));
      log(r.ok ? '✓ ' + PORT + ' 上已有 Colony 网关, 把 ' + id + ' 加进去了(model: ' + r.models.join(', ') + '); 本进程退出' : '✗ 加不进去: ' + (r.error && r.error.message));
    }
    process.exitCode = 0; server.close(); setTimeout(() => process.exit(0), 50).unref();   // 别在 listen 失败的回调里硬退: Windows 上 libuv 会断言崩
  });
  server.listen(PORT, '127.0.0.1', () => {
    log('OpenAI 端点已起: http://127.0.0.1:' + PORT + '  models: ' + [...AGENTS.keys()].join(', ') + (KEY ? '  (要 key)' : '  (无鉴权)'));
    if (PIN) log('第一视角已开: 新会话一律从 --resume ' + PIN + ' 续出(该 CLI 会话的记忆即出发点)');
    log('Colony「agent 桥接」左栏 ＋ → 扫描本机 → 添加(4123 在插件扫描表); 每个 model 是一位成员。再接别的 CLI: node colony-gateway.mjs --add <预设>。Ctrl+C 停。');
  });
}

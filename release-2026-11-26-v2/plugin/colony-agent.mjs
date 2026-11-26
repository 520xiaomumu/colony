#!/usr/bin/env node
/* ============================================================================
 * colony-agent.mjs  —  Colony Bridge 通用接入器 (colony-agent-v2)
 * ----------------------------------------------------------------------------
 * 把任意 CLI agent 接进 Colony 群聊, 协议的全部难点都在这里, 你一行协议代码都不用写:
 *   注册/agentKey 持久化(重连免重批) · 长轮询与脑子并行(生成半小时也在线)
 *   401 自动重注册 · superseded/removed 体面退位 · 游标补投去重(断线不丢话)
 *   生成期周期心跳(对方看到"仍在思考") · 子进程强制 UTF-8 · 会话续接(记忆连续)
 *
 * 用法(预设, 最常用):
 *   node colony-agent.mjs --preset openclaw            # OpenClaw(常驻 agent 'main')
 *   node colony-agent.mjs --preset hermes              # Hermes(--resume 续接同一会话)
 *   node colony-agent.mjs --preset claude              # Claude Code CLI(--resume 续接)
 *   node colony-agent.mjs --preset codex               # Codex CLI(未实测, 可用 --config 覆盖)
 *   可加: --bridge <本机 http://127.0.0.1:8888 或云端 https://…workers.dev>   --name "名字"   --state 路径
 *
 * 用法(陌生 CLI, 5 个字段接入):
 *   node colony-agent.mjs --config my.json
 *   my.json: { "name":"My Agent", "bridge":"http://127.0.0.1:7777",
 *              "command":["mycli","ask","{msg}"],            ← {msg} 会被替换成用户消息
 *              "resumeArgs":["--resume","{session}"],        ← 可选: 有会话 id 时追加
 *              "sessionRegex":"session[_ ]id[:\\s]+([\\w-]+)", ← 可选: 从输出捕获会话 id
 *              "stripLines":"^\\s*(session[_ ]id|↻)",        ← 可选: 回复里按行剥掉的元信息
 *              "timeoutSec":240 }
 *
 * 用法(程序化, 自己写 reply):
 *   import { serve } from './colony-agent.mjs';
 *   serve({ name: 'My Agent', bridge: 'http://127.0.0.1:7777', reply: async (text) => '回答' });
 *
 * 自检: node colony-agent.mjs --check --preset <名> (或 --config <文件>; 二者必带其一, 裸 --check 会被 CLI 门卫拦下)
 * ========================================================================== */
'use strict';
import fs from 'fs';
import path from 'path';
import { execFile, execSync } from 'child_process';
import { pathToFileURL } from 'url';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log('[' + ts() + ']', ...a);

/* ── 预设: 四个常见 CLI 的接法(Windows 三坑已内置: 勿 spawn .ps1 / UTF-8 / 会话续接) ── */
function npmGlobalRoot() {
  const guess = process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : null;
  if (guess && fs.existsSync(guess)) return guess;
  try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; }
}
function makePresets() {
  return {
    openclaw: () => { // 直调 node + dist 入口(npm 全局 .ps1 垫片 spawn 会 EINVAL); --agent main = 常驻会话, 记忆天然连续
      const root = npmGlobalRoot();
      const entry = root && path.join(root, 'openclaw', 'dist', 'index.js');
      if (!entry || !fs.existsSync(entry)) throw new Error('找不到 openclaw 入口(' + (entry || 'npm root 不可用') + ') — 先 npm i -g openclaw, 或用 --config 指定 command');
      return { name: 'OpenClaw', command: ['node', entry, 'agent', '--agent', 'main', '--json', '-m', '{msg}'], parse: 'openclaw-json', timeoutSec: 300 };
    },
    hermes: () => ({ // hermes 输出带 session_id 行与 ↻ 横幅, 剥掉; 捕获 session_id 供 --resume 续接
      name: 'Hermes', command: ['hermes', 'chat', '-q', '{msg}', '-Q'], resumeArgs: ['--resume', '{session}'],
      sessionRegex: 'session[_ ]id[:\\s]+([0-9A-Za-z_-]+)', stripLines: '^\\s*(session[_ ]id[:\\s]|↻)', timeoutSec: 300,
    }),
    claude: () => { // claude -p 非交互; --output-format json 里有 session_id 与 result; npm 垫片是 .cmd → node 直调 cli.js
      const root = npmGlobalRoot();
      const entry = root && path.join(root, '@anthropic-ai', 'claude-code', 'cli.js');
      const head = (entry && fs.existsSync(entry)) ? ['node', entry] : ['claude']; // 找不到入口就赌 PATH 上有真可执行体
      return { name: 'Claude Code', command: head.concat(['-p', '{msg}', '--output-format', 'json']), resumeArgs: ['--resume', '{session}'], parse: 'claude-json', timeoutSec: 600 };
    },
    codex: () => ({ // 未实测预设: 以 codex exec 为准; 不合适就用 --config 覆盖 command/resumeArgs
      name: 'Codex', command: ['codex', 'exec', '{msg}'], resumeArgs: null, timeoutSec: 600,
    }),
  };
}

/* ── 子进程调用: 输出显式 UTF-8(中文 Windows 默认 GBK 会把中文输出搅成乱码/崩溃) ── */
function runBrainCmd(argv, timeoutSec) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: (timeoutSec || 240) * 1000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      if (err && !out) return resolve({ error: '[脑子调用失败] ' + (err.killed ? '超时(' + timeoutSec + 's)' : err.message) + (stderr ? '\n' + String(stderr).slice(0, 400) : '') });
      resolve({ out });
    });
  });
}
function extractReply(out, cfg, state) {
  if (cfg.parse === 'openclaw-json') {
    try {
      const j = JSON.parse(out.slice(out.indexOf('{')));
      const texts = [];
      const walk = o => { if (!o || typeof o !== 'object') return; if (typeof o.text === 'string' && o.text.trim()) texts.push(o.text); for (const k of Object.keys(o)) if (k !== 'text') walk(o[k]); };
      walk(j.result || j);
      return texts[0] || '[无回复内容]';
    } catch (e) { return out || '[解析失败] ' + e.message; }
  }
  if (cfg.parse === 'claude-json') {
    try {
      const j = JSON.parse(out.slice(out.indexOf('{')));
      if (j.session_id) { state.session = j.session_id; }
      return (typeof j.result === 'string' && j.result.trim()) ? j.result : JSON.stringify(j).slice(0, 2000);
    } catch { return out || '[无回复内容]'; }
  }
  let text = out;
  if (cfg.sessionRegex) { const m = new RegExp(cfg.sessionRegex).exec(text); if (m) state.session = m[1]; }
  if (cfg.stripLines) { const re = new RegExp(cfg.stripLines); text = text.split('\n').filter(l => !re.test(l)).join('\n').trim(); }
  return text || '[无回复内容]';
}

/* ── 主体: serve(opts) — CLI 与程序化共用 ── */
export async function serve(opts) {
  const cfg = { ...opts };
  const BRIDGE = (cfg.bridge || process.env.COLONY_BRIDGE_URL || 'http://127.0.0.1:7777').replace(/\/+$/, '');
  const NAME = cfg.name || 'Agent';
  const slug = NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  const STATE_PATH = cfg.statePath || path.join(process.cwd(), 'colony-agent.' + slug + '.state.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { }
  if (state.bridge && state.bridge !== BRIDGE) state = { bridge: BRIDGE }; // 换桥即换身份
  state.bridge = BRIDGE;
  const saveState = () => { try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1)); } catch (e) { log('⚠ 状态文件写不进(' + e.message + '), 重启会失忆'); } };

  const J = async (method, p, body) => {
    // 瞬时网络错(连接超时/掉线, 云端/弱网常见)退避重试, 不让一次抖动崩掉整进程。
    // send 带 msgId 幂等、status/done 无副作用, 重发安全。重试仍不通则返 status:0, 调用方按非200处理。
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(BRIDGE + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json().catch(() => null) };
      } catch (e) {
        if (attempt >= 5) { log('⚠ ' + method + ' ' + p + ' 网络重试 ' + attempt + ' 次仍不通(' + e.message + '), 放弃本次'); return { status: 0, json: null, netError: e.message }; }
        await sleep(Math.min(400 * 2 ** attempt, 5000));
      }
    }
  };

  /* 大脑: 程序化给 reply(text); CLI 给 command 模板 */
  const brain = cfg.reply || (async (text) => {
    let argv = cfg.command.map(a => a === '{msg}' ? text : a);
    if (cfg.resumeArgs && state.session) argv = argv.concat(cfg.resumeArgs.map(a => a === '{session}' ? state.session : a));
    const r = await runBrainCmd(argv, cfg.timeoutSec);
    if (r.error) return r.error;
    const reply = extractReply(r.out, cfg, state);
    saveState();
    return reply;
  });

  let tok = null;
  async function register() {
    const r = await J('POST', '/agent/v2/register', { name: NAME, capabilities: cfg.capabilities || { chat: true }, agentKey: state.agentKey });
    if (r.status === 403) { log('✗ 授权已被撤销:', (r.json && r.json.fix) || ''); process.exit(1); }
    if (r.status === 410) { log('✗ 服务器还是旧协议? ', JSON.stringify(r.json)); process.exit(1); }
    if (r.status !== 200 || !r.json) throw new Error('register 失败 HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200));
    tok = r.json.inboxToken;
    if (r.json.approved) {
      log('✓ 已上线:', NAME, '· 桥', BRIDGE, '· 服务器游标', r.json.cursor);
      if (typeof state.cursor !== 'number') { state.cursor = r.json.cursor || 0; saveState(); }
    } else {
      log('⏳ 已申请接入, 等用户在 Colony 点「确认接入」…(pendingId ' + r.json.pendingId + ')');
    }
    return r.json;
  }

  /* 消息队列: poll 与脑子并行 — poll 永不被脑子阻塞, 长生成也一直在线 */
  const queue = [];
  let enqCursor = 0, busy = false;
  async function worker() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const m = queue.shift();
        log('▶ 处理消息 seq', m.seq, ':', String(m.content).slice(0, 60));
        await J('POST', '/agent/v2/status', { token: tok, chatId: m.chatId, status: '已收到, 处理中…' });
        const t0 = Date.now();
        const hb = setInterval(() => { // 生成期周期心跳: 对方看到"仍在思考", 也顺带刷新在线状态
          J('POST', '/agent/v2/status', { token: tok, chatId: m.chatId, status: '仍在思考…(' + Math.round((Date.now() - t0) / 1000) + 's)' }).catch(() => { });
        }, 20000);
        let reply;
        try { reply = await brain(String(m.content), { chatId: m.chatId, seq: m.seq, name: NAME, bridge: BRIDGE }); }
        catch (e) { reply = '[处理出错] ' + e.message; }
        finally { clearInterval(hb); }
        reply = String(reply == null ? '' : reply);
        if (reply.length > 12000) reply = reply.slice(0, 12000) + '\n\n[输出过长, 已截断]';
        await J('POST', '/agent/v2/send', { token: tok, chatId: m.chatId, content: reply || '(空回复)', msgId: 'r-' + m.seq }); // msgId=r-seq: 重试幂等
        await J('POST', '/agent/v2/done', { token: tok, chatId: m.chatId });
        state.cursor = Math.max(state.cursor || 0, m.seq); saveState(); // 处理完才推进游标: 中途崩了重启会补投
        log('✓ 已回复 seq', m.seq, ':', reply.slice(0, 80));
      }
    } finally { busy = false; }
  }

  async function handleEvent(ev) {
    const d = ev.data || {};
    if (ev.event === 'message') {
      if (typeof d.seq === 'number' && d.seq <= enqCursor) return; // 补投去重(游标未推进期间同一条会重放)
      if (typeof d.seq === 'number') enqCursor = d.seq;
      queue.push(d); worker().catch(e => log('worker 异常(已容错, 不退出): ' + (e && e.message || e)));
    } else if (ev.event === 'approved') {
      state.agentKey = d.agentKey; saveState();
      log('✓ 用户已批准, agentKey 已保存, 重连免重批');
    } else if (ev.event === 'superseded') { log('同 key 新实例已接管, 本实例退位。'); process.exit(0);
    } else if (ev.event === 'removed') { log('用户已把本成员从名单删除, 退出。'); process.exit(0);
    } else if (ev.event === 'auth-revoked') { log('授权被撤销, 退出。想回来: 请用户重新批准, 或删 state 里的 agentKey 重新申请。'); process.exit(0);
    } else if (ev.event === 'rejected') { log('接入被拒绝: ' + (d.reason || '') + ' — 礼貌退出, 不重试轰炸。'); process.exit(0);
    } else { log('· 事件', ev.event, JSON.stringify(d).slice(0, 120)); }
  }

  await register();
  enqCursor = state.cursor || 0;
  log('开始收信(长轮询并行于大脑, 静默零成本; Ctrl+C 退出即离线, 名单不掉)…');
  while (true) {
    try {
      const r = await fetch(BRIDGE + '/agent/v2/poll?token=' + encodeURIComponent(tok) + '&cursor=' + (state.cursor || 0) + '&timeout=25000');
      if (r.status === 401) { log('token 失效(多半服务器重启了) → 凭 agentKey 自动重注册'); await register(); continue; }
      if (r.status !== 200) { const j = await r.json().catch(() => null); log('poll HTTP ' + r.status, j ? JSON.stringify(j).slice(0, 160) : ''); await sleep(1500); continue; }
      const { events } = await r.json();
      for (const ev of (events || [])) await handleEvent(ev);
    } catch (e) { log('poll 出错(' + e.message + '), 1.5s 后重试'); await sleep(1500); }
  }
}

/* ── 自检: 连桥 → 注册 → 报告链路状态, 不吵不闹地退出 ── */
export async function selfCheck(opts) {
  const BRIDGE = (opts.bridge || process.env.COLONY_BRIDGE_URL || 'http://127.0.0.1:7777').replace(/\/+$/, '');
  const say = (okc, s) => console.log(' ', okc ? '✓' : '✗', s);
  let health = null;
  try { health = await (await fetch(BRIDGE + '/colony-agent/v2/health')).json(); } catch { }
  say(!!health, '桥可达: ' + BRIDGE + (health ? ' (成员 ' + health.members + ', 待批 ' + health.pending + ')' : ' — 先启动: node colony-bridge.js'));
  if (!health) process.exit(1);
  say(health.protocolVersion === 2, '协议版本 v2');
  if (opts.command) {
    try { const bin = opts.command[0]; say(true, '大脑命令: ' + opts.command.join(' ').slice(0, 80) + (bin === 'node' ? ' (入口存在: ' + fs.existsSync(opts.command[1]) + ')' : '')); } catch { }
  }
  const r = await fetch(BRIDGE + '/agent/v2/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (opts.name || 'Agent') + ' (自检)', capabilities: { chat: true } }) });
  const j = await r.json();
  say(r.status === 200 && j.pending, '注册链路通(拿到 pendingId ' + (j.pendingId || '?') + '; 自检不等审批, 该申请 10 分钟自动过期)');
  console.log('  → 一切就绪, 正式接入: 去掉 --check 重跑');
  await sleep(120); // 等 keep-alive socket 收尾再退, 免得 Windows 上 libuv 退出断言刷屏
  process.exit(0);
}

/* ── CLI ── */
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--check') a.check = true;
    else if (k.startsWith('--')) { a[k.slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  let cfg = {};
  try {
    if (args.config) cfg = JSON.parse(fs.readFileSync(args.config, 'utf8'));
    else if (args.preset) {
      const p = makePresets()[args.preset];
      if (!p) { console.error('未知预设: ' + args.preset + ' (可用: openclaw | hermes | claude | codex, 或 --config 自定义)'); process.exit(1); }
      cfg = p();
    } else {
      console.error('用法: node colony-agent.mjs --preset <openclaw|hermes|claude|codex> [--bridge URL] [--name 名字] [--check]');
      console.error('     node colony-agent.mjs --config my.json    (陌生 CLI 五字段接入, 见文件头注释)');
      process.exit(1);
    }
  } catch (e) { console.error('配置加载失败: ' + e.message); process.exit(1); }
  if (args.name) cfg.name = args.name;
  if (args.bridge) cfg.bridge = args.bridge;
  if (args.state) cfg.statePath = args.state;
  (args.check ? selfCheck(cfg) : serve(cfg)).catch(e => { console.error('接入器退出: ' + e.message); process.exit(1); });
}

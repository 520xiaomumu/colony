#!/usr/bin/env node
/* colony-gateway.mjs — 把纯 CLI agent(任意命令行脚本 / claude / codex)包成本地 OpenAI 端点。
 * 端点直连档的最后一块拼图: 没有 OpenAI 口的任意 CLI / 脚本, 经本网关统一变成 OpenAI 兼容成员。
 *
 * 用法:
 *   node colony-gateway.mjs --preset claude              # 包 Claude Code CLI(--resume 续会话)
 *   node colony-gateway.mjs --preset claude,codex        # 同时包多个(各自是一个 model)
 *   node colony-gateway.mjs --config my-agent.json       # 任意 CLI / 脚本自定义(见下)
 *   node colony-gateway.mjs --preset claude --port 4123 --key 本地密码
 *   node colony-gateway.mjs --preset claude --verbose    # 可选: 推思考/工具进度(默认关闭, 群聊不刷屏)
 *   node colony-gateway.mjs --check --preset claude      # 自检(入口存在/起服自探)
 *   node colony-gateway.mjs --add codex                  # 往 4123 上已在跑的网关热加预设
 *   node colony-gateway.mjs --add-config my-agent.json   # 往 4123 上已在跑的网关热加自定义 CLI
 *
 * --config JSON 字段(后几项均可选):
 *   { "name": "my-agent",                                ← model id(小写)
 *     "command": ["python3", "bot.py", "{msg}"],         ← 含 {msg} 则替换参数; 不含 {msg} 自动走 stdin 喂 UTF-8
 *     "resumeArgs": ["--resume", "{session}"],           ← 可选: 有会话 id 时追加
 *     "imageFlag": "--image",                            ← 可选: 收到图片附件时追加 [flag, 临时文件路径]
 *     "parse": "",                                       ← 可选: 空/text(纯文本真流式) | claude-stream | claude-json | codex-jsonl
 *     "env": {}, "cwd": "", "progress": false, "timeoutSec": 600 }
 *
 * 特性:
 *   - 通用流式 spawn 引擎: 任意纯文本/JSONL CLI 正文实时流式输出, 默认不向群聊刷思考与工具细节
 *   - 客户端断连(点「停」)立即强杀整个子进程树(Win taskkill /T /F, Unix 进程组 kill)并释放会话锁
 *   - 图片/音频/文件附件自动落盘临时目录并在提示词附上路径(支持 imageFlag 原生递图), 结束后自动清理
 *   - 剥离 CLAUDECODE* 等嵌套环境变量; 续接旧会话失败且未吐字时自动清坏 ID 冷启动重试一次
 *   - 单文件自含, 零依赖, 拷到任何有 node 的机器直接用。 */
'use strict';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/* ── 参数 ── */
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const PORT = parseInt(arg('port', '4123'));
const KEY = typeof arg('key') === 'string' ? arg('key') : '';
const PIN = typeof arg('pin-session') === 'string' ? arg('pin-session') : '';
const VERBOSE = !!arg('verbose', false);
const log = (...a) => console.log('[colony-gateway]', ...a);

/* ── 预设与配置归一 ── */
function npmGlobalRoot() {
  const guess = process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : null;
  if (guess && fs.existsSync(guess)) return guess;
  try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; }
}
function codexExe() {
  const cands = [];
  const la = process.env.LOCALAPPDATA;
  if (la) {
    const bin = path.join(la, 'OpenAI', 'Codex', 'bin');
    try { for (const d of fs.readdirSync(bin)) { const p = path.join(bin, d, 'codex.exe'); if (fs.existsSync(p)) cands.push(p); } } catch { }
    const top = path.join(bin, 'codex.exe'); if (fs.existsSync(top)) cands.push(top);
  }
  const root = npmGlobalRoot();
  if (root) {
    const vend = path.join(root, '@openai', 'codex', 'vendor');
    try { for (const d of fs.readdirSync(vend)) { const p = path.join(vend, d, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex'); if (fs.existsSync(p)) cands.push(p); } } catch { }
  }
  cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0] || 'codex';
}
const PRESETS = {
  claude: () => {
    const root = npmGlobalRoot();
    const entry = root && path.join(root, '@anthropic-ai', 'claude-code', 'cli.js');
    const head = (entry && fs.existsSync(entry)) ? ['node', entry] : ['claude'];
    return {
      name: 'claude',
      command: head.concat(['-p', '--output-format', 'stream-json', '--verbose']),
      resumeArgs: ['--resume', '{session}'],
      stdin: true,
      parse: 'claude-stream',
      timeoutSec: 600,
    };
  },
  codex: () => {
    const exe = codexExe();
    return {
      name: 'codex',
      command: [exe, 'exec', '--skip-git-repo-check', '--json', '-'],
      resume: s => [exe, 'exec', 'resume', s, '--skip-git-repo-check', '--json', '-'],
      imageFlag: '--image',
      stdin: true,
      parse: 'codex-jsonl',
      timeoutSec: 600,
    };
  },
};

function normalizeConfig(raw) {
  if (!raw || !Array.isArray(raw.command) || !raw.command.length) throw new Error('配置需要非空 command 数组');
  const name = String(raw.name || 'agent').trim().toLowerCase();
  const hasPlaceholder = raw.command.some(a => a === '{msg}');
  return Object.assign({}, raw, {
    name,
    stdin: raw.stdin != null ? !!raw.stdin : !hasPlaceholder,
    timeoutSec: Number(raw.timeoutSec) || 600,
  });
}

function loadAgents() {
  const agents = new Map();
  const cfgPath = typeof arg('config') === 'string' ? arg('config') : null;
  if (cfgPath) {
    const c = normalizeConfig(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
    agents.set(c.name, c);
  }
  const presetArg = typeof arg('preset') === 'string' ? arg('preset') : (cfgPath ? '' : 'claude');
  for (const p of presetArg.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!PRESETS[p]) { console.error('未知预设: ' + p + '(可用: ' + Object.keys(PRESETS).join('|') + ', 或 --config 自定义)'); process.exit(1); }
    try { const c = normalizeConfig(PRESETS[p]()); agents.set(c.name, c); } catch (e) { console.error('预设 ' + p + ' 不可用: ' + e.message); process.exit(1); }
  }
  return agents;
}

/* ── 子进程环境与进程树强杀 ── */
function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  for (const k of Object.keys(env)) {
    if (/^CLAUDECODE($|_)/i.test(k) || k === 'CLAUDE_CODE_ENTRYPOINT') delete env[k];
  }
  if (!env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1';
  return env;
}
function killTree(cp) {
  if (!cp || !cp.pid || cp.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
    } else {
      try { process.kill(-cp.pid, 'SIGTERM'); } catch { try { cp.kill('SIGTERM'); } catch { } }
      setTimeout(() => {
        if (cp.exitCode === null) {
          try { process.kill(-cp.pid, 'SIGKILL'); } catch { try { cp.kill('SIGKILL'); } catch { } }
        }
      }, 1500).unref();
    }
  } catch { }
}

/* ── 附件落盘(图片/音频/文件 → 临时目录, 本轮结束自动清理) ── */
const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/bmp': '.bmp', 'image/svg+xml': '.svg', 'audio/wav': '.wav', 'audio/mpeg': '.mp3',
  'application/pdf': '.pdf',
};
function createMediaBag() {
  let dir = null, seq = 0;
  const images = [];
  const ensureDir = () => {
    if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colony-gw-'));
    return dir;
  };
  const writeDataUrl = (dataUrl, prefix, fallbackName) => {
    const m = /^data:([^;,]+)?;base64,(.+)$/s.exec(String(dataUrl || ''));
    if (!m) return null;
    const mime = (m[1] || 'application/octet-stream').toLowerCase();
    const ext = MIME_EXT[mime] || (fallbackName ? path.extname(fallbackName) : '') || '.bin';
    const safeBase = fallbackName ? path.basename(fallbackName).replace(/[^\w.\u4e00-\u9fa5-]/g, '_') : (prefix + '-' + (++seq) + ext);
    const fname = fs.existsSync(path.join(ensureDir(), safeBase)) ? ((++seq) + '-' + safeBase) : safeBase;
    const fp = path.join(ensureDir(), fname);
    fs.writeFileSync(fp, Buffer.from(m[2], 'base64'));
    return fp;
  };
  const writeBase64 = (b64, prefix, ext) => {
    const fp = path.join(ensureDir(), prefix + '-' + (++seq) + (ext || '.bin'));
    fs.writeFileSync(fp, Buffer.from(String(b64 || ''), 'base64'));
    return fp;
  };
  const cleanup = () => { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } dir = null; } };
  return { images, writeDataUrl, writeBase64, cleanup };
}

function contentText(c, media) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return String(c == null ? '' : c);
  const out = [];
  for (const p of c) {
    if (!p) continue;
    if (typeof p === 'string') { out.push(p); continue; }
    if (p.type === 'text') { if (p.text) out.push(p.text); continue; }
    if (p.type === 'image_url') {
      const url = typeof p.image_url === 'string' ? p.image_url : (p.image_url && p.image_url.url);
      if (url && url.startsWith('data:') && media) {
        const fp = media.writeDataUrl(url, 'img');
        if (fp) { media.images.push(fp); out.push('[附件图片(本地路径): ' + fp + ']'); continue; }
      }
      if (url) out.push('[附件图片: ' + url.slice(0, 200) + ']');
      continue;
    }
    if (p.type === 'input_audio' && p.input_audio && p.input_audio.data && media) {
      const ext = '.' + String(p.input_audio.format || 'wav').replace(/[^a-z0-9]/gi, '');
      const fp = media.writeBase64(p.input_audio.data, 'audio', ext);
      out.push('[附件音频(本地路径): ' + fp + ']');
      continue;
    }
    if (p.type === 'file' && p.file && p.file.file_data && media) {
      const fp = media.writeDataUrl(p.file.file_data, 'file', p.file.filename);
      if (fp) { out.push('[附件文件(本地路径): ' + fp + ']'); continue; }
    }
    if (p.type === 'ref') { out.push('[附件引用 ' + (p.addr || '') + (p.name ? ' ' + p.name : '') + ']'); continue; }
    if (p.data) out.push('[' + (p.type || '媒体') + '附件' + (p.name ? ' ' + p.name : '') + '(字节略)]');
  }
  return out.filter(Boolean).join('\n');
}

function renderPrompt(messages, delta, media) {
  if (delta) {
    let li = -1;
    for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant') li = i;
    let inc = messages.slice(li + 1);
    if (!inc.length) inc = messages.slice(-1);
    return inc.map(m => m.role === 'user' ? contentText(m.content, media) : '[' + m.role + '] ' + contentText(m.content, media)).join('\n');
  }
  const lines = [];
  for (const m of messages) {
    if (m.role === 'system') lines.push('[背景] ' + contentText(m.content, media));
    else if (m.role === 'user') lines.push('用户: ' + contentText(m.content, media));
    else if (m.role === 'assistant') lines.push('你之前答: ' + contentText(m.content, media));
  }
  return lines.join('\n');
}

/* ── 通用流式 CLI 运行器(纯文本 / claude-stream / claude-json / codex-jsonl 统一走 spawn) ── */
function spawnCli(cliArgv, opts) {
  const { cfg, sess, input, signal, onDelta, onThink, onTool } = opts;
  const showProgress = VERBOSE || !!cfg.progress;
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve({ aborted: true, emitted: false, reply: '' });
    const cp = spawn(cliArgv[0], cliArgv.slice(1), {
      cwd: cfg.cwd || process.cwd(),
      env: cleanEnv(cfg.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    if (opts.onSpawn) opts.onSpawn(cp);

    let done = false, timedOut = false, aborted = false;
    let rawOut = '', errBuf = '', lineBuf = '', emitted = '', sawChunk = false, sawStreamDelta = false;
    const errs = [], seenMsg = new Map();

    const emitText = (chunk, raw) => {
      if (!chunk) return;
      const prefix = !raw && emitted && !emitted.endsWith('\n') && !chunk.startsWith('\n') ? '\n\n' : '';
      const piece = prefix + chunk;
      emitted += piece;
      sawChunk = true;
      if (onDelta) onDelta(piece);
    };

    const parseJsonLine = (line) => {
      const s = line.trim();
      if (!s) return;
      let j;
      try { j = JSON.parse(s); } catch { return; }

      if (cfg.parse === 'claude-stream') {
        if (j.session_id) sess.cli = j.session_id;
        if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta') {
          const d = j.event.delta || {};
          if (d.type === 'text_delta' && d.text) { sawStreamDelta = true; emitText(d.text, true); }
          else if (showProgress && d.type === 'thinking_delta' && d.thinking && onThink) onThink(d.thinking);
          return;
        }
        if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
          const mid = j.message.id || '';
          const parts = j.message.content;
          const fullTxt = parts.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('');
          if (fullTxt && !sawStreamDelta) {
            const prev = mid ? (seenMsg.get(mid) || '') : '';
            if (!mid) emitText(fullTxt, false);
            else if (fullTxt.length > prev.length) {
              emitText(fullTxt.startsWith(prev) ? fullTxt.slice(prev.length) : fullTxt, !!prev);
              seenMsg.set(mid, fullTxt);
            }
          }
          sawStreamDelta = false;
          if (showProgress) {
            for (const b of parts) {
              if (!b) continue;
              if (b.type === 'thinking' && b.thinking && onThink) onThink(b.thinking);
              if (b.type === 'tool_use' && onTool) {
                const label = b.input ? JSON.stringify(b.input).slice(0, 80) : '';
                onTool({ id: b.id || crypto.randomUUID(), name: b.name || 'tool', label, status: 'running' });
              }
            }
          }
          return;
        }
        if (j.type === 'user' && showProgress && onTool && j.message && Array.isArray(j.message.content)) {
          for (const b of j.message.content) {
            if (b && b.type === 'tool_result' && b.tool_use_id) {
              onTool({ id: b.tool_use_id, name: 'tool', status: b.is_error ? 'error' : 'completed' });
            }
          }
          return;
        }
        if (j.type === 'result') {
          if (j.session_id) sess.cli = j.session_id;
          if (j.is_error) errs.push(typeof j.result === 'string' && j.result ? j.result : 'Claude 返回错误');
          else if (!sawChunk && typeof j.result === 'string' && j.result.trim()) emitText(j.result, false);
        }
        return;
      }

      if (cfg.parse === 'codex-jsonl') {
        if (j.type === 'thread.started' && j.thread_id) sess.cli = j.thread_id;
        const it = j.item || {};
        if (j.type === 'item.completed' && it.type === 'agent_message' && it.text) emitText(it.text, false);
        if (showProgress) {
          if (j.type === 'item.started' && (it.type === 'command_execution' || it.type === 'mcp_tool_call') && onTool) {
            onTool({ id: it.id || crypto.randomUUID(), name: it.tool || it.type, label: String(it.command || '').slice(0, 80), status: 'running' });
          } else if (j.type === 'item.completed' && (it.type === 'command_execution' || it.type === 'mcp_tool_call') && onTool) {
            onTool({ id: it.id || crypto.randomUUID(), name: it.tool || it.type, status: it.exit_code ? 'error' : 'completed' });
          } else if (j.type === 'item.completed' && it.type === 'reasoning' && it.text && onThink) {
            onThink(it.text);
          }
        }
        if (j.type === 'turn.failed' || j.type === 'error') errs.push((j.error && j.error.message) || j.message || s);
      }
    };

    const timer = setTimeout(() => { timedOut = true; killTree(cp); }, (cfg.timeoutSec || 600) * 1000);
    const onAbort = () => { aborted = true; killTree(cp); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const finish = (code, spawnErr) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (lineBuf.trim() && (cfg.parse === 'claude-stream' || cfg.parse === 'codex-jsonl')) parseJsonLine(lineBuf);

      if (aborted) return resolve({ aborted: true, emitted: sawChunk, reply: emitted });
      if (cfg.parse === 'claude-json') {
        const out = rawOut.trim();
        try {
          const idx = out.indexOf('{');
          const j = idx >= 0 ? JSON.parse(out.slice(idx)) : null;
          if (j) {
            if (j.session_id) sess.cli = j.session_id;
            if (j.is_error) errs.push(typeof j.result === 'string' ? j.result : 'CLI 返回错误');
            else emitText((typeof j.result === 'string' && j.result.trim()) ? j.result : JSON.stringify(j).slice(0, 2000), false);
          } else if (out) emitText(out, true);
        } catch { if (out) emitText(out, true); }
      }

      if (spawnErr) return resolve({ failed: true, emitted: sawChunk, error: spawnErr.message, reply: emitted });
      if (timedOut && !sawChunk) return resolve({ failed: true, emitted: false, error: 'CLI 超时(' + cfg.timeoutSec + 's)' + (errBuf ? ' | ' + errBuf.slice(-300) : ''), reply: '' });
      if (errs.length && !sawChunk) return resolve({ failed: true, emitted: false, error: errs.join(' | ').slice(0, 500), reply: '' });
      if (code && code !== 0 && !sawChunk) {
        return resolve({ failed: true, emitted: false, error: 'CLI 退出码 ' + code + (errBuf ? ' | ' + errBuf.trim().slice(-300) : ''), reply: '' });
      }
      resolve({ failed: false, emitted: sawChunk, reply: emitted.trim() || '[无回复内容]' });
    };

    cp.stdout.setEncoding('utf8');
    cp.stdout.on('data', (chunk) => {
      if (cfg.parse === 'claude-stream' || cfg.parse === 'codex-jsonl') {
        lineBuf += chunk;
        const lines = lineBuf.split(/\r?\n/);
        lineBuf = lines.pop();
        for (const l of lines) parseJsonLine(l);
      } else if (cfg.parse === 'claude-json') {
        rawOut += chunk;
      } else {
        emitText(chunk, true);
      }
    });
    cp.stderr.setEncoding('utf8');
    cp.stderr.on('data', (chunk) => {
      errBuf += chunk;
      if (errBuf.length > 8192) errBuf = errBuf.slice(-8192);
    });
    cp.on('error', (err) => finish(1, err));
    cp.on('close', (code) => finish(code, null));
    try { if (input != null) cp.stdin.end(input, 'utf8'); else cp.stdin.end(); } catch { }
  });
}

/* ── 会话表: 会话头 → {cli: CLI侧会话id, chain: 串行链}; 持久化 cwd ── */
const STATE_PATH = path.join(process.cwd(), 'colony-gateway.state.json');
let persisted = {};
try { persisted = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { }
const sessions = new Map(Object.entries(persisted.sessions || {}).map(([k, v]) => [k, { cli: v, chain: Promise.resolve() }]));
const saveState = () => {
  try {
    const obj = Object.fromEntries([...sessions].filter(([, v]) => v.cli).map(([k, v]) => [k, v.cli]));
    fs.writeFileSync(STATE_PATH, JSON.stringify({ sessions: obj }, null, 1));
  } catch (e) { log('⚠ 状态写不进: ' + e.message); }
};

/* ── HTTP 服务 ── */
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
  const cfg = AGENTS.get(wanted) || (!wanted && AGENTS.size === 1 ? [...AGENTS.values()][0] : null);
  if (!cfg) return fail(req, res, 404, '未知 model: ' + payload.model, '可用: ' + [...AGENTS.keys()].join(', ') + '(GET /v1/models 可查)');
  if (!Array.isArray(payload.messages) || !payload.messages.length) return fail(req, res, 400, 'messages 缺失或为空', 'messages: [{role, content}, ...]');

  const sid0 = req.headers['x-hermes-session-id'] || payload.session_id || null;
  const sid = sid0 && (AGENTS.size > 1 ? cfg.name + ':' + sid0 : sid0);
  const stream = payload.stream !== false;
  const id = 'gw-' + Date.now().toString(36), created = Math.floor(Date.now() / 1000), model = cfg.name;

  const ac = new AbortController();
  let ka = null, sentRole = false;
  const onDisconnect = () => { if (!res.writableEnded) { clearInterval(ka); ac.abort(); } };
  res.on('close', onDisconnect);

  const writeSseChunk = (delta, fin) => {
    if (res.writableEnded || ac.signal.aborted) return;
    if (!sentRole && delta && !delta.role) {
      sentRole = true;
      res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: fin || null }] }) + '\n\n');
  };
  const writeSseEvent = (ev, data) => {
    if (res.writableEnded || ac.signal.aborted) return;
    res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n');
  };

  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS(req) });
    ka = setInterval(() => { try { if (!res.writableEnded) res.write(': ka\n\n'); } catch { clearInterval(ka); } }, 15000);
  }

  const sess = sid ? (sessions.get(sid) || sessions.set(sid, { cli: null, chain: Promise.resolve() }).get(sid)) : { cli: null };

  const work = async () => {
    if (ac.signal.aborted) return { aborted: true };
    const buildAndRun = async (useResume, target, useDelta) => {
      const media = createMediaBag();
      try {
        const prompt = renderPrompt(payload.messages, useDelta, media);
        let cliArgv = useResume && cfg.resume ? cfg.resume(target) : cfg.command.map(a => a === '{msg}' ? prompt : a);
        if (useResume && cfg.resumeArgs) cliArgv = cliArgv.concat(cfg.resumeArgs.map(a => a === '{session}' ? target : a));
        if (cfg.imageFlag && media.images.length) {
          const imgArgs = [];
          for (const fp of media.images) imgArgs.push(cfg.imageFlag, fp);
          if (cliArgv[cliArgv.length - 1] === '-') cliArgv = cliArgv.slice(0, -1).concat(imgArgs, ['-']);
          else cliArgv = cliArgv.concat(imgArgs);
        }
        log('→ ' + cfg.name + (useResume ? ' 续 ' + String(target).slice(0, 8) : ' 新会话') + ' · ' + prompt.length + ' 字' + (media.images.length ? ' · ' + media.images.length + ' 图' : ''));
        return await spawnCli(cliArgv, {
          cfg, sess,
          input: cfg.stdin ? prompt : null,
          signal: ac.signal,
          onDelta: stream ? (t) => writeSseChunk({ content: t }) : null,
          onThink: stream ? (t) => writeSseChunk({ reasoning_content: t }) : null,
          onTool: stream ? (tool) => writeSseEvent('hermes.tool.progress', tool) : null,
        });
      } finally {
        media.cleanup();
      }
    };

    const known = !!(sid && sess.cli);
    const resumeTarget = known ? sess.cli : (PIN || null);
    const resuming = !!(resumeTarget && (cfg.resumeArgs || cfg.resume));
    let r = await buildAndRun(resuming, resumeTarget, known && resuming);
    // 坏会话自愈: 续接旧会话失败且未输出任何正文 → 清坏 ID 冷启动重试一次
    if (r.failed && !r.emitted && resuming && known && !ac.signal.aborted) {
      log('⚠ 续会话失败(' + String(r.error || '').slice(0, 100) + '), 清旧会话冷启动重试一次');
      sess.cli = null;
      saveState();
      r = await buildAndRun(false, null, false);
    }
    if (sid && sess.cli) saveState();
    return r;
  };

  const run = sid ? (sess.chain = sess.chain.then(work, work)) : work();
  try {
    const r = await run;
    clearInterval(ka);
    res.off('close', onDisconnect);
    if (r.aborted || ac.signal.aborted || res.writableEnded) return;
    if (r.failed) throw new Error(r.error || 'CLI 执行失败');
    if (!stream) {
      return sendJson(req, res, 200, {
        id, object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content: r.reply }, finish_reason: 'stop' }],
      });
    }
    if (!r.emitted) writeSseChunk({ content: r.reply });
    writeSseChunk({}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    clearInterval(ka);
    res.off('close', onDisconnect);
    if (ac.signal.aborted || res.writableEnded) return;
    if (!stream) return fail(req, res, 502, 'CLI 执行失败: ' + e.message, '看 gateway 终端日志; --check 自检; 确认该 CLI 单独能跑');
    res.write('data: ' + JSON.stringify({ error: { message: 'CLI 执行失败: ' + e.message } }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS(req)); return res.end(); }
  if (KEY) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + KEY) return fail(req, res, 401, '缺少或错误的 API key', "带 'Authorization: Bearer <key>'(key 是起 gateway 时 --key 设的那个)");
  }
  if (req.method === 'POST' && url === '/v1/agents') {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        let c;
        if (j.config) {
          c = normalizeConfig(j.config);
        } else {
          const p = String(j.preset || '');
          if (!PRESETS[p]) return fail(req, res, 404, '未知预设: ' + p, '可用: ' + Object.keys(PRESETS).join('|') + ' 或传 {config:{name,command}}');
          c = normalizeConfig(PRESETS[p]());
        }
        AGENTS.set(c.name, c);
        log('＋ 加了 model ' + c.name + ' → ' + c.command.slice(0, 2).join(' '));
        sendJson(req, res, 200, { ok: true, models: [...AGENTS.keys()] });
      } catch (e) { fail(req, res, 500, e.message); }
    });
    return;
  }
  if (req.method === 'GET' && url === '/v1/models') return sendJson(req, res, 200, { object: 'list', data: [...AGENTS.keys()].map(id => ({ id, object: 'model', owned_by: 'colony-gateway' })) });
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => handleChat(req, res, body).catch(e => { if (!res.writableEnded) fail(req, res, 500, e.message); }));
    return;
  }
  fail(req, res, 404, '没有这个端点: ' + req.method + ' ' + url, '可用: GET /v1/models | POST /v1/chat/completions | POST /v1/agents');
});

/* ── 自检 / 热加 / 启动 ── */
const authHeaders = () => Object.assign({ 'Content-Type': 'application/json' }, KEY ? { Authorization: 'Bearer ' + KEY } : {});

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
} else if (arg('add') || arg('add-config')) {
  (async () => {
    const reqs = [];
    if (typeof arg('add') === 'string') {
      for (const p of arg('add').split(',').map(x => x.trim()).filter(Boolean)) reqs.push({ preset: p });
    }
    if (typeof arg('add-config') === 'string') {
      reqs.push({ config: JSON.parse(fs.readFileSync(arg('add-config'), 'utf8')) });
    }
    for (const body of reqs) {
      const r = await fetch('http://127.0.0.1:' + PORT + '/v1/agents', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
        .then(x => x.json()).catch(e => ({ error: { message: '连不上 ' + PORT + ' 上的网关: ' + e.message } }));
      console.log(r.ok ? '✓ 加好了, 现在的 model: ' + r.models.join(', ') : '✗ ' + (r.error && r.error.message));
      if (!r.ok) process.exit(1);
    }
    process.exit(0);
  })();
} else {
  server.on('error', async e => {
    if (e.code !== 'EADDRINUSE') { log('✗ ' + e.message); process.exit(1); }
    const m = await fetch('http://127.0.0.1:' + PORT + '/v1/models', { headers: KEY ? { Authorization: 'Bearer ' + KEY } : {} }).then(x => x.json()).catch(() => null);
    const ours = m && Array.isArray(m.data) && m.data.every(x => x.owned_by === 'colony-gateway');
    if (!ours) { log('✗ ' + PORT + ' 被别的程序占了, 换一个: --port 4124'); process.exit(1); }
    for (const [id, cfg] of AGENTS) {
      const body = PRESETS[id] ? { preset: id } : { config: cfg };
      const r = await fetch('http://127.0.0.1:' + PORT + '/v1/agents', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
        .then(x => x.json()).catch(x => ({ error: { message: x.message } }));
      log(r.ok ? '✓ ' + PORT + ' 上已有 Colony 网关, 把 ' + id + ' 加进去了(model: ' + r.models.join(', ') + '); 本进程退出' : '✗ 加不进去: ' + (r.error && r.error.message));
    }
    process.exitCode = 0; server.close(); setTimeout(() => process.exit(0), 50).unref();
  });
  server.listen(PORT, '127.0.0.1', () => {
    log('OpenAI 端点已起: http://127.0.0.1:' + PORT + '  models: ' + [...AGENTS.keys()].join(', ') + (KEY ? '  (要 key)' : '  (无鉴权)') + (VERBOSE ? '  (进度详情:开)' : ''));
    if (PIN) log('第一视角已开: 新会话一律从 --resume ' + PIN + ' 续出(该 CLI 会话的记忆即出发点)');
    log('Colony「agent 桥接」左栏 ＋ → 扫描本机 → 添加(4123 在插件扫描表); 每个 model 是一位成员。再接别的 CLI: node colony-gateway.mjs --add <预设> 或 --add-config <json>。Ctrl+C 停。');
  });
}

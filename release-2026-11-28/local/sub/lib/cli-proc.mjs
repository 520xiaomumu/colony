import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT_DIR } from './store.mjs';
import { HttpError, parseDataUrl } from './openai.mjs';

export const IS_WIN = process.platform === 'win32';
export const TMP_DIR = path.join(ROOT_DIR, '.tmp');
export const WORKTREES_DIR = path.join(ROOT_DIR, '.worktrees');
const RESOLVE_TTL_MS = 60 * 1000;
const TMP_TTL_MS = 2 * 60 * 60 * 1000;

export const BUILTIN_PRESETS = [
  {
    id: 'claude',
    name: 'Claude Code',
    protocol: 'stream-json',
    bins: ['claude'],
    args: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    resumeFlag: '--resume',
    systemFlag: '--append-system-prompt',
    inputMode: 'stdin',
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'codex',
    name: 'Codex',
    protocol: 'codex',
    bins: ['codex'],
    args: [],
    inputMode: 'stdin',
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    protocol: 'acp',
    bins: ['agy', path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe')],
    args: ['acp'],
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    protocol: 'acp',
    bins: ['gemini'],
    args: ['--acp'],
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'hermes',
    name: 'Hermes',
    protocol: 'plain',
    bins: ['hermes'],
    args: ['chat', '--quiet'],
    promptFlag: '-q',
    resumeFlag: '--resume',
    sessionRegex: /session_id:\s*([^\s]+)/,
    inputMode: 'arg',
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    protocol: 'stream-json',
    bins: ['grok', 'agent'],
    match: /(?:^|[\\/])grok(?:\.exe|\.cmd)?$|\.grok[\\/]bin[\\/]agent(?:\.exe)?$/i,
    args: ['--output-format', 'streaming-messages-json', '--include-partial-messages'],
    resumeFlag: '--resume',
    systemFlag: '--system-prompt-override',
    inputMode: 'prompt-file',
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    protocol: 'acp',
    bins: ['cursor-agent'],
    args: ['acp'],
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    protocol: 'acp',
    bins: ['opencode'],
    args: ['acp'],
    capabilities: { streaming: true, resume: true, images: true, worktree: true },
  },
];

export function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 4000, ...opts }, (err, stdout = '', stderr = '') => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function unwrapWinCmd(cmdFile) {
  try {
    const txt = fs.readFileSync(cmdFile, 'utf8');
    const dir = path.dirname(cmdFile);
    const m = /"%dp0%[\\/]([^"]+\.(?:m?js|cjs))"/i.exec(txt);
    if (m) {
      const target = path.join(dir, m[1].replace(/[\\/]+/g, path.sep));
      if (fs.existsSync(target)) return { exec: process.execPath, prefixArgs: [target], resolved: cmdFile };
    }
    const verRoot = path.join(dir, 'versions');
    if (fs.existsSync(verRoot)) {
      const dirs = fs.readdirSync(verRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(verRoot, d.name, 'index.js')))
        .map((d) => d.name)
        .sort()
        .reverse();
      if (dirs.length) {
        const vDir = path.join(verRoot, dirs[0]);
        const nodeBin = fs.existsSync(path.join(vDir, 'node.exe')) ? path.join(vDir, 'node.exe') : process.execPath;
        return { exec: nodeBin, prefixArgs: [path.join(vDir, 'index.js')], resolved: cmdFile };
      }
    }
  } catch {}
  return { exec: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', cmdFile], resolved: cmdFile };
}

function findBinariesInPath(bin) {
  if (!bin) return [];
  if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) {
    return fs.existsSync(bin) ? [bin] : [];
  }
  const pathEnv = process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts = IS_WIN
    ? (path.extname(bin) ? [''] : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean))
    : [''];
  const out = [];
  for (const d of dirs) {
    for (const ext of exts) {
      const full = path.join(d, bin + ext);
      try {
        if (fs.statSync(full).isFile()) out.push(full);
      } catch {}
    }
  }
  return out;
}

const resolveCache = new Map();
const resolveInflight = new Map();

export function clearResolveCache() {
  resolveCache.clear();
}

function pickCandidate(candidates) {
  if (!candidates.length) return null;
  const picked = IS_WIN
    ? (candidates.find((c) => /\.exe$/i.test(c)) || candidates.find((c) => /\.(?:cmd|bat)$/i.test(c)) || candidates[0])
    : candidates[0];
  return IS_WIN && /\.(?:cmd|bat)$/i.test(picked)
    ? unwrapWinCmd(picked)
    : { exec: picked, prefixArgs: [], resolved: picked };
}

function resolveKey(preset) {
  return `${preset.id}|${(preset.cmd ? [preset.cmd] : (preset.bins || [])).join(',')}`;
}

async function refreshExecutableAsync(preset, key) {
  if (resolveInflight.has(key)) return resolveInflight.get(key);
  const p = (async () => {
    const list = preset.cmd ? [preset.cmd] : (preset.bins || []);
    const candidates = [];
    for (const bin of list) {
      let found = findBinariesInPath(bin);
      if (!found.length && !path.isAbsolute(bin) && !bin.includes('/') && !bin.includes('\\')) {
        const r = await execFileAsync(IS_WIN ? 'where.exe' : 'which', [bin], { timeout: 2500 });
        if (r.ok && r.stdout) found = r.stdout.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      }
      for (const f of found) {
        if (preset.match && !preset.match.test(f)) continue;
        candidates.push(f);
      }
    }
    const val = pickCandidate(candidates);
    resolveCache.set(key, { at: Date.now(), val });
    return val;
  })().finally(() => resolveInflight.delete(key));
  resolveInflight.set(key, p);
  return p;
}

// 零子进程阻塞探测：纯 fs 扫 PATH 秒回，过期后后台异步复核 where/which
export function resolveExecutable(preset) {
  const key = resolveKey(preset);
  const cached = resolveCache.get(key);
  if (cached) {
    if (Date.now() - cached.at >= RESOLVE_TTL_MS) refreshExecutableAsync(preset, key).catch(() => {});
    return cached.val;
  }
  const list = preset.cmd ? [preset.cmd] : (preset.bins || []);
  const candidates = [];
  for (const bin of list) {
    for (const f of findBinariesInPath(bin)) {
      if (preset.match && !preset.match.test(f)) continue;
      candidates.push(f);
    }
  }
  const val = pickCandidate(candidates);
  resolveCache.set(key, { at: Date.now(), val });
  if (!val) refreshExecutableAsync(preset, key).catch(() => {});
  return val;
}

export function killTree(pid) {
  if (!pid || pid <= 0) return;
  if (IS_WIN) {
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 4000 }, () => {});
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
}

export async function resolveWorkDir(baseCwd, sessionKey, wantWorktree) {
  const cwd = baseCwd && fs.existsSync(baseCwd) ? baseCwd : os.homedir();
  if (!wantWorktree || !sessionKey) return cwd;
  const gitCheck = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 3000 });
  if (!gitCheck.ok || !gitCheck.stdout.trim()) return cwd;
  const repoRoot = gitCheck.stdout.trim();
  const hash = crypto.createHash('sha1').update(`${repoRoot}|${sessionKey}`).digest('hex').slice(0, 12);
  const wtDir = path.join(WORKTREES_DIR, hash);
  if (fs.existsSync(wtDir)) return wtDir;
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  const add = await execFileAsync('git', ['worktree', 'add', '--detach', wtDir, 'HEAD'], { cwd: repoRoot, timeout: 10000 });
  if (!add.ok) console.warn(`[colony-cli] git worktree add failed (${repoRoot}): ${add.stderr.trim().slice(0, 200)}`);
  return add.ok && fs.existsSync(wtDir) ? wtDir : cwd;
}

export function prepareTurnInput(messages, protocol) {
  const arr = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  let lastUser = null;
  for (const m of arr) {
    if (!m) continue;
    if (m.role === 'system') {
      const t = typeof m.content === 'string' ? m.content : '';
      if (t.trim()) systemParts.push(t.trim());
    } else if (m.role === 'user') {
      lastUser = m;
    }
  }
  const textParts = [];
  const images = [];
  const audios = [];
  const otherFiles = [];
  const tmpFiles = [];
  const content = lastUser?.content;

  const saveTmp = (base64, ext, hintName) => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const base = hintName
      ? path.basename(String(hintName)).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_').slice(0, 48)
      : `att.${safeExt}`;
    const finalName = path.extname(base) ? base : `${base}.${safeExt}`;
    const filePath = path.join(TMP_DIR, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${finalName}`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    tmpFiles.push(filePath);
    return filePath;
  };

  if (typeof content === 'string') {
    textParts.push(content);
  } else if (Array.isArray(content)) {
    for (const p of content) {
      if (!p) continue;
      if (typeof p === 'string') textParts.push(p);
      else if (p.type === 'text' && p.text) textParts.push(p.text);
      else if (p.type === 'image_url' && p.image_url?.url) {
        const parsed = parseDataUrl(p.image_url.url);
        if (parsed) {
          const ext = (parsed.mimeType.split('/')[1] || 'png').replace(/jpeg/i, 'jpg');
          images.push({ mimeType: parsed.mimeType, data: parsed.data, filePath: saveTmp(parsed.data, ext, `image.${ext}`) });
        }
      } else if (p.type === 'input_audio' && p.input_audio?.data) {
        const fmt = String(p.input_audio.format || 'wav').toLowerCase();
        const mimeType = fmt === 'mp3' ? 'audio/mpeg' : (fmt === 'ogg' ? 'audio/ogg' : `audio/${fmt}`);
        audios.push({ mimeType, data: p.input_audio.data, filePath: saveTmp(p.input_audio.data, fmt, `audio.${fmt}`) });
      } else if (p.type === 'file' && p.file?.file_data) {
        const parsed = parseDataUrl(p.file.file_data);
        if (parsed) {
          const ext = path.extname(p.file.filename || '').slice(1) || (parsed.mimeType.split('/')[1] || 'bin');
          const filePath = saveTmp(parsed.data, ext, p.file.filename || `file.${ext}`);
          if (/^audio\//i.test(parsed.mimeType)) audios.push({ mimeType: parsed.mimeType, data: parsed.data, filePath });
          else otherFiles.push({ mimeType: parsed.mimeType, filePath, filename: p.file.filename || path.basename(filePath) });
        }
      }
    }
  }

  let prompt = textParts.join('\n').trim();
  const attachedPaths = [];
  if (images.length && protocol !== 'acp' && protocol !== 'codex') {
    for (const i of images) attachedPaths.push(`image: ${i.filePath}`);
  }
  for (const a of audios) attachedPaths.push(`audio: ${a.filePath}`);
  for (const f of otherFiles) attachedPaths.push(`file(${f.mimeType}): ${f.filePath}`);
  if (attachedPaths.length) {
    prompt += '\n\n[Attached local file(s) — you can read/inspect them directly:\n' + attachedPaths.map((x) => '- ' + x).join('\n') + '\n]';
  }
  return {
    system: systemParts.join('\n\n').trim(),
    prompt: prompt || 'Hello',
    images,
    audios,
    otherFiles,
    cleanup() {
      setTimeout(() => {
        for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
      }, 10 * 60 * 1000).unref?.();
    },
  };
}

const MEDIA_MIMES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus', '.wma': 'audio/x-ms-wma', '.amr': 'audio/amr',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.tar': 'application/x-tar', '.gz': 'application/gzip',
};

export function resolveCliMediaFile({ filePath, agentId, session }, loadSessions) {
  let raw = String(filePath || '').trim().replace(/^file:\/\/\/?/i, '');
  try { raw = decodeURIComponent(raw); } catch {}
  if (!raw) throw new HttpError(400, '缺少 path', 'invalid_request_error');
  if (raw.startsWith('~/') || raw.startsWith('~\\')) raw = path.join(os.homedir(), raw.slice(2));
  const ext = path.extname(raw.split('?')[0]).toLowerCase();
  if (!(ext in MEDIA_MIMES)) throw new HttpError(403, `不支持的媒体扩展名: ${ext || '无'}`, 'invalid_request_error');

  const candidates = [];
  if (path.isAbsolute(raw)) {
    candidates.push(raw);
  } else {
    const cleanRel = raw.replace(/^[/\\]+/, '');
    if (cleanRel.split(/[\\/]/).includes('..')) throw new HttpError(403, '非法相对路径', 'invalid_request_error');
    const sessions = typeof loadSessions === 'function' ? loadSessions() : {};
    const aid = String(agentId || '').replace(/^cli:/, '');
    const entry = (aid && session) ? sessions[`${aid}|${session}`] : null;
    const baseCwd = entry?.cwd || os.homedir();
    candidates.push(path.join(baseCwd, cleanRel));
    if (entry?.nativeSessionId) {
      candidates.push(path.join(os.homedir(), '.grok', 'sessions', encodeURIComponent(baseCwd), entry.nativeSessionId, cleanRel));
    }
    if (aid === 'grok') {
      try {
        const dir = path.join(os.homedir(), '.grok', 'sessions', encodeURIComponent(baseCwd));
        if (fs.existsSync(dir)) {
          const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
            .map((d) => ({ p: path.join(dir, d.name, cleanRel), mt: fs.statSync(path.join(dir, d.name)).mtimeMs }))
            .sort((a, b) => b.mt - a.mt);
          for (const s of subs.slice(0, 6)) candidates.push(s.p);
        }
      } catch {}
    }
    if (baseCwd !== os.homedir()) candidates.push(path.join(os.homedir(), cleanRel));
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const st = fs.statSync(c);
        if (st.isFile() && st.size <= 32 * 1024 * 1024) {
          return { fullPath: c, mime: MEDIA_MIMES[ext], size: st.size };
        }
      }
    } catch {}
  }
  throw new HttpError(404, `未找到文件: ${raw}`, 'not_found_error');
}

export function sweepTmpDir() {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
    const cutoff = Date.now() - TMP_TTL_MS;
    for (const name of fs.readdirSync(TMP_DIR)) {
      const full = path.join(TMP_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}

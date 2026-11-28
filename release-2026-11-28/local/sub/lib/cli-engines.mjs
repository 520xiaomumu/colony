import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HttpError } from './openai.mjs';
import { IS_WIN, TMP_DIR, killTree } from './cli-proc.mjs';

// ── 引擎 1：通用 ACP over stdio (JSON-RPC 2.0, 手写 \n 切帧防 U+2028/U+2029 断帧)
export class AcpProcess {
  constructor(agent, resolved, cwd) {
    this.agent = agent;
    this.resolved = resolved;
    this.cwd = cwd;
    this.proc = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.capabilities = {};
    this.onUpdate = null;
    this.stderrTail = '';
    this.lastUsed = Date.now();
    this.dead = false;
  }

  start() {
    if (this.proc && !this.dead) return;
    this.dead = false;
    this.stderrTail = '';
    const args = [...this.resolved.prefixArgs, ...(this.agent.args || [])];
    const env = { ...process.env, ...(this.agent.env || {}) };
    this.proc = spawn(this.resolved.exec, args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !IS_WIN,
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onChunk(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    const onDown = (err) => {
      this.dead = true;
      const msg = err?.message || `ACP 进程已退出${this.stderrTail ? ': ' + this.stderrTail.trim().slice(-300) : ''}`;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(msg)); }
      this.pending.clear();
    };
    this.proc.on('error', onDown);
    this.proc.on('close', () => onDown());
  }

  _onChunk(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '').trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line || line[0] !== '{') continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this._handleMessage(msg);
    }
  }

  _sendRaw(obj) {
    if (!this.proc || this.dead || !this.proc.stdin.writable) {
      throw new Error('ACP 进程未就绪');
    }
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _handleMessage(msg) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update' && msg.params) {
      if (this.onUpdate) this.onUpdate(msg.params);
      return;
    }
    if (msg.id !== undefined && msg.method === 'session/request_permission') {
      const opts = Array.isArray(msg.params?.options) ? msg.params.options : [];
      const pick = opts.find((o) => o.kind === 'allow_once' || /allow/i.test(o.kind || o.optionId || '')) || opts[0];
      try {
        this._sendRaw({
          jsonrpc: '2.0',
          id: msg.id,
          result: pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } },
        });
      } catch {}
      return;
    }
    if (msg.id !== undefined && msg.method) {
      try {
        this._sendRaw({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not supported: ${msg.method}` } });
      } catch {}
    }
  }

  request(method, params, timeoutMs = 180000) {
    this.lastUsed = Date.now();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._sendRaw({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params) {
    try { this._sendRaw({ jsonrpc: '2.0', method, params }); } catch {}
  }

  async ensureSession(savedNativeId) {
    this.start();
    if (!this.capabilities._inited) {
      const init = await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'colony', version: '1.0.0' },
      }, 30000);
      const authMethods = Array.isArray(init?.authMethods) ? init.authMethods : [];
      if (authMethods.length && authMethods[0]?.id) {
        try {
          await this.request('authenticate', { methodId: authMethods[0].id }, 20000);
        } catch (err) {
          console.warn(`[colony-cli] ACP authenticate(${this.agent.id}) warning: ${err.message}`);
        }
      }
      this.capabilities = { ...(init?.agentCapabilities || {}), _inited: true };
    }
    if (!this.sessionId) {
      if (savedNativeId && this.capabilities.loadSession) {
        try {
          await this.request('session/load', { sessionId: savedNativeId, cwd: this.cwd, mcpServers: [] }, 30000);
          this.sessionId = savedNativeId;
          return { sessionId: this.sessionId, resumed: true };
        } catch (err) {
          console.warn(`[colony-cli] ACP session/load(${this.agent.id}, ${savedNativeId}) fallback to new: ${err.message}`);
        }
      }
      const created = await this.request('session/new', { cwd: this.cwd, mcpServers: [] }, 30000);
      this.sessionId = created?.sessionId || created?.id;
      if (!this.sessionId) throw new Error('ACP session/new 未返回 sessionId');
      return { sessionId: this.sessionId, resumed: false };
    }
    return { sessionId: this.sessionId, resumed: true };
  }

  dispose() {
    this.dead = true;
    const pid = this.proc?.pid;
    this.proc = null;
    if (pid) killTree(pid);
  }
}

// ── 引擎 2：通用 Headless 流式 CLI（stream-json / codex / plain）
export async function runHeadlessTurn({ agent, resolved, cwd, input, nativeSessionId, signal, onText, onThinking, onTool }) {
  const proto = agent.protocol;
  const args = [...resolved.prefixArgs];
  let stdinPayload = null;
  let promptFile = null;

  const fullPrompt = (!nativeSessionId && input.system && !agent.systemFlag)
    ? `${input.system}\n\n${input.prompt}`
    : input.prompt;

  if (proto === 'codex') {
    args.push('exec');
    if (nativeSessionId) args.push('resume', nativeSessionId, '--json', '--skip-git-repo-check');
    else args.push('--json', '--skip-git-repo-check');
    args.push(...(agent.args || []));
    for (const img of input.images) args.push('-i', img.filePath);
    args.push('-');
    stdinPayload = fullPrompt;
  } else {
    args.push(...(agent.args || []));
    if (nativeSessionId && agent.resumeFlag) args.push(agent.resumeFlag, nativeSessionId);
    if (!nativeSessionId && input.system && agent.systemFlag) args.push(agent.systemFlag, input.system);
    if (agent.inputMode === 'prompt-file') {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      promptFile = path.join(TMP_DIR, `prompt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
      fs.writeFileSync(promptFile, fullPrompt, 'utf8');
      args.push('--prompt-file', promptFile);
    } else if (agent.inputMode === 'arg') {
      if (agent.promptFlag) args.push(agent.promptFlag, fullPrompt);
      else args.push(fullPrompt);
    } else {
      stdinPayload = fullPrompt;
    }
  }

  try {
    return await new Promise((resolve, reject) => {
      const env = { ...process.env, ...(agent.env || {}) };
      const proc = spawn(resolved.exec, args, {
        cwd,
        env,
        stdio: [stdinPayload !== null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !IS_WIN,
      });

      let buf = '';
      let stderr = '';
      let newSessionId = nativeSessionId || null;
      let accText = '';
      let accThink = '';
      let streamedText = false;
      let usage = null;
      let errorMsg = '';

      const onAbort = () => {
        if (proc.pid) killTree(proc.pid);
        reject(new HttpError(499, '客户端已取消', 'api_error'));
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const emitText = (t) => {
        if (!t) return;
        accText += t;
        streamedText = true;
        onText(t);
      };
      const emitThink = (t) => {
        if (!t) return;
        accThink += t;
        onThinking(t);
      };

      const handleLine = (line) => {
        if (proto === 'plain') { emitText(line + '\n'); return; }
        if (!line || line[0] !== '{') return;
        let ev;
        try { ev = JSON.parse(line); } catch { return; }

        if (proto === 'codex') {
          if (ev.type === 'thread.started' && ev.thread_id) newSessionId = ev.thread_id;
          else if ((ev.type === 'item.started' || ev.type === 'item.completed') && ev.item) {
            const it = ev.item, done = ev.type === 'item.completed';
            if (done && it.type === 'agent_message' && it.text) emitText(it.text);
            else if (done && it.type === 'reasoning' && it.text) emitThink(it.text);
            else if (onTool && (it.type === 'command_execution' || it.type === 'file_change' || it.type === 'mcp_tool_call' || it.type === 'web_search')) {
              const emoji = it.type === 'command_execution' ? '⚡' : it.type === 'file_change' ? '📝' : it.type === 'web_search' ? '🔍' : '🔧';
              const tool = it.type === 'command_execution' ? 'exec' : it.type === 'file_change' ? 'edit' : (it.tool || it.type);
              const label = String(it.command || it.changes?.[0]?.path || it.query || it.server || '').replace(/\s+/g, ' ').slice(0, 80);
              const status = !done ? 'running' : ((it.exit_code && it.exit_code !== 0) || it.status === 'failed' ? 'error' : 'completed');
              onTool({ toolCallId: it.id || tool, tool, label, emoji, status });
            }
          } else if (ev.type === 'turn.completed' && ev.usage) {
            usage = ev.usage;
          } else if (ev.type === 'error' || ev.type === 'turn.failed') {
            errorMsg = ev.message || ev.error?.message || JSON.stringify(ev);
          }
          return;
        }

        if (ev.session_id) newSessionId = ev.session_id;
        else if (ev.sessionId) newSessionId = ev.sessionId;

        if (ev.type === 'stream_event' && ev.event) {
          const d = ev.event.delta;
          if (ev.event.type === 'content_block_delta' && d) {
            if (d.type === 'text_delta' && d.text) emitText(d.text);
            else if (d.type === 'thinking_delta' && d.thinking) emitThink(d.thinking);
          }
        } else if (ev.type === 'assistant' && ev.message?.content) {
          if (!streamedText) {
            for (const b of (Array.isArray(ev.message.content) ? ev.message.content : [])) {
              if (b?.type === 'text' && b.text) emitText(b.text);
              else if (b?.type === 'thinking' && b.thinking) emitThink(b.thinking);
            }
          }
        } else if (ev.type === 'result') {
          if (ev.usage) usage = ev.usage;
          if (ev.is_error) {
            errorMsg = (Array.isArray(ev.errors) && ev.errors.join('\n')) || ev.result || 'CLI 返回错误';
          } else if (!accText && typeof ev.result === 'string' && ev.result) {
            emitText(ev.result);
          }
        }
      };

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        if (proto === 'plain') { emitText(chunk); return; }
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '').trim();
          buf = buf.slice(idx + 1);
          handleLine(line);
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-3000);
        if (agent.sessionRegex) {
          const m = agent.sessionRegex.exec(chunk);
          if (m && m[1]) newSessionId = m[1];
        }
      });
      proc.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new HttpError(500, `启动 ${agent.name} 失败: ${err.message}`, 'api_error'));
      });
      proc.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (buf.trim()) handleLine(buf.trim());
        if (errorMsg) {
          reject(new HttpError(502, `${agent.name}: ${errorMsg}`, 'api_error'));
          return;
        }
        if (code !== 0 && !accText) {
          reject(new HttpError(502, `${agent.name} 退出码 ${code}: ${(stderr || '无输出').trim().slice(-500)}`, 'api_error'));
          return;
        }
        resolve({ text: accText, reasoning: accThink, sessionId: newSessionId, usage });
      });

      if (stdinPayload !== null) {
        proc.stdin.end(stdinPayload, 'utf8');
      }
    });
  } finally {
    if (promptFile) { try { fs.unlinkSync(promptFile); } catch {} }
  }
}

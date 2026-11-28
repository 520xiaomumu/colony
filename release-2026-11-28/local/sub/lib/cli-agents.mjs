import { readStateJson, writeStateJson, withLock } from './store.mjs';
import {
  HttpError,
  buildChatCompletion,
  createChatSse,
  genId,
  sendJson,
} from './openai.mjs';
import {
  BUILTIN_PRESETS,
  clearResolveCache,
  killTree,
  prepareTurnInput,
  resolveCliMediaFile,
  resolveExecutable,
  resolveWorkDir,
  sweepTmpDir,
} from './cli-proc.mjs';
import { AcpProcess, runHeadlessTurn } from './cli-engines.mjs';

export { killTree };

const CUSTOM_KEY = 'cli-agents-custom';
const SESSIONS_KEY = 'cli-sessions';
const ACP_IDLE_MS = 15 * 60 * 1000;

function loadCustomAgents() {
  const raw = readStateJson(CUSTOM_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function saveCustomAgents(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a === 'object' && a.id)
    .map((a) => ({
      id: String(a.id).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      name: String(a.name || a.id).trim(),
      protocol: ['acp', 'stream-json', 'codex', 'plain'].includes(a.protocol) ? a.protocol : 'plain',
      cmd: a.cmd ? String(a.cmd).trim() : '',
      args: Array.isArray(a.args) ? a.args.map(String) : [],
      resumeFlag: a.resumeFlag ? String(a.resumeFlag) : '',
      systemFlag: a.systemFlag ? String(a.systemFlag) : '',
      inputMode: a.inputMode || 'stdin',
      cwd: a.cwd ? String(a.cwd).trim() : '',
      env: a.env && typeof a.env === 'object' ? a.env : undefined,
      enabled: a.enabled !== false,
    }));
  writeStateJson(CUSTOM_KEY, clean);
  clearResolveCache();
  return clean;
}

function loadSessionMap() {
  const raw = readStateJson(SESSIONS_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function saveSessionEntry(mapKey, entry) {
  const map = loadSessionMap();
  if (entry === null) delete map[mapKey];
  else map[mapKey] = { ...entry, updatedAt: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > 400) {
    keys.sort((a, b) => (map[a]?.updatedAt || 0) - (map[b]?.updatedAt || 0))
      .slice(0, keys.length - 300)
      .forEach((k) => delete map[k]);
  }
  writeStateJson(SESSIONS_KEY, map);
}

export function createCliAgentManager() {
  const acpPool = new Map();
  sweepTmpDir();

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, proc] of acpPool) {
      if (proc.dead || now - proc.lastUsed > ACP_IDLE_MS) {
        proc.dispose();
        acpPool.delete(k);
      }
    }
    sweepTmpDir();
  }, 60000);
  gcTimer.unref?.();

  const dropPoolByPrefix = (prefix) => {
    for (const [k, p] of acpPool) {
      if (k.startsWith(prefix)) { p.dispose(); acpPool.delete(k); }
    }
  };

  function listAgents({ includeUnavailable = false } = {}) {
    const customs = loadCustomAgents();
    const customMap = new Map(customs.map((c) => [c.id, c]));
    const merged = [];

    for (const b of BUILTIN_PRESETS) {
      const ov = customMap.get(b.id);
      customMap.delete(b.id);
      const spec = ov ? { ...b, ...ov, bins: ov.cmd ? [ov.cmd] : b.bins, args: ov.args?.length ? ov.args : b.args } : b;
      const resolved = resolveExecutable(spec);
      const item = {
        id: spec.id,
        name: spec.name,
        protocol: spec.protocol,
        builtin: true,
        available: !!resolved,
        enabled: spec.enabled !== false,
        bin: resolved?.resolved || null,
        cwd: spec.cwd || '',
        capabilities: spec.capabilities || { streaming: true, resume: true, images: true, worktree: true },
        _spec: spec,
        _resolved: resolved,
      };
      if (includeUnavailable || (item.available && item.enabled)) merged.push(item);
    }

    for (const c of customMap.values()) {
      const resolved = c.cmd ? resolveExecutable(c) : null;
      const item = {
        id: c.id,
        name: c.name,
        protocol: c.protocol,
        builtin: false,
        available: !!resolved,
        enabled: c.enabled !== false,
        bin: resolved?.resolved || c.cmd || null,
        cwd: c.cwd || '',
        capabilities: { streaming: true, resume: c.protocol === 'acp' || !!c.resumeFlag, images: c.protocol === 'acp', worktree: true },
        _spec: c,
        _resolved: resolved,
      };
      if (includeUnavailable || (item.available && item.enabled)) merged.push(item);
    }
    return merged;
  }

  const publicSummary = ({ _spec, _resolved, ...rest }) => rest;

  function listModelsOpenAi() {
    const created = Math.floor(Date.now() / 1000);
    return {
      object: 'list',
      data: listAgents().map((a) => ({
        id: a.id,
        object: 'model',
        created,
        owned_by: 'colony-cli',
        display_name: a.name,
        protocol: a.protocol,
        cwd: a.cwd || '',
        memory: true,
        capabilities: a.capabilities,
      })),
    };
  }

  function upsertAgent(patch) {
    if (!patch || !patch.id) throw new HttpError(400, '缺少 id', 'invalid_request_error');
    const id = String(patch.id).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    const builtin = BUILTIN_PRESETS.find((b) => b.id === id);
    const list = loadCustomAgents();
    const idx = list.findIndex((x) => x.id === id);
    const base = idx >= 0 ? list[idx] : (builtin ? { id: builtin.id, name: builtin.name, protocol: builtin.protocol } : { id });
    const next = { ...base, ...patch, id };
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    saveCustomAgents(list);
    dropPoolByPrefix(id + '|');
    return listAgents({ includeUnavailable: true }).map(publicSummary);
  }

  function removeAgent(id) {
    saveCustomAgents(loadCustomAgents().filter((x) => x.id !== id));
    dropPoolByPrefix(id + '|');
    return listAgents({ includeUnavailable: true }).map(publicSummary);
  }

  function resetSession(agentId, sessionKey) {
    const mapKey = `${agentId}|${sessionKey}`;
    saveSessionEntry(mapKey, null);
    dropPoolByPrefix(mapKey + '|');
  }

  async function runAcpTurn({ agent, resolved, cwd, input, mapKey, savedNativeId, signal, onText, onThinking, onTool }) {
    const poolKey = `${mapKey}|${cwd}`;
    let client = acpPool.get(poolKey);
    if (!client || client.dead) {
      client = new AcpProcess(agent, resolved, cwd);
      acpPool.set(poolKey, client);
    }

    const { sessionId, resumed } = await client.ensureSession(savedNativeId);
    saveSessionEntry(mapKey, { nativeSessionId: sessionId, cwd });

    let accText = '';
    let accThink = '';
    const promptBlocks = [{ type: 'text', text: (!resumed && input.system) ? `${input.system}\n\n${input.prompt}` : input.prompt }];
    for (const img of input.images) promptBlocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    if (client.capabilities?.promptCapabilities?.audio) {
      for (const aud of input.audios || []) promptBlocks.push({ type: 'audio', data: aud.data, mimeType: aud.mimeType });
    }

    client.onUpdate = (params) => {
      const u = params?.update;
      if (!u) return;
      if (onTool && (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update')) {
        const st = u.status === 'completed' ? 'completed' : u.status === 'failed' ? 'error' : 'running';
        const emoji = u.kind === 'execute' ? '⚡' : (u.kind === 'edit' || u.kind === 'delete') ? '📝' : (u.kind === 'read' || u.kind === 'search') ? '🔍' : '🔧';
        const label = String(u.title || '').replace(/\s+/g, ' ').slice(0, 80);
        onTool({ toolCallId: u.toolCallId || ((u.kind || 'tool') + ':' + label), tool: u.kind || 'tool', label, emoji, status: st });
        return;
      }
      const chunkText = typeof u.content === 'string'
        ? u.content
        : (u.content?.type === 'text' ? u.content.text : (Array.isArray(u.content) ? u.content.map((c) => c?.text || '').join('') : ''));
      if (!chunkText) return;
      if (u.sessionUpdate === 'agent_message_chunk') { accText += chunkText; onText(chunkText); }
      else if (u.sessionUpdate === 'agent_thought_chunk') { accThink += chunkText; onThinking(chunkText); }
    };

    const onAbort = () => {
      client.notify('session/cancel', { sessionId });
      setTimeout(() => {
        if (acpPool.get(poolKey) === client) { client.dispose(); acpPool.delete(poolKey); }
      }, 2000).unref?.();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      await client.request('session/prompt', { sessionId, prompt: promptBlocks }, 300000);
      return { text: accText, reasoning: accThink, sessionId, usage: null };
    } catch (err) {
      if (client.dead) acpPool.delete(poolKey);
      throw err;
    } finally {
      client.onUpdate = null;
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function handleChat(body, req, res) {
    const modelId = String(body.model || '').trim().replace(/^cli:/, '');
    const agent = listAgents().find((a) => a.id === modelId);
    if (!agent || !agent._resolved) {
      throw new HttpError(404, `未找到可用的本机 CLI Agent: ${modelId}`, 'invalid_request_error');
    }

    const sessionKey = String(
      req.headers['x-colony-session-id']
      || req.headers['x-hermes-session-id']
      || req.headers['x-openclaw-session-key']
      || body.session
      || ''
    ).trim();
    const wantWorktree = body.worktree === true || req.headers['x-colony-worktree'] === '1';
    const requestedCwd = String(body.cwd || req.headers['x-colony-cwd'] || agent.cwd || '').trim();
    const isStream = body.stream === true;
    const mapKey = sessionKey ? `${agent.id}|${sessionKey}` : `${agent.id}|ephemeral-${genId('s')}`;

    const ac = new AbortController();
    req.on('close', () => { if (!res.writableEnded) ac.abort(); });

    const runTurn = async () => {
      const input = prepareTurnInput(body.messages, agent.protocol);
      const saved = sessionKey ? loadSessionMap()[mapKey] : null;
      const cwd = await resolveWorkDir(requestedCwd || saved?.cwd, sessionKey, wantWorktree);
      const sse = isStream ? createChatSse(res, { model: agent.id }) : null;
      if (sse) sse.role();

      const hooks = {
        signal: ac.signal,
        onText: (d) => sse?.text(d),
        onThinking: (d) => sse?.thinking(d),
        onTool: (t) => sse?.event('cli.tool.progress', t),
      };

      try {
        let out;
        if (agent.protocol === 'acp') {
          out = await runAcpTurn({
            agent: agent._spec,
            resolved: agent._resolved,
            cwd,
            input,
            mapKey,
            savedNativeId: saved?.nativeSessionId || null,
            ...hooks,
          });
        } else {
          const execHeadless = (nativeSessionId) => runHeadlessTurn({
            agent: agent._spec,
            resolved: agent._resolved,
            cwd,
            input,
            nativeSessionId,
            ...hooks,
          });
          try {
            out = await execHeadless(saved?.nativeSessionId || null);
          } catch (err) {
            if (saved?.nativeSessionId && !ac.signal.aborted && (!sse || !sse.started)) {
              console.warn(`[colony-cli] resume failed (${agent.id}, ${saved.nativeSessionId}), retrying fresh: ${err.message}`);
              saveSessionEntry(mapKey, null);
              out = await execHeadless(null);
            } else {
              throw err;
            }
          }
          if (sessionKey && out.sessionId) {
            saveSessionEntry(mapKey, { nativeSessionId: out.sessionId, cwd });
          }
        }

        if (sse) {
          sse.done('stop', out.usage);
          sse.cleanup();
        } else {
          sendJson(res, buildChatCompletion({
            model: agent.id,
            text: out.text,
            reasoning: out.reasoning,
            usage: out.usage,
          }));
        }
      } catch (err) {
        if (sse) { sse.fail(err); sse.cleanup(); }
        else throw err;
      } finally {
        input.cleanup();
      }
    };

    if (sessionKey) await withLock(`cli:${mapKey}`, runTurn);
    else await runTurn();
  }

  function disposeAll() {
    clearInterval(gcTimer);
    for (const p of acpPool.values()) p.dispose();
    acpPool.clear();
  }

  return {
    listAgents: (opts) => listAgents(opts).map(publicSummary),
    listModelsOpenAi,
    upsertAgent,
    removeAgent,
    resetSession,
    handleChat,
    resolveMediaFile: (args) => resolveCliMediaFile(args, loadSessionMap),
    disposeAll,
  };
}

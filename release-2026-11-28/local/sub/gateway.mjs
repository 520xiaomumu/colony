import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DRIVERS, DRIVER_MAP } from './drivers/index.mjs';
import {
  estimateTokens,
  forwardToProvider,
  handleCorsProxy,
  makeReplayReq,
  runAnthropicViaOpenAi,
} from './lib/anthropic-bridge.mjs';
import { createCliAgentManager } from './lib/cli-agents.mjs';
import { ROOT_DIR, readStateJson, writeStateJson } from './lib/store.mjs';
import {
  HttpError,
  corsHeaders,
  formatModelList,
  genId,
  readJsonBody,
  sendJson,
  sendOpenAiError,
} from './lib/openai.mjs';

export const GATEWAY_VERSION = '0.2.0';
const DEFAULT_PORT = 4135;
const CONFIG_KEY = 'gateway-config';
const PROVIDERS_KEY = 'gateway-providers';

function genGatewayKey() {
  return `sk-colony-${crypto.randomBytes(12).toString('hex')}`;
}

function isLoopback(req) {
  const addr = String(req.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function getLanIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs || {})) {
    if (/vEthernet|Docker|WSL|Loopback|VMware|VirtualBox|Tailscale|Clash|Meta|TUN|utun|Mihomo/i.test(name)) continue;
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal && !/^(198\.18\.|169\.254\.)/.test(item.address)) out.push(item.address);
    }
  }
  return out;
}

function slugify(name) {
  const s = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'provider';
}

function loadConfig(portOverride) {
  const saved = readStateJson(CONFIG_KEY, {}) || {};
  const cfg = {
    expose: saved.expose === true,
    apiKey: typeof saved.apiKey === 'string' && saved.apiKey.trim() ? saved.apiKey.trim() : genGatewayKey(),
    port: Number(portOverride || saved.port || DEFAULT_PORT) || DEFAULT_PORT,
  };
  if (!saved.apiKey) writeStateJson(CONFIG_KEY, cfg);
  return cfg;
}

function saveConfig(cfg) {
  writeStateJson(CONFIG_KEY, {
    expose: !!cfg.expose,
    apiKey: String(cfg.apiKey || '').trim(),
    port: Number(cfg.port) || DEFAULT_PORT,
  });
}

function loadSyncedProviders() {
  const saved = readStateJson(PROVIDERS_KEY, []);
  return Array.isArray(saved) ? saved : [];
}

function saveSyncedProviders(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === 'object' && p.endpoint && !/^https?:\/\/(127\.0\.0\.1|localhost):4135\b/i.test(p.endpoint))
    .map((p) => ({
      id: String(p.id || slugify(p.name)),
      name: String(p.name || p.id || 'provider'),
      slug: slugify(p.slug || p.name || p.id),
      endpoint: String(p.endpoint).replace(/\/+$/, ''),
      apiKey: String(p.apiKey || ''),
      protocol: String(p.protocol || 'openai-compatible'),
      models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string' && m.trim()) : [],
      defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel : (typeof p.model === 'string' ? p.model : ''),
      exposed: p.exposed !== false,
    }));
  writeStateJson(PROVIDERS_KEY, clean);
  return clean;
}

function extractClientKey(req, url) {
  const auth = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  if (typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].trim()) {
    return req.headers['x-api-key'].trim();
  }
  const qk = url.searchParams.get('key');
  return qk ? qk.trim() : '';
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkApiAuth(req, url, cfg, isAnthropic = false) {
  if (!cfg.expose) return; // 本机模式默认免密（留空或任意占位 Key 均放行）
  const got = extractClientKey(req, url);
  if (timingSafeEqualStr(got, cfg.apiKey)) return;
  if (isAnthropic) {
    throw new HttpError(401, 'Invalid API key for Colony Gateway', 'authentication_error');
  }
  throw new HttpError(401, '外放网关鉴权失败：请提供正确的 API Key', 'authentication_error');
}

function requireLoopback(req, label) {
  if (!isLoopback(req)) {
    throw new HttpError(403, `${label} 仅允许本机访问`, 'permission_error');
  }
}

// ── 启动统一数据面网关（可被 colony-local.cjs 同进程挂载，也可由 server.mjs 独立启动）
export async function startGateway(opts = {}) {
  const startedAt = Date.now();
  const cfg = loadConfig(opts.port);
  const cliAgents = createCliAgentManager();
  let syncedProviders = loadSyncedProviders();
  let currentHost = cfg.expose ? '0.0.0.0' : '127.0.0.1';
  const taskRoutes = new Map(); // taskId -> route (记住异步视频/音乐任务归属渠道，供 GET 轮询定位)
  const rememberTask = (id, route) => {
    if (!id) return;
    if (taskRoutes.size > 500) taskRoutes.delete(taskRoutes.keys().next().value);
    taskRoutes.set(String(id), route);
  };
  let server = null;

  // ── 网页模型反向桥接(浏览器开着 Colony 时维持 SSE 长连接, 把已接入的网页模型透出到 :4135/v1)
  const webBridge = {
    res: null,
    models: [], // [{ id, slug, providerName, model }]
    pending: new Map(), // reqId -> { res, sse, resolve, reject, timer }
    send(ev, data) {
      if (!this.res || this.res.writableEnded || this.res.destroyed) return false;
      this.res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    },
    clearAll(reason) {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        if (p.sse && !p.res.writableEnded) { p.res.end(); }
        else if (p.reject) p.reject(new HttpError(503, reason || '浏览器网页模型桥已断开', 'api_error'));
        this.pending.delete(id);
      }
      this.models = [];
      this.res = null;
    },
  };

  const ctx = {
    get host() { return currentHost; },
    get port() { return cfg.port; },
    version: GATEWAY_VERSION,
  };

  function requireDriver(id) {
    const d = DRIVER_MAP.get(id);
    if (!d) throw new HttpError(404, `未知订阅渠道: ${id}`, 'invalid_request_error');
    return d;
  }

  async function collectDriverSummary(driver) {
    const st = await driver.status(ctx).catch((e) => ({ loggedIn: false, error: e.message }));
    return {
      id: driver.id,
      name: driver.name,
      providerName: driver.providerName || `订阅 · ${driver.name}`,
      desc: driver.desc || '',
      authModes: driver.authModes || [],
      capabilities: driver.capabilities || ['chat'],
      endpoint: `http://127.0.0.1:${cfg.port}/sub/${driver.id}/v1`,
      ...st,
    };
  }

  function gatewayMeta() {
    const lanIps = getLanIps();
    return {
      version: GATEWAY_VERSION,
      pid: process.pid,
      port: cfg.port,
      host: currentHost,
      expose: cfg.expose,
      apiKey: cfg.apiKey,
      localEndpoint: `http://127.0.0.1:${cfg.port}/v1`,
      proxyEndpoint: `http://127.0.0.1:${cfg.port}/proxy?url={url}`,
      lanIps,
      lanEndpoints: cfg.expose ? lanIps.map((ip) => `http://${ip}:${cfg.port}/v1`) : [],
      syncedProviderCount: syncedProviders.filter((p) => p.exposed).length,
      webBridgeOnline: !!(webBridge.res && !webBridge.res.writableEnded),
      webModelCount: webBridge.models.length,
      cliAgentCount: cliAgents.listAgents().length,
      uptimeMs: Date.now() - startedAt,
    };
  }

  async function runViaWebBridge(entry, body, req, res) {
    if (!webBridge.res || webBridge.res.writableEnded) {
      throw new HttpError(503, '网页模型离线：需要保持 Colony 浏览器页面打开', 'api_error');
    }
    const reqId = genId('wb');
    const isStream = body.stream === true;
    const compId = genId('chatcmpl');
    const created = Math.floor(Date.now() / 1000);
    const messages = (Array.isArray(body.messages) ? body.messages : []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const ok = webBridge.send('chat', {
      reqId,
      providerName: entry.providerName,
      model: entry.model,
      messages,
      stream: isStream,
      maxTokens: body.max_tokens || undefined,
      temperature: body.temperature,
    });
    if (!ok) throw new HttpError(503, '网页模型桥已断开', 'api_error');

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        webBridge.pending.delete(reqId);
        reject(new HttpError(504, '网页模型执行超时', 'api_error'));
      }, 180000);
      if (isStream) {
        res.writeHead(200, corsHeaders({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }));
      }
      req.on('close', () => {
        if (webBridge.pending.has(reqId)) {
          clearTimeout(timer);
          webBridge.pending.delete(reqId);
          webBridge.send('cancel', { reqId });
          resolve();
        }
      });
      webBridge.pending.set(reqId, { res, sse: isStream, compId, created, model: body.model, resolve, reject, timer });
    });
  }

  async function resolveRoute(rawModel, preferAnthropic = false) {
    const name = String(rawModel || '').trim();
    const slash = name.indexOf('/');
    if (slash > 0) {
      const prefix = name.slice(0, slash);
      const rest = name.slice(slash + 1);
      if (prefix === 'cli') {
        return { kind: 'cli', model: rest };
      }
      if (DRIVER_MAP.has(prefix)) {
        return { kind: 'driver', driver: DRIVER_MAP.get(prefix), model: rest };
      }
      const prov = syncedProviders.find(
        (p) => p.exposed && (p.slug === prefix.toLowerCase() || p.name === prefix || p.id === prefix),
      );
      if (prov) return { kind: 'provider', provider: prov, model: rest };
      const wm = webBridge.models.find((w) => w.id === name || (w.slug === prefix.toLowerCase() && w.model === rest));
      if (wm) return { kind: 'web', entry: wm, model: wm.model };
    }

    // 1. 优先查已登录订阅驱动（若走 /v1/messages 且是 claude 模型，先匹配 claude 驱动）
    const orderedDrivers = preferAnthropic
      ? [...DRIVERS].sort((a, b) => (a.id === 'claude' ? -1 : b.id === 'claude' ? 1 : 0))
      : DRIVERS;
    for (const d of orderedDrivers) {
      const st = await d.status(ctx).catch(() => ({ loggedIn: false }));
      if (!st.loggedIn) continue;
      const ms = await d.listModels(ctx, { force: false }).catch(() => []);
      if (ms.some((m) => m.id === name)) return { kind: 'driver', driver: d, model: name };
    }

    // 2. 再查已同步的常规上游厂商
    for (const p of syncedProviders) {
      if (!p.exposed) continue;
      if (p.models.includes(name) || p.defaultModel === name) {
        return { kind: 'provider', provider: p, model: name };
      }
    }

    // 3. 浏览器在线时再查网页模型反桥
    const wm2 = webBridge.models.find((w) => w.model === name || w.id === name);
    if (wm2) return { kind: 'web', entry: wm2, model: wm2.model };

    throw new HttpError(404, `未找到可用模型: ${name}（可用 渠道/模型 或先在 AI 配置中登录/同步）`, 'invalid_request_error');
  }

  async function handleRequest(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders({ 'Access-Control-Allow-Private-Network': 'true' }));
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${cfg.port}`}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // 1. Health check
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, {
        ok: true,
        name: 'colony-gateway',
        version: GATEWAY_VERSION,
        pid: process.pid,
        host: currentHost,
        port: cfg.port,
        expose: cfg.expose,
        uptimeMs: Date.now() - startedAt,
        drivers: DRIVERS.map((d) => d.id),
      });
      return;
    }

    // 2. 本机专用透明流式 CORS 代理
    if (pathname === '/proxy') {
      await handleCorsProxy(req, res, url, requireLoopback);
      return;
    }

    // 3. Admin 管理端点（严格仅限本机回环）
    if (pathname.startsWith('/admin/')) {
      requireLoopback(req, '/admin');

      if (req.method === 'GET' && pathname === '/admin/status') {
        const drivers = await Promise.all(DRIVERS.map(collectDriverSummary));
        sendJson(res, {
          ok: true,
          ...gatewayMeta(),
          drivers,
          cliAgents: cliAgents.listAgents({ includeUnavailable: true }),
          providers: syncedProviders.map(({ apiKey: _k, ...rest }) => rest),
        });
        return;
      }

      if (pathname === '/admin/cli-agents') {
        if (req.method === 'GET') {
          sendJson(res, { ok: true, agents: cliAgents.listAgents({ includeUnavailable: true }) });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const agents = cliAgents.upsertAgent(body);
          sendJson(res, { ok: true, agents });
          return;
        }
      }

      if (req.method === 'POST' && pathname === '/admin/cli-agents/reset-session') {
        const body = await readJsonBody(req);
        if (!body.id || !body.session) throw new HttpError(400, '缺少 id 或 session', 'invalid_request_error');
        cliAgents.resetSession(String(body.id), String(body.session));
        sendJson(res, { ok: true });
        return;
      }

      const cliDelMatch = /^\/admin\/cli-agents\/([^/]+)$/.exec(pathname);
      if (cliDelMatch && req.method === 'DELETE') {
        const agents = cliAgents.removeAgent(decodeURIComponent(cliDelMatch[1]));
        sendJson(res, { ok: true, agents });
        return;
      }

      if (req.method === 'GET' && pathname === '/admin/gateway') {
        sendJson(res, { ok: true, ...gatewayMeta() });
        return;
      }

      if (req.method === 'POST' && pathname === '/admin/gateway') {
        const body = await readJsonBody(req);
        const nextExpose = body.expose !== undefined ? !!body.expose : cfg.expose;
        let nextKey = cfg.apiKey;
        if (body.regenerateKey) nextKey = genGatewayKey();
        else if (typeof body.apiKey === 'string') nextKey = body.apiKey.trim();

        if (nextExpose && !nextKey) {
          throw new HttpError(400, '开启局域网外放时必须设置非空的外放密码', 'invalid_request_error');
        }
        const needRebind = nextExpose !== cfg.expose;
        cfg.expose = nextExpose;
        cfg.apiKey = nextKey || genGatewayKey();
        saveConfig(cfg);
        const nextHost = cfg.expose ? '0.0.0.0' : '127.0.0.1';
        const preview = Object.assign(gatewayMeta(), {
          host: nextHost,
          lanEndpoints: cfg.expose ? getLanIps().map((ip) => `http://${ip}:${cfg.port}/v1`) : [],
        });
        if (needRebind) {
          res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }));
          res.end(JSON.stringify({ ok: true, ...preview }), () => {
            setTimeout(() => { rebind(nextHost).catch((e) => console.error('[colony-gateway] rebind:', e.message)); }, 30);
          });
          return;
        }
        sendJson(res, { ok: true, ...preview });
        return;
      }

      if (req.method === 'POST' && pathname === '/admin/providers') {
        const body = await readJsonBody(req);
        syncedProviders = saveSyncedProviders(body.providers);
        sendJson(res, {
          ok: true,
          count: syncedProviders.length,
          exposedCount: syncedProviders.filter((p) => p.exposed).length,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/admin/web-bridge/events') {
        if (webBridge.res && !webBridge.res.writableEnded) {
          try { webBridge.res.end(); } catch {}
        }
        res.writeHead(200, corsHeaders({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }));
        webBridge.res = res;
        res.write(`event: ready\ndata: {"ok":true}\n\n`);
        const hb = setInterval(() => {
          if (res.writableEnded || res.destroyed) return clearInterval(hb);
          res.write(': ping\n\n');
        }, 15000);
        req.on('close', () => {
          clearInterval(hb);
          if (webBridge.res === res) webBridge.clearAll('浏览器页面已关闭');
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/admin/web-bridge/register') {
        const body = await readJsonBody(req);
        const list = Array.isArray(body.models) ? body.models : [];
        webBridge.models = list.filter((x) => x && x.providerName && x.model).map((x) => {
          const slug = `web-${slugify(x.slug || x.providerName.replace(/\(网页\)|网页/g, ''))}`;
          return { id: `${slug}/${x.model}`, slug, providerName: x.providerName, model: x.model };
        });
        sendJson(res, { ok: true, count: webBridge.models.length });
        return;
      }

      if (req.method === 'POST' && pathname === '/admin/web-bridge/reply') {
        const body = await readJsonBody(req);
        const p = webBridge.pending.get(body.reqId);
        if (!p) { sendJson(res, { ok: true, ignored: true }); return; }
        if (body.error) {
          clearTimeout(p.timer);
          webBridge.pending.delete(body.reqId);
          if (p.sse && !p.res.writableEnded) {
            p.res.write(`data: ${JSON.stringify({ error: { message: body.error } })}\n\n`);
            p.res.end();
            p.resolve();
          } else {
            p.reject(new HttpError(502, body.error, 'api_error'));
          }
          sendJson(res, { ok: true });
          return;
        }
        if (body.delta && p.sse && !p.res.writableEnded) {
          p.res.write(`data: ${JSON.stringify({
            id: p.compId, object: 'chat.completion.chunk', created: p.created, model: p.model,
            choices: [{ index: 0, delta: { content: body.delta }, finish_reason: null }],
          })}\n\n`);
        }
        if (body.done) {
          clearTimeout(p.timer);
          webBridge.pending.delete(body.reqId);
          if (p.sse) {
            if (!p.res.writableEnded) {
              p.res.write(`data: ${JSON.stringify({
                id: p.compId, object: 'chat.completion.chunk', created: p.created, model: p.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              })}\n\n`);
              p.res.write('data: [DONE]\n\n');
              p.res.end();
            }
          } else {
            sendJson(p.res, {
              id: p.compId, object: 'chat.completion', created: p.created, model: p.model,
              choices: [{ index: 0, message: { role: 'assistant', content: String(body.content || '') }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
          p.resolve();
        }
        sendJson(res, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/admin/shutdown') {
        sendJson(res, { ok: true, stopping: true, embedded: !!opts.embedded });
        if (!opts.embedded) setTimeout(() => stop().then(() => process.exit(0)), 100);
        return;
      }

      const adminMatch = /^\/admin\/(login|cancel-login|logout|models)\/([^/]+)$/.exec(pathname);
      if (adminMatch) {
        const [, action, id] = adminMatch;
        const driver = requireDriver(id);
        if (action === 'login' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await driver.startLogin(ctx, body);
          sendJson(res, { ok: true, driver: id, ...result });
          return;
        }
        if (action === 'cancel-login' && req.method === 'POST') {
          if (driver.cancelLogin) await driver.cancelLogin(ctx);
          sendJson(res, { ok: true, driver: id });
          return;
        }
        if (action === 'logout' && req.method === 'POST') {
          await driver.logout(ctx);
          sendJson(res, { ok: true, driver: id });
          return;
        }
        if (action === 'models' && req.method === 'GET') {
          const force = url.searchParams.get('force') === '1';
          const models = await driver.listModels(ctx, { force });
          sendJson(res, { ok: true, driver: id, models });
          return;
        }
      }
      throw new HttpError(404, `未知管理路径: ${pathname}`, 'invalid_request_error');
    }

    // 3.4. 本机 CLI 媒体文件只读端点：/cli/file?path=...&agent=...&session=...（支持相对路径与会话沙箱目录）
    if (req.method === 'GET' && pathname === '/cli/file') {
      const info = cliAgents.resolveMediaFile({
        filePath: url.searchParams.get('path'),
        agentId: url.searchParams.get('agent') || '',
        session: url.searchParams.get('session') || '',
      });
      res.writeHead(200, corsHeaders({
        'Content-Type': info.mime,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Private-Network': 'true',
      }));
      fs.createReadStream(info.fullPath).pipe(res);
      return;
    }

    // 3.5. 本机 CLI Agent 统一 OpenAI 兼容端点：/cli/v1/*（ACP + 流式 CLI 零端口托管）
    const cliMatch = /^\/cli\/v1(\/.*)?$/.exec(pathname);
    if (cliMatch) {
      const tail = cliMatch[1] || '/';
      checkApiAuth(req, url, cfg, false);
      if (req.method === 'GET' && tail === '/models') {
        sendJson(res, cliAgents.listModelsOpenAi());
        return;
      }
      if (req.method === 'POST' && tail === '/chat/completions') {
        const body = await readJsonBody(req);
        await cliAgents.handleChat(body, req, res);
        return;
      }
      throw new HttpError(404, `CLI 网关不支持路径 ${tail}`, 'invalid_request_error');
    }

    // 4. 单渠道 OpenAI 兼容端点：/sub/:driver/v1/*（完全向后兼容）
    const subMatch = /^\/sub\/([^/]+)\/v1(\/.*)?$/.exec(pathname);
    if (subMatch) {
      const [, id, tail = '/'] = subMatch;
      checkApiAuth(req, url, cfg, tail === '/messages');
      const driver = requireDriver(id);
      if (req.method === 'GET' && tail === '/models') {
        const models = await driver.listModels(ctx, { force: false });
        sendJson(res, formatModelList(models));
        return;
      }
      if (req.method === 'POST' && tail === '/chat/completions') {
        const body = await readJsonBody(req);
        await driver.chat(ctx, body, req, res);
        return;
      }
      if (driver.handleExtra) {
        await driver.handleExtra(ctx, tail, req, res);
        return;
      }
      throw new HttpError(404, `渠道 ${id} 不支持路径 ${tail}`, 'invalid_request_error');
    }

    // 5. 全聚合 OpenRouter / CLIProxyAPI 端点：/v1/*
    const v1Match = /^\/v1(\/.*)?$/.exec(pathname);
    if (v1Match) {
      const tail = v1Match[1] || '/';
      const isAnthropic = tail === '/messages' || tail === '/messages/count_tokens';
      checkApiAuth(req, url, cfg, isAnthropic);

      if (req.method === 'GET' && tail === '/models') {
        const driverLists = await Promise.all(DRIVERS.map(async (d) => {
          const st = await d.status(ctx).catch(() => ({ loggedIn: false }));
          if (!st.loggedIn) return [];
          const ms = await d.listModels(ctx, { force: false }).catch(() => []);
          return ms.map((m) => ({ ...m, id: `${d.id}/${m.id}`, owned_by: d.id }));
        }));
        const all = driverLists.flat();
        for (const p of syncedProviders) {
          if (!p.exposed) continue;
          const list = p.models.length ? p.models : (p.defaultModel ? [p.defaultModel] : []);
          for (const m of list) all.push({ id: `${p.slug}/${m}`, owned_by: p.slug, object: 'model' });
        }
        for (const w of webBridge.models) {
          all.push({ id: w.id, owned_by: w.slug, object: 'model' });
        }
        for (const c of cliAgents.listAgents()) {
          all.push({ id: `cli/${c.id}`, displayName: `CLI · ${c.name}`, owned_by: 'colony-cli', object: 'model' });
        }
        sendJson(res, formatModelList(all));
        return;
      }

      if (req.method === 'POST' && tail === '/messages/count_tokens') {
        const body = await readJsonBody(req);
        sendJson(res, { input_tokens: estimateTokens(body) });
        return;
      }

      if (req.method === 'POST' && tail === '/chat/completions') {
        const body = await readJsonBody(req);
        const route = await resolveRoute(body.model, false);
        body.model = route.model;
        if (route.kind === 'cli') {
          await cliAgents.handleChat(body, req, res);
        } else if (route.kind === 'driver') {
          await route.driver.chat(ctx, body, req, res);
        } else if (route.kind === 'web') {
          await runViaWebBridge(route.entry, body, req, res);
        } else {
          await forwardToProvider(route.provider, '/chat/completions', 'POST', body, req, res);
        }
        return;
      }

      if (req.method === 'POST' && tail === '/messages') {
        const body = await readJsonBody(req);
        const route = await resolveRoute(body.model, true);
        body.model = route.model;
        if (route.kind === 'cli') {
          await runAnthropicViaOpenAi((oa, vres) => cliAgents.handleChat(oa, req, vres), body, route.model, res);
          return;
        }
        if (route.kind === 'driver') {
          if (route.driver.id === 'claude' && route.driver.handleExtra) {
            const origBody = Buffer.from(JSON.stringify(body));
            await route.driver.handleExtra(ctx, '/messages', makeReplayReq(req, origBody), res);
            return;
          }
          await runAnthropicViaOpenAi((oa, vres) => route.driver.chat(ctx, oa, req, vres), body, route.model, res);
          return;
        }
        if (route.kind === 'web') {
          await runAnthropicViaOpenAi((oa, vres) => runViaWebBridge(route.entry, oa, req, vres), body, route.model, res);
          return;
        }
        if (route.provider.protocol === 'anthropic') {
          await forwardToProvider(route.provider, '/messages', 'POST', body, req, res);
          return;
        }
        await runAnthropicViaOpenAi(
          (oa, vres) => forwardToProvider(route.provider, '/chat/completions', 'POST', oa, req, vres),
          body,
          route.model,
          res,
        );
        return;
      }

      // 其余 /v1/* 端点（/responses, /images/*, /videos/*, /audio/*, /embeddings 等；兼容 JSON、multipart 与 GET 轮询）
      const ct = String(req.headers['content-type'] || '');
      if (req.method === 'GET' || req.method === 'DELETE') {
        let route = null;
        let realTail = tail;
        const mPref = /^(\/(?:videos|tasks|batches|audio)\/)([a-z0-9_-]+):([^/]+)$/i.exec(tail);
        if (mPref) {
          route = await resolveRoute(`${mPref[2]}/*`, false).catch(() => null);
          realTail = `${mPref[1]}${mPref[3]}`;
        } else {
          const segId = tail.split('/').filter(Boolean).pop();
          if (segId && taskRoutes.has(segId)) route = taskRoutes.get(segId);
          else if (url.searchParams.get('model')) route = await resolveRoute(url.searchParams.get('model'), false);
        }
        if (route) {
          const qs = url.search || '';
          if (route.kind === 'driver') {
            if (!route.driver.handleExtra) throw new HttpError(404, `订阅渠道 ${route.driver.id} 不支持 ${realTail}`, 'invalid_request_error');
            await route.driver.handleExtra(ctx, realTail, makeReplayReq(req, null), res);
          } else if (route.kind === 'provider') {
            await forwardToProvider(route.provider, realTail + qs, req.method, null, req, res);
          }
          return;
        }
      }

      if (req.method === 'POST') {
        if (/multipart\/form-data/i.test(ct)) {
          const chunks = [];
          for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          const rawBuf = Buffer.concat(chunks);
          const mModel = /name="model"\r?\n\r?\n([^\r\n]+)/.exec(rawBuf.toString('latin1'));
          const rawModel = mModel ? mModel[1].trim() : (url.searchParams.get('model') || '');
          const route = await resolveRoute(rawModel, false);
          if (route.kind === 'driver') {
            if (!route.driver.handleExtra) throw new HttpError(404, `订阅渠道 ${route.driver.id} 不支持 ${tail}`, 'invalid_request_error');
            await route.driver.handleExtra(ctx, tail, makeReplayReq(req, rawBuf), res);
          } else if (route.kind === 'provider') {
            await forwardToProvider(route.provider, tail, 'POST', rawBuf, req, res, ct);
          } else {
            throw new HttpError(400, `网页模型暂不支持 ${tail}`, 'invalid_request_error');
          }
          return;
        }

        const body = await readJsonBody(req);
        const route = await resolveRoute(body.model, false);
        body.model = route.model;
        const origWrite = res.write.bind(res);
        const capChunks = [];
        res.write = (chunk, ...rest) => {
          if (capChunks.length < 8) capChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return origWrite(chunk, ...rest);
        };
        const origEnd = res.end.bind(res);
        res.end = (chunk, ...rest) => {
          if (chunk && capChunks.length < 8) capChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          try {
            const j = JSON.parse(Buffer.concat(capChunks).toString('utf8'));
            const tid = j?.request_id || j?.task_id || j?.id || j?.output?.task_id;
            if (tid && typeof tid === 'string') rememberTask(tid, route);
          } catch {}
          return origEnd(chunk, ...rest);
        };
        if (route.kind === 'driver') {
          if (!route.driver.handleExtra) {
            throw new HttpError(404, `订阅渠道 ${route.driver.id} 不支持 ${tail}`, 'invalid_request_error');
          }
          const origBody = Buffer.from(JSON.stringify(body));
          await route.driver.handleExtra(ctx, tail, makeReplayReq(req, origBody), res);
        } else if (route.kind === 'provider') {
          await forwardToProvider(route.provider, tail, 'POST', body, req, res);
        } else {
          throw new HttpError(400, `网页模型暂不支持 ${tail}`, 'invalid_request_error');
        }
        return;
      }
    }

    throw new HttpError(404, `Not found: ${pathname}`, 'invalid_request_error');
  }

  function createHttpServer() {
    return http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        if (/^\/v1\/messages\b/.test(req.url || '')) {
          const status = Number(err?.status) || 500;
          sendJson(res, { type: 'error', error: { type: err?.type || 'api_error', message: err?.message || String(err) } }, status);
        } else {
          sendOpenAiError(res, err);
        }
      });
    });
  }

  function listenOn(host) {
    return new Promise((resolve, reject) => {
      const srv = createHttpServer();
      srv.once('error', reject);
      srv.listen(cfg.port, host, () => {
        srv.removeAllListeners('error');
        server = srv;
        currentHost = host;
        resolve();
      });
    });
  }

  async function closeServer() {
    cliAgents.disposeAll();
    webBridge.clearAll('网关重启中');
    if (!server) return;
    const old = server;
    server = null;
    await new Promise((r) => {
      old.close(() => r());
      if (old.closeAllConnections) old.closeAllConnections();
    });
  }

  async function rebind(nextHost) {
    const prevHost = currentHost;
    await closeServer();
    try {
      await listenOn(nextHost);
    } catch (err) {
      await listenOn(prevHost).catch(() => {});
      throw new HttpError(500, `切换监听地址到 ${nextHost}:${cfg.port} 失败: ${err.message}`, 'api_error');
    }
  }

  async function stop() {
    await closeServer();
  }

  await listenOn(currentHost);
  // 后台静默预热已登录订阅驱动的模型列表缓存，确保首次 /v1/models 与路由匹配零等待
  const warmupTimer = setTimeout(() => {
    for (const d of DRIVERS) {
      d.status(ctx)
        .then((st) => (st?.loggedIn ? d.listModels(ctx, { force: false }) : null))
        .catch(() => {});
    }
  }, 250);
  if (warmupTimer.unref) warmupTimer.unref();
  return {
    get status() { return gatewayMeta(); },
    stop,
    rebind,
  };
}

export { ROOT_DIR };

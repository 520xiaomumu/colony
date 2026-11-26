import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DRIVERS, DRIVER_MAP } from './drivers/index.mjs';
import { ROOT_DIR } from './lib/store.mjs';
import { HttpError, corsHeaders, formatModelList, readJsonBody, sendJson, sendOpenAiError } from './lib/openai.mjs';

const VERSION = '0.1.0';
const STARTED_AT = Date.now();
const PID_FILE = path.join(ROOT_DIR, 'server.pid');

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const HOST = parseArg('--host', process.env.COLONY_SUB_HOST || '127.0.0.1');
const PORT = Number(parseArg('--port', process.env.COLONY_SUB_PORT || '4135')) || 4135;

const ctx = { host: HOST, port: PORT, version: VERSION };

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
    endpoint: `http://${HOST}:${PORT}/sub/${driver.id}/v1`,
    ...st,
  };
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // 1. Health check
  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, {
      ok: true,
      name: 'colony-sub',
      version: VERSION,
      pid: process.pid,
      host: HOST,
      port: PORT,
      uptimeMs: Date.now() - STARTED_AT,
      drivers: DRIVERS.map((d) => d.id),
    });
    return;
  }

  // 2. Admin endpoints (consumed by petri:sub panel)
  if (req.method === 'GET' && pathname === '/admin/status') {
    const drivers = await Promise.all(DRIVERS.map(collectDriverSummary));
    sendJson(res, {
      ok: true,
      version: VERSION,
      pid: process.pid,
      host: HOST,
      port: PORT,
      uptimeMs: Date.now() - STARTED_AT,
      drivers,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/admin/shutdown') {
    sendJson(res, { ok: true, stopping: true });
    setTimeout(() => shutdown(0), 100);
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

  // 3. Per-driver OpenAI-compatible endpoints: /sub/:driver/v1/*
  const subMatch = /^\/sub\/([^/]+)\/v1(\/.*)?$/.exec(pathname);
  if (subMatch) {
    const [, id, tail = '/'] = subMatch;
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

  // 4. Aggregated /v1/* endpoints (prefix model with "driver/" or auto-resolve)
  if (req.method === 'GET' && pathname === '/v1/models') {
    const all = [];
    for (const d of DRIVERS) {
      const st = await d.status(ctx).catch(() => ({ loggedIn: false }));
      if (!st.loggedIn) continue;
      const ms = await d.listModels(ctx, { force: false }).catch(() => []);
      for (const m of ms) {
        all.push({ ...m, id: `${d.id}/${m.id}`, owned_by: d.id });
      }
    }
    sendJson(res, formatModelList(all));
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    const body = await readJsonBody(req);
    const rawModel = String(body.model || '');
    const slash = rawModel.indexOf('/');
    let driver = null;
    if (slash > 0 && DRIVER_MAP.has(rawModel.slice(0, slash))) {
      driver = DRIVER_MAP.get(rawModel.slice(0, slash));
      body.model = rawModel.slice(slash + 1);
    } else {
      for (const d of DRIVERS) {
        const st = await d.status(ctx).catch(() => ({ loggedIn: false }));
        if (!st.loggedIn) continue;
        const models = await d.listModels(ctx, { force: false }).catch(() => []);
        if (models.some((m) => m.id === rawModel)) { driver = d; break; }
      }
      if (!driver) {
        throw new HttpError(404, `没有找到可用模型: ${rawModel}，请使用 provider/model 或先同步模型`, 'invalid_request_error');
      }
    }
    if (!driver) throw new HttpError(401, '没有已登录的订阅渠道', 'authentication_error');
    await driver.chat(ctx, body, req, res);
    return;
  }

  throw new HttpError(404, `Not found: ${pathname}`, 'invalid_request_error');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    sendOpenAiError(res, err);
  });
});

function writePid() {
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch {}
}

function clearPid() {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

function shutdown(code = 0) {
  clearPid();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1500).unref();
}

server.on('error', (err) => {
  console.error('[colony-sub] Server error:', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writePid();
  console.log(`[colony-sub] v${VERSION} listening on http://${HOST}:${PORT} (drivers: ${DRIVERS.map((d) => d.id).join(', ')})`);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

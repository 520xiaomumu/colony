import crypto from 'node:crypto';
import { readStateJson, withLock, writeStateJson } from './store.mjs';

const CACHE_STATE_KEY = 'model-cache';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

let memCache = null;
const inflight = new Map();
const generations = new Map();

function ensureLoaded() {
  if (!memCache) {
    const raw = readStateJson(CACHE_STATE_KEY, {});
    memCache = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  }
  return memCache;
}

function getGen(driverId) {
  return generations.get(driverId) || 0;
}

function bumpGen(driverId) {
  const next = getGen(driverId) + 1;
  generations.set(driverId, next);
  return next;
}

function persistStore(store) {
  const snapshot = { ...store };
  return withLock('model-cache-write', async () => {
    writeStateJson(CACHE_STATE_KEY, snapshot);
  }).catch((err) => {
    console.warn('[colony-sub] 写入模型缓存文件失败:', err?.message || err);
  });
}

function credHash(credKey) {
  return crypto.createHash('sha256').update(String(credKey || 'anon')).digest('hex').slice(0, 16);
}

export function peekCachedModels(driverId, credKey) {
  if (!credKey) return null;
  const store = ensureLoaded();
  const entry = store[driverId];
  if (!entry || entry.hash !== credHash(credKey) || !Array.isArray(entry.models) || !entry.models.length) {
    return null;
  }
  return entry.models;
}

export function invalidateModelCache(driverId) {
  bumpGen(driverId);
  const store = ensureLoaded();
  if (driverId in store) {
    delete store[driverId];
    persistStore(store);
  }
}

export async function cachedListModels(driverId, credKey, fetcher, {
  force = false,
  ttlMs = DEFAULT_TTL_MS,
  fallback = [],
} = {}) {
  const store = ensureLoaded();
  const hash = credHash(credKey);
  const existing = store[driverId]?.hash === hash && Array.isArray(store[driverId]?.models) && store[driverId].models.length
    ? store[driverId]
    : null;

  const refreshNow = () => {
    const startGen = getGen(driverId);
    const flightKey = `${driverId}:${hash}:${startGen}`;
    if (inflight.has(flightKey)) return inflight.get(flightKey);
    const p = (async () => {
      const list = await fetcher();
      if (Array.isArray(list) && list.length && getGen(driverId) === startGen) {
        store[driverId] = { hash, fetchedAt: Date.now(), models: list };
        await persistStore(store);
      }
      return Array.isArray(list) ? list : [];
    })().finally(() => {
      inflight.delete(flightKey);
    });
    inflight.set(flightKey, p);
    return p;
  };

  if (!force && existing) {
    if (Date.now() - (existing.fetchedAt || 0) >= ttlMs) {
      refreshNow().catch((err) => {
        if ((err?.status === 401 || err?.status === 403) && store[driverId]?.hash === hash) {
          delete store[driverId];
          persistStore(store);
        }
        console.warn(`[colony-sub] 后台静默刷新模型列表失败 (${driverId}):`, err?.message || err);
      });
    }
    return existing.models;
  }

  try {
    const fresh = await refreshNow();
    return fresh.length ? fresh : (existing?.models || fallback);
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      if (store[driverId]?.hash === hash) {
        delete store[driverId];
        persistStore(store);
      }
      throw err;
    }
    if (!force && existing?.models?.length) return existing.models;
    if (!force && Array.isArray(fallback) && fallback.length) {
      console.warn(`[colony-sub] 实时拉取模型失败，回退兜底列表 (${driverId}):`, err?.message || err);
      return fallback;
    }
    throw err;
  }
}

export function normalizeModelId(id) {
  return String(id || '').trim().replace(/-wm$/, '');
}

export function mergeModels(...sources) {
  const out = [];
  const seen = new Set();
  for (const source of sources) {
    for (const model of Array.isArray(source) ? source : []) {
      if (!model || model.visibility === 'hide' || model.supported_in_api === false) continue;
      const id = normalizeModelId(model.slug || model.id || model.name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        ...model,
        id,
        slug: id,
        displayName: model.displayName || model.display_name || model.title || id,
        owned_by: model.owned_by || model.provider || 'openai',
        capabilities: model.capabilities || (id.startsWith('gpt-image-') ? ['image'] : ['chat']),
        protocol: model.protocol || 'openai-chat',
        source: model.source || 'discovered',
      });
    }
  }
  return out;
}

export function mergeCodexModels(codex = {}, web = {}) {
  const webModels = (web.models || []).filter((m) => {
    const id = String(m?.slug || m?.id || '');
    return id.endsWith('-wm') || /^gpt-image(?:-|$)/i.test(id);
  });
  return mergeModels(codex.models, webModels);
}

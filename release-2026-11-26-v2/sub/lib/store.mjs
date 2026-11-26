import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT_DIR = path.join(os.homedir(), 'colony-sub');
export const TOKENS_DIR = path.join(ROOT_DIR, 'tokens');
export const STATE_DIR = path.join(ROOT_DIR, '.state');
fs.mkdirSync(TOKENS_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

function safeName(value) {
  const name = String(value || '').replace(/[^a-z0-9._-]/gi, '_');
  if (!name) throw new Error('Invalid identifier');
  return name;
}
function jsonPath(dir, name) { return path.join(dir, `${safeName(name)}.json`); }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readJson(file, fallback = null) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}

export function readStateJson(name, fallback = null) { return readJson(jsonPath(STATE_DIR, name), fallback); }
export function writeStateJson(name, value) { atomicWrite(jsonPath(STATE_DIR, name), value); }

export function readCreds(driverId, accountId = null) {
  const raw = readJson(jsonPath(TOKENS_DIR, driverId));
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.accounts) && raw.accounts.length) {
    const wanted = accountId || raw.activeAccountId;
    const account = (wanted && raw.accounts.find((a) => a.accountId === wanted || a.email === wanted)) || raw.accounts[0];
    return account ? { ...raw, ...account } : raw;
  }
  return raw;
}
export function listCredAccounts(driverId) {
  const raw = readJson(jsonPath(TOKENS_DIR, driverId));
  return Array.isArray(raw?.accounts) && raw.accounts.length ? raw.accounts : (raw ? [raw] : []);
}
export function writeCreds(driverId, value) { atomicWrite(jsonPath(TOKENS_DIR, driverId), { ...value, updatedAt: Date.now() }); }
export function readDriverStore(driverId) { return readJson(jsonPath(TOKENS_DIR, driverId), {}); }
export function writeDriverStore(driverId, value) { atomicWrite(jsonPath(TOKENS_DIR, driverId), { ...value, updatedAt: Date.now() }); }
export function upsertCredAccount(driverId, account, accountId = account?.accountId || account?.email) {
  const store = readDriverStore(driverId);
  const accounts = Array.isArray(store.accounts) ? [...store.accounts] : (Object.keys(store).length ? [{ ...store }] : []);
  const index = accounts.findIndex((a) => accountId && (a.accountId === accountId || a.email === accountId));
  if (index >= 0) accounts[index] = { ...accounts[index], ...account };
  else accounts.push({ ...account, accountId: accountId || account.accountId });
  writeDriverStore(driverId, { accounts, activeAccountId: accountId || accounts[0]?.accountId });
  return accounts[index >= 0 ? index : accounts.length - 1];
}
export function setActiveCredAccount(driverId, accountId) {
  const store = readDriverStore(driverId);
  if (!Array.isArray(store.accounts) || !store.accounts.some((a) => a.accountId === accountId || a.email === accountId)) return false;
  writeDriverStore(driverId, { ...store, activeAccountId: accountId });
  return true;
}
export function clearCreds(driverId) {
  try { fs.unlinkSync(jsonPath(TOKENS_DIR, driverId)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

const locks = new Map();
export function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  locks.set(key, current);
  current.finally(() => { if (locks.get(key) === current) locks.delete(key); }).catch(() => {});
  return current;
}

class LoginManager {
  constructor() { this.sessions = new Map(); }
  get(id) {
    const s = this.sessions.get(id);
    if (!s) return { state: 'idle' };
    return { state: s.state, mode: s.mode, attemptId: s.attemptId, url: s.url || null,
      userCode: s.userCode || null, message: s.message || '', error: s.error || null,
      startedAt: s.startedAt, updatedAt: s.updatedAt };
  }
  begin(id, mode, message = '正在初始化登录…') {
    this.cancel(id);
    const controller = new AbortController();
    const session = { attemptId: crypto.randomUUID(), state: 'pending', mode, url: null,
      userCode: null, message, error: null, startedAt: Date.now(), updatedAt: Date.now(), controller };
    this.sessions.set(id, session);
    const current = () => this.sessions.get(id) === session && !controller.signal.aborted;
    return {
      attemptId: session.attemptId, signal: controller.signal, isCurrent: current,
      update: (patch) => { if (current()) Object.assign(session, patch, { updatedAt: Date.now() }); },
      commitCreds: (creds, done = '登录成功') => { if (!current()) return false; writeCreds(id, creds); session.state = 'done'; session.message = done; return true; },
      succeed: (done = '登录成功') => { if (current()) Object.assign(session, { state: 'done', message: done, error: null, updatedAt: Date.now() }); },
      fail: (err) => { if (this.sessions.get(id) === session) { const message = err instanceof Error ? err.message : String(err || '登录失败'); Object.assign(session, { state: 'error', message, error: message, updatedAt: Date.now() }); } },
    };
  }
  cancel(id) { const s = this.sessions.get(id); if (s?.state === 'pending') s.controller.abort(); this.sessions.delete(id); }
  clear(id) { this.cancel(id); }
}
export const loginManager = new LoginManager();

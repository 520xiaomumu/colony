import { clearCreds, loginManager, readCreds, withLock, writeCreds } from './store.mjs';
import { HttpError } from './openai.mjs';
import { invalidateModelCache, peekCachedModels } from './models.mjs';

export function abortableSleep(ms, signal, cancelMsg = '已取消登录') {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(cancelMsg));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error(cancelMsg));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function postOAuthToken(url, payload, { json = false, signal, headers = {} } = {}) {
  const reqHeaders = {
    Accept: 'application/json',
    'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
    ...headers,
  };
  const body = json
    ? JSON.stringify(payload)
    : new URLSearchParams(
        Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ).toString();
  const resp = await fetch(url, { method: 'POST', headers: reqHeaders, body, signal });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

/**
 * 统一 OAuth 订阅驱动底座：凭据读取、单飞锁内刷新（防并发二次轮换 refresh_token）、
 * 401 自动强制刷新重试、状态拼装与登出缓存清理。
 */
export function createOAuthRuntime({
  id,
  label,
  notLoggedInMessage,
  expiredMessage,
  refreshLeadMs = 2 * 60 * 1000,
  credKeyOf = (c) => c?.accountId || c?.email || c?.refreshToken || c?.accessToken || id,
  isReady = () => true,
  canSkipRefresh = null,
  doRefresh,
}) {
  function getCreds() {
    const c = readCreds(id);
    return c && c.accessToken ? c : null;
  }

  async function refreshCreds(prevCreds, { force = false } = {}) {
    return withLock(`${id}-refresh`, async () => {
      const latest = readCreds(id) || prevCreds;
      const alreadyRotated = Boolean(prevCreds?.accessToken && latest?.accessToken && latest.accessToken !== prevCreds.accessToken);
      const effectiveForce = force && !alreadyRotated;

      if (
        !effectiveForce
        && latest?.accessToken
        && latest.expiresAt
        && Date.now() < latest.expiresAt - refreshLeadMs
        && isReady(latest)
      ) {
        return latest;
      }
      if (!effectiveForce && canSkipRefresh && canSkipRefresh(latest)) {
        return latest;
      }
      if (!latest?.refreshToken) {
        throw new HttpError(401, expiredMessage || `${label} 登录已过期，请重新登录`, 'authentication_error');
      }

      const patch = await doRefresh(latest);
      const updated = { ...latest, ...patch };
      writeCreds(id, updated);
      return updated;
    });
  }

  async function ensureCreds() {
    const c = getCreds();
    if (!c) {
      throw new HttpError(
        401,
        notLoggedInMessage || `${label} 尚未登录，请先在订阅中心登录`,
        'authentication_error',
      );
    }
    const expiringSoon = Boolean(c.expiresAt && Date.now() >= c.expiresAt - refreshLeadMs);
    if ((expiringSoon && c.refreshToken) || !isReady(c)) {
      return refreshCreds(c);
    }
    return c;
  }

  async function callWithNetRetry(fn, signal) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      if (err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 250));
        if (signal?.aborted) throw err;
        return fn();
      }
      throw err;
    }
  }

  async function fetchWithAuth(runOnce, signal) {
    let creds = await ensureCreds();
    let resp = await callWithNetRetry(() => runOnce(creds), signal);
    if (resp.status === 401 && creds.refreshToken) {
      creds = await refreshCreds(creds, { force: true });
      resp = await callWithNetRetry(() => runOnce(creds), signal);
    }
    return { resp, creds };
  }

  function buildStatus({
    authModeOf = (c) => c?.authMode || 'browser',
    accountOf = (c) => c?.email || null,
    fallbackModelCount = null,
    extra = {},
  } = {}) {
    const c = getCreds();
    const cachedCount = c ? (peekCachedModels(id, credKeyOf(c))?.length ?? fallbackModelCount) : null;
    return {
      loggedIn: !!c,
      account: c ? accountOf(c) : null,
      expiresAt: c?.expiresAt || null,
      authMode: c ? authModeOf(c) : null,
      modelCount: cachedCount,
      login: loginManager.get(id),
      ...extra,
    };
  }

  async function cancelLogin() {
    loginManager.cancel(id);
    return { ok: true };
  }

  async function logout(onBeforeClear) {
    const prev = getCreds();
    loginManager.clear(id);
    clearCreds(id);
    invalidateModelCache(id);
    if (onBeforeClear && prev) {
      try { await onBeforeClear(prev); } catch {}
    }
    return { ok: true };
  }

  return {
    getCreds,
    credKeyOf,
    refreshCreds,
    ensureCreds,
    fetchWithAuth,
    buildStatus,
    cancelLogin,
    logout,
  };
}

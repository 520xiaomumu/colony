import http from 'node:http';
import crypto from 'node:crypto';

export function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  return { verifier, challenge, state, nonce };
}

/**
 * Start a temporary localhost HTTP server to capture an OAuth authorization code callback.
 * Reusable by Antigravity / Codex / Claude drivers.
 */
export function listenOAuthCallback({ port = 0, host = '127.0.0.1', redirectHost, callbackPath = '/oauth-callback', expectedState, timeoutMs = 5 * 60 * 1000, signal }) {
  return new Promise((resolveReady, rejectReady) => {
    let settleCode, rejectCode;
    const codePromise = new Promise((res, rej) => { settleCode = res; rejectCode = rej; });
    let closed = false;
    const pubHost = redirectHost || host || 'localhost';

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${pubHost}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h3>授权失败</h3><p>${error}</p>`);
        close();
        rejectCode(new Error(`OAuth error: ${error}`));
        return;
      }
      if (expectedState && state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>状态校验失败</h3>');
        close();
        rejectCode(new Error('OAuth state mismatch'));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>缺少授权码</h3>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:32px;background:#0a0a0a;color:#fafafa"><h2>✓ 授权成功</h2><p>可以关闭此页面，回到 Colony 继续使用。</p></body>');
      const params = Object.fromEntries(url.searchParams.entries());
      close();
      settleCode({ code, state, params, url: url.toString() });
    });

    const timer = setTimeout(() => {
      close();
      rejectCode(new Error('OAuth 登录超时'));
    }, timeoutMs);

    const onAbort = () => {
      close();
      rejectCode(new Error('已取消登录'));
    };
    if (signal) {
      if (signal.aborted) return rejectReady(new Error('已取消登录'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { server.close(); } catch {}
    }

    server.on('error', (err) => {
      close();
      rejectReady(err);
    });

    const onListen = () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolveReady({
        port: actualPort,
        redirectUri: `http://${pubHost}:${actualPort}${callbackPath}`,
        waitForCode: () => codePromise,
        close,
      });
    };
    if (host) server.listen(port, host, onListen);
    else server.listen(port, onListen);
  });
}

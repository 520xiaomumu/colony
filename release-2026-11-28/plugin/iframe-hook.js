/* Colony 内嵌浏览器 iframe 钩子: 跑在页面 MAIN world。
   仅当 window.name 以 ccb- 开头才启用, 不干扰用户自己的网页。 */
'use strict';
(function () {
  const n = String(window.name || '');
  if (n.indexOf('ccb-') !== 0) return;
  if (window.__ccbMain) return;
  window.__ccbMain = 1;
  const tell = (url, kind) => {
    try {
      const abs = new URL(url, location.href).href;
      window.parent.postMessage({ __ccb: { op: 'open', url: abs, kind: kind || 'tab', name: n } }, '*');
    } catch (e) { }
  };
  let lastUrl = '', lastAt = 0;
  const gate = (url) => {   // 闸门: 页面自己调 window.open/改 target 来突破嵌套时, 转标签会无限自我复制 — 必须卡住
    let abs = url; try { abs = new URL(url, location.href).href; } catch (e) {}
    if (navigator.userActivation && !navigator.userActivation.isActive) return false;   // 没有用户手势 = 反嵌套脚本在弹, 丢弃
    const now = Date.now();
    if (abs === lastUrl && now - lastAt < 2500) return false;   // 同址连发 = 循环, 丢弃
    lastUrl = abs; lastAt = now; return true;
  };
  const icon = () => { try { const l = document.querySelector('link[rel~="icon"],link[rel="shortcut icon"]'); return l ? l.href : location.origin + '/favicon.ico'; } catch (e) { return ''; } };
  let lastSent = '';
  const ping = () => {
    try {
      const s = { op: 'state', url: location.href, title: document.title || '', icon: icon(), name: n };
      const k = s.url + '|' + s.title + '|' + s.icon; if (k === lastSent) return; lastSent = k;
      window.parent.postMessage({ __ccb: s }, '*');
    } catch (e) { }
  };
  // 单页应用(GitHub、YouTube…)用 pushState 换网址不触发任何事件: 包一层, 外加标题变化和兜底轮询
  try {
    ['pushState', 'replaceState'].forEach(k => { const o = history[k]; history[k] = function () { const r = o.apply(this, arguments); setTimeout(ping, 0); return r; }; });
  } catch (e) { }
  setInterval(ping, 1000);
  // 弹窗里的页(ccb-pop-*)调 window.close 收尾: 让应用关浮层; window.opener 指回开它的那页(postMessage 走应用中转)
  if (n.indexOf('ccb-pop-') === 0) {
    try { window.close = function () { window.parent.postMessage({ __ccb: { op: 'closeSelf', name: n } }, '*'); }; } catch (e) { }
  }
  try {
    // window.open: 带窗口特征(宽高/popup)的多半是登录、授权弹窗 → 让应用开浮层子窗(真 iframe, 能 postMessage 回来、能关);
    // 只给网址的当新标签。都回一个代理, 页面拿它 .closed / .close() / .postMessage / .location 不会报错。
    const _open = window.open;
    window.open = function (u, target, features) {
      if (!u || u === 'about:blank') {   // 先开空窗再塞网址的写法: 回代理, 等它设 location 再开
        const proxy = { closed: false, close() { proxy.closed = true; }, focus() {}, postMessage() {}, document: { write() {}, close() {} } };
        let href = '';
        Object.defineProperty(proxy, 'location', { get: () => ({ get href() { return href; }, set href(v) { href = v; if (gate(v)) tell(v, 'popup'); }, replace(v) { this.href = v; }, assign(v) { this.href = v; } }), set: v => { href = String(v); if (gate(href)) tell(href, 'popup'); } });
        return proxy;
      }
      if (!gate(u)) return null;
      const isPopup = /width|height|popup/i.test(String(features || ''));
      const pid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      window.parent.postMessage({ __ccb: { op: 'open', url: new URL(u, location.href).href, kind: isPopup ? 'popup' : 'tab', name: n, pid, features: String(features || '') } }, '*');
      const proxy = { closed: false, close() { proxy.closed = true; window.parent.postMessage({ __ccb: { op: 'closePopup', pid, name: n } }, '*'); }, focus() {}, blur() {},
        postMessage(data, origin) { window.parent.postMessage({ __ccb: { op: 'popupMsg', pid, name: n, data, origin } }, '*'); } };
      window.addEventListener('message', ev => { const m = ev.data && ev.data.__ccbPopupClosed; if (m && m.pid === pid) proxy.closed = true; });
      return proxy;
    };
  } catch (e) { }
  document.addEventListener('click', (e) => {
    let el = e.target;
    while (el && el.nodeType === 1) {
      if (el.tagName === 'A' || el.tagName === 'AREA') {
        const href = el.getAttribute('href') || '';
        const tg = (el.getAttribute('target') || '').toLowerCase();
        if ((tg && tg !== '_self') || e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          if (href && href.charAt(0) !== '#' && gate(href)) tell(href, 'blank');
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    let el = e.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A' && el.tagName !== 'AREA') el = el.parentElement;
    if (!el) return;
    const href = el.getAttribute('href') || '';
    if (href && href.charAt(0) !== '#') { e.preventDefault(); tell(href, 'middle'); }
  }, true);
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data && e.data.__ccbCommand;
    if (!m || m.name !== n) return;
    if (m.op === 'back') history.back();
    else if (m.op === 'forward') history.forward();
    else if (m.op === 'reload') location.reload();
    else if (m.op === 'state') { lastSent = ''; ping(); }
    else if (m.op === 'dom') {   // 取渲染后 DOM/元素: 本钩子跑在页面 MAIN world, 天然读得到 — 免去父窗跨域隔离, 也免开后台标签
      let payload = null, err = null;
      try {
        if (m.selector) {
          const els = [].slice.call(document.querySelectorAll(m.selector), 0, m.limit || 50);
          payload = { kind: 'nodes', selector: m.selector, count: els.length,
            items: els.map(function (el) { return { text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000), html: (el.outerHTML || '').slice(0, 20000), href: el.getAttribute && el.getAttribute('href') || undefined, src: el.getAttribute && el.getAttribute('src') || undefined }; }) };
        } else {
          payload = { kind: 'page', title: document.title, url: location.href,
            text: (document.body && document.body.innerText || '').slice(0, 400000),
            html: document.documentElement.outerHTML.slice(0, 2000000) };
        }
      } catch (ex) { err = String(ex && ex.message || ex); }
      try { window.parent.postMessage({ __ccbDom: { id: m.id, name: n, ok: !err, error: err, data: payload } }, '*'); } catch (ex) {}
    }
  });
  window.addEventListener('popstate', ping);
  ping();
  window.addEventListener('DOMContentLoaded', ping);
  window.addEventListener('load', ping);
  window.addEventListener('hashchange', ping);
  document.addEventListener('visibilitychange', ping);
})();

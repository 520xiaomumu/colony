(function () {
/* Colony Bridge 插件 · 内容脚本: 页面 window ↔ 扩展 runtime 的哑管道(不解析业务, 只搬运)。
   页面协议(bridge 块的 Relay 客户端与此对应):
     发: window.postMessage({ __colonyRelay: { id, op, req? } })    op: ping|fetch|scan|notify|reload|stream|cancel
     收: { __colonyRelayResult: { id, ...resp } }                   一次性 op
         { __colonyRelayChunk:  { id, delta|keepalive|done|error } } op:'stream' 逐块
     就绪广播: { __colonyRelayReady: { version } }; 页面可发 { __colonyRelayHello:1 } 请求重播。 */
'use strict';
/* 代际接管(epoch): 插件 reload 后 bg 会把本文件重新注入所有页面, 但页面里那份旧 cs 仍活着 —
   它连不回新 bg(Extension context invalidated), 却照样在监听 postMessage。
   若这里只写"注入过就跳过", 新的一份会自我放弃, 孤儿旧 cs 继续占着管道 → 桥永远不自愈(实测教训)。
   故改为代际号: 每份注入进来就 +1 并广播, 旧世代收到广播即自行退休(其监听器见 epoch 不符直接 return)。 */
const __EPOCH = (window.__colonyRelayEpoch = (window.__colonyRelayEpoch || 0) + 1);
const __mine = () => window.__colonyRelayEpoch === __EPOCH;
const ports = new Map(); // 流 id → Port

window.addEventListener('message', (ev) => {
  if (!__mine() || !chrome.runtime.id) return;   // 已被更新的世代接管: 本份退休, 不再应答(否则一条请求回两次包)
  if (ev.source !== window) return;
  const m = ev.data && ev.data.__colonyRelay;
  if (!m || !m.id) return;

  /* 本机打开的 Colony 单文件(file://): 页面里有 colony/petri 或 colony/stem 脚本才算, 告诉后台; 后台只给它连本机 agent 的那几样 */
  if (location.protocol === 'file:' && window === window.top && document.querySelector('script[type="colony/petri"],script[type="colony/stem"],script#stem'))
    m.colonyPage = true;

  if (m.op === 'cancel') { const p = ports.get(m.id); if (p) { try { p.disconnect(); } catch { } ports.delete(m.id); } return; }

  if (m.op === 'stream') {
    let port;
    try { port = chrome.runtime.connect({ name: 'colony-stream' }); }
    catch (e) { window.postMessage({ __colonyRelayChunk: { id: m.id, error: '插件不可用: ' + e.message, done: true } }, '*'); return; }
    ports.set(m.id, port);
    port.onMessage.addListener(x => window.postMessage({ __colonyRelayChunk: { id: m.id, ...x } }, '*'));
    port.onDisconnect.addListener(() => { ports.delete(m.id); window.postMessage({ __colonyRelayChunk: { id: m.id, done: true, disconnected: true } }, '*'); });
    port.postMessage(m);
    return;
  }

  try {
    chrome.runtime.sendMessage(m, (resp) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __colonyRelayResult: { ...(resp || { error: (err && err.message) || '插件后台无应答' }), id: m.id } }, '*');   // id 放最后: 回包里自己带 id(epRemove 等)不能盖掉请求号
    });
  } catch (e) { window.postMessage({ __colonyRelayResult: { id: m.id, error: '插件不可用: ' + e.message } }, '*'); }
});

/* 内嵌浏览器自动继承登录: 本框架是 Colony 内嵌浏览器的页面(name 以 ccb- 开头、不是顶层)时, 让 bg 给本站开登录继承;
   首次开且升了 cookie, bg 回 reload:true → 刷新一次让请求带上登录 */
try {
  if (window !== window.top && String(window.name || '').indexOf('ccb-') === 0 && location.protocol === 'https:') {
    chrome.runtime.sendMessage({ op: 'embedAuto', url: location.href }, (r) => {
      void chrome.runtime.lastError;
      if (r && r.reload) location.reload();
    });
  }
} catch (e) { }

const announce = () => window.postMessage({ __colonyRelayReady: { version: chrome.runtime.getManifest().version } }, '*');
announce();
window.addEventListener('message', (ev) => { if (__mine() && ev.source === window && ev.data && ev.data.__colonyRelayHello) announce(); });
/* 本机成员名单变了(popup 增删改)→ 广播给页面, 让群聊实时同步 */
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.endpoints) window.postMessage({ __colonyRelayEvent: { kind: 'endpoints' } }, '*'); });
})();

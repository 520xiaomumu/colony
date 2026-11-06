/* Colony Bridge 插件 · 后台(MV3 service worker) — 通用浏览器/网络枢纽:
   HTTP(S) 转发、Chrome tabs/CDP RPC、本机端点扫描、通知与自重载。
   产品无关: 能力按 op/method 透传，不为网站或交互写专用分支。 */
try { importScripts('instr.js'); } catch (e) { console.warn('[colony] instr.js 没载入', e); }   // 接入指令(op: instr)

'use strict';

/* 已知 agent/模型端口 + 识别标签(浏览器列不出所有开放端口=安全限制, 故探这批已知的, 用 /v1/models 验真)。
   排除逻辑靠指纹: 系统必开端口/dev server 不会对 /v1/models 回合法模型数组, 天然被滤掉。 */
const PORT_HINTS = {
  18790: 'OpenClaw 系(openclaw/qclaw/kimiclaw/minimaxclaw)', 8642: 'Hermes gateway', 11434: 'Ollama', 1234: 'LM Studio',
  1337: 'Jan', 4000: 'pi-gateway', 4123: 'colony-gateway', 8080: 'Llamafile/通用', 8000: 'vLLM/通用',
  5000: '通用', 3000: '通用 dev', 8787: 'wrangler/通用', 9997: 'Xinference', 5001: '通用',
};
/* 成员初始名: 已知 agent 端口给短名(减少 agent 没自报姓名的认错), 未知端口 → 端口号后缀(见 scan) */
const PORT_NAMES = { 18790: 'openclaw', 8642: 'hermes', 11434: 'ollama', 1234: 'lmstudio', 4123: 'colony-gateway', 1337: 'jan', 4000: 'pi-gateway', 9997: 'xinference' };
const SCAN_PORTS = [18790, 8642, 4000, 4123, 1234, 11434, 1337, 8080, 8000, 5000, 3000, 8787, 11435, 8090, 1235, 4001, 9997, 8001, 5001];

function allowed(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}
const deny = (url) => ({ error: '插件只转发 HTTP/HTTPS 地址, 拒绝: ' + url });

/* 密钥存插件(按端口, 本地明文): 用户在 popup 填, 转发时自动注入 Authorization。
   这样 Colony 页面连端点无需知道 key, 密钥集中在本地枢纽(用户诉求)。 */
async function keyForUrl(url) {
  try { const port = new URL(url).port; const keys = (await chrome.storage.local.get('endpointKeys')).endpointKeys || {}; return keys[port] || ''; }
  catch { return ''; }
}
async function withInjectedAuth(url, headers) {
  const h = { ...(headers || {}) };
  const hasAuth = Object.keys(h).some(k => k.toLowerCase() === 'authorization');
  if (!hasAuth) { const k = await keyForUrl(url); if (k) h['Authorization'] = 'Bearer ' + k; }
  // 会话头镜像: 页面只发 X-Hermes-Session-Id(hermes 认); 同值补一份 x-openclaw-session-key(openclaw 认)→ 两家原生口都按会话隔离记忆, 页面无需知道谁认哪个头
  const sid = Object.entries(h).find(([k]) => k.toLowerCase() === 'x-hermes-session-id');
  if (sid && sid[1] && !Object.keys(h).some(k => k.toLowerCase() === 'x-openclaw-session-key')) h['x-openclaw-session-key'] = sid[1];
  return h;
}

async function doFetch(req) {
  if (!allowed(req.url)) return deny(req.url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), req.timeout || 30000);
  try {
    const headers = await withInjectedAuth(req.url, req.headers);
    /* 二进制请求体: 页面侧 multipart(图编辑/生视频参考图)无法跨 message 传 ArrayBuffer,
       故约定用 bodyB64 传 base64, 这里还原成 Uint8Array 再发 —— 不还原会当成空体,
       上游报 "multipart: NextPart: EOF"(收到了请求但没有内容)。 */
    let sendBody = req.body || undefined;
    if (req.bodyB64) {
      const bin = atob(req.bodyB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      sendBody = u8;
    }
    const res = await fetch(req.url, { method: req.method || 'GET', headers, body: sendBody, signal: ctrl.signal });
    const out = {}; res.headers.forEach((v, k) => { out[k] = v; });
    const ct = res.headers.get('content-type') || '';
    /* 二进制回执: 图/音/视/压缩包等塞进 JS 字符串会被 UTF-8 解码器把非法字节替换成 U+FFFD(必损坏),
       故按 content-type 判定, 非文本一律转 base64 交回, 由调用方组 dataURL。
       调用方也可显式传 req.binary:true 强制走这条(content-type 缺失/撒谎时)。 */
    const isText = /^text\/|json|xml|javascript|x-www-form-urlencoded|event-stream/i.test(ct);
    if (req.binary === true || (req.binary !== false && ct && !isText)) {
      const buf = new Uint8Array(await res.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { ok: true, status: res.status, headers: out, contentType: ct, base64: btoa(s), bytes: buf.length };
    }
    return { ok: true, status: res.status, headers: out, contentType: ct, text: await res.text() };
  } catch (e) { return { error: 'fetch 失败: ' + e.message, fix: '确认端点进程在跑; popup 点「扫描」看有哪些本机端点在。' }; }
  finally { clearTimeout(t); }
}

/* 读本机文件(op: localFile {path}): agent 回的「MEDIA:C:/…/x.png」这类本机路径, 页面自己读不到, 经这里取回 base64。
   只读媒体和常见文档(看扩展名), ≤ 50 MB; 要用户在插件详情页开了「允许访问文件网址」(不开会报错, 叫他去开) */
const LOCAL_FILE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|oga|m4a|aac|flac|opus|pdf|txt|md|csv|json|html?|docx?|xlsx?|pptx?|zip)$/i;
async function localFile(req) {
  let p = String(req.path || '').trim().replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/');
  if (!p || !LOCAL_FILE_EXT.test(p)) return { error: '只读媒体和常见文档: ' + p };
  const url = 'file:///' + p.replace(/^\/+/, '').split('/').map((x, i) => i === 0 && /^[a-z]:$/i.test(x) ? x : encodeURIComponent(decodeURIComponent(x))).join('/');
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 50 * 1024 * 1024) return { error: '文件太大(>50 MB)' };
    let b = '';
    for (let i = 0; i < buf.length; i += 0x8000) b += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { ok: true, base64: btoa(b), bytes: buf.length, name: p.split('/').pop() };
  } catch (e) {
    return { error: '读不了 ' + p + ': ' + e.message, fix: '在 chrome://extensions → Colony Bridge 详情里打开「允许访问文件网址」' };
  }
}

/* 通用浏览器 RPC: tabs.* 动态调用扩展 API; 其它 method 原样直通 CDP。
   calls[] 可在一次 attach 内批量执行，避免为 click/input/network/screenshot 各写一层。 */
/* ── 用户脚本(篡改猴式) ──
   存 chrome.storage.local.userScripts {id: {code, meta, enabled, at}}, 用 chrome.userScripts 注册: 不受页面 CSP 限制、不靠调试器、重启也在。
   要 Chrome 120+, 且用户在 chrome://extensions 本插件「详细信息」里打开「允许用户脚本」(旧版 Chrome 是开发者模式)。
   解析 ==UserScript== 头: @name @namespace @version @match @include @exclude @exclude-match @run-at @grant @noframes; @require 由 bg 拉取后内联。
   GM_* 兼容: 脚本前拼垫片, 存值/跨域请求/开标签/通知/剪贴板经 userScripts 专用消息通道回 bg。 */
const US_KEY = 'userScripts';
const usAll = async () => (await chrome.storage.local.get(US_KEY))[US_KEY] || {};
const usSave = all => chrome.storage.local.set({ [US_KEY]: all });
function usMeta(code) {
  const m = { name: '', namespace: '', version: '', description: '', match: [], include: [], exclude: [], excludeMatch: [], require: [], runAt: 'document_idle', grant: [], noframes: false };
  const blk = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(code);
  if (!blk) return m;
  for (const line of blk[1].split('\n')) {
    const r = /^\s*\/\/\s*@([\w:-]+)\s*(.*?)\s*$/.exec(line); if (!r) continue;
    const k = r[1], v = r[2];
    if (k === 'match') m.match.push(v); else if (k === 'include') m.include.push(v); else if (k === 'exclude') m.exclude.push(v);
    else if (k === 'exclude-match') m.excludeMatch.push(v); else if (k === 'grant') m.grant.push(v); else if (k === 'require') m.require.push(v);
    else if (k === 'noframes') m.noframes = true;
    else if (k === 'run-at') m.runAt = ({ 'document-start': 'document_start', 'document-end': 'document_end', 'document-body': 'document_end' })[v] || 'document_idle';
    else if (k in m && typeof m[k] === 'string') m[k] = v;
  }
  return m;
}
const MATCH_OK = /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^\/*]+|[^\/*]+)\/.*$/;
const usShim = (id, meta, values) => '(function(){"use strict";' +
  'const __id=' + JSON.stringify(id) + ',__meta=' + JSON.stringify(meta) + ';' +
  'const __send=(op,a)=>chrome.runtime.sendMessage({__us:1,id:__id,op,a});' +
  'let __store=' + JSON.stringify(values || {}) + ';' +   // 注册时内联, 同步可读; 写入回存并重注册时更新
  '__send("getAll").then(v=>{if(v)__store=Object.assign({},v,__store)}).catch(()=>{});' +
  'const GM_getValue=(k,d)=>k in __store?__store[k]:d;' +
  'const GM_setValue=(k,v)=>{__store[k]=v;__send("set",{k,v});};' +
  'const GM_deleteValue=k=>{delete __store[k];__send("del",{k});};' +
  'const GM_listValues=()=>Object.keys(__store);' +
  'const GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;(document.head||document.documentElement).appendChild(s);return s};' +
  'const GM_addElement=(p,t,a)=>{if(typeof p==="string"){a=t;t=p;p=document.head||document.documentElement}const e=document.createElement(t);Object.assign(e,a||{});p.appendChild(e);return e};' +
  'const GM_openInTab=(url,o)=>{__send("open",{url,active:!(o&&(o===true||o.active===false))});return {close(){}}};' +
  'const GM_setClipboard=t=>{try{navigator.clipboard.writeText(String(t))}catch(e){__send("clip",{t:String(t)})}};' +
  'const GM_notification=(d,t)=>__send("notify",typeof d==="string"?{text:d,title:t}:d);' +
  'const GM_log=(...a)=>console.log("["+__meta.name+"]",...a);' +
  'const GM_registerMenuCommand=(n,f)=>{(window.__usMenu=window.__usMenu||[]).push([n,f]);return n};const GM_unregisterMenuCommand=()=>{};' +
  'const GM_getResourceText=()=>"";const GM_getResourceURL=()=>"";' +
  'const GM_xmlhttpRequest=d=>{let aborted=false;__send("xhr",{url:d.url,method:d.method||"GET",headers:d.headers||{},data:d.data,responseType:d.responseType||"",timeout:d.timeout||0}).then(r=>{if(aborted)return;if(!r||r.error){d.onerror&&d.onerror({error:r&&r.error});return}' +
  'let response=r.text;if(d.responseType==="json"){try{response=JSON.parse(r.text)}catch(e){response=null}}else if(d.responseType==="arraybuffer"||d.responseType==="blob"){const b=Uint8Array.from(atob(r.base64||""),c=>c.charCodeAt(0));response=d.responseType==="blob"?new Blob([b],{type:r.contentType}):b.buffer}' +
  'const o={status:r.status,statusText:"",responseText:r.text,response,responseHeaders:Object.entries(r.headers||{}).map(([k,v])=>k+": "+v).join("\\r\\n"),finalUrl:r.url||d.url,readyState:4};d.onload&&d.onload(o);d.onloadend&&d.onloadend(o)}).catch(e=>{d.onerror&&d.onerror({error:String(e)})});return {abort(){aborted=true;d.onabort&&d.onabort()}}};' +
  'const GM_info={script:{name:__meta.name,namespace:__meta.namespace,version:__meta.version,description:__meta.description,grant:__meta.grant},scriptHandler:"Colony Bridge",version:"0.5"};' +
  'const unsafeWindow=window;' +
  'const GM={getValue:async(k,d)=>GM_getValue(k,d),setValue:async(k,v)=>GM_setValue(k,v),deleteValue:async k=>GM_deleteValue(k),listValues:async()=>GM_listValues(),addStyle:GM_addStyle,addElement:GM_addElement,openInTab:GM_openInTab,setClipboard:GM_setClipboard,notification:GM_notification,info:GM_info,registerMenuCommand:GM_registerMenuCommand,' +
  'xmlHttpRequest:d=>new Promise((res,rej)=>GM_xmlhttpRequest(Object.assign({},d,{onload:o=>{d.onload&&d.onload(o);res(o)},onerror:e=>{d.onerror&&d.onerror(e);rej(e)}})))};\n';
async function usBuild(id, s) {
  let req = '';
  for (const u of s.meta.require || []) {   // @require: 拉一次缓存在记录里, 之后不再联网
    s.reqCache = s.reqCache || {};
    if (!(u in s.reqCache)) { try { const r = await fetch(u); s.reqCache[u] = r.ok ? await r.text() : ''; } catch (e) { s.reqCache[u] = ''; } }
    req += '\n;' + s.reqCache[u] + '\n';
  }
  return usShim(id, s.meta, s.values) + req + '\n' + s.code + '\n})();';
}
function usReg(id, s, code) {
  const m = s.meta, matches = [], globs = m.include.slice();
  for (const x of m.match) (MATCH_OK.test(x) || x === '<all_urls>' ? matches : globs).push(x);
  if (!matches.length) matches.push('<all_urls>');   // userScripts 必须有 matches; 只给 @include 时全匹配再用 includeGlobs 缩
  const reg = { id, matches, js: [{ code }], runAt: m.runAt, allFrames: !m.noframes, world: 'USER_SCRIPT' };
  if (globs.length) reg.includeGlobs = globs.map(g => g.replace(/^\/(.*)\/$/, '*'));
  if (m.exclude.length) reg.excludeGlobs = m.exclude;
  if (m.excludeMatch.length) reg.excludeMatches = m.excludeMatch.filter(x => MATCH_OK.test(x));
  return reg;
}
async function usSync() {   // 把存的脚本全量重新注册到 chrome.userScripts
  if (!chrome.userScripts) return { error: '没有 chrome.userScripts: 要在 chrome://extensions 本插件详情里打开「允许用户脚本」(旧版 Chrome: 开发者模式), 然后 plugin.reload' };
  try { chrome.userScripts.configureWorld({ messaging: true }); } catch (e) { }
  const all = await usAll();
  try { await chrome.userScripts.unregister(); } catch (e) { }
  const regs = [], bad = [];
  for (const [id, s] of Object.entries(all)) { if (!s.enabled) continue; try { regs.push(usReg(id, s, await usBuild(id, s))); } catch (e) { bad.push(id + ': ' + e.message); } }
  await usSave(all);   // 存下 @require 缓存
  if (regs.length) { try { await chrome.userScripts.register(regs); } catch (e) { return { error: '注册失败: ' + e.message, bad }; } }
  return { ok: true, registered: regs.length, bad };
}
let usT = 0; const usResync = () => { clearTimeout(usT); usT = setTimeout(() => usSync().catch(() => {}), 300); };
async function userScriptOp(m0) {
  const m = Object.assign({}, m0, { id: m0.sid });   // m0.id 是通道消息 id, 脚本 id 用 sid
  const all = await usAll();
  if (m.action === 'list') return { ok: true, available: !!chrome.userScripts, scripts: Object.entries(all).map(([id, s]) => ({ id, name: s.meta.name, enabled: s.enabled, match: s.meta.match.concat(s.meta.include), runAt: s.meta.runAt, at: s.at, bytes: s.code.length })) };
  if (m.action === 'get') { const s = all[m.id]; return s ? { ok: true, sid: m.id, code: s.code, meta: s.meta, enabled: s.enabled, values: s.values || {} } : { error: '没有脚本 ' + m.id }; }
  if (m.action === 'install') {
    let code = m.code;
    if (!code && m.url) { const r = await fetch(m.url); if (!r.ok) return { error: 'HTTP ' + r.status + ' ' + m.url }; code = await r.text(); }
    if (!code) return { error: 'install 要 code 或 url' };
    const meta = usMeta(code);
    const id = m.id || ('us-' + ((meta.namespace || '') + '/' + (meta.name || 'script')).replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 60));
    const old = all[id];
    all[id] = { code, meta, enabled: m.enabled !== false, at: Date.now(), values: old ? old.values : {}, source: m.url || (old && old.source) || '' };
    await usSave(all);
    return Object.assign({ sid: id, name: meta.name, match: meta.match.concat(meta.include), updated: !!old }, await usSync());
  }
  if (m.action === 'enable' || m.action === 'disable') { if (!all[m.id]) return { error: '没有脚本 ' + m.id }; all[m.id].enabled = m.action === 'enable'; await usSave(all); return usSync(); }
  if (m.action === 'remove') { delete all[m.id]; await usSave(all); return usSync(); }
  if (m.action === 'sync') return usSync();
  return { error: 'userScript action: list | get | install {code|url} | enable | disable | remove | sync' };
}
// 用户脚本里 GM_* 发来的消息(只收 userScripts 世界的, 跟 Colony 页面的通道分开)
if (chrome.runtime.onUserScriptMessage) chrome.runtime.onUserScriptMessage.addListener((msg, sender, send) => {
  if (!msg || !msg.__us) return;
  (async () => {
    const all = await usAll(), s = all[msg.id]; if (!s) return send(null);
    const a = msg.a || {};
    if (msg.op === 'getAll') return send(s.values || {});
    if (msg.op === 'set') { s.values = s.values || {}; s.values[a.k] = a.v; await usSave(all); usResync(); return send(true); }
    if (msg.op === 'del') { if (s.values) delete s.values[a.k]; await usSave(all); usResync(); return send(true); }
    if (msg.op === 'open') { await chrome.tabs.create({ url: a.url, active: a.active !== false, openerTabId: sender.tab && sender.tab.id }); return send(true); }
    if (msg.op === 'notify') { chrome.notifications.create({ type: 'basic', iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', title: a.title || s.meta.name || 'Colony', message: String(a.text || '') }); return send(true); }
    if (msg.op === 'xhr') {   // 跨域请求: 由插件发, 带用户 cookie
      try {
        const ctl = new AbortController(); const t = a.timeout ? setTimeout(() => ctl.abort(), a.timeout) : null;
        const r = await fetch(a.url, { method: a.method, headers: a.headers, body: a.data, credentials: 'include', signal: ctl.signal }); if (t) clearTimeout(t);
        const headers = {}; r.headers.forEach((v, k) => headers[k] = v);
        const bin = a.responseType === 'arraybuffer' || a.responseType === 'blob';
        if (bin) { const b = new Uint8Array(await r.arrayBuffer()); let s2 = ''; for (let i = 0; i < b.length; i += 32768) s2 += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return send({ status: r.status, headers, url: r.url, contentType: headers['content-type'], base64: btoa(s2) }); }
        return send({ status: r.status, headers, url: r.url, text: await r.text() });
      } catch (e) { return send({ error: String(e && e.message || e) }); }
    }
    send(null);
  })();
  return true;
});
chrome.runtime.onInstalled.addListener(() => { usSync().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { usSync().catch(() => {}); });

/* 免授权: 把 Colony 站点(及内嵌浏览器里用的站)的麦克风/摄像头/通知/剪贴板设为「允许」, 以后不再弹窗。
   录屏(getDisplayMedia)浏览器强制每次让用户选屏, 扩展改不了; 免点录 Colony 这一页见下面 recStart。 */
const MEDIA_KINDS = ['microphone', 'camera', 'notifications', 'automaticDownloads', 'popups'];
async function mediaAllow(m) {
  if (!chrome.contentSettings) return { error: '没有 contentSettings 权限' };
  const origins = [].concat(m.origins || ['https://colonyai.fun']);
  const kinds = [].concat(m.kinds || ['microphone', 'camera', 'notifications', 'automaticDownloads', 'popups']);
  const setting = m.on === false ? 'ask' : 'allow', out = {};
  for (const o of origins) {
    const pattern = o.replace(/\/+$/, '') + '/*';
    for (const k of kinds) {
      const cs = chrome.contentSettings[k]; if (!cs) { out[k] = '不支持'; continue; }
      try { await cs.set({ primaryPattern: pattern, setting: m.on === false ? (k === 'popups' ? 'block' : 'ask') : 'allow' }); out[o + ' ' + k] = setting; }
      catch (e) { out[o + ' ' + k] = 'ERR ' + e.message; }
    }
  }
  await chrome.storage.local.set({ mediaAllow: { on: m.on !== false, origins, kinds, at: Date.now() } });
  return { ok: true, result: out };
}
async function mediaState(m) {
  const origin = (m && m.origin) || 'https://colonyai.fun/', out = {};
  for (const k of MEDIA_KINDS) { const cs = chrome.contentSettings && chrome.contentSettings[k]; if (!cs) continue; try { out[k] = (await cs.get({ primaryUrl: origin })).setting; } catch (e) { out[k] = 'ERR'; } }
  return { ok: true, origin, settings: out, saved: (await chrome.storage.local.get('mediaAllow')).mediaAllow || null };
}


/* ── 免点录屏(整个在插件里): 调试接口抓某个标签页的帧(Page.startScreencast, 只对前台页有画面),
   直接转给后台录屏页(offscreen.html)画布录成 webm。帧不进事件缓冲、不经 Colony 页面, 不跟别的命令抢通道。
   op recStart {tabId?(不给=发起的页), fps?, maxWidth?} / recStop → {dataUrl, sec, fps, bytes} / recStatus */
const REC = { tab: null, fps: 15, lastAck: 0, frames: 0 };
async function recEnsureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Colony 免点录屏: 画布录制调试接口抓到的帧' });
}
const recSend = (m) => chrome.runtime.sendMessage(Object.assign({ to: 'offscreen-rec' }, m));
chrome.debugger.onEvent.addListener((src, method, params) => {
  if (method !== 'Page.screencastFrame' || REC.tab == null || src.tabId !== REC.tab) return;
  REC.frames++;
  recSend({ op: 'frame', data: params.data }).catch(() => {});
  const gap = 1000 / REC.fps, wait = Math.max(0, REC.lastAck + gap - Date.now());   // 按帧率确认, 浏览器才发下一帧
  setTimeout(() => { REC.lastAck = Date.now(); chrome.debugger.sendCommand(src, 'Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {}); }, wait);
});
async function recStart(m, sender) {
  if (REC.tab != null) return { error: '正在录, 先 recStop' };
  const tab = m.tabId || (sender && sender.tab && sender.tab.id);
  if (!tab) return { error: '不知道录哪个标签页' };
  const info = await chrome.tabs.get(tab);
  // 默认按页面原尺寸录(缩小会让字发糊); 要省体积再给 maxWidth
  const w = Math.min(m.maxWidth || 3840, info.width || 1920), h = Math.round(w * (info.height || 1080) / (info.width || 1920));
  await recEnsureOffscreen();
  const st = await recSend({ op: 'start', w, h, fps: m.fps || 15, bps: m.bps || 12e6 });
  if (!st || st.error) return { error: '录屏页没起来: ' + (st && st.error) };
  Object.assign(REC, { tab, fps: m.fps || 15, lastAck: 0, frames: 0 });
  const target = { tabId: tab };
  await dbgAttach(target);
  await chrome.debugger.sendCommand(target, 'Page.enable', {});
  await chrome.debugger.sendCommand(target, 'Page.startScreencast', { format: 'jpeg', quality: m.quality || 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  REC.keep = setInterval(() => dbgBump(target), 10000);   // 录屏期间别让调试器闲置卸下
  return { ok: true, tabId: tab, size: w + 'x' + h, mimeType: st.mimeType };
}
async function recStop() {
  if (REC.tab == null) return { error: '没在录' };
  const target = { tabId: REC.tab }; REC.tab = null; clearInterval(REC.keep);
  try { await chrome.debugger.sendCommand(target, 'Page.stopScreencast', {}); } catch (e) { }
  const r = await recSend({ op: 'stop' });
  return r && r.ok ? Object.assign(r, { received: REC.frames }) : { error: '收不到视频: ' + (r && r.error) };
}

/* 通用扩展 API 透传 {method:'scripting.registerContentScripts', args:[...]}: 只放行 manifest 里有权限的命名空间。
   executeScript 的 func 不能跨消息传, 约定给 code 字符串, 这里包成函数在页面里 eval。 */
const EXT_NS = ['contentSettings', 'scripting', 'cookies', 'tabs', 'windows', 'storage', 'notifications', 'declarativeNetRequest', 'debugger', 'action', 'runtime', 'permissions', 'management', 'downloads', 'history', 'bookmarks', 'userScripts', 'tabGroups', 'sessions', 'contextMenus', 'alarms', 'offscreen', 'sidePanel', 'webNavigation'];
async function extCall(req) {
  const parts = String(req.method || '').split('.'), fnName = parts.pop();
  if (!EXT_NS.includes(parts[0])) throw new Error('不放行的命名空间: ' + parts[0]);
  let obj = chrome; for (const p of parts) { obj = obj && obj[p]; }
  if (!obj) throw new Error('chrome.' + parts.join('.') + ' 不存在(多半是 manifest 没这个权限)');
  const fn = obj[fnName]; if (typeof fn !== 'function') throw new Error('chrome.' + req.method + ' 不是函数');
  let args = req.args || [];
  if (req.method === 'scripting.executeScript' && args[0] && typeof args[0].code === 'string') {
    const { code, ...rest } = args[0];
    // MAIN world 里 eval 受页面 CSP 管(严格 CSP 的站会拒): 拒了就改走 CDP Runtime.evaluate(不受 CSP)
    args = [Object.assign(rest, { func: (c) => { try { return (0, eval)(c); } catch (e) { return { __evalError: String(e && e.message || e) }; } }, args: [code] })];
  }
  return { ok: true, result: await fn.apply(obj, args) };
}

async function browserCall(req) {
  req = req || {};
  if (req.method === 'debugger.getTargets') {
    return { ok: true, result: await chrome.debugger.getTargets() };
  }
  if (String(req.method || '').startsWith('tabs.')) {
    const name = req.method.slice(5), fn = chrome.tabs[name];
    if (typeof fn !== 'function') throw new Error('未知 tabs 方法: ' + name);
    return { ok: true, result: await fn.apply(chrome.tabs, Array.isArray(req.args) ? req.args : []) };
  }
  let tabId = req.tabId;
  if (tabId == null && !req.targetId) {
    const a = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = a[0] && a[0].id;
  }
  if (tabId == null && !req.targetId) throw new Error('需要 tabId 或 targetId');
  const target = req.targetId ? { targetId: req.targetId } : { tabId };
  await dbgAttach(target);
  if (req.listen !== undefined) {   // listen:false 停收集并清空; 数组/true 开始收集
    const k = dbgKey(target);
    if (req.listen === false) EVT.delete(k);
    else { const e = EVT.get(k) || { buf: [], seq: 0 }; e.subs = req.listen === true ? [] : [].concat(req.listen); EVT.set(k, e); }
  }
  const calls = req.calls || [{ method: req.method, params: req.params || {} }], out = [], limit = req.timeout || 15000;
  try {
    for (const c of calls) {
      let timer;
      try { out.push(await Promise.race([chrome.debugger.sendCommand(target, c.method, c.params || {}), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('CDP 超时: ' + c.method)), limit); })])); }
      finally { clearTimeout(timer); }
    }
  } catch (e) {
    if (/超时|not attached|Detached/i.test(String(e && e.message))) dbgDrop(target, true);   // 卡住或掉线: 卸下, 下次重挂
    throw e;
  }
  dbgBump(target);
  return { ok: true, tabId, result: req.calls ? out : out[0] };
}

/* 调试器常驻: 同一目标挂上后留着, 闲 30 秒才卸(每条命令都挂/卸太慢, 浏览器顶上的提示条也会一直闪) */
const DBG = new Map();
const dbgKey = t => t.targetId ? 'g:' + t.targetId : 't:' + t.tabId;
function dbgBump(t) {
  const k = dbgKey(t), e = DBG.get(k); if (!e) return;
  clearTimeout(e.timer); e.timer = setTimeout(() => dbgDrop(t, true), 30000);
}
function dbgDrop(t, detach) {
  const k = dbgKey(t), e = DBG.get(k); if (!e) return;
  clearTimeout(e.timer); DBG.delete(k);
  if (detach) chrome.debugger.detach(t).catch(() => {});
}
async function dbgAttach(t) {
  if (DBG.has(dbgKey(t))) { dbgBump(t); return; }
  try { await chrome.debugger.attach(t, '1.3'); }
  catch (e) { if (!/already attached/i.test(String(e && e.message))) throw e; }
  DBG.set(dbgKey(t), { timer: null }); dbgBump(t);
}
/* CDP 事件回传: 插件只能把浏览器事件缓冲起来等页面来拉(不能主动推)。
   browser 调用带 listen:['Network.','Runtime.consoleAPICalled'...](前缀或全名, true=全部)就开始收集该目标的事件;
   browserEvents {tabId|targetId, since, method?, clear?} 拉取缓冲 → {events:[{seq,t,method,params}], next}。
   被动监听(Network/Console/Log/Target)安全; 主动拦截(Fetch.requestPaused)仍要调用方在事件后回 continueRequest, 否则页面悬住。 */
const EVT = new Map();
const evtMatch = (subs, method) => !subs || !subs.length || subs.some(s => s === method || (s.slice(-1) === '.' ? method.indexOf(s) === 0 : method.indexOf(s + '.') === 0));
chrome.debugger.onEvent.addListener((src, method, params) => {
  const k = src.targetId ? 'g:' + src.targetId : (src.tabId != null ? 't:' + src.tabId : null);
  if (!k) return;
  const e = EVT.get(k); if (!e || !evtMatch(e.subs, method)) return;
  e.buf.push({ seq: ++e.seq, t: Date.now(), method, params });
  if (e.buf.length > 3000) { e.buf.splice(0, e.buf.length - 3000); e.dropped = true; }
});

chrome.debugger.onDetach.addListener(src => {
  if (src.targetId) { DBG.delete('g:' + src.targetId); EVT.delete('g:' + src.targetId); }
  if (src.tabId != null) { DBG.delete('t:' + src.tabId); EVT.delete('t:' + src.tabId); }
});

/* /v1/models 指纹: 必须是含模型数组的合法 JSON(教训: 有些控制台对任意路径回 200 空壳) */
function modelsFingerprint(text) {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : null));
    return arr ? arr.map(m => m.id || m.name || String(m)).slice(0, 20) : null;
  } catch { return null; }
}

async function probe(base) {
  const url = base.replace(/\/+$/, '') + '/v1/models';
  try {
    const headers = await withInjectedAuth(url, {}); // 有存的 key 就带上 → 扫描直接显示 ok(不再停在"要key")
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(url, { headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    const text = await res.text();
    const models = modelsFingerprint(text);
    const gw = /"owned_by"\s*:\s*"(colony-gateway|hermes|openclaw)/i.test(text); // 自报=认会话头保记忆(乙): hermes→X-Hermes-Session-Id, openclaw→x-openclaw-session-key(插件relay补), colony-gateway→--resume
    if (res.status === 200 && models) return { state: 'ok', models, gw };
    if (res.status === 401 || res.status === 403) return { state: 'auth' };
    return { state: 'running' }; // 端口有服务但不是合法 OpenAI 端点
  } catch { return { state: 'down' }; }
}

/* 广扫: 并行探已知端口 + 自定义端口。排除逻辑 —
   ok/auth → 真模型端点, 报为候选; 已知 agent 端口但没开 OpenAI 面 → 报为"待开启"(给教学卡);
   未知端口有服务但非模型端点 → 纯噪音, 只计数不显(排除电脑上一堆必开端口)。 */
async function scan() {
  const custom = (await chrome.storage.local.get('customPorts')).customPorts || [];
  const ports = [...new Set(SCAN_PORTS.concat(custom))];
  const found = []; let otherCount = 0;
  await Promise.all(ports.map(async (port) => {
    const base = 'http://127.0.0.1:' + port;
    const r = await probe(base);
    if (r.state === 'ok') found.push({ port, base, state: 'ok', hint: PORT_HINTS[port] || 'OpenAI 兼容端点', name: PORT_NAMES[port] || String(port), models: r.models });
    else if (r.state === 'auth') found.push({ port, base, state: 'auth', hint: PORT_HINTS[port] || 'OpenAI 兼容端点', name: PORT_NAMES[port] || String(port) });
    else if (r.state === 'running') {
      if (PORT_HINTS[port]) found.push({ port, base, state: 'needs-enable', hint: PORT_HINTS[port] }); // 已知 agent, 端口在但 OpenAI 面没开 → 教学
      else otherCount++; // 未知噪音端口 → 排除
    }
  }));
  found.sort((a, b) => a.port - b.port);
  return { found, otherCount };
}

/* ── 本机成员名单(方案乙: 本机 agent 连接管理归插件, 存 chrome.storage 'endpoints'; 页面经 relay 拉取注入群聊) ── */
const PORT_MEMORY = { 4123: 'stateful', 8642: 'stateful' }; // 已知认 X-Hermes-Session-Id 保记忆的端口(colony-gateway 默认 / hermes)
const memoryOf = (port, gw) => (PORT_MEMORY[port] || gw) ? 'stateful' : 'stateless'; // 裸端点默认每轮独立(乙: 如实标不保记忆)
const portOf = base => { try { return +(new URL(base).port) || 0; } catch { return 0; } };
async function epList() { return (await chrome.storage.local.get('endpoints')).endpoints || []; }
async function epSave(a) { await chrome.storage.local.set({ endpoints: a }); }
async function epRoster() { // 逐端点活探 → 页面注入群聊用
  const arr = await epList();
  return Promise.all(arr.map(async e => {
    const r = await probe(e.base);
    // 一个地址可以有几个 model(Colony 网关同时包 claude、codex): 该 model 不在了也算不在线
    const 在 = (r.state === 'ok' && (!e.model || !r.models || r.models.includes(e.model))) || r.state === 'auth';
    return { id: e.id, name: e.name, base: e.base, model: e.model || (r.models && r.models[0]) || '', memory: e.memory || memoryOf(portOf(e.base), r.gw), online: 在, needsKey: r.state === 'auth', renamedTo: e.renamedTo || null, allowSDK: !!e.allowSDK }; // allowSDK: 页面 Brain.records 映射成 allowMiniAppSDK(miniapp 经 colony.ai.chat 调此 agent 的权限闸)
  }));
}
async function epAdd({ base, name, key, model }) {
  base = String(base || '').replace(/\/+$/, ''); if (!base) return { error: '缺 base' };
  const port = portOf(base); const arr = await epList();
  if (key) { const ks = (await chrome.storage.local.get('endpointKeys')).endpointKeys || {}; ks[String(port)] = key; await chrome.storage.local.set({ endpointKeys: ks }); }
  const r = await probe(base); const memory = memoryOf(port, r.gw); const ms = r.models || [];
  // Colony 网关一个地址包几个 CLI: 不指定 model 就每个 model 各加一位(名字就是 model); 指定了就只加那个。同地址同 model 才算同一位
  const 要 = model ? [model] : (r.gw && ms.length > 1 ? ms : [ms[0] || '']);
  const ids = [];
  for (const md of 要) {
    let e = arr.find(x => x.base === base && (!md || !x.model || x.model === md));
    const nm = name && 要.length === 1 ? name : (要.length > 1 ? md : name || (port ? String(port) : base));
    if (e) { if (name || 要.length > 1) e.name = nm; e.model = md || e.model; e.memory = memory; }
    else { e = { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)).slice(0, 8), name: nm, base, model: md, memory, addedAt: Date.now() }; arr.push(e); }
    ids.push(e.id);
  }
  await epSave(arr); return { ok: true, id: ids[0], ids };
}
async function epRemove(id) { await epSave((await epList()).filter(x => x.id !== id)); return { ok: true }; }
async function epRename(id, name) { const a = await epList(); const e = a.find(x => x.id === id); if (e) { e.name = name; e.renamedTo = name; } await epSave(a); return { ok: true }; } // renamedTo=一次性标志, 页面下轮注入"你现在叫X"给 agent
async function epUpdate(id, patch) { const a = await epList(); const e = a.find(x => x.id === id); if (e) Object.assign(e, patch || {}); await epSave(a); return { ok: true }; }
async function epClearRename(id) { const a = await epList(); const e = a.find(x => x.id === id); if (e) delete e.renamedTo; await epSave(a); return { ok: true }; }


/* 重载自愈: service worker 每次启动后, 把 cs.js 重新注入所有已打开标签。
   MV3 里扩展一 reload, 各页面原有 content script 立即成孤儿(连不回 bg), 而修复通道本身也走那座断桥 —
   于是只能靠用户手动刷新。这里由扩展侧主动补注入, 页面无感恢复。已有 cs 的页面会重复注入,
   故 cs.js 里用 __colonyRelayInjected 自守, 重复执行不叠监听。 */
async function reinjectAll() {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }); } catch (e) { return; }
  await Promise.all(tabs.map(async t => {
    if (t.id == null) return;
    try { await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: false }, files: ["cs.js"] }); } catch (e) { }
  }));
}
reinjectAll();
function trustedSender(sender) {
  try {
    const u = new URL(sender.url || '');
    if (sender.id === chrome.runtime.id && u.protocol === 'chrome-extension:' && u.hostname === chrome.runtime.id) return true;
    return u.protocol === 'https:' && u.hostname === 'colonyai.fun';
  } catch { return false; }
}
/* 本机打开的 Colony 单文件(file://, 如单独导出的 agent 桥接): 只给「连本机 agent」那几样 ——
   转发(只转 127.0.0.1/localhost, 见 localOnly)、扫描、成员名单、存 Key; 浏览器控制、chrome.*、录屏、用户脚本这些高权的照旧只给 colonyai.fun。
   要求: 顶层标签页(不是别人页面里嵌的框), 且页面自己声明是 Colony(cs.js 看到 colony/petri 或 colony/stem 脚本才带 colonyPage) */
const LOCAL_FILE_OPS = new Set(['ping', 'fetch', 'localFile', 'instr', 'scan', 'setkey', 'epRoster', 'epAdd', 'epList', 'epRemove', 'epRename', 'epClearRename', 'epUpdate', 'notify']);
function localColonyFile(sender, m) {
  try {
    const u = new URL(sender.url || '');
    return u.protocol === 'file:' && sender.frameId === 0 && !!(m && m.colonyPage) && /\.html?$/i.test(u.pathname);
  } catch { return false; }
}
const localOnly = (url) => { try { const h = new URL(url).hostname; return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'; } catch { return false; } };
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (m && m.op === 'embedAuto' && sender && sender.frameId !== 0 && sender.tab && /^https:\/\/colonyai\.fun\//.test(sender.tab.url || '')) {
    // 只认: 嵌在 Colony 标签页里的子框架(不是顶层页面), 才能让自己所在站点开登录继承
    embedAuto(m, sender).then(sendResponse, e => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
  const 本机文件 = !trustedSender(sender) && localColonyFile(sender, m);
  if (!trustedSender(sender) && !本机文件) {
    sendResponse({ error: '拒绝非 Colony 页面调用插件权限' });
    return false;
  }
  if (本机文件 && (!LOCAL_FILE_OPS.has(m.op) || (m.op === 'fetch' && !localOnly((m.req || {}).url)))) {
    sendResponse({ error: '本机打开的 Colony 文件只能连本机 agent(' + m.op + ' 要在 colonyai.fun 上用)' });
    return false;
  }
  (async () => {
    try {
      if (m.op === 'ping') return sendResponse({ ok: true, plugin: 'colony-bridge', version: chrome.runtime.getManifest().version, build: 'generic-rpc-1' });
      if (m.op === 'fetch') return sendResponse(await doFetch(m.req || {}));
      if (m.op === 'localFile') return sendResponse(await localFile(m.req || {}));
      if (m.op === 'instr') { // 接入指令: Colony agent 桥接的「接入」页从这里拿, 不自己写一份
        try { const k = (m.req || {}).kind; return sendResponse({ ok: true, cloud: CLOUD_BRIDGE, text: k ? await colonyInstrBundle(k) : undefined }); }
        catch (e) { return sendResponse({ error: '指令没取到: ' + e.message }); } }
      if (m.op === 'browser') return sendResponse(await browserCall(m.req || {}));
      if (m.op === 'ext') return sendResponse(await extCall(m.req || {}));   // 通用 chrome.* 透传(白名单)
      if (m.op === 'recStart') return sendResponse(await recStart(m, sender));   // 免点录屏(插件里录)
      if (m.op === 'recStop') return sendResponse(await recStop());
      if (m.op === 'recStatus') return sendResponse({ ok: true, recording: REC.tab != null, tabId: REC.tab, received: REC.frames });
      if (m.op === 'mediaAllow') return sendResponse(await mediaAllow(m));   // {origins?, kinds?, on?:false} 站点免授权
      if (m.op === 'mediaState') return sendResponse(await mediaState(m));
      if (m.op === 'userScript') return sendResponse(await userScriptOp(m));   // 篡改猴式用户脚本: list|get|install|enable|disable|remove|sync
      if (m.op === 'browserEvents') {   // 拉取缓冲的 CDP 事件
        const k = m.targetId ? 'g:' + m.targetId : 't:' + m.tabId;
        const e = EVT.get(k);
        if (!e) return sendResponse({ ok: true, events: [], next: 0, note: '该目标没在收集: 先 browser 调用时带 listen' });
        const since = m.since || 0, mf = m.method ? [].concat(m.method) : null;
        const events = e.buf.filter(x => x.seq > since && (!mf || evtMatch(mf, x.method)));
        const next = e.seq, dropped = e.dropped; if (m.clear) { e.buf = []; e.dropped = false; }
        return sendResponse({ ok: true, events, next, dropped: !!dropped });
      }
      if (m.op === 'scan') return sendResponse({ ok: true, ...(await scan()) });
      if (m.op === 'setkey') { // {port, key} 存/删端点密钥(空 key = 删)
        const keys = (await chrome.storage.local.get('endpointKeys')).endpointKeys || {};
        if (m.key) keys[String(m.port)] = m.key; else delete keys[String(m.port)];
        await chrome.storage.local.set({ endpointKeys: keys });
        return sendResponse({ ok: true });
      }
      if (m.op === 'notify') {
        const on = (await chrome.storage.local.get('notify')).notify !== false;
        if (on) { try { chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: m.title || 'Colony', message: m.message || '' }); } catch (e) { } }
        return sendResponse({ ok: true, shown: on });
      }
      if (m.op === 'embedSite') return sendResponse(await embedSite(m));   // {host|url, on?:false} 让这站在内嵌浏览器里带登录 / 还原
      if (m.op === 'embedSites') return sendResponse({ ok: true, sites: Object.keys(await embedSites()) });
      if (m.op === 'cookieRule') {   // 内嵌浏览器打开网页前调这条: 把该域真实 cookie 写进子框架请求头(破 SameSite=Lax 跨站不发)
        if (!m.url) return sendResponse({ error: 'cookieRule 需要 {url}' });
        if (!allowed(m.url)) return sendResponse(deny(m.url));
        return sendResponse(await ensureCookieRule(m.url));
      }
      if (m.op === 'reload') { sendResponse({ ok: true }); chrome.runtime.reload(); return; }
      if (m.op === 'epRoster') return sendResponse({ ok: true, roster: await epRoster() });
      if (m.op === 'epAdd') return sendResponse(await epAdd(m));
      if (m.op === 'epRemove') return sendResponse(await epRemove(m.id));
      if (m.op === 'epRename') return sendResponse(await epRename(m.id, m.name));
      if (m.op === 'epUpdate') return sendResponse(await epUpdate(m.id, m.patch));
      if (m.op === 'epClearRename') return sendResponse(await epClearRename(m.id));
      sendResponse({ error: '未知 op: ' + m.op, fix: '可用: ping | fetch | browser | embedSite | embedSites | cookieRule | scan | setkey | notify | reload | stream | epRoster | epAdd | epRemove | epRename | epUpdate | epClearRename' });
    } catch (e) { sendResponse({ error: e.message }); }
  })();
  return true; // 异步应答
});

/* ── 跨站 cookie 注入(内嵌浏览器用) ──
   为什么必须有: 登录 cookie 默认 SameSite=Lax, 浏览器判"站点关系"而非 iframe 层级/origin 合法性 —
   Colony(colonyai.fun) 里嵌 github.com/x.com 属跨站, Lax cookie 一律不发送 → 站点视你为游客。
   declarativeNetRequest 只能改头、改不了 cookie 归属判定, 所以唯一通用解: 用 cookies API 读真实
   cookie, 再以动态规则把它写进子框架请求的 Cookie 头。不分站点、不设白名单 —— 对一切站点同一条路。
   作用域严格限定: resourceTypes 只含 sub_frame, initiatorDomains 只含 colonyai.fun,
   即仅 Colony 内嵌的网页受影响; 用户自己在真实标签页的浏览行为完全不碰。 */
const CK_RULE_BASE = 9000;   // 动态规则 id 段, 与静态 rules.json(1..3) 不冲突
const ckCache = new Map();   // host → {header, at} 短缓存, 免每帧都查一遍 cookie 库

async function cookieHeaderFor(url) {
  const u = new URL(url);
  const all = await chrome.cookies.getAll({ domain: u.hostname });
  if (!all.length) return '';
  /* 只取该 URL 真正该带的: 域匹配(含父域 .example.com)、路径前缀、secure 与协议一致。
     不做 SameSite 过滤 —— 正是为了突破 Lax 才有本函数。 */
  const secure = u.protocol === 'https:';
  const ok = all.filter(c => {
    if (c.secure && !secure) return false;
    const d = c.domain.replace(/^\./, '');
    if (!(u.hostname === d || u.hostname.endsWith('.' + d))) return false;
    return u.pathname.startsWith(c.path || '/');
  });
  if (!ok.length) return '';
  const seen = new Set(), parts = [];
  for (const c of ok.sort((a, b) => (b.path || '').length - (a.path || '').length)) {   // 路径长者优先, 同名去重
    if (seen.has(c.name)) continue;
    seen.add(c.name); parts.push(c.name + '=' + c.value);
  }
  return parts.join('; ');
}

async function ensureCookieRule(url) {
  const u = new URL(url);
  const host = u.hostname;
  const hit = ckCache.get(host);
  if (hit && Date.now() - hit.at < 20000) return { ok: true, cached: true, host, bytes: hit.header.length };
  const header = await cookieHeaderFor(url);
  if (!header) { ckCache.set(host, { header: '', at: Date.now() }); return { ok: true, host, bytes: 0, note: '该域无 cookie(未登录过)' }; }
  let h = 0; for (let i = 0; i < host.length; i++) h = ((h << 5) - h + host.charCodeAt(i)) | 0;
  const id = CK_RULE_BASE + (Math.abs(h) % 900);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id, priority: 20,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'set', value: header }] },
      condition: { requestDomains: [host], resourceTypes: ['sub_frame'], initiatorDomains: ['colonyai.fun'] },
    }],
  });
  ckCache.set(host, { header, at: Date.now() });
  return { ok: true, host, bytes: header.length, ruleId: id };
}

/* ── 内嵌浏览器登录继承: 把选定站点的 cookie 升成 SameSite=None; Secure, 嵌在 Colony 里的 iframe 才带得上登录。
   站点名单存 chrome.storage.local.embedSites {base: {at, orig:{键: 原 sameSite}}}; 网站之后再发的新 cookie 由 onChanged 自动再升。
   还原: embedSite {host, on:false} 把记下的原 sameSite 写回。只动 https 站点的 cookie(None 必须带 Secure)。 */
// 注册域: 一般取最后两段; 像 asahi.co.jp / bbc.co.uk / gov.cn 这种「二级后缀」要取三段, 否则会把整个 co.jp 的 cookie 都改了
const SLD = /^(co|com|net|org|gov|edu|ac|go|or|ne|ed|lg|gr|ad|mil|nic|ltd|plc|sch|nom)$/;
const embedBase = (host) => { const p = String(host || '').replace(/^\.+/, '').split('.'); if (p.length <= 2) return p.join('.'); const n = (p.length >= 3 && p[p.length - 1].length === 2 && SLD.test(p[p.length - 2])) ? 3 : 2; return p.slice(-n).join('.'); };
const ckKey = (c) => c.name + '|' + c.domain + '|' + c.path + '|' + (c.partitionKey ? JSON.stringify(c.partitionKey) : '');
async function embedSites() { return (await chrome.storage.local.get('embedSites')).embedSites || {}; }
async function setSameSite(c, sameSite) {
  const d = c.domain.replace(/^\./, '');
  const det = { url: 'https://' + d + c.path, name: c.name, value: c.value, path: c.path, secure: sameSite === 'no_restriction' ? true : c.secure,
    httpOnly: c.httpOnly, sameSite, storeId: c.storeId };
  if (!c.hostOnly) det.domain = c.domain;
  if (!c.session && c.expirationDate) det.expirationDate = c.expirationDate;
  if (c.partitionKey) det.partitionKey = c.partitionKey;
  return chrome.cookies.set(det);
}
let embedBusy = false;
async function upgradeSite(base, rec) {
  const all = await chrome.cookies.getAll({ domain: base });
  let n = 0;
  for (const c of all) {
    if (c.sameSite === 'no_restriction' || c.partitionKey) continue;
    if (!c.secure && !/^__/.test(c.name)) { /* 非 Secure 的也升: None 必须 Secure, 页面都是 https */ }
    const k = ckKey(c); if (!(k in rec.orig)) rec.orig[k] = c.sameSite;
    try { await setSameSite(c, 'no_restriction'); n++; } catch (e) { }
  }
  return n;
}
async function embedSite(m) {
  const base = embedBase(m.host || (m.url ? new URL(m.url).hostname : ''));
  if (!base) return { error: 'embedSite 要 {host} 或 {url}' };
  const sites = await embedSites();
  embedBusy = true;
  try {
    if (m.on === false) {
      const rec = sites[base]; if (!rec) return { ok: true, base, note: '本来就没开' };
      delete sites[base]; await chrome.storage.local.set({ embedSites: sites });
      let n = 0;
      for (const c of await chrome.cookies.getAll({ domain: base })) {
        const o = rec.orig[ckKey(c)]; if (o && o !== c.sameSite) { try { await setSameSite(c, o); n++; } catch (e) { } }
      }
      return { ok: true, base, restored: n };
    }
    const rec = sites[base] || { at: Date.now(), orig: {} };
    const n = await upgradeSite(base, rec);
    sites[base] = rec; await chrome.storage.local.set({ embedSites: sites });
    return { ok: true, base, upgraded: n, total: Object.keys(rec.orig).length };
  } finally { embedBusy = false; }
}
/* ── 内嵌浏览器自动继承登录: Colony 内嵌浏览器(window.name 以 ccb- 开头)的页面一打开, iframe-hook 就发 embedAuto,
   这里自动给该站开 embedSite(升 SameSite=None), 不用逐站手开。按"注册域"(最后两段)算, 一个站开一次。
   页面若刚因没带登录而落在登录页, 升完回 {reload:true} 让 hook 刷新一次; 同站 60 秒内只刷一次, 防死循环。 */
const autoReloaded = new Map();
async function embedAuto(m, sender) {
  const url = m.url || (sender && sender.url) || '';
  let host; try { host = new URL(url).hostname; } catch { return { error: 'embedAuto 要 url' }; }
  if (!/^https:/.test(url)) return { ok: true, skip: '只处理 https' };
  const base = embedBase(host), sites = await embedSites();
  const fresh = !sites[base];
  const r = await embedSite({ host });
  let reload = false;
  if (fresh && r.upgraded > 0) {
    const last = autoReloaded.get(base) || 0;
    if (Date.now() - last > 60000) { autoReloaded.set(base, Date.now()); reload = true; }
  }
  return Object.assign({ fresh, reload }, r);
}
chrome.cookies.onChanged.addListener(async (ch) => {
  if (ch.removed || embedBusy) return;
  const c = ch.cookie; if (c.sameSite === 'no_restriction' || c.partitionKey) return;
  const sites = await embedSites();
  const base = Object.keys(sites).find(b => c.domain.replace(/^\./, '') === b || c.domain.endsWith('.' + b));
  if (!base) return;
  const rec = sites[base]; const k = ckKey(c);
  if (!(k in rec.orig)) { rec.orig[k] = c.sameSite; await chrome.storage.local.set({ embedSites: sites }); }
  try { await setSameSite(c, 'no_restriction'); } catch (e) { }
});

/* 流式转发: 页面开 Port, 首消息 {op:'stream', req}, 逐块回 {delta}, 末尾 {done, status}。
   三条实战教训(源自 Nemilia 还原): ① 20s keepalive 防 MV3 SW 被杀; ② Port 断开→真取消扩展侧
   in-flight 请求; ③ HTTP 错误如实回 {error,status}, 不伪造 200。 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'colony-stream') return;
  const 本机文件 = !trustedSender(port.sender || {});
  if (本机文件 && !(port.sender && /^file:/.test(port.sender.url || '') && port.sender.frameId === 0)) {
    port.disconnect();
    return;
  }
  const ctrl = new AbortController();
  let hb = null;
  port.onDisconnect.addListener(() => { clearInterval(hb); ctrl.abort(); });
  port.onMessage.addListener(async (m) => {
    if (m && m.keepalive) return;
    const req = (m && m.req) || {};
    if (!allowed(req.url)) { port.postMessage({ ...deny(req.url), done: true }); return; }
    if (本机文件 && !(m.colonyPage && localOnly(req.url))) { port.postMessage({ error: '本机打开的 Colony 文件只能连本机 agent', done: true }); return; }
    hb = setInterval(() => { try { port.postMessage({ keepalive: true }); } catch { clearInterval(hb); } }, 20000);
    try {
      const headers = await withInjectedAuth(req.url, req.headers); // 流式也注入存的 key
      const res = await fetch(req.url, { method: req.method || 'POST', headers, body: req.body || undefined, signal: ctrl.signal });
      if (!res.ok) { port.postMessage({ error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300), done: true, status: res.status }); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      while (true) { const { value, done } = await reader.read(); if (done) break; port.postMessage({ delta: dec.decode(value, { stream: true }) }); }
      port.postMessage({ done: true, status: res.status });
    } catch (e) { if (!ctrl.signal.aborted) port.postMessage({ error: 'stream 失败: ' + e.message, done: true }); }
    finally { clearInterval(hb); }
  });
});

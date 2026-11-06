'use strict';
// ═ 自报 ═
// 改浏览器插件 Colony Bridge 的源码(写前自动快照、可回滚、重载、验活), 并经插件操控浏览器(标签页、CDP、执行脚本、点、填、截图); 给小应用一个作品运行窗(单独窗口跑别人写的 HTML, 卡死不连累 Colony); 接远程 MCP; 给开源网址学外面的技能和插件(要时花额度改写成 Colony 的做法), 能导出给别的 Colony 和 agent
// 数据 {"prefix": "pluginfs:", "label": "插件源码快照", "kind": "backup"}
// 数据 {"prefix": "plugin.mcp.", "label": "接入的远程 MCP", "kind": "config"}
// 数据 {"prefix": "plugin.ext.", "label": "学来的技能和插件", "kind": "data"}
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【录屏时截图】截图(browser.screenshot / browser.cdp 的 Page.captureScreenshot)自动把后台页切到前台、调试截图超时改截可见区, 不用绕;
//   高清: 先 Emulation.setDeviceMetricsOverride 放大再截。录「浏览器」应用: 录前 ui.state 看它的窗没收起, 收起时录到的是桌面。
// 【插件能做什么】经 Colony Bridge 插件碰用户的真浏览器。按任务挑最轻的一条, 轻的不行再往下:
//   ① 只要数据: browser.fetch 代发请求(带用户 IP 和登录 cookie, 二进制给 binary:true, 可并发; Origin 固定是插件, 少数校验来源的接口会拒)。
//      网站有接口(JSON/RSS/公开 API)就别开页面; data.get 网址被拦(503/跨域)时也改走它。
//   ② 要看渲染后的页、点、填、跑脚本: 桌面「浏览器」应用(mmva8bo3hpur, 窗没开先 ui.do 打开) + browser.frame*:
//      frameOpen 拿 id → frameSnapshot 拿编号元素 → frameClick/frameType {tab, ref}(真鼠标/真键盘) → frameWait 等结果。
//      页面一变 ref 作废要重拍; 只要数据用 frameRead/frameEval; frameShot 截图(窗要在屏上); frameSave 带登录下载进口袋。
//      用户也在用, 每步都带 tab: id。登录自动继承(新站首开改 cookie 为 SameSite=None 并刷新一次, 还原: embedSite {host, on:false})。
//      真标签页用 browser.eval/click/type/screenshot {tabId}。
//   ③ 浏览器底层: browser.cdp 发任意 CDP 命令(calls 批量); listen + browser.events 收事件(抓包、控制台;
//      Fetch 拦截改写: requestPaused 后要及时 fulfill/continue, 否则页面悬住)。调试器闲 30 秒才卸, 期间模拟/注入一直有效。
//   ④ 浏览器本身: browser.ext 调 chrome.*(history、downloads、bookmarks、windows、tabGroups、cookies、contentSettings、
//      declarativeNetRequest、scripting)。
//   ⑤ 长期改某类网站: browser.userScript 装用户脚本(code 或 url, 兼容 ==UserScript== 和常用 GM_*, 持久、不受 CSP、不靠调试器)。
//   ⑥ 改插件本身: 源码在 disk:plugin/, plugin.read → plugin.edit {path, old, new}(先自动快照) → plugin.reload(约 1 秒生效, 不用刷新);
//      回 alive:false 就 plugin.revert 再 reload。manifest.json 要 force 且先 plugin.backup。
// 【免点录屏】browser.recStart {fps?(默认 15), maxWidth?, quality?} → 做事 → browser.recStop {name?} 存进口袋(media:)。
//   在插件后台页录, 不占 Colony 页面和通道, 边录边操作不卡(实测 1920 宽 50+ 帧/秒); 只录 Colony 这一页(桌面/小应用/块/内置浏览器都算),
//   要在前台, 没声音, 字比人点授权的 ui.rec 稍糊。长任务留痕、临时演示用它; 宣传片、跨标签页、要声音用 ui.rec(人点一次)。
// 【边界】插件进不了 chrome:// / doubao:// 设置页; tabCapture 要用户点插件图标, 不能代发; CDP 截图/抓帧只对前台页有画面;
//   严格 CSP 的站 scripting.executeScript 的字符串代码会被拒, 改用 CDP; 新权限 Chrome 可能要用户确认。
// 【要人点的】用户脚本总开关(插件详情页, 已开)、录屏选屏框、插件图标(tabCapture)、浏览器设置页。其余自己做, 做前说明, 做完照实报。
// 【作品运行窗】要跑一段别人(agent、选手)写的 HTML 并看它、点它、打分时(竞技、评审、自动测试), 小应用里也能调:
//   browser.runOpen {html} 回 {id} → runAct {id, label 或 selector, do: click|type|key} 回做完后的页面字 → runEval {id, expr} 读状态
//   → runShot {id} 回 JPEG dataUrl(给 agent 看: bridge.file 存成附件再 ask) → runClose {id}。
//   是插件开的单独浏览器窗口(独立进程): 作品死循环、卡死时读它会在 timeout 秒(默认 8)报「没回应」, 截图 5 秒报, 关掉就好, Colony 和调它的应用不卡。
//   实测过别的路都不行: 小应用里嵌 iframe、宿主 stem.mount 的隔离窗跑死循环都会卡住调用方。
//   作品是 data: 网址: 没有 colony、读不到本机存储(localStorage 报 SecurityError), 作品要存东西就只在内存里; 外网能访问。
//   同时最多 4 个; 闲 idle 秒(默认 120)没人碰自动关; 开它的小应用窗一关, 它开的作品窗 5 秒内跟着关。没装插件就没有这几个能力(先 colony.call 试, 报错就退回只看代码)
// 【远程 MCP】要接 Claude/Cursor/pi 的 mcp.json 或某个远程 MCP 网址时: plugin.mcp.connect {url} 或 {config: mcp.json};
//   plugin.mcp.tools {id} 看参数 → plugin.mcp.call {id, name, arguments}。只接远程 HTTP/SSE(官方 Registry 约 86% 是这类);
//   本机 npx/uvx 的 stdio 会报错, 要本机桥起进程。跨域自动改走 browser.fetch; token 放 auth; 会话过期自动重握手。
// 【扩展库】要学外面的技能/MCP/插件, 或要用学来的时。只学用得上的, 一次一个, 别整目录灌:
//   找: plugin.ext.search {q, kind?, ecosystem?} 市场一起搜(技能 ClawHub、MCP 官方 Registry、插件 npm 的 pi/openclaw/Claude Code
//   + DeepSeek Harness 的 DSH Plugin Hub; DSH 包常常只套了一个 MCP: 远程的学时直接接上, 本机的接不了),
//   回的 ref 直接给 plugin.ext.learn {url: ref}。也认 ClawHub/npm 网页、GitHub 仓库/目录/SKILL.md、raw、贴正文、导出包。
//   MCP: mcp:名 有远程端点就直接接上; 只发本机包(npm/pypi/oci stdio)的接不了; 401 要 token(auth), 只有 OAuth 的接不了;
//   Registry 里不少端点已经停了: 报「连不上」就换一个。
//   分级: direct 直接用; map 工具名已按表换成 Colony 的; adapt(插件、带脚本的技能)要 plugin.ext.adapt 花额度改写,
//   先 {id, estimate:true} 估价告诉用户, 他点头再跑(实测一条约 1.5–2.5 万 token)。用: plugin.ext.list {q} → plugin.ext.read {id}。
//   给别人: plugin.ext.export 出 colony-ext/1 包(别的 Colony 装上不花额度) 或 {ids:[id], format:"skill"} 出标准 SKILL.md
//   (头里带 source 网址, hermes/pi/Claude Code 能直接装)。用户在插件管理的窗里能搜市场、学、适配、导出。
//   块自带的技能段不在这里: 那个用 skill.read {id:块, name}。
// ═ 插件通道 ═
// 插件的内容脚本在本页收 postMessage {__colonyRelay:{id, op, req}}, 回 {__colonyRelayResult:{id, ok|error, result}}
const 发 = (op, extra, ms) => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') return reject(new Error('插件通道只在页面里有'));
  const id = 'pm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let t;
  const on = ev => {
    const d = ev.data, r = d && d.__colonyRelayResult;
    if (op === 'reload' && d && d.__colonyRelayReady) { fin(); return resolve({ ready: d.__colonyRelayReady }); }
    if (!r || r.id !== id) return;
    fin();
    if (r.error) reject(new Error('插件回: ' + r.error + (r.fix ? ' (' + r.fix + ')' : '')));
    else resolve(r);
  };
  const fin = () => { clearTimeout(t); window.removeEventListener('message', on); };
  window.addEventListener('message', on);
  window.postMessage({ __colonyRelay: Object.assign({ id, op }, extra || {}) }, '*');
  t = setTimeout(() => { fin(); reject(new Error('插件没回音(' + op + '): 没装、被停用, 或刚重载过 — 刷新 Colony 页面后再试')); }, ms || 3000);
});
const 浏览器 = (req, ms) => 发('browser', { req }, ms || 20000).then(r => r.result);
// ═ 源码 ═
const KEEP = 5, BK = 'pluginfs:backup:';
const 路径 = p => {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^plugin\//, '');
  if (!s || s.includes('..')) throw new Error('要 path(插件文件夹里的相对路径, 如 bg.js)');
  return s;
};
const 键 = p => 'disk:plugin/' + p;
const 读 = async p => { const r = await ctx.call('data.get', { key: 键(p) }); return typeof r === 'string' ? r : (r && r.text != null ? r.text : ''); };
const 写 = (p, text) => ctx.call('data.set', { key: 键(p), value: text });
const 清单 = p => /(^|\/)manifest\.json$/i.test(p);
async function 快照(p) {
  const content = await 读(p), ts = Date.now();
  await ctx.kv.set(BK + p + ':' + ts, { file: p, ts, content });
  const all = (await ctx.kv.list(BK + p + ':')).sort((a, b) => (a.value.ts || 0) - (b.value.ts || 0));
  while (all.length > KEEP) { const e = all.shift(); await ctx.kv.del(e.key).catch(() => {}); }
  return { file: p, ts, bytes: content.length };
}
async function 稳写(p, text, force) {
  if (typeof text !== 'string') throw new Error('text 要是字符串');
  if (清单(p) && !force) throw new Error('manifest.json 默认不让写: 改坏插件就加载不起来。确定要改带 force:true, 且先 plugin.backup');
  let backedUp = null; try { backedUp = await 快照(p); } catch (e) { }
  await 写(p, text);
  return { ok: true, file: p, bytes: text.length, backedUp: backedUp && backedUp.ts };
}
// ═ MCP ═
// 远程 MCP(Streamable HTTP / SSE): 给网址或粘贴 mcp.json 直连, 工具经 plugin.mcp.call 调。
// 能力挂在 plugin. 下(本块清单只有 plugin、browser 两个前缀, 挂 mcp. 就成了私有的, agent 调不到)。
// 先宿主页直接 fetch, 跨域被拦再走 browser.fetch(插件代发)。本机 npx/uvx 起进程的 stdio MCP 这里接不了
// 本段和扩展库、界面都在装配前跑, 用不了装配里的 P: 用 P0 登记
const P0 = (path, fn, desc, schema) => ctx.provide(path, fn, { desc, schema: schema || {}, frames: false });
const MCP = {
  库: 'plugin.mcp.servers',
  版: '2025-06-18',
  // 网址里带的密钥(?exaApiKey=… 这类)拆进 secret 单独存: 列表、界面、导出包只见干净网址, 发请求时 址() 拼回
  密: /key|token|secret|auth|password|pass/i,
  拆(url) {
    const u = new URL(url), secret = {};
    for (const [k, v] of [...u.searchParams]) if (MCP.密.test(k)) { secret[k] = v; u.searchParams.delete(k); }
    return { url: u.toString(), secret: Object.keys(secret).length ? secret : undefined };
  },
  址(s) { const u = new URL(s.url); for (const [k, v] of Object.entries(s.secret || {})) u.searchParams.set(k, v); return u.toString(); },
  async 全() {
    const all = (await ctx.kv.get(MCP.库).catch(() => null)) || {};
    let 旧 = false;   // 早先存的网址还带着密钥: 拆一次存回
    for (const s of Object.values(all)) { const x = MCP.拆(s.url); if (x.secret) { s.url = x.url; s.secret = Object.assign({}, s.secret, x.secret); 旧 = true; } }
    if (旧) await ctx.kv.set(MCP.库, all);
    return all;
  },
  公开: s => ({ id: s.id, url: s.url, 要密钥: [...Object.keys(s.secret || {}), ...s.auth ? ['auth'] : []] }),
  async 存(all) { await ctx.kv.set(MCP.库, all); 界面.脏(); },
  async 取(id) { return (await MCP.全())[id] || (() => { throw new Error('没接这个 MCP: ' + id + ', 用 plugin.mcp.list 看'); })(); },
  名: s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server',
  解(t) { // 回的是 SSE(event:/data: 行) 或一整段 JSON
    t = String(t || '').trim();
    if (!t) return null;
    if (!/^(event|data|id):/m.test(t)) return JSON.parse(t);
    const d = t.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
    return d.length ? JSON.parse(d[d.length - 1]) : null;
  },
  头(s) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': s.protocol || MCP.版 };
    if (s.session) h['Mcp-Session-Id'] = s.session;
    if (s.auth) h.Authorization = /^Bearer /i.test(s.auth) ? s.auth : 'Bearer ' + s.auth;
    return h;
  },
  async rpc(s, method, params, id) { // 回 result; 新给的会话号记进 s
    const body = JSON.stringify({ jsonrpc: '2.0', method, ...id !== undefined && { id }, ...params !== undefined && { params } });
    let r;
    try {
      const res = await fetch(MCP.址(s), { method: 'POST', headers: MCP.头(s), body, signal: AbortSignal.timeout(60000) });
      r = { status: res.status, text: await res.text(), sid: res.headers.get('mcp-session-id') };
    } catch (e) {
      const x = await ctx.call('browser.fetch', { url: MCP.址(s), method: 'POST', headers: MCP.头(s), body, timeout: 60000 })
        .catch(e2 => { throw new Error('MCP 连不上 ' + s.url + ': 服务停了、网址不对, 或它拒绝浏览器来的请求(' + e2.message.split('(')[0] + ')'); });
      const hs = x.headers || {}, k = Object.keys(hs).find(k => k.toLowerCase() === 'mcp-session-id');
      r = { status: x.status, text: typeof x.text === 'string' ? x.text : JSON.stringify(x.json), sid: k && hs[k] };
    }
    if (r.sid) s.session = r.sid;
    if (r.status === 401 || r.status === 403) throw new Error('MCP ' + s.url + ' 要登录(HTTP ' + r.status + '): 有 API token 就放 auth 再接; 只支持 OAuth 网页登录的这里还接不了');
    if (r.status >= 400) throw new Error('MCP ' + method + ' HTTP ' + r.status + ': ' + String(r.text || '').slice(0, 200));
    if (id === undefined) return null;   // 通知没有回话
    const j = MCP.解(r.text);
    if (j && j.error) throw new Error('MCP ' + method + ': ' + (j.error.message || JSON.stringify(j.error)));
    return j && j.result;
  },
  async 握手(s) {
    const r = await MCP.rpc(s, 'initialize', { protocolVersion: MCP.版, capabilities: {}, clientInfo: { name: 'colony', version: '1' } }, 1);
    s.protocol = (r && r.protocolVersion) || MCP.版;
    s.serverInfo = r && r.serverInfo;
    await MCP.rpc(s, 'notifications/initialized').catch(() => { });
    s.tools = ((await MCP.rpc(s, 'tools/list', {}, 2)) || {}).tools || [];
    return s;
  },
};
P0('plugin.mcp.list', async () => Object.values(await MCP.全()).map(s => ({ ...MCP.公开(s), tools: (s.tools || []).length, server: s.serverInfo && [s.serverInfo.title || s.serverInfo.name, s.serverInfo.version].filter(Boolean).join(' ') })),   // 不回图标(base64 可以很大)
  '已接入的远程 MCP(不回密钥, 要密钥列出它存着哪几样)');
P0('plugin.mcp.connect', async a => {
  let { id, url, auth } = a;
  if (a.config) { // Claude / Cursor / pi 的 mcp.json: {mcpServers: {名: {url | serverUrl, headers}}}
    const raw = typeof a.config === 'string' ? JSON.parse(a.config) : a.config, all = raw.mcpServers || raw.servers || raw;
    const k = id || Object.keys(all)[0], c = all[k] || {};
    if (c.command) throw new Error(k + ' 是本机起进程的 stdio MCP(' + c.command + '), 这里只接远程 HTTP/SSE');
    id = k; url = url || c.url || c.serverUrl;
    auth = auth || (c.headers && (c.headers.Authorization || c.headers.authorization));
  }
  if (!url) throw new Error('给 url, 或 config 贴 mcp.json');
  id = MCP.名(id || new URL(url).hostname.replace(/^(www|mcp)\./, '').split('.')[0]);
  const s = await MCP.握手({ id, ...MCP.拆(url), auth });
  const all = await MCP.全();
  all[id] = s;
  await MCP.存(all);
  return { ...MCP.公开(s), serverInfo: s.serverInfo, tools: s.tools.map(t => ({ name: t.name, description: String(t.description || '').split('\n')[0].slice(0, 120) })) };
}, '接入一个远程 MCP: url 给网址, 或 config 贴 mcp.json(多个服务时 id 选一个); auth 放 token; 回工具清单',
  { url: 'string?', id: 'string?', auth: 'string?', config: 'string|object?' });
P0('plugin.mcp.tools', async a => (await MCP.取(a.id)).tools || [], '一个 MCP 的工具清单(含参数 inputSchema)', { id: 'string' });
P0('plugin.mcp.call', async a => {
  const s = await MCP.取(a.id), 原 = s.session;
  const go = () => MCP.rpc(s, 'tools/call', { name: a.name, arguments: a.arguments || {} }, Date.now() % 1e9);
  let r;
  try { r = await go(); } catch (e) { // 会话过期(404/400): 重新握手一次再调
    if (!/HTTP (400|404)/.test(e.message)) throw e;
    delete s.session; await MCP.握手(s); r = await go();
  }
  if (s.session !== 原) { const all = await MCP.全(); all[s.id] = s; await MCP.存(all); }
  return r;
}, '调已接入 MCP 的一个工具: 先 plugin.mcp.tools 看参数', { id: 'string', name: 'string', arguments: 'object?' });
P0('plugin.mcp.remove', async a => {
  const all = await MCP.全();
  if (!all[a.id]) throw new Error('没接这个 MCP: ' + a.id);
  delete all[a.id];
  await MCP.存(all);
  return { removed: a.id };
}, '去掉一个已接入的 MCP', { id: 'string' });
// ═ 扩展库 ═
// 从外面学来的技能和插件。市场能搜能学: 技能 ClawHub(zip)、MCP 官方 Registry(远程的直接接)、
// 插件 npm(tgz; pi / openclaw / Claude Code 按关键词, DeepSeek Harness 走它的社区市场 DSH Plugin Hub, 包也在 npm);
// 也认 GitHub 仓库/目录/SKILL.md、raw 链接、贴 SKILL.md 正文。一次学一个: 只学用得上的;
// 每条都记着来源网址: 别的 Colony 拿网址或导出包(colony-ext/1)、别的 agent 拿导出的 SKILL.md, 都能学到同一份。
// 分级: direct 纯指令, 直接用 / map 只用到网页类工具, 按表换成 Colony 能力名, 不花额度 /
// adapt 要本机执行或是插件代码, 要花额度让模型改写成用 Colony 能力的做法(plugin.ext.adapt, 先 estimate 看要多少)。
// 默认不进系统提示: 会越来越多; agent 用 plugin.ext.list 搜, 置顶的才把名字列进去(最多 10 条)
const 扩展 = {
  前: 'plugin.ext.item.',
  索: 'plugin.ext.index',
  原上限: 60000,   // 插件源码最多收这么多字去适配: 再多模型也读不完, 额度白花
  单文件: 15000,
  async 索取() { return (await ctx.kv.get(扩展.索).catch(() => null)) || []; },
  async 取(id) {
    const it = await ctx.kv.get(扩展.前 + id).catch(() => null);
    if (!it) throw new Error('扩展库里没有 ' + id + ', 用 plugin.ext.list 看有哪些');
    return it;
  },
  原文: it => [it.kind === 'plugin' ? '' : String(it.body || '')].concat((it.files || []).map(f => '=== ' + f.path + ' ===\n' + f.text)).filter(Boolean).join('\n\n'),
  行: it => ({ id: it.id, kind: it.kind, name: it.name, description: String(it.description || '').slice(0, 160),
    grade: it.grade, source: it.source, adapted: !!it.adapted, adaptedBy: it.adaptedBy || '', pinned: !!it.pinned,
    origChars: 扩展.原文(it).length, cost: it.cost || null, at: it.at }),
  排: Promise.resolve(),   // 索引是读-改-写: 并发学(一次学一整个目录)会互相盖掉, 排成一个一个来
  改索(fn) {
    const p = 扩展.排.then(async () => { await ctx.kv.set(扩展.索, fn(await 扩展.索取())); 界面.脏(); });
    扩展.排 = p.catch(() => { });
    return p;
  },
  async 存(it) {
    const old = await ctx.kv.get(扩展.前 + it.id).catch(() => null);
    if (old && old.pinned && it.pinned === undefined) it.pinned = true;   // 重学一遍不丢置顶
    await ctx.kv.set(扩展.前 + it.id, it);
    const 行 = 扩展.行(it);
    await 扩展.改索(l => [行].concat(l.filter(x => x.id !== it.id)));
    return 行;
  },
  async 删(id) {
    await ctx.kv.del(扩展.前 + id);
    await 扩展.改索(l => l.filter(x => x.id !== id));
  },
  async 重建索引() { // 索引坏了、丢了: 照条目重排
    const ks = (await ctx.kv.list(扩展.前)).map(e => e.key);
    const items = (await Promise.all(ks.map(k => ctx.kv.get(k).catch(() => null)))).filter(Boolean);
    await 扩展.改索(() => items.map(扩展.行).sort((x, y) => y.at - x.at));
    return items.length;
  },
  名: s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ext',
  析(md) { // SKILL.md: 头上 --- 之间是 YAML; 只认顶层 key: value, 和 key: | / > 的多行块
    md = String(md || '').replace(/^\uFEFF/, '');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md), meta = {};
    if (!m) return { meta, body: md };
    const ls = m[1].split(/\r?\n/);
    for (let i = 0; i < ls.length; i++) {
      const k = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(ls[i]);
      if (!k) continue;
      let v = k[2].trim();
      if (/^[|>][-+]?$/.test(v)) { // 多行块: 收后面缩进的行
        const 收 = [];
        while (i + 1 < ls.length && (/^\s+\S/.test(ls[i + 1]) || !ls[i + 1].trim())) 收.push(ls[++i].trim());
        v = 收.join(v[0] === '>' ? ' ' : '\n').trim();
      }
      meta[k[1]] = v.replace(/^(["'])([\s\S]*)\1$/, '$2');
    }
    return { meta, body: m[2] };
  },
  // 分级只看正文点名的工具: 跑命令、跑代码的换不掉(Colony 起不了进程) → adapt; 读写文件、上网的有对应能力, 按表换名 → map
  执行词: ['terminal', 'execute_code', 'run_terminal', 'run_command', 'bash', 'shell_exec', 'subprocess', 'process_spawn', 'python3?\\s+\\S+\\.py', 'npx\\s', 'uvx\\s', 'pip install', 'npm install'],
  换表: [
    [/\bweb_search\b/g, 'browser.fetch(调搜索接口)'],
    [/\bweb_extract\b/g, 'browser.fetch 或 browser.frameRead(读网页)'],
    [/\bbrowser_navigate\b/g, 'browser.frameOpen'],
    [/\bbrowser_click\b/g, 'browser.frameClick'],
    [/\bbrowser_type\b/g, 'browser.frameType'],
    [/\bbrowser_snapshot\b/g, 'browser.frameSnapshot'],
    [/\bread_file\b/g, 'data.get(次元口袋里的文件)'],
    [/\bwrite_file\b/g, 'data.set(存进次元口袋)'],
    [/\bimage_generate\b/g, 'ai.image'],
    [/\btext_to_speech\b/g, 'ai.speak'],
    [/\bvision_analyze\b/g, 'ai.chat(带图)'],
  ],
  级(body) {
    const t = String(body || ''),
      exec = 扩展.执行词.reduce((n, w) => n + (t.match(new RegExp('\\b' + w, 'gi')) || []).length, 0),
      web = 扩展.换表.reduce((n, [re]) => n + (t.match(re) || []).length, 0);
    if (exec) return { grade: 'adapt', reason: '要跑命令或代码 ' + exec + ' 处(Colony 起不了进程), 要花额度改写' };
    if (web) return { grade: 'map', reason: '点到的工具 ' + web + ' 处都有对应能力, 已按表换名' };
    return { grade: 'direct', reason: '纯指令/知识, 不点工具' };
  },
  换: body => 扩展.换表.reduce((t, [re, to]) => t.replace(re, to), String(body || '')),
  async 拉(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {   // 跨域或被限流: 插件代发
      const r = await ctx.call('browser.fetch', { url, timeout: 30000 });
      if (r.status >= 400) throw new Error('拉不到 ' + url + ': HTTP ' + r.status);
      return typeof r.text === 'string' ? r.text : JSON.stringify(r.json);
    }
  },
  gh(url) { // GitHub 网址拆成 {o, r, ref, path, file}; 分支名带斜杠的认不全
    let m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
    if (m) return { o: m[1], r: m[2], ref: m[3], path: m[4], file: true };
    m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(tree|blob)\/([^/#?]+)(?:\/([^#?]*))?)?\/?(?:[#?].*)?$/.exec(url);
    return m && { o: m[1], r: m[2].replace(/\.git$/, ''), ref: m[4] || '', path: (m[5] || '').replace(/\/$/, ''), file: m[3] === 'blob' };
  },
  raw: (g, path) => 'https://raw.githubusercontent.com/' + g.o + '/' + g.r + '/' + g.ref + '/' + path,
  页: (g, path) => 'https://github.com/' + g.o + '/' + g.r + '/blob/' + g.ref + '/' + path,
  async 树(g) { // 文件清单: 先走网页的 tree-list(不限次; API 不带 token 一小时只给 60 次), 不行再走 API。只回 {path}
    const 页 = 'https://github.com/' + g.o + '/' + g.r, 拿 = u => ctx.call('browser.fetch', { url: u, timeout: 30000 }).then(x => x.text || '');
    try {
      if (!g.ref) g.ref = (/data-default-branch="([^"]+)"|"defaultBranch":"([^"]+)"/.exec(await 拿(页)) || []).slice(1).find(Boolean) || 'main';
      const oid = (/Commit\/([0-9a-f]{40})/.exec(await 拿(页 + '/commits/' + g.ref + '.atom')) || [])[1];   // 这个分支最新的 commit
      if (!oid) throw new Error('拿不到 ' + g.ref + ' 的 commit');
      const y = await ctx.call('browser.fetch', { url: 页 + '/tree-list/' + oid, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 30000 });
      const ps = (y.json || JSON.parse(y.text)).paths;
      if (!Array.isArray(ps) || !ps.length) throw new Error('tree-list 没回文件');
      return 扩展.夹里(ps.map(path => ({ path })), g);
    } catch (e) {
      const api = 'https://api.github.com/repos/' + g.o + '/' + g.r;
      if (!g.ref) g.ref = JSON.parse(await 扩展.拉(api)).default_branch || 'main';
      const t = JSON.parse(await 扩展.拉(api + '/git/trees/' + encodeURIComponent(g.ref) + '?recursive=1'));
      return 扩展.夹里((t.tree || []).filter(x => x.type === 'blob').map(x => ({ path: x.path })), g);
    }
  },
  夹里: (fs, g) => g.path ? fs.filter(f => f.path.startsWith(g.path + '/')) : fs,
  async 收技能(md, source, 默认名, 附 = []) { // 附: 同目录的脚本、参考文件; 有脚本的技能要适配才能用
    const { meta, body } = 扩展.析(md);
    if (!meta.name && /^\s*(<!doctype|<html|<\?xml|\{)/i.test(String(md))) throw new Error('这不是技能: 拿到的是网页或 JSON, 不是 SKILL.md(要有 --- name/description --- 头, 或至少是 markdown)');
    const 带 = String(meta['colony-adapted']) === 'true';   // 别的 Colony 导出的: 适配好的正文原样收, 不再花额度
    附 = 附.filter(f => f.text).map(f => ({ path: f.path, text: f.text.slice(0, 扩展.单文件) }));
    const 脚 = 附.filter(f => /\.(py|sh|js|mjs|cjs|ts)$/i.test(f.path));
    let g = 带 ? { grade: meta['colony-grade'] || 'adapt', reason: '别的 Colony 已经适配好' } : 扩展.级(body);
    if (!带 && 脚.length) g = { grade: 'adapt', reason: '带 ' + 脚.length + ' 个脚本(' + 脚.map(f => f.path).slice(0, 3).join(', ') + '), 要改写成 Colony 能跑的' };
    const name = meta.name || 默认名 || (/^#\s+(.+)/m.exec(body) || [])[1] || 'unnamed';
    const it = { id: 扩展.名(name), kind: 'skill', name, description: meta.description || '', grade: g.grade,
      reason: g.reason, source: meta.source || source, meta, body: 带 ? '' : body, files: 带 ? [] : 附, at: Date.now() };
    if (带) { it.adapted = body.trim(); it.adaptedBy = meta['colony-adapted-by'] || '导入的'; }
    else if (g.grade === 'map') { it.adapted = 扩展.换(body); it.adaptedBy = '按表替换'; }
    return 扩展.存(it);
  },
  async 收仓库插件(g, tree, source) { // GitHub 仓库/目录: 挑说明和源码拉下来; 测试、构建产物不要
    const 内 = f => g.path ? f.path.slice(g.path.length + 1) : f.path, 深 = f => 内(f).split('/').length,
      要 = f => /(^|\/)(readme[^/]*\.md|package\.json|plugin\.ya?ml|manifest\.json|mcp\.json|pyproject\.toml)$/i.test(f.path),
      码 = f => /\.(ts|tsx|js|mjs|py)$/.test(f.path) && !/\.(test|spec|d)\.[a-z]+$/.test(f.path)
        && !/(^|\/)(tests?|__tests__|dist|build|node_modules|\.github)\//i.test(内(f));   // 只看给的目录以内: 插件本身在 examples/ 下也收
    const 候 = tree.filter(要).sort((x, y) => 深(x) - 深(y)).slice(0, 4).concat(tree.filter(码).sort((x, y) => 深(x) - 深(y))).slice(0, 40);
    const files = [];
    for (let i = 0, n = 0; i < 候.length && n < 扩展.原上限; i += 6)   // 拿不到大小: 边拉边数, 够了就停
      for (const f of await Promise.all(候.slice(i, i + 6).map(async f => ({ path: 内(f), text: await 扩展.拉(扩展.raw(g, f.path)).catch(() => '') }))))
        if (f.text && n < 扩展.原上限) { files.push(f); n += Math.min(f.text.length, 扩展.单文件); }
    return 扩展.收插件(files, source, g.path ? g.r + '-' + g.path.split('/').pop() : g.r, 'GitHub');
  },
  async 收插件(files, source, 名, 来, mcp) { // 说明在前、源码由浅到深, 截到 原上限; mcp: DSH 包里套的 MCP
    const 说 = f => /(^|\/)(readme[^/]*\.md|package\.json|plugin\.ya?ml|manifest\.json|openclaw\.plugin\.json|mcp\.json|pyproject\.toml)$/i.test(f.path);
    const 码 = f => /\.(ts|tsx|js|mjs|cjs|py)$/.test(f.path) && !/\.(test|spec|d)\.[a-z]+$/.test(f.path);
    const 深 = f => f.path.split('/').length, 排 = files.filter(说).sort((x, y) => 深(x) - 深(y)).slice(0, 4)
      .concat(files.filter(码).sort((x, y) => 深(x) - 深(y) || x.text.length - y.text.length));
    const 留 = [];
    let n = 0;
    for (const f of 排) {
      if (n >= 扩展.原上限) break;
      const t = f.text.length > 扩展.单文件 ? f.text.slice(0, 扩展.单文件) + '\n…(后面截掉了)' : f.text;
      留.push({ path: f.path, text: t });
      n += t.length;
    }
    if (!留.length) throw new Error('没拿到能读的说明或源码');
    const pk = 留.find(f => /(^|\/)package\.json$/.test(f.path)), rd = 留.find(f => /readme/i.test(f.path));
    let desc = '', pj = {};
    try { pj = pk ? JSON.parse(pk.text) : {}; desc = pj.description || ''; } catch (e) { }
    if (!desc && rd) desc = (rd.text.split(/\n\s*\n/).find(p => p.trim() && !/^\s*[#!<[|]/.test(p)) || '').trim().slice(0, 200);
    const 码数 = 留.filter(码).length;
    const it = { id: 扩展.名(名), kind: 'plugin', name: pj.name || 名, description: desc, grade: 'adapt',
      reason: (来 ? 来 + ' 的' : '') + '插件代码(' + 码数 + ' 个源文件 ' + n + ' 字)跑不了, 要花额度改写成 Colony 的做法', source, files: 留, at: Date.now() };
    if (mcp) Object.assign(it, { mcp, reason: mcp.url
      ? '这个包只是套了一个远程 MCP(' + mcp.url + '): 直接 plugin.mcp.connect 接上就行, 不用花额度适配'
      : '这个包只是套了一个本机 MCP(' + (mcp.command + ' ' + mcp.args).trim() + '): 浏览器起不了进程, 接不了; 适配也只能写成交给本机 agent 做' });
    if (mcp && mcp.url) it.grade = 'mcp';
    return 扩展.存(it);
  },
  // —— 市场: 技能 ClawHub, MCP 官方 Registry, 插件 npm(pi / openclaw / Claude Code 各自的关键词)。都是公开接口, 不要 key ——
  市场: {
    skill: { 名: 'ClawHub', 搜: q => 'https://clawhub.ai/api/v1/search?q=' + encodeURIComponent(q) },
    mcp: { 名: 'MCP Registry', 搜: q => 'https://registry.modelcontextprotocol.io/v0/servers?limit=30&search=' + encodeURIComponent(q) },
    dsh: { 名: 'DSH Plugin Hub', 搜: q => 'https://api.dshpluginhub.ai/api/v1/packages?q=' + encodeURIComponent(q) },   // DeepSeek Harness 的社区市场, 包本身在 npm
    plugin: { 名: 'npm', 词: ['pi-package', 'openclaw-plugin', 'claude-code-plugin'],
      搜: (q, 词) => 'https://registry.npmjs.org/-/v1/search?size=20&text=' + encodeURIComponent((q + ' keywords:' + 词).trim()) },
  },
  async json(url) { const t = await 扩展.拉(url); return JSON.parse(t); },
  async 搜(a) {
    const q = String(a.q || '').trim(), 要 = a.kind ? [a.kind] : ['skill', 'mcp', 'plugin'], out = {};
    await Promise.all(要.map(async k => {
      try {
        if (k === 'skill') out.skill = ((await 扩展.json(扩展.市场.skill.搜(q))).results || []).slice(0, a.n || 10).map(x => ({
          ref: 'clawhub:' + x.install.reference, name: x.displayName, summary: String(x.summary || '').slice(0, 160),
          downloads: x.downloads, official: !!x.official, suspicious: !!(x.native && x.native.skill && x.native.skill.isSuspicious) }));
        if (k === 'mcp') {
          const 见 = new Set();
          out.mcp = ((await 扩展.json(扩展.市场.mcp.搜(q))).servers || []).map(x => x.server).filter(s => !见.has(s.name) && 见.add(s.name))
            .slice(0, a.n || 10).map(s => {
              const 远 = (s.remotes || [])[0], 要钥 = 远 && (远.headers || []).some(h => h.isRequired);
              return { ref: 'mcp:' + s.name, name: s.name, summary: String(s.description || '').slice(0, 160),
                能接: 远 ? (要钥 ? '远程, 要 token' : '远程, 直接接') : '只有本机包(' + (s.packages || []).map(p => p.registryType).join('/') + '), 接不了',
                url: 远 && 远.url, repo: s.repository && s.repository.url };
            });
        }
        if (k === 'plugin') {
          const 词 = a.ecosystem ? [a.ecosystem].filter(w => w !== 'deepseek-harness') : 扩展.市场.plugin.词, 要dsh = !a.ecosystem || a.ecosystem === 'deepseek-harness';
          const dsh = 要dsh ? 扩展.json(扩展.市场.dsh.搜(q)).then(r => (r.items || []).filter(x => !x.deprecated).slice(0, a.n || 10).map(x => ({ ref: 'npm:' + x.packageName,
            name: x.packageName, ecosystem: 'deepseek-harness', summary: String(x.summary || '').slice(0, 160), repo: x.repository && 'https://github.com/' + x.repository,
            分: (x.github && x.github.stars || 0) * 10 + (x.weeklyDownloads || 0), verified: !!x.verified })), () => []) : Promise.resolve([]);
          const 各 = await Promise.all(词.map(w => 扩展.json(扩展.市场.plugin.搜(q, w)).then(r => (r.objects || []).map(o => ({ o, w })), () => [])));
          const npm = 各.flat().sort((x, y) => (y.o.downloads?.monthly || y.o.score?.final || 0) - (x.o.downloads?.monthly || x.o.score?.final || 0))
            .slice(0, a.n || 10).map(({ o, w }) => ({ ref: 'npm:' + o.package.name, name: o.package.name, ecosystem: w,
              summary: String(o.package.description || '').slice(0, 160), repo: o.package.links && o.package.links.repository }));
          const 见 = new Set();   // 几家轮流排, 同一个包只留一次
          const 轮 = [await dsh].concat(词.map(w => npm.filter(x => x.ecosystem === w)));
          out.plugin = [];
          for (let i = 0; out.plugin.length < (a.n || 10) && 轮.some(l => l[i]); i++) 轮.forEach(l => { const x = l[i]; if (x && !见.has(x.ref)) { 见.add(x.ref); out.plugin.push(x); } });
          out.plugin = out.plugin.slice(0, a.n || 10);
        }
      } catch (e) { out[k] = { error: e.message }; }
    }));
    return out;
  },
  // —— 解包: ClawHub 给 zip, npm 给 tgz; 都在浏览器里解(DecompressionStream), 只留文本 ——
  async 解压(bytes, how) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(how))).arrayBuffer());
  },
  async zip(bin) {
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), td = new TextDecoder(), out = [];
    let e = bin.length - 22;
    while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e <= 0) throw new Error('不是 zip');
    for (let i = 0, p = dv.getUint32(e + 16, true), n = dv.getUint16(e + 10, true); i < n; i++) {
      const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true),
        lo = dv.getUint32(p + 42, true), name = td.decode(bin.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      if (name.endsWith('/')) continue;
      const d0 = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = bin.subarray(d0, d0 + cs);
      out.push({ path: name, text: td.decode(m === 0 ? raw : await 扩展.解压(raw, 'deflate-raw')) });
    }
    return out;
  },
  async tgz(bin) {
    const tar = await 扩展.解压(bin, 'gzip'), td = new TextDecoder(), out = [];
    for (let p = 0; p + 512 <= tar.length;) {
      const h = tar.subarray(p, p + 512);
      if (!h[0]) break;
      const s = b => td.decode(b).replace(/\0[\s\S]*$/, ''), size = parseInt(s(h.subarray(124, 136)).trim() || '0', 8);
      const pre = s(h.subarray(345, 500)), name = (pre ? pre + '/' : '') + s(h.subarray(0, 100)), t = h[156];
      if (t === 48 || t === 0) out.push({ path: name.replace(/^package\//, ''), text: td.decode(tar.subarray(p + 512, p + 512 + size)) });
      p += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
  },
  async 下(url) { // 二进制: 走插件代发(跨域、不限次)
    const r = await ctx.call('browser.fetch', { url, binary: true, timeout: 60000 });
    if (r.status >= 400) throw new Error('下载 ' + url + ' HTTP ' + r.status);
    return Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
  },
  文本: f => /\.(md|txt|json|ya?ml|toml|ts|tsx|js|mjs|cjs|py|sh)$/i.test(f.path) && !/(^|\/)(node_modules|dist|build|tests?|__tests__)\//.test(f.path)
    && !/(^|\/)(license|licence|copying|notice|changelog)[^/]*$/i.test(f.path),   // 授权、更新记录对做事没用, 只占额度
  async 收文件(files, source, 默认名, 来) { // 包里有 SKILL.md 就是技能(多个就要选), 没有就是插件
    files = files.filter(扩展.文本);
    const sk = files.filter(f => /(^|\/)SKILL\.md$/i.test(f.path));
    if (sk.length === 1) return 扩展.收技能(sk[0].text, source, 默认名, files.filter(f => f !== sk[0] && !/(^|\/)(_meta\.json|skill-card\.md)$/.test(f.path)));
    if (sk.length > 1) return { 要选: true, 共: sk.length, 技能: sk.map(f => f.path.replace(/\/?SKILL\.md$/i, '')), 说明: '包里有多个技能, 去它的 GitHub 目录学其中一个' };
    const mcp = 扩展.dshMCP(files);
    if (mcp) return 扩展.收插件(files, source, 默认名, 来, mcp);
    return 扩展.收插件(files, source, 默认名, 来);
  },
  dshMCP(files) { // DeepSeek Harness 的包常常只是套了一个 MCP: cordis.patch.yml 里一行 dsh-mcp-client, 配了 transport/url 或 command
    const p = files.find(f => /(^|\/)cordis\.patch\.ya?ml$/.test(f.path));
    if (!p || !/dsh-mcp-client/.test(p.text)) return null;
    const 取 = k => (new RegExp('^\\s*' + k + ':\\s*[\'"]?([^\'"\\n#]+)', 'm').exec(p.text) || [])[1];
    const tr = (取('transport') || '').trim(), url = (取('url') || '').trim(), cmd = (取('command') || '').trim();
    const 远 = /^https?:/.test(url) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url) && tr !== 'stdio';   // 本机地址、stdio 都不算远程
    return { serverName: (取('serverName') || '').trim(), transport: tr || (url ? 'http' : 'stdio'), url: 远 ? url : '', command: cmd || (url && !远 ? url : ''),
      args: ((/^\s*args:\s*\[([^\]]*)\]/m.exec(p.text) || [])[1] || '').replace(/['"]/g, '').trim() };
  },
  async 学网址(a) {
    const url = String(a.url).trim();
    let m;
    // 市场简写(plugin.ext.search 回的 ref)和市场网页都认
    if ((m = /^clawhub:([^/\s]+)\/([^/\s]+)$/.exec(url) || /^https?:\/\/(?:www\.)?clawhub\.ai\/([^/]+)\/(?:skills\/)?([^/?#]+)/.exec(url)))
      return 扩展.收文件(await 扩展.zip(await 扩展.下('https://clawhub.ai/api/v1/download?slug=' + m[2] + '&ownerHandle=' + m[1])),
        'https://clawhub.ai/' + m[1] + '/skills/' + m[2], m[2], 'ClawHub');
    if ((m = /^npm:(.+)$/.exec(url) || /^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/.exec(url) || /^https?:\/\/(?:www\.)?dshpluginhub\.ai\/(?:plugins|packages)\/((?:@[^/]+\/)?[^/?#]+)/.exec(url))) {
      const meta = await 扩展.json('https://registry.npmjs.org/' + decodeURIComponent(m[1]).replace('/', '%2F') + '/latest');
      const 生 = (meta.keywords || []).find(k => 扩展.市场.plugin.词.includes(k)) || (meta.dsh || (meta.keywords || []).some(k => /^(dsh|deepseek-harness|dsh-plugin)$/.test(k)) ? 'deepseek-harness' : '');
      const r = await 扩展.收文件(await 扩展.tgz(await 扩展.下(meta.dist.tarball)), 'https://www.npmjs.com/package/' + meta.name, meta.name.split('/').pop(),
        'npm ' + meta.name + '@' + meta.version + (生 ? ' · ' + 生 : ''));
      if (r.grade === 'mcp' && !a.noConnect) { // 套壳的远程 MCP: 顺手接上
        const it = await 扩展.取(r.id);
        r.connected = await ctx.call('plugin.mcp.connect', { url: it.mcp.url, id: it.mcp.serverName || r.id, auth: a.auth }).then(x => x.id + ' ' + x.tools.length + ' 个工具', x => '没接上: ' + x.message);
      }
      return r;
    }
    if ((m = /^mcp:(.+)$/.exec(url))) { // 市场里的 MCP: 有远程端点就接上, 只有本机包就说清楚
      const s = (((await 扩展.json(扩展.市场.mcp.搜(m[1]))).servers || []).map(x => x.server).find(x => x.name === m[1]));
      if (!s) throw new Error('MCP Registry 里没有 ' + m[1]);
      const 远 = (s.remotes || []).find(r => !(r.headers || []).some(h => h.isRequired)) || (s.remotes || [])[0];
      if (!远) throw new Error(m[1] + ' 只发了本机包(' + (s.packages || []).map(p => p.registryType + '/' + (p.transport && p.transport.type)).join(', ') + '), 浏览器起不了进程, 接不了');
      if ((远.headers || []).some(h => h.isRequired) && !a.auth) throw new Error(m[1] + ' 要 token: ' + 远.headers.map(h => h.description).join('; ') + '。拿到后 auth 带上再接');
      return ctx.call('plugin.mcp.connect', { url: 远.url, id: m[1].split('/').pop(), auth: a.auth });
    }
    const g = 扩展.gh(url);
    if (!g) { // 别的网址: 导出包或 SKILL.md
      const t = await 扩展.拉(url);
      if (/^\s*\{/.test(t) && /colony-ext\//.test(t)) return 扩展.装包(t);
      return 扩展.收技能(t, url, url.split(/[?#]/)[0].split('/').filter(Boolean).slice(-2, -1)[0]);
    }
    if (g.file) {
      if (!g.ref) g.ref = 'main';
      return 扩展.收技能(await 扩展.拉(扩展.raw(g, g.path)), 扩展.页(g, g.path), g.path.split('/').slice(-2, -1)[0] || g.r);
    }
    const tree = await 扩展.树(g), 夹 = p => p.replace(/\/?SKILL\.md$/i, '');
    const sk = tree.filter(x => /(^|\/)SKILL\.md$/i.test(x.path));
    if (!sk.length) return 扩展.收仓库插件(g, tree, url);
    const 选 = a.path ? sk.filter(x => 夹(x.path) === a.path.replace(/\/$/, '') || x.path.startsWith(a.path.replace(/\/$/, '') + '/')) : sk;
    if (!选.length) throw new Error('这里没有 ' + a.path + ' 这个技能');
    if (选.length > 1) return { 要选: true, 共: 选.length, 技能: 选.slice(0, 300).map(x => 夹(x.path)), 说明: '这里有多个技能: 给 path 学其中一个(一次学一个, 只学用得上的)' };
    const 目 = 夹(选[0].path), 附 = tree.filter(x => 目 && x.path.startsWith(目 + '/') && x !== 选[0] && 扩展.文本(x)).slice(0, 12);
    const 附文 = (await Promise.all(附.map(async f => ({ path: f.path.slice(目.length + 1), text: await 扩展.拉(扩展.raw(g, f.path)).catch(() => '') })))).filter(f => f.text);
    return 扩展.收技能(await 扩展.拉(扩展.raw(g, 选[0].path)), 扩展.页(g, 选[0].path), 目.split('/').pop() || g.r, 附文);
  },
  async 装包(p) { // colony-ext/1: 适配好的原样收(不花额度); 只有网址的照网址重学; MCP 重新接
    p = typeof p === 'string' ? JSON.parse(p) : p;
    if (!p || !/^colony-ext\//.test(p.format || '')) throw new Error('不是 colony-ext 导出包');
    const 学到 = [], 错 = [];
    for (const it of p.items || []) {
      try {
        if (!it.adapted && !it.body && !(it.files || []).length) 学到.push(await 扩展.学网址({ url: it.source, path: it.path }));
        else 学到.push(await 扩展.存(Object.assign({}, it, { id: 扩展.名(it.id || it.name), at: Date.now() })));
      } catch (e) { 错.push((it.id || it.name) + ': ' + e.message); }
    }
    const mcp = [];
    for (const s of p.mcp || []) {
      try { mcp.push((await ctx.call('plugin.mcp.connect', { url: s.url, id: s.id })).id); } catch (e) { 错.push('MCP ' + s.id + ': ' + e.message); }
    }
    return { 学到: 学到.length, mcp, 错 };
  },
  适配说明: '你在把一个外面的 agent 技能或插件改写成 Colony 全能 agent 能照着做的技能。Colony 是浏览器里的一个 html 文件: '
    + '没有本机终端、没有本机文件系统、不能起进程; 它能做的事全在下面的能力清单里(agent 用 call {path, args} 调)。\n'
    + '写法: 1 第一行写它干什么、什么时候用。2 一步步写做法, 每步写用哪个能力(清单里的全路径)和关键参数。'
    + '3 原来要本机终端、读写文件、跑 Python/Node 的: 能换成 js.run(隔离窗里跑 JS, 能 fetch)、browser.fetch(带用户登录代发请求)、'
    + 'data.set / data.get(存取次元口袋)、ai.*(模型)的就换; 换不了的那步写明「要本机: 交给接了本机 agent 的 bridge.ask」, 不要假装能做。'
    + '4 只用清单里有的能力, 不编。5 原文里有价值的知识、规则、提示词原样保留。6 先在 <think></think> 里想, 想完在 <skill></skill> 里只写技能正文(markdown, 3000 字内), 正文里不写分析过程。',
  async 清单() {
    return (await ctx.call('stem.capabilities')).map(c => c.path + ': ' + String(c.desc || '').split(/[;；。]/)[0].slice(0, 70)).join('\n');
  },
  估: n => Math.ceil(n / 2.2),   // 中英混排大约 2.2 字一个 token, 只是估
  出上限: 12000,   // 实测带参考文件的技能 8000 会写不完
  技能md(it) { // 导出成标准 SKILL.md: hermes / pi / Claude Code 直接能装; 来源和适配情况写在头里
    const 正 = it.adapted || it.body || ((it.description || '') + '\n\n还没适配: 原插件在 ' + it.source + ', 拿这个网址学。');
    return ['---', 'name: ' + it.name, 'description: ' + JSON.stringify(String(it.description || '')), 'source: ' + (it.source || ''),
      'colony-grade: ' + it.grade, 'colony-adapted: ' + (it.adapted ? 'true' : 'false')]
      .concat(it.adaptedBy ? ['colony-adapted-by: ' + it.adaptedBy] : []).concat(['---', '', 正]).join('\n');
  },
};
P0('plugin.ext.search', async a => 扩展.搜(a),
  '在市场里找: 技能 ClawHub、MCP 官方 Registry、插件(npm 的 pi / openclaw / Claude Code, DeepSeek Harness 的 DSH Plugin Hub); 回 ref, 拿它给 plugin.ext.learn {url: ref} 学。只搜不装',
  { q: 'string', kind: 'string?(skill|mcp|plugin, 不给三家都搜)', ecosystem: 'string?(pi-package|openclaw-plugin|claude-code-plugin|deepseek-harness)', n: 'number?' });
P0('plugin.ext.learn', async a => {
  if (a.package) return 扩展.装包(a.package);
  if (a.text) return 扩展.收技能(a.text, a.source || '贴进来的');
  if (!a.url) throw new Error('给 url(开源网址)、text(SKILL.md 正文) 或 package(导出包) 之一');
  return 扩展.学网址(a);
}, '学一个: url 给市场 ref(clawhub:主/名、npm:包名、mcp:名, 见 plugin.ext.search)、ClawHub/npm 网页、GitHub 仓库/目录/SKILL.md、raw 链接、导出包网址; text 贴 SKILL.md; package 给导出包。只拉文本不花额度; mcp: 的直接接上',
  { url: 'string?', text: 'string?', package: 'string|object?', path: 'string?', auth: 'string?', source: 'string?' });
P0('plugin.ext.list', async a => {
  let l = await 扩展.索取();
  if (a.kind) l = l.filter(x => x.kind === a.kind);
  if (a.grade) l = l.filter(x => x.grade === a.grade);
  if (a.pinned) l = l.filter(x => x.pinned);
  if (a.q) { const q = String(a.q).toLowerCase(); l = l.filter(x => (x.id + ' ' + x.name + ' ' + x.description).toLowerCase().includes(q)); }
  l = l.slice().sort((x, y) => (y.pinned - x.pinned) || (y.at - x.at));
  return { total: l.length, items: l.slice(0, a.n || 30) };
}, '搜扩展库里学来的技能和插件(默认不进系统提示, 用这个按需找): q 关键词, kind skill|plugin, grade direct|map|adapt, pinned',
  { q: 'string?', kind: 'string?', grade: 'string?', pinned: 'boolean?', n: 'number?' });
P0('plugin.ext.read', async a => {
  const it = await 扩展.取(a.id), 行 = 扩展.行(it);
  if (a.part === 'original') return Object.assign(行, { original: 扩展.原文(it) });
  const 用 = it.adapted || (it.grade === 'direct' ? it.body : '');
  return Object.assign(行, 用 ? { text: 用 } : { text: '', note: '还没适配: 要用先 plugin.ext.adapt {id, estimate:true} 看花多少, 再 adapt; 原文用 part:"original" 看' });
}, '读一条扩展: 默认给能照着做的正文(适配好的, 或直接能用的原文); part:"original" 给原文/源码', { id: 'string', part: 'string?' });
P0('plugin.ext.adapt', async a => {
  const it = await 扩展.取(a.id), 原 = 扩展.原文(it);
  if (!原) throw new Error(it.id + ' 没有原文(导入时只带了适配版), 要重来就照来源网址重学: ' + it.source);
  const sys = 扩展.适配说明 + '\n\n能力清单(路径: 说明):\n' + await 扩展.清单();
  const user = '这是一个' + (it.kind === 'plugin' ? '插件的源码' : '技能') + '「' + it.name + '」, 来源 ' + it.source + ':\n\n' + 原;
  const 估 = { 入: 扩展.估(sys.length + user.length), 出上限: 扩展.出上限 };
  if (a.estimate) return { id: it.id, 估计: 估, 说明: '入是估的; 真花多少看回来的 cost' };
  // 关思考: 要的是改写好的正文, 思考只白占额度。有的模型偶尔只回一两个乱码字: 不像正文就再问一次, 两次都花的额度照实记
  const 花 = { 入: 0, 出: 0 };
  let t = '', stop = '';
  for (let 次 = 0; 次 < 2 && t.length < 200; 次++) {
    const r = await ctx.call('ai.chat', { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      maxTokens: 扩展.出上限, think: 'off', ...a.model && { model: a.model } });
    const u = r.usage || {};
    花.入 += u.prompt_tokens ?? u.input_tokens ?? 0;
    花.出 += u.completion_tokens ?? u.output_tokens ?? 0;
    const 全 = String(r.content || ''), 包 = /<skill>([\s\S]*?)(<\/skill>|$)/i.exec(全);   // 只要 <skill> 里的: 分析过程不进技能
    t = (包 ? 包[1] : 全.replace(/<think>[\s\S]*?<\/think>/gi, '')).replace(/^[^\n#\w\u4e00-\u9fff]{1,3}/, '').trim();
    stop = r.stop || '';
  }
  if (t.length < 200) throw new Error('模型两次都没写成(' + t.length + ' 字: ' + t.slice(0, 40) + '), 没存; 花了 ' + 花.入 + '+' + 花.出 + ' token。换个模型: model 参数');
  Object.assign(it, { adapted: t + (stop === 'length' ? '\n\n…(写到输出上限被截断了)' : ''), adaptedBy: a.model || '默认模型',
    cost: 花, truncated: stop === 'length', adaptedAt: Date.now() });
  await 扩展.存(it);
  return { id: it.id, 字数: t.length, cost: 花, 估计: 估, ...stop === 'length' && { 注意: '写到输出上限被截断了, 可以换个更能写的模型重新适配' } };
}, '花额度把一条技能或插件改写成用 Colony 能力的做法(插件、要本机的技能用); estimate:true 只估不花; model 可换模型', { id: 'string', estimate: 'boolean?', model: 'string?' });
P0('plugin.ext.export', async a => {
  const ids = a.ids || (await 扩展.索取()).map(x => x.id), items = await Promise.all(ids.map(扩展.取));
  if (a.format === 'skill') {
    if (items.length !== 1) throw new Error('format:"skill" 一次导一条, 给 ids:[一个 id]');
    return 扩展.技能md(items[0]);
  }
  const mcp = a.mcp === false ? [] : Object.values(await MCP.全()).map(MCP.公开);   // 密钥不导出, 要密钥写着装的那边得自己补哪几样
  return { format: 'colony-ext/1', at: Date.now(),
    items: items.map(it => { const o = Object.assign({}, it); if (!a.original) { delete o.files; if (o.adapted) delete o.body; } return o; }), mcp };
}, '导出: 默认 colony-ext/1 包(含适配好的正文、来源网址、MCP 网址, 不含密钥; 别的 Colony 用 plugin.ext.learn {package} 装, 不花额度); format:"skill" 导一条成标准 SKILL.md(别的 agent 能装)',
  { ids: 'string[]?', format: 'string?', original: 'boolean?', mcp: 'boolean?' });
P0('plugin.ext.pin', async a => {
  const it = await 扩展.取(a.id);
  it.pinned = a.on !== false;
  if (it.pinned && (await 扩展.索取()).filter(x => x.pinned && x.id !== it.id).length >= 10) throw new Error('置顶最多 10 条, 先取消一条');
  await 扩展.存(it);
  return { id: it.id, pinned: it.pinned };
}, '置顶/取消置顶一条扩展: 置顶的名字进全能 agent 的系统提示(最多 10 条)', { id: 'string', on: 'boolean?' });
P0('plugin.ext.remove', async a => { await 扩展.取(a.id); await 扩展.删(a.id); return { removed: a.id }; }, '删一条扩展', { id: 'string' });
P0('plugin.ext.reindex', async () => ({ 条目: await 扩展.重建索引() }), '扩展库的清单和条目对不上时照条目重建清单', {});
// ═ 界面 ═
// 打开插件管理就看到: Colony Bridge 在不在线、接了哪些远程 MCP、从外面学了哪些技能和插件(分级、适配没有、来源网址)。
// 画在 ctx.root: 界面块打开本块时把它搬进窗。数据一变(学、适配、接 MCP)就重画; 看不见时不画, 下次看见再画
const 界面 = {
  脏的: true,
  开: {},   // 展开了哪几行
  确: '',   // 适配: 头一下估价, 再点一下才花
  q: '', 搜到: null,   // 市场搜索词和结果
  搜到行() {
    const e = 界面.esc, 段 = (k, 名) => (界面.搜到[k] || []).length ? '<div class="pm-hint" style="margin-top:8px">' + 名 + '</div>' + 界面.搜到[k].map(x =>
      '<div class="pm-hit"><span class="pm-tag">' + e(x.ecosystem || (k === 'skill' ? (x.downloads || 0) + ' 下载' : k)) + '</span><div class="pm-d"><b>' + e(x.name) + '</b> '
      + e(x.summary) + (x.能接 ? ' <i>(' + e(x.能接) + ')</i>' : '') + (x.suspicious ? ' <span class="pm-tag bad">市场标了可疑</span>' : '') + '</div>'
      + (k === 'mcp' && /接不了/.test(x.能接) ? '' : '<button data-act="take" data-id="' + e(x.ref) + '">' + (k === 'mcp' ? '接入' : '学') + '</button>') + '</div>').join('') : '';
    return 段('skill', '技能 · ClawHub') + 段('mcp', 'MCP · 官方 Registry') + 段('plugin', '插件 · npm') + (界面.搜到.err ? '<p class="pm-msg bad">' + e(界面.搜到.err) + '</p>' : '');
  },
  话: '',
  el: null,
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
  样式: '.pm-ui{--m:var(--text-muted,#8a8a8a);--a:var(--accent,#B5FF00);--l:var(--border,rgba(255,255,255,.08));'
    + 'padding:16px;color:var(--text,#fafafa);font:13px/1.5 var(--sans,-apple-system,"PingFang SC",sans-serif);min-height:200px}'
    + '.pm-ui h3{font-size:12px;color:var(--m);font-weight:500;margin:18px 0 8px;display:flex;gap:8px;align-items:center}'
    + '.pm-ui h3 b{color:var(--text,#fafafa)}.pm-hint{font-size:11px;color:var(--m);margin:0 0 8px}'
    + '.pm-row{border:1px solid var(--l);border-radius:10px;padding:8px 10px;margin:6px 0;background:var(--bg-2,#131313)}'
    + '.pm-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pm-top .pm-n{font-weight:600;cursor:pointer}'
    + '.pm-d{color:var(--m);font-size:12px;margin-top:3px}.pm-tag{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid var(--l);color:var(--m)}'
    + '.pm-tag.direct,.pm-tag.mcp,.pm-tag.ok{color:var(--a);border-color:var(--a)}.pm-tag.map{color:#5ac8fa;border-color:#5ac8fa}'
    + '.pm-tag.adapt{color:var(--warn,#FF9500);border-color:var(--warn,#FF9500)}.pm-tag.bad{color:var(--danger,#FF4444);border-color:var(--danger,#FF4444)}'
    + '.pm-ui button{background:var(--bg,#0a0a0a);color:var(--text,#fafafa);border:1px solid var(--l);border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}'
    + '.pm-ui button:hover{border-color:var(--a)}.pm-ui button.pm-pri{color:var(--a);border-color:var(--a)}.pm-ui button:disabled{opacity:.5;cursor:wait}'
    + '.pm-in{display:flex;gap:6px;margin:6px 0}.pm-in input,.pm-in textarea{flex:1;background:var(--bg,#0a0a0a);color:inherit;border:1px solid var(--l);'
    + 'border-radius:8px;padding:6px 10px;font:inherit;font-size:12px}.pm-in textarea{min-height:60px;font-family:var(--mono,monospace)}'
    + '.pm-sp{flex:1}.pm-ui a{color:var(--m);font-size:11px;word-break:break-all}.pm-pre{white-space:pre-wrap;font:11px/1.5 var(--mono,monospace);'
    + 'color:var(--m);max-height:260px;overflow:auto;margin-top:6px;border-top:1px solid var(--l);padding-top:6px}'
    + '.pm-msg{font-size:12px;color:var(--a);min-height:18px;margin:4px 0}.pm-msg.bad{color:var(--danger,#FF4444)}'
    + '.pm-ui select{background:var(--bg,#0a0a0a);color:inherit;border:1px solid var(--l);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px}'
    + '.pm-hit{display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--l);font-size:12px}.pm-hit .pm-d{flex:1;margin:0}',
  看得见: () => !!(ctx.root && ctx.root.isConnected && ctx.root.offsetParent !== null
    && ctx.root.parentNode && ctx.root.parentNode.id !== 'colony-root'),
  脏() { 界面.脏的 = true; if (界面.看得见()) 界面.画(); },
  说(t, 坏) { 界面.话 = (坏 ? '!' : '') + t; const m = ctx.root && ctx.root.querySelector('.pm-msg'); if (m) { m.textContent = t; m.className = 'pm-msg' + (坏 ? ' bad' : ''); } },
  async 画() {
    if (!ctx.root) return;
    界面.脏的 = false;
    const e = 界面.esc;
    const [ping, ms, idx] = await Promise.all([
      ctx.call('plugin.ping').catch(() => ({ alive: false })),
      MCP.全().catch(() => ({})),
      扩展.索取().catch(() => []),
    ]);
    const 档名 = { direct: '直接用', map: '换名可用', adapt: '要花额度适配', mcp: '套了远程 MCP, 已接上' };
    const 扩行 = x => {
      const 能用 = x.adapted || x.grade === 'direct', 开 = 界面.开['x:' + x.id];
      return '<div class="pm-row"><div class="pm-top">'
        + '<span class="pm-n" data-act="open" data-id="' + e(x.id) + '">' + (开 ? '▾ ' : '▸ ') + e(x.name) + '</span>'
        + '<span class="pm-tag">' + (x.kind === 'plugin' ? '插件' : '技能') + '</span>'
        + '<span class="pm-tag ' + e(x.grade) + '">' + e(档名[x.grade] || x.grade) + '</span>'
        + (能用 ? '<span class="pm-tag ok">' + (x.adapted ? '已适配' + (x.adaptedBy ? ' · ' + e(x.adaptedBy) : '') : '能用') + '</span>' : '<span class="pm-tag bad">还不能用</span>')
        + (x.pinned ? '<span class="pm-tag ok">置顶</span>' : '')
        + (x.cost && x.cost.入 != null ? '<span class="pm-tag">花了 ' + x.cost.入 + '+' + x.cost.出 + ' tok</span>' : '')
        + '<i class="pm-sp"></i>'
        + (x.grade === 'direct' || x.grade === 'mcp' ? '' : !x.origChars   // 装包来的只有适配版: 要重做得先照来源网址把原文拉回来
          ? (/^https?:/.test(x.source) ? '<button data-act="relearn" data-id="' + e(x.id) + '" title="导入时只带了适配版; 照来源网址把原文拉回来(不花额度), 之后才能重新适配">照网址重学</button>' : '')
          : '<button data-act="adapt" data-id="' + e(x.id) + '"' + (界面.确 === x.id ? ' class="pm-pri"' : '') + '>'
            + (界面.确 === x.id ? '确认花额度' : x.adapted ? '重新适配' : '适配') + '</button>')
        + '<button data-act="pin" data-id="' + e(x.id) + '">' + (x.pinned ? '取消置顶' : '置顶') + '</button>'
        + '<button data-act="md" data-id="' + e(x.id) + '" title="导出成标准 SKILL.md, 别的 agent 能装">SKILL.md</button>'
        + '<button data-act="del" data-id="' + e(x.id) + '">删</button></div>'
        + (x.description ? '<div class="pm-d">' + e(x.description) + '</div>' : '')
        + '<div class="pm-d">来源 <a href="' + e(x.source) + '" target="_blank" rel="noopener">' + e(x.source) + '</a> · 原文 ' + x.origChars + ' 字</div>'
        + (开 ? '<div class="pm-pre" data-pre="' + e(x.id) + '">读取中…</div>' : '') + '</div>';
    };
    const mcp行 = s => '<div class="pm-row"><div class="pm-top"><span class="pm-n" data-act="mopen" data-id="' + e(s.id) + '">'
      + (界面.开['m:' + s.id] ? '▾ ' : '▸ ') + e(s.id) + '</span><span class="pm-tag">' + (s.tools || []).length + ' 个工具</span>'
      + (s.serverInfo ? '<span class="pm-tag">' + e(s.serverInfo.name + ' ' + (s.serverInfo.version || '')) + '</span>' : '')
      + '<i class="pm-sp"></i><button data-act="mdel" data-id="' + e(s.id) + '">移除</button></div>'
      + '<div class="pm-d"><a href="' + e(s.url) + '" target="_blank" rel="noopener">' + e(s.url) + '</a></div>'
      + (界面.开['m:' + s.id] ? '<div class="pm-pre">' + (s.tools || []).map(t => '• ' + e(t.name) + ' — ' + e(String(t.description || '').split('\n')[0].slice(0, 120))).join('\n') + '</div>' : '')
      + '</div>';
    const 技 = idx.filter(x => x.kind !== 'plugin'), 插 = idx.filter(x => x.kind === 'plugin'), ss = Object.values(ms);
    const 排 = l => l.slice().sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at));
    ctx.root.innerHTML = '<div class="pm-ui"><style>' + 界面.样式 + '</style>'
      + '<div class="pm-top"><b>Colony Bridge</b>' + (ping.alive ? '<span class="pm-tag ok">在线 ' + e(ping.version || '') + '</span>' : '<span class="pm-tag bad">不在线</span>')
      + '<i class="pm-sp"></i><span class="pm-tag">MCP ' + ss.length + '</span><span class="pm-tag">技能 ' + 技.length + '</span><span class="pm-tag">插件 ' + 插.length + '</span>'
      + '<button data-act="export" title="导出全部: 适配好的正文 + 来源网址 + MCP 网址(不含密钥), 别的 Colony 装上不花额度">导出包</button></div>'
      + '<div class="pm-msg' + (界面.话[0] === '!' ? ' bad' : '') + '">' + e(界面.话.replace(/^!/, '')) + '</div>'
      + '<h3>市场</h3><p class="pm-hint">技能 ClawHub · MCP 官方 Registry · 插件 npm(pi / openclaw / Claude Code) + DSH Plugin Hub(DeepSeek Harness)。搜到挑一个学, 只拉文本不花额度; 插件和带脚本的技能学完点「适配」才花。</p>'
      + '<div class="pm-in"><input data-f="q" placeholder="搜: pdf、memory、web search…" value="' + e(界面.q || '') + '"><select data-f="kind"><option value="">三家</option><option value="skill">技能</option><option value="mcp">MCP</option><option value="plugin">插件</option><option value="dsh">DeepSeek 插件</option></select><button class="pm-pri" data-act="search">搜</button></div>'
      + (界面.搜到 ? 界面.搜到行() : '')
      + '<p class="pm-hint">或给网址: GitHub 仓库 / 技能目录 / SKILL.md / ClawHub、npm 网页 / 导出包</p>'
      + '<div class="pm-in"><input data-f="url" placeholder="https://github.com/…"><button data-act="learn">学</button></div>'
      + '<details><summary class="pm-hint" style="cursor:pointer">或者贴 SKILL.md 正文 / 导出包 JSON</summary>'
      + '<div class="pm-in"><textarea data-f="text"></textarea><button data-act="paste">学</button></div></details>'
      + '<h3><b>远程 MCP</b> · ' + ss.length + '</h3>'
      + '<div class="pm-in"><input data-f="murl" placeholder="MCP 网址 https://…/mcp, 或整段 mcp.json"><input data-f="mauth" placeholder="token(可空)" style="flex:0 0 120px"><button data-act="mcp">接入</button></div>'
      + (ss.map(mcp行).join('') || '<p class="pm-hint">还没接</p>')
      + '<h3><b>技能</b> · ' + 技.length + '<span class="pm-hint" style="margin:0">默认不进 agent 的系统提示, 它用 plugin.ext.list 按需搜; 置顶的(最多 10)才列名字</span></h3>'
      + (排(技).map(扩行).join('') || '<p class="pm-hint">还没学</p>')
      + '<h3><b>插件</b> · ' + 插.length + '</h3>' + (排(插).map(扩行).join('') || '<p class="pm-hint">还没学</p>')
      + '</div>';
    for (const p of ctx.root.querySelectorAll('[data-pre]'))
      ctx.call('plugin.ext.read', { id: p.dataset.pre }).then(r => { p.textContent = r.text || r.note; }, er => { p.textContent = er.message; });
  },
  下载(名, 文) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([文], { type: 'text/plain' }));
    a.download = 名;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async 点(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b || !ctx.root.contains(b)) return;
    const act = b.dataset.act, id = b.dataset.id, 值 = f => (ctx.root.querySelector('[data-f="' + f + '"]') || {}).value || '';
    if (act !== 'adapt') 界面.确 = '';
    const 忙 = async (话, fn) => {
      b.disabled = true; 界面.说(话);
      try { const r = await fn(); if (r !== undefined) 界面.说(r); } catch (e) { 界面.说(e.message, true); }
      b.disabled = false; 界面.画();
    };
    if (act === 'open' || act === 'mopen') { const k = (act === 'open' ? 'x:' : 'm:') + id; 界面.开[k] = !界面.开[k]; return 界面.画(); }
    if (act === 'search') return 忙('搜市场…', async () => {
      界面.q = 值('q').trim();
      if (!界面.q) throw new Error('先填要搜的词');
      const k = 值('kind');
      界面.搜到 = await ctx.call('plugin.ext.search', { q: 界面.q, kind: k === 'dsh' ? 'plugin' : k || undefined, ...k === 'dsh' && { ecosystem: 'deepseek-harness' }, n: 6 });
      const n = ['skill', 'mcp', 'plugin'].reduce((s, k) => s + (Array.isArray(界面.搜到[k]) ? 界面.搜到[k].length : 0), 0);
      return '搜到 ' + n + ' 个; 挑用得上的点「学」';
    });
    if (act === 'take') return 忙('学 ' + id + '…', async () => {
      const r = await ctx.call('plugin.ext.learn', { url: id });
      if (r.tools) return '接上 MCP ' + r.id + ': ' + r.tools.length + ' 个工具';
      if (r.grade === 'mcp') return '「' + r.name + '」只是套了一个远程 MCP: ' + (r.connected || '');
      if (r.要选) return '包里有 ' + r.共 + ' 个技能, 去它的 GitHub 目录学其中一个';
      return '学到「' + r.name + '」: ' + r.grade + (r.grade === 'adapt' ? ', 点「适配」才能用' : '');
    });
    if (act === 'learn' || act === 'paste') return 忙('学习中…', async () => {
      const 文 = act === 'learn' ? 值('url').trim() : 值('text').trim();
      if (!文) throw new Error('先填网址或贴正文');
      const r = act === 'learn' ? await ctx.call('plugin.ext.learn', { url: 文 })
        : /^\s*\{/.test(文) ? await ctx.call('plugin.ext.learn', { package: 文 }) : await ctx.call('plugin.ext.learn', { text: 文 });
      if (r.要选) {
        if (!confirm('这里有 ' + r.共 + ' 个技能(只拉文本不花额度), 全学?\n\n' + r.技能.slice(0, 30).join('\n') + (r.共 > 30 ? '\n…' : ''))) return '没学: 要学其中一个就把网址写到那个技能目录';
        const all = await ctx.call('plugin.ext.learn', { url: 文, all: true });
        return '学到 ' + all.学到 + ' 个: ' + Object.entries(all.分级).map(([k, n]) => k + ' ' + n).join(', ');
      }
      if (r.学到 !== undefined) return '学到 ' + r.学到 + (r.分级 ? ': ' + Object.entries(r.分级).map(([k, n]) => k + ' ' + n).join(', ') : '') + (r.mcp && r.mcp.length ? ', 接上 MCP ' + r.mcp.join(', ') : '') + (r.错 && r.错.length ? '; 错: ' + r.错.join('; ') : '');
      return '学到「' + r.name + '」: ' + r.grade + (r.grade === 'adapt' ? ', 点「适配」才能用' : '');
    });
    if (act === 'adapt') {
      if (界面.确 !== id) return 忙('估算中…', async () => {
        const r = await ctx.call('plugin.ext.adapt', { id, estimate: true });
        界面.确 = id;
        return '「' + id + '」适配约 ' + r.估计.入 + ' token 入、最多 ' + r.估计.出上限 + ' 出; 再点「确认花额度」才开始';
      });
      界面.确 = '';
      return 忙('适配中, 模型在改写…', async () => {
        const r = await ctx.call('plugin.ext.adapt', { id });
        return '适配好了: ' + r.字数 + ' 字, 花了 ' + (r.cost.入 ?? '?') + '+' + (r.cost.出 ?? '?') + ' token';
      });
    }
    if (act === 'relearn') return 忙('照来源网址重学…', async () => {
      const it = await 扩展.取(id), r = await ctx.call('plugin.ext.learn', { url: it.source });
      return '拉回原文: 「' + (r.name || id) + '」' + r.grade + ', 原来的适配版换掉了' + (r.grade === 'adapt' ? ', 要用再点「适配」' : '');
    });
    if (act === 'pin') return 忙('', async () => { const r = await ctx.call('plugin.ext.pin', { id, on: !(await 扩展.取(id)).pinned }); return r.pinned ? '已置顶: 名字进 agent 的系统提示' : '已取消置顶'; });
    if (act === 'del') { if (!confirm('删掉「' + id + '」?')) return; return 忙('', async () => { await ctx.call('plugin.ext.remove', { id }); return '删了 ' + id; }); }
    if (act === 'md') return 忙('', async () => { 界面.下载(id + '.SKILL.md', await ctx.call('plugin.ext.export', { ids: [id], format: 'skill' })); return '导出了 ' + id + '.SKILL.md'; });
    if (act === 'export') return 忙('', async () => {
      const p = await ctx.call('plugin.ext.export', {});
      界面.下载('colony-ext-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(p, null, 1));
      return '导出了 ' + p.items.length + ' 条扩展、' + p.mcp.length + ' 个 MCP; 别的 Colony 在这里贴进去或 plugin.ext.learn {package} 就装上';
    });
    if (act === 'mcp') return 忙('接入中…', async () => {
      const v = 值('murl').trim(), auth = 值('mauth').trim() || undefined;
      if (!v) throw new Error('先填 MCP 网址');
      const r = await ctx.call('plugin.mcp.connect', /^\s*\{/.test(v) ? { config: v, auth } : { url: v, auth });
      return '接上 ' + r.id + ': ' + r.tools.length + ' 个工具';
    });
    if (act === 'mdel') { if (!confirm('移除 MCP「' + id + '」?')) return; return 忙('', async () => { await ctx.call('plugin.mcp.remove', { id }); return '移除了 ' + id; }); }
  },
};
if (ctx.root) {
  ctx.root.addEventListener('click', 界面.点);
  // 界面块把 ctx.root 搬进窗、窗重新露出来时补画; 不在页面上(单独跑、测试)就不画
  const 看 = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && 界面.脏的) 界面.画(); });
  看.observe(ctx.root);
  // 先同步画个壳: 界面块在本块重启那一刻量 root 高度, 是 0 就当没界面、换成卡片
  ctx.root.innerHTML = '<div class="pm-ui"><style>' + 界面.样式 + '</style><p class="pm-hint">载入中…</p></div>';
  界面.画().catch(e => { ctx.root.textContent = '插件管理界面没画出来: ' + e.message; });
}
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ═ 装配 ═
const P = (path, fn, desc, schema) => ctx.provide(path, fn, { desc, schema: schema || {}, frames: false });
P('plugin.ping', async () => {
  try { const r = await 发('ping', {}, 2000); return { alive: true, plugin: r.plugin, version: r.version, build: r.build }; }
  catch (e) { return { alive: false, note: e.message }; }
}, '插件在不在线: 回 {alive, version}');
P('plugin.status', async () => {
  let files = null; try { files = (await ctx.call('data.list', { in: 'disk:plugin/', n: 200 })).items.map(i => i.name); } catch (e) { files = '读不到 disk:plugin/: ' + e.message; }
  return { plugin: await ctx.call('plugin.ping'), files, backups: (await ctx.kv.list(BK)).length };
}, '总览: 插件在线没有、源码文件夹里有哪些文件、快照几条');
P('plugin.list', async () => (await ctx.call('data.list', { in: 'disk:plugin/', n: 200 })).items.map(i => ({ path: i.name, bytes: i.bytes, at: i.at })),
  '列插件源码文件');
P('plugin.read', async a => { const p = 路径(a && a.path), t = await 读(p);
  if (a.from || a.n) { const L = t.split('\n'), f = Math.max(1, a.from || 1); return { path: p, lines: L.length, from: f, text: L.slice(f - 1, f - 1 + (a.n || 200)).join('\n') }; }
  return { path: p, lines: t.split('\n').length, text: t }; },
  '读插件源码; 给 from/n 按行取一段', { path: 'string', from: 'number?', n: 'number?' });
P('plugin.write', a => 稳写(路径(a && a.path), a.text, a.force), '整文件写(先自动快照; manifest.json 要 force)',
  { path: 'string', text: 'string', force: 'boolean?' });
P('plugin.edit', async a => {
  const p = 路径(a && a.path);
  if (typeof a.old !== 'string' || !a.old || typeof a.new !== 'string') throw new Error('要 {path, old, new}, old 不能空');
  const t = await 读(p), n = t.split(a.old).length - 1;
  if (!n) throw new Error('找不到 old: 先 plugin.read 看原文, 空白缩进要逐字一样');
  if (n > 1 && !a.all) throw new Error('old 出现 ' + n + ' 次, 多带点上下文让它唯一, 或给 all:true');
  const r = await 稳写(p, a.all ? t.split(a.old).join(a.new) : t.replace(a.old, () => a.new), a.force);
  return Object.assign(r, { replaced: a.all ? n : 1 });
}, '锚点替换: old 逐字且唯一换成 new(先自动快照)', { path: 'string', old: 'string', new: 'string', all: 'boolean?', force: 'boolean?' });
P('plugin.backup', a => 快照(路径(a && a.path)), '给一个文件留快照', { path: 'string' });
P('plugin.backups', async a => (await ctx.kv.list(BK + (a && a.path ? 路径(a.path) + ':' : ''))).map(e => ({ file: e.value.file, ts: e.value.ts, bytes: (e.value.content || '').length })),
  '列快照', { path: 'string?' });
P('plugin.revert', async a => {
  const p = 路径(a && a.path), all = (await ctx.kv.list(BK + p + ':')).sort((x, y) => y.value.ts - x.value.ts);
  if (!all.length) throw new Error('没有 ' + p + ' 的快照');
  const pick = a.ts ? all.find(e => e.value.ts === a.ts) : all[0];
  if (!pick) throw new Error('没有 ts=' + a.ts + ' 的快照, 有: ' + all.map(e => e.value.ts).join(', '));
  await 写(p, pick.value.content);
  return { ok: true, file: p, revertedTo: pick.value.ts };
}, '回滚到快照(不给 ts = 最近一版)', { path: 'string', ts: 'number?' });
P('plugin.reload', async () => {
  try { await 发('reload', {}, 5000); } catch (e) { }
  for (let i = 0; i < 12; i++) {   // 新 bg 起来后会把 cs.js 重注入各页, 通道自愈; 等它回 ping
    await new Promise(r => setTimeout(r, 1000));
    try { const p = await 发('ping', {}, 1500); return { reloaded: true, alive: true, version: p.version, build: p.build, waitedSec: i + 1 }; } catch (e) { }
  }
  return { reloaded: '指令已发', alive: false, note: '12 秒内没等到新插件回音: 可能改坏了起不来 — 先 plugin.revert 再 plugin.reload, 还不行请用户刷新 Colony 页面或到 chrome://extensions 看报错' };
}, '让插件重新加载源码, 并等它重新上线(回 alive/build)');
P('browser.tabs', async a => (await 浏览器({ method: 'tabs.query', args: [a && a.query || {}] })).map(t => ({ tabId: t.id, windowId: t.windowId, active: t.active, title: t.title, url: t.url })),
  '列标签页: 回 [{tabId, active, title, url}]', { query: 'object?(chrome.tabs.query 的条件)' });
P('browser.cdp', a => {
  const go = () => 浏览器({ tabId: a.tabId, targetId: a.targetId, method: a.method, args: a.args, params: a.params, calls: a.calls, timeout: a.timeout, listen: a.listen }, (a.timeout || 15000) + 5000);
  const 截图 = [a.method, ...(a.calls || []).map(c => c.method)].includes('Page.captureScreenshot');
  return 截图 && a.tabId && !a.targetId ? 前台(a.tabId, a.stay, go) : go();   // 截图的后台页先切到前台, 不然一直等到超时
},
  '通用: CDP 原名命令(或 calls 批量); 带 Page.captureScreenshot 的后台页会先切到前台(stay:true 不切回); 调试器常驻(闲 30 秒才卸), 所以模拟/注入/开着的域会一直生效。listen 给事件前缀(如 ["Network.","Fetch.requestPaused"], true=全部, false=停)开始收集事件, 用 browser.events 拉',
  { tabId: 'number?(不给=活动页)', targetId: 'string?', method: 'string?', params: 'object?', args: 'array?(tabs.* 用)', calls: 'array?([{method, params}])', listen: 'array|boolean?', timeout: 'number?', stay: 'boolean?' });
P('browser.fetch', async a => {
  const r = await 发('fetch', { req: { url: a.url, method: a.method || 'GET', headers: a.headers || {}, body: a.bodyB64 || a.body === undefined ? undefined : (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)), bodyB64: a.bodyB64 || undefined, binary: !!a.binary, timeout: a.timeout || 30000 } }, (a.timeout || 30000) + 5000);
  if (r.error) throw new Error(r.error);
  const out = { status: r.status, contentType: r.contentType, headers: r.headers };
  if (r.base64 !== undefined) { out.base64 = r.base64; out.bytes = r.bytes; }
  else if (a.json || /json/.test(r.contentType || '')) { try { out.json = JSON.parse(r.text); } catch (e) { out.text = r.text; } }
  else out.text = r.text;
  return out;
}, '插件代发 HTTP(S) 请求: 带用户浏览器的 IP 和登录 cookie, 不受跨域限制; JSON 自动解析成 json, binary:true 回 base64; 二进制请求体(zip、图片、multipart 带文件)给 bodyB64(base64, 插件还原成字节再发); 回 {status, contentType, json|text|base64}', { url: 'string', method: 'string?', headers: 'object?', body: 'string|object?', bodyB64: 'string?(二进制请求体的 base64, 给了就不看 body)', binary: 'boolean?', json: 'boolean?', timeout: 'number?' });
P('browser.recStart', async a => { const r = await 发('recStart', { tabId: a.tabId, fps: a.fps, maxWidth: a.maxWidth, quality: a.quality, bps: a.bps }, 20000); if (r.error) throw new Error(r.error); delete r.id; return r; },
  '免点录屏: 插件后台录 Colony 这一页(不弹框、不占通道, 边录边操作不卡); 页要在前台, 没声音; 停用 browser.recStop',
  { fps: 'number?(默认 15)', maxWidth: 'number?(默认原尺寸)', quality: 'number?(JPEG 1-100, 默认 92)', bps: 'number?(码率, 默认 12e6)', tabId: 'number?' });
P('browser.recStop', async a => {
  const r = await 发('recStop', {}, 60000); if (r.error) throw new Error(r.error);
  const name = (a && a.name || '录屏 ' + new Date().toLocaleString()) + '.webm';
  const s = await ctx.call('data.set', { key: 'media:', value: { name, dataUrl: r.dataUrl } });
  return { key: s.key, 秒: +r.sec.toFixed(1), 帧率: r.fps, 字节: r.bytes };
}, '停住免点录屏, 视频存进次元口袋; 回 {key, 秒, 帧率, 字节}, 给人看写 [[show:key]]', { name: 'string?' });
P('browser.recStatus', async () => { const r = await 发('recStatus', {}, 5000); delete r.id; return r; }, '免点录屏在不在录、收到几帧', {});
P('browser.events', async a => { const r = await 发('browserEvents', { tabId: a.tabId, targetId: a.targetId, since: a.since, method: a.method, clear: a.clear }, 10000); return { events: r.events, next: r.next, dropped: r.dropped, note: r.note }; },
  '拉某页收集到的 CDP 事件(先 browser.cdp 带 listen): 回 {events:[{seq,method,params}], next}; 下次给 since: next 只拿新的; method 过滤; Fetch.requestPaused 要及时回 continueRequest/fulfillRequest, 否则页面悬住',
  { tabId: 'number?', targetId: 'string?', since: 'number?', method: 'string|array?', clear: 'boolean?' });
P('browser.ext', async a => (await 发('ext', { req: { method: a.method, args: a.args || [] } }, a.timeout || 20000)).result,
  '调插件的 chrome.* 接口: method 如 history.search / downloads.download / bookmarks.search / windows.create / tabGroups.update / scripting.insertCSS / cookies.getAll / declarativeNetRequest.updateSessionRules; args 数组原样传; scripting.executeScript 给 code 字符串(严格 CSP 的站会拒, 改用 browser.eval)',
  { method: 'string', args: 'array?', timeout: 'number?' });
P('browser.userScript', async a => { const r = await 发('userScript', (({ id, ...rest }) => Object.assign(rest, { sid: id }))(a), 30000); if (r.error) throw new Error(r.error); delete r.id; if (r.sid) { r.id = r.sid; delete r.sid; } return r; },
  '篡改猴式用户脚本(持久、不受 CSP、不靠调试器, 兼容 ==UserScript== 头和常用 GM_*): action list | get {id} | install {code 或 url(如 greasyfork 的 .user.js)} | enable/disable/remove {id} | sync; 要用户在插件详情开「允许用户脚本」',
  { action: 'string', id: 'string?', code: 'string?', url: 'string?', enabled: 'boolean?' });
const 跑 = async (tabId, expr) => {
  const r = await 浏览器({ tabId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true } });
  if (r && r.exceptionDetails) throw new Error('页面里出错: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : r;
};
P('browser.eval', a => 跑(a.tabId, a.expr), '在标签页里跑一段 JS 表达式(可 await), 回它的值', { tabId: 'number?', expr: 'string' });
P('browser.open', async a => { const t = await 浏览器({ method: 'tabs.create', args: [{ url: a.url, active: a.active !== false }] }); return { tabId: t.id, url: a.url }; },
  '开新标签页', { url: 'string', active: 'boolean?' });
P('browser.go', a => 浏览器({ method: 'tabs.update', args: [a.tabId, { url: a.url }] }).then(t => ({ tabId: t.id, url: a.url })),
  '让一个标签页去某网址', { tabId: 'number', url: 'string' });
P('browser.click', a => 跑(a.tabId, '(()=>{const e=document.querySelector(' + JSON.stringify(a.selector) + ');if(!e)throw new Error("找不到 "+' + JSON.stringify(a.selector) + ');e.scrollIntoView({block:"center"});e.click();return (e.innerText||e.value||e.tagName).slice(0,80)})()'),
  '按选择器点一个元素', { tabId: 'number?', selector: 'string' });
P('browser.type', a => 跑(a.tabId, '(()=>{const e=document.querySelector(' + JSON.stringify(a.selector) + ');if(!e)throw new Error("找不到 "+' + JSON.stringify(a.selector) + ');e.focus();const p=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(p,"value");if(d&&d.set)d.set.call(e,' + JSON.stringify(String(a.text)) + ');else e.textContent=' + JSON.stringify(String(a.text)) + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));' + (a.enter ? 'e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,bubbles:true}));e.form&&e.form.requestSubmit&&e.form.requestSubmit();' : '') + 'return true})()'),
  '按选择器往输入框里填字(enter:true 再回车)', { tabId: 'number?', selector: 'string', text: 'string', enter: 'boolean?' });
// 截图都走 截: 后台标签页不渲染, 调试截图会一直等到超时 → 先切到前台, 截完切回(stay:true 不切回);
// 调试截图还是超时(页被别的调试会话占着之类) → 改截窗口看得见的那块(tabs.captureVisibleTab), 有 clip 就按标签页宽度换算裁出来
const 前台 = async (tabId, stay, fn) => {
  const all = await 浏览器({ method: 'tabs.query', args: [{}] });
  const me = tabId ? all.find(t => t.id === tabId) : (await 浏览器({ method: 'tabs.query', args: [{ active: true, lastFocusedWindow: true }] }))[0];   // 不给 = 活动页, 和别的 browser.* 一样
  if (!me) throw new Error('没有 tabId=' + tabId + ' 的标签页');
  const back = !me.active && all.find(t => t.active && t.windowId === me.windowId);
  if (back) { await 浏览器({ method: 'tabs.update', args: [me.id, { active: true }] }); await new Promise(r => setTimeout(r, 600)); }
  try { return await fn(me, !!back); }
  finally { if (back && stay !== true) await 浏览器({ method: 'tabs.update', args: [back.id, { active: true }] }).catch(() => { }); }
};
const 裁 = (b64, fmt, c, tabW) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => {
    const k = i.naturalWidth / tabW, cv = document.createElement('canvas');
    cv.width = Math.round(c.width * k); cv.height = Math.round(c.height * k);
    cv.getContext('2d').drawImage(i, c.x * k, c.y * k, cv.width, cv.height, 0, 0, cv.width, cv.height);
    ok(cv.toDataURL('image/' + fmt, 0.85).split(',')[1]);
  };
  i.onerror = () => no(new Error('截图解不开'));
  i.src = 'data:image/' + fmt + ';base64,' + b64;
});
const 截 = async (me, params) => {
  try { return (await 浏览器({ tabId: me.id, method: 'Page.captureScreenshot', params, timeout: 6000 }, 9000)).data; }
  catch (e) { if (!/超时|timeout/i.test(e.message)) throw e; }
  const fmt = params.format === 'jpeg' ? 'jpeg' : 'png';
  const url = (await 发('ext', { req: { method: 'tabs.captureVisibleTab', args: [me.windowId, { format: fmt, ...fmt === 'jpeg' && { quality: params.quality || 80 } }] } }, 15000)).result;
  const data = String(url).split(',')[1];
  return params.clip ? 裁(data, fmt, params.clip, me.width) : data;
};
P('browser.screenshot', async a => {
  a = a || {};
  const fmt = a.format || 'png', params = { format: fmt, ...fmt === 'jpeg' && { quality: a.quality || 80 } };
  return 前台(a.tabId, a.stay, async (me, switched) => ({ mimeType: 'image/' + fmt, data: await 截(me, params), switched }));
}, '截标签页的图: 回 {mimeType, data(base64)}; 后台页会临时切到前台截完再切回(stay:true 不切回)', { tabId: 'number?', format: 'string?(png|jpeg)', quality: 'number?', stay: 'boolean?' });
// ── 桌面「浏览器」应用里嵌着的页: 每个标签是一个 name=ccb-* 的 iframe, 在 Chrome 里是单独的调试目标(type other)。
// 调试目标列表里没有 iframe 名字, 所以按网址对: 应用报的 url 和目标 url 一致的那个; 同网址多个时再在页里问 window.name。
const 应用状态 = async () => {
  for (const f of (await ctx.call('frame.list')).filter(f => f.frame !== 'host')) {
    try { const r = await ctx.call('frame.eval', { frame: f.frame, expr: 'window.__browser ? window.__browser.state() : null' }); const v = r && r.value !== undefined ? r.value : r; if (v) return { frame: f.frame, miniappId: f.miniappId, ...v }; } catch (e) { }
  }
  throw new Error('没有开着的「浏览器」应用窗: 先 ui.do {target: app:<浏览器 id>, action: 打开}, 且要用户在窗上开「完全访问」');
};
const 应用做 = async (js) => { const s = await 应用状态(); const r = await ctx.call('frame.eval', { frame: s.frame, expr: js }); return r && r.value !== undefined ? r.value : r; };
const 目标 = async (tab) => {
  const s = await 应用状态();
  const t = tab == null ? s.tabs.find(x => x.active) : s.tabs.find(x => x.id === tab || x.name === tab);
  if (!t) throw new Error('浏览器里没有标签 ' + tab + '; 有: ' + s.tabs.map(x => x.id + ' ' + x.title).join(' | '));
  if (!t.url) throw new Error('标签 ' + t.id + ' 是空的新标签页, 先 browser.frameGo');
  const all = (await 浏览器({ method: 'debugger.getTargets' })).filter(x => x.type === 'other' || x.type === 'iframe');
  const strip = u => String(u || '').replace(/#.*$/, '');
  let hit = all.filter(x => strip(x.url) === strip(t.url));
  if (!hit.length) hit = all.filter(x => { try { return new URL(x.url).origin === new URL(t.url).origin; } catch (e) { return false; } });
  if (hit.length > 1) {
    for (const x of hit) {
      try { const r = await 浏览器({ targetId: x.id, method: 'Runtime.evaluate', params: { expression: 'window.name', returnByValue: true } }); if (r.result && r.result.value === t.name) return { targetId: x.id, tab: t }; } catch (e) { }
    }
  }
  if (!hit.length) throw new Error('找不到标签「' + t.title + '」对应的页(可能还在加载), 稍等再试');
  return { targetId: hit[0].id, tab: t };
};
const 页跑 = async (tab, expr) => {
  const { targetId } = await 目标(tab);
  const r = await 浏览器({ targetId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true } });
  if (r && r.exceptionDetails) throw new Error('页面里出错: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : r;
};
const 等到 = async (tab, url, ms) => {   // 等应用里这个标签加载完(钩子报了地址、不在转圈)
  const end = Date.now() + (ms || 20000);
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 800));
    try { const s = await 应用状态(); const t = s.tabs.find(x => x.id === tab); if (t && !t.loading && t.url && t.title && t.title !== '加载中…' && (!url || t.url !== url)) { await 目标(tab); return t; } } catch (e) { }
  }
  return null;
};
P('browser.frameTabs', async () => 应用状态(), '桌面「浏览器」应用里的标签: 回 {frame, tabs:[{id, title, url, active, loading}]}');
P('browser.frameOpen', async a => {
  const t = await 应用做('window.__browser.open(' + JSON.stringify(a.url) + ', ' + (a.active !== false) + ')');
  const done = a.wait === false ? null : await 等到(t.id, null, a.timeout);
  return Object.assign({}, t, done ? { title: done.title, url: done.url, ready: true } : { ready: false });
}, '在「浏览器」应用里开新标签(网址或搜索词), 默认等它加载完; 回 id, 之后的 frame* 都带 tab: id(用户也在用, 「当前标签」会变)', { url: 'string', active: 'boolean?', wait: 'boolean?', timeout: 'number?' });
P('browser.frameGo', async a => {
  const t = await 应用做('window.__browser.go(' + JSON.stringify(a.url) + ', ' + (a.tab == null ? 'undefined' : JSON.stringify(a.tab)) + ')');
  const done = a.wait === false ? null : await 等到(t.id, null, a.timeout);
  return Object.assign({}, t, done ? { title: done.title, url: done.url, ready: true } : { ready: false });
}, '让「浏览器」里的一个标签(不给=当前)去某网址或搜索', { url: 'string', tab: 'number?', wait: 'boolean?', timeout: 'number?' });
P('browser.frameNav', async a => 应用做((a.tab != null ? 'window.__browser.select(' + JSON.stringify(a.tab) + '),' : '') + 'window.__browser.' + ({ back: 'back', forward: 'forward', reload: 'reload', close: 'close', select: 'select' }[a.op] || 'state') + '(' + (a.op === 'close' && a.tab != null ? JSON.stringify(a.tab) : '') + ')'),
  '「浏览器」里: back | forward | reload | close | select(切到 tab)', { op: 'string', tab: 'number?' });
P('browser.frameEval', a => 页跑(a.tab, a.expr), '在「浏览器」某个标签(不给=当前)的页里跑 JS(可 await), 回值', { tab: 'number?', expr: 'string' });
P('browser.frameRead', a => 页跑(a && a.tab, '(()=>{const sel=' + JSON.stringify(a && a.selector || '') + ';const max=' + ((a && a.max) || 20000) + ';if(sel){return [...document.querySelectorAll(sel)].slice(0,50).map(e=>({text:(e.innerText||e.textContent||"").trim().slice(0,2000),href:e.href||undefined,src:e.currentSrc||e.src||undefined}))}return {url:location.href,title:document.title,text:(document.body&&document.body.innerText||"").slice(0,max),links:[...document.querySelectorAll("a[href]")].slice(0,80).map(a=>({t:(a.innerText||a.getAttribute("aria-label")||"").trim().slice(0,60),h:a.href})).filter(x=>x.t)}})()'),
  '读「浏览器」里一页: 不给 selector 回标题、正文、链接; 给了回匹配元素的字/链接', { tab: 'number?', selector: 'string?', max: 'number?' });
// ── 给 agent 提速: 快照(可交互元素编号) → 按编号点/填 → 等状态; 点击走真鼠标事件(网页看到的是可信点击)
const 快照脚本 = (max) => '(()=>{const vis=e=>{const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return false;const s=getComputedStyle(e);return s.visibility!=="hidden"&&s.display!=="none"&&+s.opacity!==0};' +
  'document.querySelectorAll("[data-ccb-ref]").forEach(e=>e.removeAttribute("data-ccb-ref"));' +
  'const sel="a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=true],[onclick],[tabindex]:not([tabindex=\\"-1\\"])";' +
  'const out=[];let i=0;for(const e of document.querySelectorAll(sel)){if(!vis(e))continue;const r=e.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight*3)continue;i++;e.setAttribute("data-ccb-ref",i);' +
  'const tag=e.tagName.toLowerCase(),role=e.getAttribute("role")||(tag==="a"?"link":tag==="textarea"||e.isContentEditable?"textbox":tag==="input"?(e.type||"text"):tag);' +
  'const lb=e.getAttribute(\"aria-labelledby\");const kid=e.querySelector(\"[aria-label],[title],img[alt]\");const svg=e.querySelector(\"svg[class*=octicon]\");' +
  'const name=(e.getAttribute(\"aria-label\")||(lb?lb.split(\" \").map(i=>(document.getElementById(i)||{}).innerText||\"\").join(\" \"):\"\")||e.innerText||e.value||e.placeholder||e.title||e.getAttribute(\"alt\")||(kid?(kid.getAttribute(\"aria-label\")||kid.getAttribute(\"title\")||kid.getAttribute(\"alt\")):\"\")||e.getAttribute(\"data-tooltip\")||(svg?svg.getAttribute(\"class\").replace(/.*octicon-([a-z0-9-]+).*/,\"icon:$1\"):\"\")||(e.href&&tag===\"a\"?new URL(e.href).pathname:\"\")||\"\").replace(/\\\\s+/g,\" \").trim().slice(0,70);' +
  'const x={ref:i,role,name};if(e.href&&tag==="a")x.href=e.href.slice(0,120);if(e.checked||e.getAttribute("aria-checked")==="true"||e.getAttribute("aria-selected")==="true")x.on=1;if(e.disabled)x.off=1;if(r.top>innerHeight||r.bottom<0)x.below=1;out.push(x);if(i>=' + (max || 300) + ')break}' +
  'return {url:location.href,title:document.title,scroll:[Math.round(scrollY),document.documentElement.scrollHeight,innerHeight],items:out,text:(document.body&&document.body.innerText||"").replace(/\\n{3,}/g,"\\n\\n").slice(0,' + 4000 + ')}})()';
P('browser.frameSnapshot', a => 页跑(a && a.tab, 快照脚本(a && a.max)),
  '看「浏览器」里一页: 网址、标题、正文前 4000 字, 和可交互元素清单 [{ref, role, name, href?}]; 之后 frameClick/frameType 直接给 ref', { tab: 'number?', max: 'number?(最多几个元素, 默认 300)' });
const 定位 = (a) => a.ref != null ? 'document.querySelector(\'[data-ccb-ref="' + a.ref + '"]\')' : a.selector ? 'document.querySelector(' + JSON.stringify(a.selector) + ')' :
  '(()=>{const tx=' + JSON.stringify(a.text || '') + ';const c=[...document.querySelectorAll("a,button,[role=button],[role=tab],[role=menuitem],[role=link],input[type=submit],summary,label")];return c.find(x=>(x.innerText||x.value||x.getAttribute("aria-label")||"").trim()===tx)||c.find(x=>(x.innerText||x.getAttribute("aria-label")||"").includes(tx))})()';
P('browser.frameClick', async a => {
  const { targetId } = await 目标(a.tab);
  const pos = await 浏览器({ targetId, method: 'Runtime.evaluate', params: { returnByValue: true, expression: '(()=>{const e=' + 定位(a) + ';if(!e)return null;e.scrollIntoView({block:"center",inline:"center"});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,name:(e.innerText||e.value||e.getAttribute("aria-label")||e.tagName).trim().slice(0,80)}})()' } });
  const p = pos.result && pos.result.value;
  if (!p) throw new Error('找不到要点的元素(' + (a.ref != null ? 'ref ' + a.ref + ', 先重新 frameSnapshot' : a.selector || a.text) + ')');
  if (a.js) { await 页跑(a.tab, '(' + 定位(a) + ').click()'); return { clicked: p.name, via: 'js' }; }
  const m = (type, extra) => ({ method: 'Input.dispatchMouseEvent', params: Object.assign({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, extra || {}) });
  await 浏览器({ targetId, calls: [m('mouseMoved', { button: 'none' }), m('mousePressed'), m('mouseReleased')] });
  return { clicked: p.name, via: 'mouse' };
}, '在「浏览器」里点: 给 ref(frameSnapshot 里的编号)、selector 或按钮上的字; 默认走真鼠标事件, js:true 改用脚本 click', { tab: 'number?', ref: 'number?', selector: 'string?', text: 'string?', js: 'boolean?' });
P('browser.frameWait', async a => {
  const end = Date.now() + (a.timeout || 15000);
  const cond = a.expr ? '(' + a.expr + ')' : a.selector ? '!!document.querySelector(' + JSON.stringify(a.selector) + ')' : a.text ? '(document.body&&document.body.innerText||"").includes(' + JSON.stringify(a.text) + ')' : a.url ? 'location.href.includes(' + JSON.stringify(a.url) + ')' : 'document.readyState==="complete"';
  let last;
  while (Date.now() < end) {
    try { last = await 页跑(a.tab, '(()=>{try{return !!(' + cond + ')}catch(e){return false}})()'); if (last) return { ok: true, waited: (a.timeout || 15000) - (end - Date.now()) }; } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 400));
  }
  return { ok: false, note: '等超时', last };
}, '等「浏览器」里一页满足条件: text(页面出现这段字)、selector、url(网址含)、expr(任意 JS 为真); 不给条件就等加载完', { tab: 'number?', text: 'string?', selector: 'string?', url: 'string?', expr: 'string?', timeout: 'number?' });
P('browser.frameSave', async a => {
  // 由插件后台取(带本浏览器登录 cookie、不受网页跨域/CSP 限制); 相对网址按那页的网址补全
  let base = '';
  try { base = (await 目标(a.tab)).tab.url; } catch (e) { }
  const url = new URL(a.url, base || undefined).href;
  const r = await 发('fetch', { req: { url, method: 'GET', binary: true, timeout: a.timeout || 60000, headers: base ? { Referer: base } : {} } }, (a.timeout || 60000) + 5000);
  if (r.error) throw new Error(r.error);
  if (r.status >= 400) throw new Error('HTTP ' + r.status + ': ' + url);
  const d = (r.headers && r.headers['content-disposition']) || '';
  const m = d.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
  const name = a.name || (m ? decodeURIComponent(m[1]) : (new URL(url).pathname.split('/').pop() || 'download'));
  const type = (r.contentType || 'application/octet-stream').split(';')[0];
  const w = await ctx.call('data.set', { key: a.key || 'media:', value: { name, dataUrl: 'data:' + type + ';base64,' + r.base64 } });
  return { key: w && w.key || w, name, type, size: r.bytes, url };
}, '下载一个文件(带本浏览器的登录, 网址可相对「浏览器」里那页), 存进次元口袋: 回 {key, name, size}', { tab: 'number?', url: 'string', name: 'string?', key: 'string?(默认 media:)', timeout: 'number?' });
P('browser.frameClick_js', a => 页跑(a.tab, '(()=>{let e=' + (a.selector ? 'document.querySelector(' + JSON.stringify(a.selector) + ')' : 'null') + ';const tx=' + JSON.stringify(a.text || '') + ';if(!e&&tx){e=[...document.querySelectorAll("a,button,[role=button],[role=tab],[role=menuitem],input[type=submit],summary,label")].find(x=>(x.innerText||x.value||x.getAttribute("aria-label")||"").trim()===tx)||[...document.querySelectorAll("a,button,[role=button],[role=tab],[role=menuitem],summary,label")].find(x=>(x.innerText||x.getAttribute("aria-label")||"").includes(tx))}if(!e)throw new Error("找不到 "+(' + JSON.stringify(a.selector || '') + '||tx));e.scrollIntoView({block:"center"});e.click();return (e.innerText||e.value||e.getAttribute("aria-label")||e.tagName).trim().slice(0,80)})()'),
  '(旧)脚本 click, 留作兜底', { tab: 'number?', selector: 'string?', text: 'string?' });
P('browser.frameType', async a => {
  // 原生键盘输入只送进有焦点的框架: 嵌入页没焦点时字会落到 Colony 外层。先用真鼠标点输入框把焦点拿进来, 再插字
  const { targetId } = await 目标(a.tab);
  const ev = e => 浏览器({ targetId, method: 'Runtime.evaluate', params: { returnByValue: true, userGesture: true, expression: e } }).then(r => r.result && r.result.value);
  const p = await ev('(()=>{const e=' + 定位(a) + ';if(!e)return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,20),y:r.top+r.height/2}})()');
  if (!p) throw new Error('找不到要填的输入框(ref 过期就重新 frameSnapshot)');
  const m = (type, extra) => ({ method: 'Input.dispatchMouseEvent', params: Object.assign({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, extra || {}) });
  await 浏览器({ targetId, calls: [m('mouseMoved', { button: 'none' }), m('mousePressed'), m('mouseReleased')] });
  await ev('(()=>{const e=' + 定位(a) + ';if(!e)return false;e.focus();' + (a.clear !== false ? 'if(e.isContentEditable){getSelection().selectAllChildren(e)}else if(e.select){e.select()}' : '') + ';return document.activeElement===e||e.contains(document.activeElement)})()');
  const calls = [];
  if (a.clear !== false) calls.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 } }, { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 } });
  calls.push({ method: 'Input.insertText', params: { text: String(a.text) } });
  if (a.enter) calls.push({ method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } }, { method: 'Input.dispatchKeyEvent', params: { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r' } }, { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } });
  await 浏览器({ targetId, calls });
  const v = await ev('(()=>{const e=' + 定位(a) + ';return e?(e.value!==undefined?e.value:e.innerText||"").slice(0,200):null})()').catch(() => null);
  return { ok: true, value: v };
}, '在「浏览器」里的输入框里打字(先真鼠标点进去拿焦点, 再走原生键盘输入; 网页分不出不是人打的); enter:true 再回车; 回框里现在的值', { tab: 'number?', ref: 'number?', selector: 'string?', text: 'string', enter: 'boolean?', clear: 'boolean?' });
P('browser.frameKey', async a => {
  const { targetId } = await 目标(a.tab);
  const K = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''], Delete: [46, ''], ArrowUp: [38, ''], ArrowDown: [40, ''], ArrowLeft: [37, ''], ArrowRight: [39, ''], PageDown: [34, ''], PageUp: [33, ''], Home: [36, ''], End: [35, ''], ' ': [32, ' '] };
  const parts = String(a.key).split('+'), key = parts.pop(), mods = parts.reduce((s, m) => s | ({ Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 }[m] || 0), 0);
  const [code, text] = K[key] || [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? key : ''];
  const calls = [];
  for (let i = 0; i < (a.times || 1); i++) {
    calls.push({ method: 'Input.dispatchKeyEvent', params: { type: text && !mods ? 'keyDown' : 'rawKeyDown', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, modifiers: mods, text: mods ? undefined : text || undefined } },
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers: mods } });
  }
  await 浏览器({ targetId, calls });
  return { ok: true };
}, '在「浏览器」里那页按键(发给当前焦点): Enter、Tab、Escape、ArrowDown、PageDown、Ctrl+A 这类; times 连按几次', { tab: 'number?', key: 'string', times: 'number?' });
P('browser.frameScroll', a => 页跑(a.tab, '(()=>{' + (a.ref != null || a.selector || a.text ? 'const e=' + 定位(a) + ';if(!e)throw new Error("找不到");e.scrollIntoView({block:"center"});' : 'scrollBy(0,' + (a.y != null ? +a.y : Math.round(0.85 * 800)) + ');') + 'return [Math.round(scrollY),document.documentElement.scrollHeight,innerHeight]})()'),
  '在「浏览器」里滚: 给 ref/selector/text 滚到那个元素; 否则按 y 像素滚(默认下翻一屏); 回 [当前位置, 总高, 窗高]', { tab: 'number?', y: 'number?', ref: 'number?', selector: 'string?', text: 'string?' });
P('browser.frameShot', async a => {
  a = a || {};
  const s = await 应用状态();
  if (a.tab != null) { await ctx.call('frame.eval', { frame: s.frame, expr: 'window.__browser.select(' + JSON.stringify(a.tab) + ')' }); await new Promise(r => setTimeout(r, 400)); }
  // 嵌着的页不是顶层, 调试接口不让单截; 截 Colony 标签页, 裁出浏览器应用里网页那块
  const cur = s.tabs.find(t => a.tab != null ? t.id === a.tab : t.active);
  // 可能开着好几个 Colony 标签页: 挑里面真有这个标签(iframe name)且看得见的那个
  const tabs = (await 浏览器({ method: 'tabs.query', args: [{}] })).filter(t => /^https:\/\/colonyai\.fun\//.test(t.url || ''));
  const find = '(()=>{const fs=[];const walk=(d,ox,oy)=>{d.querySelectorAll("iframe").forEach(f=>{const r=f.getBoundingClientRect();const x=ox+r.left,y=oy+r.top;let inner=null;try{inner=f.contentDocument}catch(e){}if(f.name===' + JSON.stringify(cur.name) + '&&r.width>0)fs.push({x,y,w:r.width,h:r.height});if(inner)walk(inner,x,y)})};walk(document,0,0);return fs[0]||null})()';
  let host = null, f = null;
  for (const t of tabs.sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0))) {
    try { const r = await 浏览器({ tabId: t.id, method: 'Runtime.evaluate', params: { returnByValue: true, expression: find } }); if (r.result && r.result.value) { host = t; f = r.result.value; break; } } catch (e) { }
  }
  if (!f) throw new Error('浏览器应用的网页区不在画面上(窗最小化了, 或当前是空标签页)');
  const fmt = a.format || 'jpeg', params = { format: fmt, clip: { x: f.x, y: f.y, width: f.w, height: f.h, scale: 1 }, captureBeyondViewport: false, ...fmt === 'jpeg' && { quality: a.quality || 80 } };
  const data = await 前台(host.id, true, me => 截(me, params));
  return { mimeType: 'image/' + fmt, data, tab: cur.id, title: cur.title, url: cur.url };
}, '截「浏览器」里一页在屏幕上的样子(不给 tab = 当前; 给了会先切过去): 回 {mimeType, data}', { tab: 'number?', format: 'string?(jpeg|png)', quality: 'number?' });
// ✂ 运行窗
// 作品运行窗: 小应用(竞技、评审、测试类)要跑一段别人写的 HTML 并看它、点它时用。经插件开一个单独的浏览器窗口(独立进程):
// 作品死循环、卡死不连累 Colony 和调它的小应用, 读不动就超时, 关窗 30ms 级。作品是 data: 网址, 没有 Colony 的桥、读不到本机存储。
// 只管自己开的窗(号 = 窗 id): 同时最多 4 个, 闲 秒(默认 120)没人碰自动关; 调它的那个应用的窗关掉时, 它开的作品窗也关。
const 运行窗 = {
  表: new Map(), 最多: 4,
  // 页面上的字(前 600)和能点、能填的东西: 没有字的按钮(图标)用 aria-label / title 认, 都没有就给 selector
  清单: '(()=>{const q=(e)=>{if(e.id)return "#"+CSS.escape(e.id);const p=e.parentElement;return (p&&p!==document.body?q(p)+" > ":"")+e.tagName.toLowerCase()+(p?":nth-of-type("+([...p.children].filter(x=>x.tagName===e.tagName).indexOf(e)+1)+")":"");};'
    + 'const 可=[...document.querySelectorAll("button,a[href],input,select,textarea,[onclick],[role=button]")].filter(e=>e.offsetParent!==null||e.getClientRects().length).slice(0,40);'
    + 'return {text:(document.body?document.body.innerText:"").slice(0,600),controls:可.map(e=>{const t=(e.innerText||e.value||"").trim().slice(0,30),l=e.getAttribute("aria-label")||e.title||e.placeholder||"";return {tag:e.tagName.toLowerCase(),label:(/[\\p{L}\\p{N}]/u.test(t)?t:l||t),selector:q(e)};})};})()',
  取(id) { const w = 运行窗.表.get(+id); if (!w) throw new Error('没有这个运行窗(' + id + '): 已关、超时自动关了, 或不是运行窗开的'); w.碰 = Date.now(); return w; },
  async 开(a, meta) {
    const html = String(a.html || ''); if (!html) throw new Error('html 不能空');
    if (html.length > 1.5e6) throw new Error('作品太大(' + (html.length / 1e6).toFixed(1) + ' MB), 上限 1.5 MB');
    if (运行窗.表.size >= 运行窗.最多) throw new Error('运行窗最多开 ' + 运行窗.最多 + ' 个, 先 browser.runClose 关掉不用的');
    const 宽 = Math.min(Math.max(+a.width || 800, 200), 1920), 高 = Math.min(Math.max(+a.height || 600, 150), 1200);
    const w = (await 发('ext', { req: { method: 'windows.create', args: [{ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html),
      type: 'popup', focused: !!a.focused, width: 宽, height: 高 + 40, left: 60 + 运行窗.表.size * 40, top: 60 + 运行窗.表.size * 40 }] } }, 15000)).result;
    const 记 = { id: w.id, tab: w.tabs[0].id, 碰: Date.now(), 闲: Math.min(Math.max(+a.idle || 120, 10), 1800) * 1000,
      主: meta && meta.context && meta.context.miniappId || null, name: String(a.name || '作品').slice(0, 60) };
    运行窗.表.set(w.id, 记); 运行窗.看门();
    // 等它加载完: 作品常引外网 CDN(tailwind、字体), 没加载完就点会找不到按钮。最多等 load 秒(默认 15), 再给脚本 wait 毫秒画好
    const 限 = Date.now() + Math.min(Math.max(+a.load || 15, 1), 60) * 1000; let 态 = 'loading';
    while (Date.now() < 限) { 态 = await Promise.race([跑(记.tab, 'document.readyState'), new Promise(r => setTimeout(() => r('卡住'), 3000))]).catch(() => 'loading');
      if (态 === 'complete' || 态 === '卡住') break; await new Promise(r => setTimeout(r, 300)); }
    await new Promise(r => setTimeout(r, +a.wait || 500));
    const 看 = 态 === '卡住' ? null : await Promise.race([跑(记.tab, 运行窗.清单), new Promise(r => setTimeout(() => r(null), 3000))]).catch(() => null);
    return { id: w.id, name: 记.name, ready: 态 === 'complete' ? true : 态 === '卡住' ? '卡住了(脚本可能死循环)' : '超时还没加载完(外网资源慢?)', ...(看 || {}) };
  },
  // 在作品里算一段 JS(可 await), 超时就说它卡住了: 卡住的作品读不动, 关掉就好
  async 算(id, expr, 秒) {
    const w = 运行窗.取(id), ms = Math.min(Math.max(+秒 || 8, 1), 60) * 1000;
    return Promise.race([跑(w.tab, expr), new Promise((_, no) => setTimeout(() => no(new Error('作品 ' + ms / 1000 + ' 秒没回应(可能卡死或死循环); 用 browser.runClose 关掉')), ms))]);
  },
  async 关(id) {
    const w = 运行窗.表.get(+id); if (!w) return { closed: false };
    运行窗.表.delete(+id); await 发('ext', { req: { method: 'windows.remove', args: [w.id] } }, 5000).catch(() => { }); return { closed: true };
  },
  看门() {
    if (运行窗.钟) return;
    运行窗.钟 = setInterval(async () => {
      const 活 = new Set(colony.has('frame.list') ? (await ctx.call('frame.list', {}).catch(() => [])).map(f => f.miniappId).filter(Boolean) : []);
      for (const w of [...运行窗.表.values()]) if (Date.now() - w.碰 > w.闲 || (w.主 && !活.has(w.主))) 运行窗.关(w.id);
      if (!运行窗.表.size) { clearInterval(运行窗.钟); 运行窗.钟 = null; }
    }, 5000);
    ctx.cleanup(() => { clearInterval(运行窗.钟); [...运行窗.表.keys()].forEach(运行窗.关); });
  },
};
const R = (path, fn, desc, schema) => ctx.provide(path, fn, { desc, schema: schema || {}, frames: true });
R('browser.runOpen', (a, meta) => 运行窗.开(a, meta), '开一个作品运行窗: 把一段完整 HTML 放进单独的浏览器窗口里跑(独立进程, 卡死不连累 Colony), 等它加载完(外网资源最多 load 秒), 回 {id, ready, text, controls}(controls 同 runSee)。'
  + '作品没有 Colony 的桥、读不到本机存储; 闲 idle 秒(默认 120)没人碰自动关, 调它的应用关窗时也关; 同时最多 4 个。看完一定 runClose',
  { html: 'string', name: 'string?', width: 'number?(默认 800)', height: 'number?(默认 600)', idle: 'number?(秒)', focused: 'boolean?', load: 'number?(最多等加载几秒, 默认 15)', wait: 'number?(加载完再等几毫秒, 默认 500)' });
R('browser.runEval', a => 运行窗.算(a.id, a.expr, a.timeout), '在作品里算一段 JS(可 await, 回 JSON 能装的值): 读 DOM、读状态、模拟操作都用它; 作品卡死时 timeout 秒(默认 8)报错',
  { id: 'number', expr: 'string', timeout: 'number?' });
// 真按键: 走 CDP Input.dispatchKeyEvent, 带齐 key / code / keyCode, 游戏(推箱子、贪吃蛇)认 e.key 也认 e.keyCode; 插件不给 CDP 时退回合成事件
const 键表 = { ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Enter: ['Enter', 13], ' ': ['Space', 32], Space: ['Space', 32],
  Escape: ['Escape', 27], Backspace: ['Backspace', 8], Tab: ['Tab', 9], Shift: ['ShiftLeft', 16], Delete: ['Delete', 46], Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34] };
const 真按 = async (w, key) => {
  const k = key === 'Space' ? ' ' : key, 表 = 键表[k] || (k.length === 1 ? [/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : '', k.toUpperCase().charCodeAt(0)] : [k, 0]);
  const p = { key: k, code: 表[0], windowsVirtualKeyCode: 表[1], nativeVirtualKeyCode: 表[1] }, 字 = k.length === 1 ? { text: k, unmodifiedText: k } : {};
  await 浏览器({ tabId: w.tab, method: 'Input.dispatchKeyEvent', params: Object.assign({ type: 字.text ? 'keyDown' : 'rawKeyDown' }, p, 字) }, 5000);
  await 浏览器({ tabId: w.tab, method: 'Input.dispatchKeyEvent', params: Object.assign({ type: 'keyUp' }, p) }, 5000);
};
R('browser.runAct', async a => { // 点、填、按键, 和人一样; 回动作后的页面文字(前 600 字), 方便直接看效果
  if (a.do === 'key' && !a.selector && !a.label) { // 按键给整页(当前焦点), 用真按键; keys 一次按一串
    const w = 运行窗.取(a.id), ks = [].concat(a.keys || a.key || 'Enter').slice(0, 30); let 真 = true;
    for (const k of ks) { try { if (真) await 真按(w, String(k)); } catch (e) { 真 = false; }
      if (!真) await 运行窗.算(a.id, '(()=>{const t=document.activeElement||document.body;for(const y of ["keydown","keyup"])t.dispatchEvent(new KeyboardEvent(y,{key:' + JSON.stringify(String(k)) + ',bubbles:true}));})()', a.timeout);
      await new Promise(r => setTimeout(r, +a.gap || 80)); }
    return 运行窗.算(a.id, '(async()=>{await new Promise(r=>setTimeout(r,' + (+a.wait || 300) + '));return document.body.innerText.slice(0,600);})()', a.timeout);
  }
  const sel = JSON.stringify(a.selector || ''), txt = JSON.stringify(a.text == null ? '' : String(a.text));
  const 找 = 'const e=' + (a.selector ? 'document.querySelector(' + sel + ')' : '(()=>{const L=' + JSON.stringify(String(a.label || '').trim()) + ',可=[...document.querySelectorAll("button,a,input,select,textarea,[onclick],[role=button]")],名=x=>[(x.innerText||x.value||"").trim(),x.getAttribute("aria-label")||"",x.title||"",x.placeholder||""];'
    + 'return 可.find(x=>名(x).includes(L))||可.find(x=>名(x).some(n=>n&&n.includes(L)));})()') + ';if(!e)throw new Error("找不到 "+' + JSON.stringify(a.selector || a.label || '') + '+"; 页面上能点的: "+[...document.querySelectorAll("button,a,input,[role=button]")].slice(0,20).map(x=>((x.innerText||x.value||"").trim()||x.getAttribute("aria-label")||x.title||x.tagName.toLowerCase()).slice(0,20)).join(" | "));';
  const 做 = a.do === 'type' ? 'e.focus();const p=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(p,"value");d&&d.set?d.set.call(e,' + txt + '):e.value=' + txt + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));'
    : a.do === 'key' ? '(e||document.activeElement||document.body||document.documentElement).dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(a.key || 'Enter') + ',bubbles:true}));(e||document.activeElement||document.body||document.documentElement).dispatchEvent(new KeyboardEvent("keyup",{key:' + JSON.stringify(a.key || 'Enter') + ',bubbles:true}));'
    : 'e.scrollIntoView({block:"center"});["pointerdown","mousedown","pointerup","mouseup"].forEach(t=>e.dispatchEvent(new MouseEvent(t,{bubbles:true})));e.click();';
  return 运行窗.算(a.id, '(async()=>{' + (a.do === 'key' && !a.selector && !a.label ? 'const e=null;' : 找) + 做 + 'await new Promise(r=>setTimeout(r,' + (+a.wait || 300) + '));return document.body.innerText.slice(0,600);})()', a.timeout);
}, '在作品里像人一样做一下: do = click(默认) | type(填 text) | key(按 key, 默认 Enter; 不给 selector/label 时是真按键(游戏认 e.key 和 keyCode), keys 给一串依次按, gap 键间隔毫秒); 用 selector 或 label 找元素(label 认按钮上的字、aria-label、title、placeholder, 包含就算); 回做完后页面上的字(前 600); 找不到时报错里列出能点的',
  { id: 'number', do: 'string?(click|type|key)', selector: 'string?', label: 'string?', text: 'string?', key: 'string?(ArrowUp、Enter、a…)', keys: 'string[]?(一串依次按)', gap: 'number?(键间隔, 默认 80)', wait: 'number?(做完等几毫秒, 默认 300)', timeout: 'number?' });
R('browser.runSee', a => 运行窗.算(a.id, 运行窗.清单, a.timeout), '看一眼作品: 回 {text(页面上的字), controls[{tag, label, selector}]} — 能点、能填的东西和怎么找它(没字的图标按钮用 aria-label/title, 都没有就用 selector)', { id: 'number', timeout: 'number?' });
R('browser.runShot', async a => {
  const w = 运行窗.取(a.id);
  const r = await Promise.race([浏览器({ tabId: w.tab, method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: Math.min(Math.max(+a.quality || 70, 20), 95) } }, 15000),
    new Promise((_, no) => setTimeout(() => no(new Error('作品 5 秒没画出来(可能卡死或死循环); 用 browser.runClose 关掉')), 5000))]);
  return { dataUrl: 'data:image/jpeg;base64,' + (r && (r.data || r.result && r.result.data)) };
}, '给作品截一张图, 回 {dataUrl}(JPEG); 要交给 agent 看就 bridge.file 存成附件再发', { id: 'number', quality: 'number?(20-95, 默认 70)' });
R('browser.runClose', a => a.id === 'all' ? Promise.all([...运行窗.表.keys()].map(运行窗.关)).then(l => ({ closed: l.length })) : 运行窗.关(a.id),
  '关掉一个作品运行窗(id: \'all\' 关掉全部自己开的)', { id: 'number|string' });
// ✂ 运行窗 完
return {};
'use strict';
// ═ 自报 ═
// 改 Colony Bridge 插件源码并操控真浏览器(零黄条自动化/抓包/作品运行窗); 统一托管网页插件、远程 MCP 与扩展技能库(默认不预载, 按需 plugin.web/mcp/ext.list 查目录再读详情)
// 数据 {"prefix": "pluginfs:", "label": "插件源码快照", "kind": "backup"}
// 数据 {"prefix": "plugin.mcp.", "label": "接入的远程 MCP", "kind": "config"}
// 数据 {"prefix": "plugin.web.", "label": "网页插件", "kind": "config"}
// 数据 {"prefix": "plugin.ext.", "label": "学来的技能和插件", "kind": "data"}
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【创建技能、网页插件与MCP】新建/整理技能、网页插件或 MCP 时走三步闭环：
//   ① 先查后分流：先 plugin.web.list / plugin.ext.list / plugin.mcp.list / apps.list 查已有避免重复。四选一载体：纯方法论/避坑→技能；需登录态或无公开 API 的网站→网页插件(plugin.web.explore / install)；外部标准工具服务→远程 MCP(plugin.mcp.connect)；需独立界面或持久化库→小应用或新块。
//   ② 最小规范构建：
//      - 技能：只提炼真实试跑过的不可猜步骤/边界/反例，目录写精准触发词，正文不堆废话。
//      - 网页插件：优先 plugin.web.explore {url, goal}；通路严格按「原生 WebMCP > tools.fetchSite(asSite:true) > 页内同源接口/令牌(tools.fetchInTab) > 零黄条页面操作(tools.pickMenu / fillEditor / pasteImages)」；只写站点差异，绝不改底座；不可逆动作(删/发/付/改设置)须标需用户确认。
//      - 跨站通用工程纪律：① 耗时等待(>10s)禁止在单次 runPage 里 while 死等(后台定时器节流+消息超时)，一律「页内起异步任务挂状态 → 宿主短轮询」；② 禁写 innerHTML(防 TrustedTypes 报错)；解析先定主容器勿盲搜 body.innerText；读折叠侧边栏/抽屉前先展开；③ 流式/渐进产出设就绪门槛+连续两次稳定，多元素时锁定目标勿每轮重排；④ 大站分阶段收口，前半程先装 MVP 验通落盘再增量补全，退出前清临时页。
//      - MCP：按高层工作流组织工具并控制返回体大小，接完即 plugin.mcp.tools 并实调一条只读工具验收。
//   ③ 真实试跑与如实标注：每类产出必须真跑验收；受登录/配额/风控/高危限制未测的如实标「待人工验证」，不写猜测。
// 【网页插件与自动化】泛化托管任意网站插件(不仅限大模型站)：调用前先 plugin.web.describe 读动作与避坑；新增站点优先 plugin.web.explore {url, goal}(有全能 agent 自动派探索 worker，无则降级返只读指纹)，或手工走「探查(probeTab)→建模(capabilities/actions/skills/可选 models)→封装(plugin.web.install 复用 tools.*)→实测」；仅声明 models 的插件可 enable 接入 AI 配置。
//   零黄条页面操作用折叠 🤖 后台组 bgTab + MAIN 世界 runPage + MutationObserver，不挂 CDP；定位先语义后稳定属性(role/aria-label/data-testid)，菜单走 tools.pickMenu(可见性过滤防串台)，富文本与参考图走 tools.fillEditor / pasteImages，每步带超时与 AbortSignal 清理。
// 【插件能做什么】browser.* 操控真浏览器(免调试器: tabs/open/go/click/type/eval/screenshot/fetch/userScript；需抓包才 cdp/events)；演示自己写的网页/游戏用 browser.runOpen 放进独立作品运行窗，勿抢占用户当前页。
// 【登录、风控与边界】复用 Chrome 当前登录态，不替人输密码、不碰 Cloudflare Cookie(__cf*/cf_*)，未登录时 browser.open 请用户手动登录；插件进不了 chrome:// 与扩展商店页，userScript 需开启「允许用户脚本」，改完 manifest.json/权限需用户到 chrome://extensions 点刷新。
// 【免点录屏】用 ui.rec.start / stop(依赖插件, 不弹系统分享窗)。
// 【远程 MCP】plugin.mcp.connect 接入后用 plugin.mcp.tools 查工具、plugin.mcp.call 调用。
// 【扩展库】plugin.ext.search → plugin.ext.learn {url:ref}; plugin.ext.list/read 按需用; adapt 先 estimate:true 估价; export 导出 colony-ext/1 或 SKILL.md。
// 块自带技能段不在这里: 用 skill.read {id:块,name}。
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
let 源根 = null;
const 路径 = p => {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^plugin\//, '');
  if (!s || s.includes('..')) throw new Error('要 path(插件文件夹里的相对路径, 如 bg.js)');
  return s;
};
const 是插件 = async dir => {
  try {
    const r = await ctx.call('data.get', { key: dir + 'manifest.json' });
    const m = JSON.parse(typeof r === 'string' ? r : (r && r.text || ''));
    return !!(m && m.name === 'Colony Bridge');
  } catch (e) { return false; }
};
async function 根(重扫) {
  if (!重扫 && 源根 && await 是插件(源根)) return 源根;
  源根 = null;
  if (await 是插件('disk:plugin/')) return (源根 = 'disk:plugin/');
  let disks = [];
  try { disks = (await ctx.call('data.list', { in: 'disk:', n: 100 })).items || []; } catch (e) { }
  for (const d of disks) {
    const dk = d.key.endsWith('/') ? d.key : d.key + '/';
    if (await 是插件(dk)) return (源根 = dk);
    let subs = [];
    try { subs = (await ctx.call('data.list', { in: dk, n: 200 })).items || []; } catch (e) { }
    const dirs = subs.filter(s => s.type === 'dir')
      .sort((a, b) => (/^(plugin|colony-bridge)$/i.test(b.name) ? 1 : 0) - (/^(plugin|colony-bridge)$/i.test(a.name) ? 1 : 0));
    for (const s of dirs) {
      const sk = s.key.endsWith('/') ? s.key : s.key + '/';
      if (await 是插件(sk)) return (源根 = sk);
    }
  }
  throw new Error('找不到 Colony Bridge 源码目录(需在次元口袋连接插件目录或其父目录, 且含 manifest.json)');
}
const 读 = async p => { const r = await ctx.call('data.get', { key: (await 根()) + p }); return typeof r === 'string' ? r : (r && r.text != null ? r.text : ''); };
const 写 = async (p, text) => ctx.call('data.set', { key: (await 根()) + p, value: text });
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
    const [ping, ms, idx, webs] = await Promise.all([
      ctx.call('plugin.ping').catch(() => ({ alive: false })),
      MCP.全().catch(() => ({})),
      扩展.索取().catch(() => []),
      ctx.call('plugin.web.list').catch(() => []),
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
    const 网行 = w => {
      const 开 = 界面.开['w:' + w.id];
      return '<div class="pm-row"><div class="pm-top">'
        + '<span class="pm-n" data-act="wopen" data-id="' + e(w.id) + '">' + (开 ? '▾ ' : '▸ ') + e(w.name) + '</span>'
        + (w.hasModels
          ? '<span class="pm-tag">' + e((w.models || []).join(' · ')) + '</span>'
          : '<span class="pm-tag">网站插件</span>')
        + '<span class="pm-tag">动作 ' + (w.actionCount || 0) + ' · 技能 ' + (w.skillCount || 0) + '</span>'
        + (w.enabled
          ? '<span class="pm-tag ok">已接入 AI 配置</span>'
          : (w.loggedIn ? '<span class="pm-tag ok">可用</span>' : '<span class="pm-tag bad">未登录</span>'))
        + '<i class="pm-sp"></i>'
        + (w.loggedIn ? '' : '<button data-act="weblogin" data-id="' + e(w.id) + '">去登录</button>')
        + (w.hasModels ? (w.enabled
          ? '<button data-act="webon" data-id="' + e(w.id) + '">同步</button><button data-act="weboff" data-id="' + e(w.id) + '">断开 AI</button>'
          : '<button class="pm-pri" data-act="webon" data-id="' + e(w.id) + '">接入 AI 配置</button>') : '')
        + '<button data-act="webreexplore" data-id="' + e(w.id) + '" title="派探索 worker 重新摸排该网站并补齐功能">重探</button>'
        + '<button data-act="webdel" data-id="' + e(w.id) + '">删除</button>'
        + '</div><div class="pm-d">' + e(w.desc || '') + '</div>'
        + (开 ? '<div class="pm-pre" data-wpre="' + e(w.id) + '">读取中…</div>' : '') + '</div>';
    };
    ctx.root.innerHTML = '<div class="pm-ui"><style>' + 界面.样式 + '</style>'
      + '<div class="pm-top"><b>Colony Bridge</b>' + (ping.alive ? '<span class="pm-tag ok">在线 ' + e(ping.version || '') + '</span>' : '<span class="pm-tag bad">不在线</span>')
      + '<i class="pm-sp"></i><span class="pm-tag">网页插件 ' + webs.length + '</span><span class="pm-tag">MCP ' + ss.length + '</span><span class="pm-tag">技能 ' + 技.length + '</span><span class="pm-tag">插件 ' + 插.length + '</span>'
      + '<button data-act="refresh">刷新</button>'
      + '<button data-act="export" title="导出全部: 适配好的正文 + 来源网址 + MCP 网址(不含密钥), 别的 Colony 装上不花额度">导出包</button></div>'
      + '<div class="pm-msg' + (界面.话[0] === '!' ? ' bad' : '') + '">' + e(界面.话.replace(/^!/, '')) + '</div>'
      + '<h3><b>网页插件</b> · ' + webs.length + '</h3>'
      + '<p class="pm-hint">复用当前 Chrome 登录态，支持任意网站(AI 工具、SaaS、内容站等)零本地服务零黄条封装为插件；输入网址可自动深度探索并生成插件。</p>'
      + '<div class="pm-in"><input data-f="wurl" placeholder="输入网址，如 https://example.com"><input data-f="wgoal" placeholder="重点探索的功能(可空)" style="flex:0 0 180px"><button class="pm-pri" data-act="webexplore">探索并生成</button></div>'
      + (webs.length ? webs.map(网行).join('') : '<p class="pm-hint">暂无网页插件</p>')
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
    for (const p of ctx.root.querySelectorAll('[data-wpre]'))
      ctx.call('plugin.web.describe', { id: p.dataset.wpre }).then(r => {
        const acts = (r.actions || []).map(x => '• ' + x.name + ' — ' + (x.desc || '')).join('\n');
        const sks = (r.skills || []).map(x => '• ' + x.name + (x.when ? ' (' + x.when + ')' : '')).join('\n');
        p.textContent = (acts ? '【动作】\n' + acts + '\n\n' : '') + (sks ? '【技能】\n' + sks : '') || JSON.stringify(r, null, 2);
      }, er => { p.textContent = er.message; });
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
    if (act === 'refresh') return 忙('刷新状态…', async () => '已刷新');
    if (act === 'weblogin') return 忙('打开登录页…', async () => {
      const list = await ctx.call('plugin.web.list');
      const w = list.find(x => x.id === id);
      if (w?.origin) await ctx.call('browser.open', { url: w.origin, active: true });
      return '已在浏览器打开 ' + (w?.origin || id) + '，登录完点「刷新」';
    });
    if (act === 'webon') return 忙('配对并接入 AI 配置…', async () => {
      const r = await ctx.call('plugin.web.enable', { id });
      return '已接入「' + r.name + '」: ' + (r.pulled || (r.models || []).join(', '));
    });
    if (act === 'weboff') {
      return 忙('断开 AI 配置…', async () => { await ctx.call('plugin.web.disable', { id }); return '已从 AI 配置断开 ' + id; });
    }
    if (act === 'webdel') {
      if (!confirm('彻底删除网页插件「' + id + '」?(如有接入 AI 配置会同时移除)')) return;
      return 忙('删除插件…', async () => { await ctx.call('plugin.web.remove', { id }); return '已删除网页插件 ' + id; });
    }
    if (act === 'webexplore' || act === 'webreexplore') return 忙('正在勘探网站并启动探索…', async () => {
      const args = act === 'webreexplore' ? { id, goal: 值('wgoal').trim() || undefined } : { url: 值('wurl').trim(), goal: 值('wgoal').trim() || undefined };
      const r = await ctx.call('plugin.web.explore', args);
      if (r.mode === 'worker') return '已派后台探索任务(' + r.taskId + ')深入摸排 ' + r.origin + '，完成后点「刷新」查看新插件';
      return '只读勘探完成(' + r.origin + ', 控件 ' + (r.probe?.controlsCount || 0) + ' 个, 路由 ' + (r.probe?.navRoutes?.length || 0) + ' 条): ' + (r.note || '');
    });
    if (act === 'open' || act === 'mopen' || act === 'wopen') { const k = (act === 'open' ? 'x:' : act === 'mopen' ? 'm:' : 'w:') + id; 界面.开[k] = !界面.开[k]; return 界面.画(); }
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
  queueMicrotask(() => 界面.画().catch(e => { ctx.root.textContent = '插件管理界面没画出来: ' + e.message; }));
}
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 petri:ai 的 协议适配
// ═ 网页模型 · 跟着: 插件通道, 协议适配 ═
// 纯通用动态运行时(不焊死任何站点): 所有网页应用/模型插件存 plugin.web.plugins，可独立 install / remove / enable / disable / describe / observe / act。
// 底层全部走插件无黄条通用能力: 折叠「🤖」标签组静默后台页(bgTab) + chrome.userScripts.execute(runPage 零调试器/零黄条/无视 CSP) + MutationObserver 事件驱动 + asSite:true 同源抓取 + AbortSignal 瞬时关页 + 可配并发信号量。
const 网页模型 = (() => {
  const 本 = {}, 库 = 'plugin.web.plugins';
  const 池 = new Map(), 活页 = new Set();
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const 睡 = ms => new Promise(r => setTimeout(r, ms));
  const W = (path, fn, desc, schema) => ctx.provide(path, fn, { desc, schema: schema || {}, frames: false });
  const 限并 = (id, max, fn) => {
    let s = 池.get(id);
    if (!s) 池.set(id, s = { n: 0, q: [] });
    const 跑 = () => {
      s.n++;
      return Promise.resolve().then(fn).finally(() => { s.n--; if (s.q.length) s.q.shift()(); });
    };
    return s.n < max ? 跑() : new Promise((ok, no) => s.q.push(() => 跑().then(ok, no)));
  };

  async function 全部() { return (await ctx.kv.get(库).catch(() => null)) || {}; }
  async function 存全(all) { await ctx.kv.set(库, all); if (typeof 界面 !== 'undefined') 界面.脏(); }

  async function 查登(site) {
    const raw = site?.authCookie;
    const names = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).filter(Boolean);
    if (!names.length) return true;
    try {
      const list = await ctx.call('browser.ext', { method: 'cookies.getAll', args: [{ domain: site.domain }] });
      const now = Date.now() / 1000;
      return Array.isArray(list) && list.some(c => names.includes(c.name) && c.value && (!c.expirationDate || c.expirationDate > now));
    } catch { return false; }
  }

  const 关页 = tabId => {
    活页.delete(tabId);
    return 发('bgTab', { req: { action: 'close', tabId } }, 8000).catch(() =>
      ctx.call('browser.ext', { method: 'tabs.remove', args: [tabId] }).catch(() => {}));
  };

  async function 页跑(tabId, code, ms, world) {
    const r = await 发('runPage', { req: { tabId, code, ...(world ? { world } : {}) } }, ms || 35000);
    if (r.error) throw new Error(r.error);
    return r.result;
  }

  // 兼容两种签法: openTab(url, fn) 或 openTab(url, fn, {readyExpr, signal, timeout, world})
  async function 后台页(url, fn, opt) {
    const o = opt || {}, signal = o.signal;
    if (signal?.aborted) throw new Error('已取消');
    let r;
    for (let k = 0; k < 3; k++) {
      try { r = await 发('bgTab', { req: { url, groupTitle: '🤖', color: 'grey' } }, 15000); break; }
      catch (e) { if (k < 2 && /cannot be edited|dragging/i.test(String(e?.message || e))) { await 睡(450); continue; } throw e; }
    }
    if (r.error || r.tabId == null) throw new Error(r.error || '打开静默后台页失败');
    const tabId = r.tabId;
    活页.add(tabId);
    const 断 = () => 关页(tabId);
    if (signal) signal.addEventListener('abort', 断, { once: true });
    try {
      let locked = false;
      const keepAlive = () => 页跑(tabId, `(() => { try { if (!window.__colonyKeepAlive && navigator.locks) { window.__colonyKeepAlive = 1; navigator.locks.request('__colony_keepalive__', () => new Promise(() => {})); } } catch {} return 1; })()`, 3500, 'MAIN').then(() => { locked = true; }, () => {});
      for (let i = 0; i < 40; i++) {
        if (signal?.aborted) throw new Error('已取消');
        const info = await 发('ext', { req: { method: 'tabs.get', args: [tabId] } }, 5000).then(x => x.result).catch(() => null);
        if (info && info.url && /^https?:/.test(info.url) && !locked) await keepAlive();
        if (info && (info.status === 'complete' || i > 20)) break;
        await 睡(200);
      }
      // 折叠后台组里的标签极易在 1~2s 内被 Chrome 冻结(frozen:true)，完成加载后再兜底持锁一次
      await keepAlive();
      if (o.readyExpr) {
        const waitMs = o.timeout || 20000;
        const ok = await 页跑(tabId, `(async()=>{const check=()=>!!(${o.readyExpr});if(check())return true;`
          + `return new Promise(res=>{const ob=new MutationObserver(()=>{if(check()){ob.disconnect();clearTimeout(t);res(true);}});`
          + `ob.observe(document.documentElement,{childList:true,subtree:true,attributes:true});`
          + `const t=setTimeout(()=>{ob.disconnect();res(check());},${waitMs});});})()`, waitMs + 5000, o.world);
        if (!ok) throw new Error('页面加载超时，请确认已在浏览器登录 ' + url);
      } else {
        await 睡(300);
      }
      return await fn(tabId);
    } finally {
      if (signal) signal.removeEventListener('abort', 断);
      await 关页(tabId);
    }
  }

  const 工具 = {
    sleep: 睡,
    openTab: 后台页,
    runPage: 页跑,
    // evalTab 兼容旧插件: 自动走无黄条 runPage，不再挂 CDP 调试器
    evalTab: (tabId, expr, ms, world) => 页跑(tabId, expr, ms || 35000, world),
    async waitForTab(tabId, checkExpr, ms) {
      const waitMs = Math.min(Number(ms) || 30000, 180000);
      const r = await 页跑(tabId, `(async()=>{const check=()=>(${checkExpr});const v=check();if(v)return v;`
        + `return new Promise(res=>{const fin=x=>{ob.disconnect();clearTimeout(t);clearInterval(iv);res(x);};`
        + `const tick=()=>{const x=check();if(x)fin(x);};`
        + `const ob=new MutationObserver(tick);ob.observe(document.documentElement,{childList:true,subtree:true,attributes:true});`
        + `const iv=setInterval(tick,1000);const t=setTimeout(()=>fin(check()||null),${waitMs});});})()`, waitMs + 8000);
      if (!r) throw new Error('网页等待超时');
      return r;
    },
    async observeTab(tabId, detail) {
      return 页跑(tabId, `(() => {
        const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
        const text = (document.body?.innerText || '').slice(0, ${detail ? 12000 : 4000});
        const sel = 'button,a[href],input:not([type=hidden]),textarea,select,[contenteditable="true"],[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="radio"],[role="switch"],[role="combobox"]';
        const controls = [...document.querySelectorAll(sel)].filter(vis).slice(0, 300).map((x, i) => ({
          i, tag: x.tagName.toLowerCase(), role: x.getAttribute('role') || '',
          aria: x.getAttribute('aria-label') || '',
          label: (x.getAttribute('aria-label') || x.getAttribute('placeholder') || x.innerText || x.value || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
          state: x.getAttribute('data-state') || x.getAttribute('aria-checked') || x.getAttribute('aria-selected') || x.getAttribute('aria-expanded') || '',
          disabled: !!(x.disabled || x.getAttribute('aria-disabled') === 'true'),
        })).filter(x => x.label || x.role || x.aria);
        return { url: location.href, title: document.title, ready: document.readyState, text, controls };
      })()`, 20000);
    },
    async fetchSite(url, opts) {
      const o = opts || {};
      return ctx.call('browser.fetch', Object.assign({ url, asSite: true, credentials: 'include' }, o));
    },
    async fetchMedia(url, fallbackMime, headers) {
      const r = await ctx.call('browser.fetch', { url, binary: true, asSite: true, credentials: 'include', headers: headers || {}, timeout: 60000 });
      if (!r || r.status >= 400 || !r.base64) throw new Error('拉取媒体失败 HTTP ' + (r?.status || '?'));
      return { mimeType: (r.contentType || fallbackMime || 'application/octet-stream').split(';')[0].trim(), data: r.base64 };
    },
    async blobFromTab(tabId, src, fallbackMime) {
      if (!src) throw new Error('没拿到媒体地址');
      if (src.startsWith('data:')) {
        const m = /^data:([^;,]+);base64,(.+)$/.exec(src);
        if (m) return { mimeType: m[1], data: m[2] };
      }
      const r = await 页跑(tabId, `(async () => {
        try {
          const resp = await fetch(${JSON.stringify(src)});
          if (!resp.ok) return { ok: false, err: 'HTTP ' + resp.status };
          const blob = await resp.blob();
          const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          const i = dataUrl.indexOf(',');
          return { ok: true, mimeType: blob.type || ${JSON.stringify(fallbackMime || 'application/octet-stream')}, data: dataUrl.slice(i + 1) };
        } catch (e) {
          const im = [...document.querySelectorAll('img')].find(x => (x.currentSrc || x.src) === ${JSON.stringify(src)} && x.naturalWidth > 0);
          if (!im) return { ok: false, err: e.message };
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d').drawImage(im, 0, 0);
          return { ok: true, mimeType: 'image/png', data: c.toDataURL('image/png').split(',')[1] || '' };
        }
      })()`, 45000);
      if (!r?.ok) throw new Error('页内读取媒体失败: ' + (r?.err || '未知'));
      return { mimeType: r.mimeType, data: r.data };
    },
    async pasteImages(tabId, imgs, editorSel, previewSel) {
      const list = [].concat(imgs || []).filter(Boolean);
      if (!list.length) return false;
      const items = [];
      for (let i = 0; i < list.length; i++) {
        const v = list[i], s = typeof v === 'string' ? v : v.data || v.url || '';
        if (/^https?:/.test(s)) items.push(await 工具.fetchMedia(s, 'image/png'));
        else {
          const m = /^data:([^;,]+);base64,(.+)$/.exec(s);
          items.push({ mimeType: (typeof v === 'object' && v.mimeType) || (m && m[1]) || 'image/png', data: m ? m[2] : s });
        }
      }
      return 页跑(tabId, `(async (items, edSel, prevSel) => {
        const dt = new DataTransfer();
        items.forEach((it, i) => {
          const bin = atob(it.data), u = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
          const ext = (it.mimeType || 'image/png').split('/')[1]?.split(';')[0] || 'png';
          dt.items.add(new File([u], 'ref_' + i + '.' + ext, { type: it.mimeType || 'image/png' }));
        });
        const inp = document.querySelector('input[type="file"]');
        const ed = document.querySelector(edSel || '.ProseMirror,[contenteditable="true"],textarea');
        const doPaste = () => {
          if (!ed) return;
          ed.focus();
          ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        };
        if (inp) {
          try { inp.files = dt.files; } catch {}
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          doPaste();
        }
        if (!prevSel) { await new Promise(r => setTimeout(r, 1200)); return true; }
        const has = () => !!document.querySelector(prevSel);
        if (has()) return true;
        return new Promise(res => {
          let fbDone = !inp;
          const ob = new MutationObserver(() => { if (has()) { ob.disconnect(); clearTimeout(t); clearTimeout(fb); res(true); } });
          ob.observe(document.body, { childList: true, subtree: true });
          const fb = setTimeout(() => { if (!fbDone && !has()) { fbDone = true; doPaste(); } }, 1800);
          const t = setTimeout(() => { ob.disconnect(); clearTimeout(fb); res(has()); }, 8000);
        });
      })(${JSON.stringify(items)}, ${JSON.stringify(editorSel || '')}, ${JSON.stringify(previewSel || '')})`, 20000, 'MAIN');
    },
    async fetchInTab(tabId, url, opts) {
      const o = opts || {};
      return 页跑(tabId, `(async (u, o) => {
        const init = { method: o.method || 'GET', credentials: o.credentials || 'include', headers: Object.assign({}, o.headers || {}) };
        if (o.body !== undefined) {
          if (typeof o.body === 'string') init.body = o.body;
          else { init.body = JSON.stringify(o.body); if (!init.headers['content-type'] && !init.headers['Content-Type']) init.headers['content-type'] = 'application/json'; }
        }
        const r = await fetch(u, init);
        const ct = r.headers.get('content-type') || '';
        const text = await r.text();
        let json = null;
        if (o.json !== false && (o.json || /json/i.test(ct))) { try { json = JSON.parse(text); } catch {} }
        return { ok: r.ok, status: r.status, contentType: ct, json, text: json ? undefined : text.slice(0, 12000) };
      })(${JSON.stringify(url)}, ${JSON.stringify({ method: o.method, headers: o.headers, body: o.body, credentials: o.credentials, json: o.json })})`, o.timeout || 25000, 'MAIN');
    },
    async waitHydrated(tabId, ms) {
      const deadline = Date.now() + Math.max(1200, Math.min(10000, Number(ms) || 4000));
      let last = -1, ok = 0;
      while (Date.now() < deadline) {
        const st = await 页跑(tabId, `(() => ({
          ready: document.readyState,
          n: document.querySelectorAll('button,a[href],input,textarea,[role="textbox"]').length,
          len: ((document.body?.innerText || document.body?.textContent || '').trim()).length,
        }))()`, 5000, 'MAIN').catch(() => null);
        if (st && st.ready === 'complete' && st.n >= 1 && st.len > 20) {
          if (st.len === last) { if (++ok >= 1) return true; }
          else { ok = 0; last = st.len; }
        }
        await 睡(350);
      }
      return true;
    },
    async pickMenu(tabId, triggerSel, match, opts) {
      const o = opts || {};
      return 页跑(tabId, `(async (sel, want, o) => {
        const sleep = t => new Promise(r => setTimeout(r, t));
        const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
        const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
        const btn = [...document.querySelectorAll(sel)].find(vis) || document.querySelector(sel);
        if (!btn) return { changed: false, missing: true };
        const before = clean(btn.innerText || btn.getAttribute('aria-label'));
        const wl = String(want || '').trim().toLowerCase();
        const hitText = t => { const tl = t.toLowerCase(); return tl === wl || tl.startsWith(wl + ' ') || (o.contains !== false && tl.includes(wl)); };
        if (wl && o.skipIfMatch !== false && hitText(before)) return { changed: false, skipped: true, before, after: before };
        ['pointerdown','mousedown','pointerup','mouseup'].forEach(t => btn.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, button: 0 })));
        btn.click();
        await sleep(o.delay || 340);
        const itemSel = o.itemSel || '[role="menuitemradio"],[role="menuitemcheckbox"],[role="menuitem"],[role="option"]';
        const items = [...document.querySelectorAll(itemSel)].filter(vis);
        const texts = items.map(x => clean(x.innerText)).filter(Boolean);
        const hit = wl ? (items.find(x => clean(x.innerText).toLowerCase() === wl) || items.find(x => hitText(clean(x.innerText)))) : null;
        if (hit) { hit.click(); await sleep(o.afterDelay || 260); }
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { changed: !!hit, matched: hit ? clean(hit.innerText) : '', before, after: clean(btn.innerText || btn.getAttribute('aria-label')), items: texts };
      })(${JSON.stringify(triggerSel)}, ${JSON.stringify(String(match || ''))}, ${JSON.stringify(o)})`, o.timeout || 15000, 'MAIN');
    },
    async fillEditor(tabId, text, opts) {
      const o = opts || {};
      return 页跑(tabId, `(async (text, o) => {
        const sleep = t => new Promise(r => setTimeout(r, t));
        const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; };
        const sel = o.selector || '.ProseMirror,[role="textbox"],[contenteditable="true"],textarea,input[type="text"],input[type="search"]';
        const el = [...document.querySelectorAll(sel)].find(vis) || document.querySelector(sel);
        if (!el) throw new Error('找不到输入框: ' + sel);
        el.focus();
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (set) set.call(el, text); else el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const s = window.getSelection(), r = document.createRange();
          r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r);
          const dt = new DataTransfer(); dt.setData('text/plain', text);
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          await sleep(280);
          if (!(el.innerText || '').trim()) { document.execCommand('insertText', false, text); await sleep(220); }
        }
        let submitted = false;
        if (o.submit) {
          await sleep(160);
          const subSel = typeof o.submit === 'string' ? o.submit : 'button[aria-label="提交"],button[aria-label="Submit"],button[type="submit"],button[aria-label*="发送"],button[aria-label*="Send"]';
          const btn = [...document.querySelectorAll(subSel)].find(b => vis(b) && !b.disabled) || document.querySelector(subSel);
          if (btn && !btn.disabled) { btn.click(); submitted = true; }
          else { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); submitted = true; }
        }
        return { ok: true, value: (el.value ?? el.innerText ?? '').trim().slice(0, 120), submitted };
      })(${JSON.stringify(String(text || ''))}, ${JSON.stringify(o)})`, o.timeout || 20000, 'MAIN');
    },
    async probeTab(tabId, opts) {
      const o = opts || {};
      if (o.hydrate !== false) await 工具.waitHydrated(tabId, o.hydrateMs || 3500);
      return 页跑(tabId, `(() => {
        const notHidden = e => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
        const vis = e => { const r = e.getBoundingClientRect(); return r.width >= 2 && r.height >= 2 && notHidden(e); };
        const pick = list => { const v = list.filter(vis); return v.length ? v : list.filter(notHidden); };
        const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
        const editors = pick([...document.querySelectorAll('.ProseMirror,[contenteditable="true"],[role="textbox"],textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio])')]).slice(0, 12).map(el => ({
          tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
          kind: el.classList.contains('ProseMirror') ? 'prosemirror' : el.getAttribute('contenteditable') ? 'contenteditable' : el.tagName.toLowerCase(),
          placeholder: el.getAttribute('placeholder') || el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '',
        }));
        const controls = pick([...document.querySelectorAll('button,[role="tab"],[role="combobox"],select,[role="switch"]')]).map(el => ({
          tag: el.tagName.toLowerCase(), aria: el.getAttribute('aria-label') || '',
          text: clean(el.innerText || el.textContent).slice(0, 48), haspopup: el.getAttribute('aria-haspopup') || '',
          pressed: el.getAttribute('aria-pressed'), state: el.getAttribute('data-state') || '',
        })).filter(x => x.aria || x.text).slice(0, 80);
        const navRoutes = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#') && !h.startsWith('javascript:') && (h.startsWith('/') || h.startsWith(location.origin) || !/^https?:/.test(h))).map(h => h.replace(location.origin, '')))].slice(0, 40);
        const apis = [...new Set(performance.getEntriesByType('resource').filter(e => /fetch|xmlhttprequest/i.test(e.initiatorType) || /\\/(api|rest|graphql|v\\d+)\\//i.test(e.name)).map(e => e.name.split('?')[0].replace(location.origin, '')))].slice(0, 40);
        const rawText = (document.body?.innerText || '').trim() || (() => {
          const c = document.body?.cloneNode(true);
          if (!c) return '';
          c.querySelectorAll('style,script,noscript,svg').forEach(n => n.remove());
          return clean(c.textContent || '');
        })();
        return {
          origin: location.origin, url: location.href, title: document.title,
          webmcp: { native: !!(navigator.modelContext || document.modelContext), declarativeTools: [...document.querySelectorAll('form[toolname],[toolname]')].map(x => x.getAttribute('toolname')).filter(Boolean) },
          uiKits: { prosemirror: !!document.querySelector('.ProseMirror'), radixOrBaseUI: !!document.querySelector('[data-radix-popper-content-wrapper],[data-state],[aria-haspopup="menu"]'), shadowHosts: [...document.querySelectorAll('*')].filter(e => e.shadowRoot).length },
          editors, controlsCount: controls.length, controls, navRoutes, apis,
          textSample: rawText.slice(0, 2000),
        };
      })()`, 12000, 'MAIN');
    },
    textOf: c => Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : String(c ?? ''),
  };

  async function 找站(p) {
    const all = Object.values(await 全部());
    const ep = String(p?.endpoint || '').replace(/\/+$/, '');
    return all.find(s => ep === s.origin || ep.startsWith(s.origin + '/') || s.name === p?.name) || null;
  }

  async function 跑码(code, kind, a, site, maxConc) {
    if (!code) throw new Error('该网页模型插件未实现此能力: ' + kind);
    const max = Math.max(1, Number(maxConc) || Number(site?.concurrency) || 1);
    const t = site ? Object.assign({}, 工具, { openTab: (u, f, o) => 限并(site.id, max, () => 后台页(u, f, o)) }) : 工具;
    const fn = new AsyncFn('ctx', 'kind', 'args', 'tools', code);
    return await fn(ctx, kind, a || {}, t);
  }

  const 挂协议 = () => {
    if (typeof 协议适配 === 'undefined' || 协议适配['web-browser']?.出自 === 本) return;
    const 兼容 = 协议适配['openai-compatible'];
    if (!兼容) return;
    协议适配['web-browser'] = Object.assign({}, 兼容, {
      出自: 本,
      名称: '浏览器网页插件 (折叠后台组 · 零黄条 · 复用登录态)',
      默认端点: 'https://grok.com',
      async 拉模型(p) {
        const s = await 找站(p);
        if (!s) throw new Error('网页模型插件不存在或已删除: ' + (p?.endpoint || p?.name));
        return { models: (s.models || []).slice(), hints: Object.assign({}, s.hints) };
      },
      async 执行多模态(p, 类, a) {
        const s = await 找站(p);
        if (!s) throw new Error('网页模型插件不存在或已删除: ' + (p?.endpoint || p?.name));
        if (!(await 查登(s))) throw new Error(`浏览器未登录 ${s.origin}，请先打开网页登录`);
        return 跑码(s.runCode, 类, a, s, p.concurrency);
      },
      async *执行对话(p, a) {
        const s = await 找站(p);
        if (!s) throw new Error('网页模型插件不存在或已删除: ' + (p?.endpoint || p?.name));
        if (!s.chatCode) throw new Error(`${s.name} 目前仅支持多模态，不支持对话`);
        if (!(await 查登(s))) throw new Error(`浏览器未登录 ${s.origin}，请先打开网页登录`);
        const r = await 跑码(s.chatCode, 'chat', a, s, p.concurrency);
        if (r && typeof r[Symbol.asyncIterator] === 'function') {
          yield* r;
        } else {
          const content = typeof r === 'string' ? r : (r?.content ?? r?.text ?? '');
          if (content) yield { delta: content };
          yield Object.assign({ usage: null, stop: 'stop', toolCalls: null }, typeof r === 'object' ? r : {}, { content, done: true });
        }
      },
    });
  };
  挂协议();
  if (typeof document !== 'undefined') {
    document.addEventListener('colony:blocks', 挂协议);
    ctx.cleanup(() => {
      document.removeEventListener('colony:blocks', 挂协议);
      活页.forEach(id => 关页(id));
      活页.clear();
      if (typeof 协议适配 !== 'undefined' && 协议适配['web-browser']?.出自 === 本) delete 协议适配['web-browser'];
    });
  }

  async function 已接厂商() {
    if (!colony.has('ai.providers')) return [];
    const r = await ctx.call('ai.providers', {}).catch(() => ({ providers: [] }));
    return Array.isArray(r?.providers) ? r.providers : (Array.isArray(r) ? r : []);
  }

  async function 列表(full) {
    const [all, ps] = await Promise.all([全部(), 已接厂商()]);
    return Promise.all(Object.values(all).map(async s => {
      const models = Array.isArray(s.models) ? s.models : [];
      const p = models.length ? ps.find(x => x.protocol === 'web-browser' && (String(x.endpoint || '').replace(/\/+$/, '') === s.origin || x.name === s.name)) : null;
      const base = {
        id: s.id, name: s.name, desc: s.desc, origin: s.origin,
        kind: models.length ? 'model' : 'site', hasModels: models.length > 0,
        models, concurrency: p?.concurrency || s.concurrency || 1,
        loggedIn: await 查登(s), enabled: !!p, providerId: p?.id || null,
        skillCount: (s.skills || []).length, actionCount: (s.actions || []).length,
      };
      return full ? Object.assign(base, { capabilities: s.capabilities || {}, skills: s.skills || [], actions: s.actions || [] }) : base;
    }));
  }

  async function 安装(a) {
    const id = String(a?.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const origin = String(a?.origin || '').trim().replace(/\/+$/, '');
    let domain = String(a?.domain || '').trim();
    if (!domain && origin) { try { domain = new URL(origin).hostname.replace(/^www\./, ''); } catch {} }
    const models = Array.isArray(a?.models) ? a.models.filter(Boolean) : [];
    const authCookie = Array.isArray(a?.authCookie) ? a.authCookie.filter(Boolean) : (a?.authCookie ? String(a.authCookie) : []);
    if (!id || !a?.name || !origin || !domain) {
      throw new Error('缺少必要字段: id, name, origin');
    }
    if (!a.actionCode && !a.observeCode && !a.runCode && !a.chatCode) {
      throw new Error('至少需要提供 actionCode / observeCode / runCode / chatCode 之一');
    }
    if (a.runCode) new AsyncFn('ctx', 'kind', 'args', 'tools', a.runCode);
    if (a.chatCode) new AsyncFn('ctx', 'kind', 'args', 'tools', a.chatCode);
    if (a.observeCode) new AsyncFn('ctx', 'kind', 'args', 'tools', a.observeCode);
    if (a.actionCode) new AsyncFn('ctx', 'kind', 'args', 'tools', a.actionCode);
    await 限并('__kv__', 1, async () => {
      const all = await 全部();
      all[id] = {
        id, name: String(a.name), desc: String(a.desc || ''),
        origin, domain, authCookie, models,
        defaultModel: a.defaultModel || '',
        concurrency: Math.max(1, Math.min(8, Number(a.concurrency) || 1)),
        hints: a.hints || {}, modelOf: a.modelOf || {},
        capabilities: a.capabilities || {}, skills: Array.isArray(a.skills) ? a.skills.slice() : [],
        actions: Array.isArray(a.actions) ? a.actions.slice() : [],
        runCode: a.runCode || '', chatCode: a.chatCode || '', observeCode: a.observeCode || '', actionCode: a.actionCode || '',
        at: Date.now(),
      };
      await 存全(all);
    });
    if (a.enable && models.length) return await 开启(id);
    return { installed: id, name: String(a.name), kind: models.length ? 'model' : 'site', models };
  }

  async function 开启(id) {
    const all = await 全部(), s = all[id];
    if (!s) throw new Error('未安装网页插件: ' + id);
    if (!Array.isArray(s.models) || !s.models.length) {
      throw new Error(`「${s.name}」是纯网站插件，不声明 AI 模型，无需接入 AI 配置（直接调 plugin.web.act / observe 即可）`);
    }
    挂协议();
    if (!(await 查登(s))) throw new Error(`当前浏览器未登录 ${s.origin}，请先在 Chrome 登录该网站`);
    const cfg = {
      name: s.name, protocol: 'web-browser', endpoint: s.origin,
      concurrency: s.concurrency || 1, modelOf: s.modelOf || {},
    };
    if (s.defaultModel) cfg.model = s.defaultModel;
    const r = await ctx.call('ai.configure', cfg);
    if (typeof 界面 !== 'undefined') 界面.脏();
    return Object.assign({ id: s.id, name: s.name, models: s.models }, r);
  }

  async function 关闭(id) {
    const all = await 全部(), s = all[id];
    const ps = await 已接厂商();
    const p = ps.find(x => x.protocol === 'web-browser' && (
      (s && (String(x.endpoint || '').replace(/\/+$/, '') === s.origin || x.name === s.name))
      || String(x.name || '').toLowerCase().includes(String(id || '').toLowerCase())
    ));
    if (!p) return { id, disabled: false };
    await ctx.call('ai.remove', { provider: p.id });
    if (typeof 界面 !== 'undefined') 界面.脏();
    return { id, disabled: true, name: p.name };
  }

  async function 删除(id) {
    await 关闭(id).catch(() => {});
    return 限并('__kv__', 1, async () => {
      const all = await 全部();
      if (!all[id]) return { id, removed: false };
      delete all[id];
      await 存全(all);
      return { id, removed: true };
    });
  }

  async function 说明(id) {
    const all = await 全部(), s = all[id];
    if (!s) throw new Error('未安装网页应用插件: ' + id);
    return { id: s.id, name: s.name, desc: s.desc, concurrency: s.concurrency || 1, capabilities: s.capabilities || {}, skills: s.skills || [], actions: s.actions || [], models: s.models || [] };
  }
  async function 观察(id, a) {
    const all = await 全部(), s = all[id];
    if (!s) throw new Error('未安装网页应用插件: ' + id);
    if (!s.observeCode) return 说明(id);
    if (!(await 查登(s))) throw new Error(`浏览器未登录 ${s.origin}，请先在 Chrome 登录该网站`);
    return 跑码(s.observeCode, 'observe', a || {}, s);
  }
  async function 动作(id, a) {
    const all = await 全部(), s = all[id];
    if (!s) throw new Error('未安装网页应用插件: ' + id);
    if (!s.actionCode) throw new Error('该网页应用插件未实现动作接口: ' + id);
    if (!(await 查登(s))) throw new Error(`浏览器未登录 ${s.origin}，请先在 Chrome 登录网站`);
    return 跑码(s.actionCode, String(a?.action || 'act'), a || {}, s);
  }

  async function 探索(a) {
    let rawUrl = String(a?.url || '').trim();
    if (!rawUrl && a?.id) {
      const ex = (await 全部())[a.id];
      if (ex?.origin) rawUrl = ex.origin;
    }
    if (!rawUrl) throw new Error('请提供要探索的网站网址 url');
    if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
    let u;
    try { u = new URL(rawUrl); } catch { throw new Error('网址格式不正确: ' + rawUrl); }
    const origin = u.origin, domain = u.hostname.replace(/^www\./, '');
    const suggestedId = String(a?.id || domain.split('.')[0] || 'site').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const goal = String(a?.goal || '').trim();

    const [probe, cookies, existing] = await Promise.all([
      后台页(u.href, tabId => 工具.probeTab(tabId, { hydrateMs: 3500 }), { timeout: 20000 }).catch(e => ({ error: e.message })),
      ctx.call('browser.ext', { method: 'cookies.getAll', args: [{ domain }] }).then(l => Array.isArray(l) ? l.length : 0, () => 0),
      全部().then(all => all[suggestedId] || null, () => null),
    ]);

    const hasAgent = typeof colony !== 'undefined' && typeof colony.has === 'function' && (colony.has('agent.spawn') || colony.has('task.spawn'));
    if (a?.probeOnly || !hasAgent) {
      return {
        mode: 'probe', hasAgent, url: u.href, origin, domain, suggestedId, cookieCount: cookies,
        existing: existing ? { id: existing.id, name: existing.name, actionCount: (existing.actions || []).length, skillCount: (existing.skills || []).length } : null,
        probe,
        note: hasAgent ? '已返回只读站点指纹（probeOnly）' : '当前未启用全能 agent 后台 worker，已平滑降级为只读站点指纹勘探，可据此手动封装网页插件',
      };
    }

    const probeBrief = probe && !probe.error ? {
      title: probe.title, url: probe.url, webmcp: probe.webmcp, uiKits: probe.uiKits,
      editors: probe.editors, controlsCount: probe.controlsCount,
      controlsSample: (probe.controls || []).slice(0, 24),
      navRoutes: (probe.navRoutes || []).slice(0, 20),
      apis: (probe.apis || []).slice(0, 20),
      textSample: String(probe.textSample || '').slice(0, 800),
    } : probe;

    const workerGoal = `深入探索网站 ${u.href}（id: ${suggestedId}）的全部核心功能并封装/更新为 Colony 独立网页插件${goal ? '，重点关注：' + goal : ''}`;
    const workerContext = [
      `目标网址: ${u.href} | origin: ${origin} | domain: ${domain} | 建议插件 id: ${suggestedId} | 当前域 Cookie 数: ${cookies}`,
      existing ? `已有插件待更新: ${existing.name}（现有 actions: ${(existing.actions || []).map(x => x.name).join(', ') || '无'}，models: ${(existing.models || []).join(', ') || '无'}）` : '新站点探索',
      `首轮只读勘探指纹:\n${JSON.stringify(probeBrief, null, 2)}`,
      `强制规范:`,
      `1. 先读 skill.read {id:"petri:plugin-manager", name:"创建技能、网页插件与MCP"} 和 "网页插件与自动化"。`,
      `2. 通路优先级：原生 WebMCP > tools.fetchSite(asSite:true) > 页内同源接口/令牌(tools.fetchInTab，能直调接口绝不硬点复杂前端按钮) > 零黄条页面操作(tools.pickMenu / fillEditor / pasteImages / openTab)。绝不修改插件管理底座源码。`,
      `3. 通用工程纪律：`,
      `   - 耗时等待(>10s)禁止在单次 runPage 里 while 死等，一律拆成「页内发起异步任务挂状态 → 宿主侧短间隔轮询」。`,
      `   - 禁写 innerHTML(防 TrustedTypes 报错)；抽取文本/状态先定位主内容容器，勿对整页 body.innerText 盲搜(防侧边栏/升级广告干扰)；读侧边栏或抽屉列表前先确保已展开。`,
      `   - 流式/渐进内容须设最小就绪门槛 + 连续两次稳定，多元素并存时锁定目标勿每轮重排导致判定归零。`,
      `4. 节奏与收口：探索复杂大站须先在前半程完成「只读勘探 + 1~2 个核心能力安装并验通落盘(MVP)」，再用剩余轮次增量扩展次要子页，避免超时白跑；退出前关闭所有临时测试页。`,
      `5. 安全红线：探索阶段只做只读或无害草稿探测，严禁自动触发发布/删除/支付/改账号设置等不可逆操作；高危动作写入插件时须在 desc 与 skill 中标注需用户确认；若网站未登录则如实回报，不编造功能。`,
      `6. 调 plugin.web.install 安装/更新插件（普通网站无需强填 models，只有真提供对话/生图/视频等 AI 模型时才声明 models 与 runCode/chatCode；非敏感认证 Cookie 名可留空数组表示免校验或填入真实登录态 Cookie 名），并把该站特有的接口/DOM/风控避坑经验写入插件自带 skills。`,
      `7. 实测验证：真跑只读和无害动作验收；无法自动测的项在技能与最终汇报中如实标明「待人工验证」。`,
    ].join('\n');

    const spawnPath = colony.has('agent.spawn') ? 'agent.spawn' : 'task.spawn';
    const spawned = await ctx.call(spawnPath, {
      kind: 'agent', goal: workerGoal, context: workerContext, maxRounds: 30, minutes: 15,
    });
    return {
      mode: 'worker',
      taskId: spawned?.id || spawned?.taskId || spawned,
      url: u.href, origin, domain, suggestedId, cookieCount: cookies,
      probe: { title: probeBrief?.title, webmcp: probeBrief?.webmcp, uiKits: probeBrief?.uiKits, controlsCount: probeBrief?.controlsCount, navCount: (probeBrief?.navRoutes || []).length, apiCount: (probeBrief?.apis || []).length },
    };
  }

  W('plugin.web.list', a => 列表(!!(a && a.full)), '列已安装的网页插件目录(默认仅名称/简介/类型/模型/状态; 详情用 plugin.web.describe 或 full:true)', { full: 'boolean?' });
  W('plugin.web.describe', a => 说明(a && a.id), '读取网页插件的能力清单、动作与技能', { id: 'string' });
  W('plugin.web.observe', a => 观察(a && a.id, a), '只读观察网页插件当前页面状态(折叠后台页无黄条，不点击、不提交)', { id: 'string', detail: 'boolean?' });
  W('plugin.web.act', a => 动作(a && a.id, a), '执行网页插件声明的动作(插件自行定义 action)', { id: 'string', action: 'string', args: 'object?' });
  W('plugin.web.explore', a => 探索(a), '输入网址自动深度探索网站并封装为网页插件(有全能 agent 自动派后台探索 worker; 无则平滑降级返回只读站点指纹; probeOnly:true 仅勘探)', {
    url: 'string?', id: 'string?(重探更新已有插件时传)', goal: 'string?(想重点探索的功能)', probeOnly: 'boolean?',
  });
  W('plugin.web.install', a => 安装(a), '安装或更新一个网页插件(存 kv，不动插件管理源码; 纯网站插件可不填 models/authCookie; enable:true 且有 models 时顺便接入 AI 配置)', {
    id: 'string', name: 'string', desc: 'string?', origin: 'string', domain: 'string?',
    authCookie: 'string|string[]?', models: 'string[]?', defaultModel: 'string?', concurrency: 'number?',
    hints: 'object?', modelOf: 'object?', capabilities: 'object?', skills: 'array?', actions: 'array?',
    runCode: 'string?', chatCode: 'string?', observeCode: 'string?', actionCode: 'string?', enable: 'boolean?',
  });
  W('plugin.web.remove', a => 删除(a && a.id), '彻底删除一个网页插件(如有接入 AI 配置则同时移除)', { id: 'string' });
  W('plugin.web.enable', a => 开启(a && a.id), '将声明了 AI 模型的网页插件接入 AI 配置', { id: 'string' });
  W('plugin.web.disable', a => 关闭(a && a.id), '从 AI 配置断开指定网页插件(保留插件)', { id: 'string' });
  return { 列表, 安装, 删除, 开启, 关闭, 探索, 挂协议 };
})();
// ═ 装配 ═
const P = (path, fn, desc, schema) => ctx.provide(path, fn, { desc, schema: schema || {}, frames: false });
P('plugin.ping', async () => {
  const 试 = ms => 发('ping', {}, ms);
  try {
    let r; try { r = await 试(2000); } catch { await new Promise(x => setTimeout(x, 300)); r = await 试(2500); }
    return { alive: true, plugin: r.plugin, version: r.version, build: r.build };
  } catch (e) { return { alive: false, note: e.message }; }
}, '插件在不在线: 回 {alive, version}');
P('plugin.summary', async () => {
  const [web, mcp, ext] = await Promise.all([
    ctx.kv.get('plugin.web.plugins').then(x => x && typeof x === 'object' ? Object.keys(x).length : 0, () => 0),
    ctx.kv.keys('plugin.mcp.').then(ks => ks.length, () => 0),
    ctx.call('plugin.ext.list', { n: 1 }).then(r => r && typeof r.total === 'number' ? r.total : (r?.items?.length || 0), () => 0),
  ]);
  return `网页插件 ${web} / MCP ${mcp} / 扩展 ${ext}`;
}, '轻量总数概览(仅报网页插件、远程 MCP、扩展技能数量, 不预载正文)');
P('plugin.status', async () => {
  let dir = null, files = null;
  try { dir = await 根(true); files = (await ctx.call('data.list', { in: dir, n: 200 })).items.map(i => i.name); }
  catch (e) { files = e.message; }
  return { plugin: await ctx.call('plugin.ping'), dir, files, backups: (await ctx.kv.list(BK)).length };
}, '总览: 插件在线没有、源码目录及文件、快照几条');
P('plugin.list', async () => (await ctx.call('data.list', { in: await 根(), n: 200 })).items.map(i => ({ path: i.name, bytes: i.bytes, at: i.at })),
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
  const r = await 发('fetch', { req: { url: a.url, method: a.method || 'GET', headers: a.headers || {}, body: a.bodyB64 || a.body === undefined ? undefined : (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)), bodyB64: a.bodyB64 || undefined, binary: !!a.binary, asSite: !!a.asSite, credentials: a.credentials || undefined, timeout: a.timeout || 30000 } }, (a.timeout || 30000) + 5000);
  if (r.error) throw new Error(r.error);
  const out = { status: r.status, contentType: r.contentType, headers: r.headers };
  if (r.base64 !== undefined) { out.base64 = r.base64; out.bytes = r.bytes; }
  else if (a.json || /json/.test(r.contentType || '')) { try { out.json = JSON.parse(r.text); } catch (e) { out.text = r.text; } }
  else out.text = r.text;
  return out;
}, '插件代发 HTTP(S) 请求: 带用户浏览器的 IP 和登录 cookie, 不受跨域限制; asSite:true 自动把 Origin/Referer 改成目标站点并带登录态(防私有接口拒掉 chrome-extension://); JSON 自动解析成 json, binary:true 回 base64; 二进制请求体给 bodyB64; 回 {status, contentType, json|text|base64}', { url: 'string', method: 'string?', headers: 'object?', body: 'string|object?', bodyB64: 'string?(二进制请求体的 base64, 给了就不看 body)', binary: 'boolean?', asSite: 'boolean?(伪装成目标同源站并带登录 cookie)', credentials: 'string?(include|same-origin|omit)', json: 'boolean?', timeout: 'number?' });
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
const 睡 = ms => new Promise(r => setTimeout(r, ms));
const 应用状态=async()=>{for(const f of(await ctx.call('frame.list')).filter(x=>x.frame!=='host'))try{const r=await ctx.call('frame.eval',{frame:f.frame,expr:'window.__browser&&window.__browser.state()'}),v=r&&r.value!==undefined?r.value:r;if(v)return{frame:f.frame,...v}}catch(e){}throw Error('没有开着的浏览器小应用')};
const 应用做=async js=>{const s=await 应用状态(),r=await ctx.call('frame.eval',{frame:s.frame,expr:js});return r&&r.value!==undefined?r.value:r};
const 目标=async tab=>{const s=await 应用状态(),t=tab==null?s.tabs.find(x=>x.active):s.tabs.find(x=>x.id===tab||x.name===tab);if(!t)throw Error('没有这个标签');if(!t.name||!t.url)throw Error('标签为空白页');return t};
const 页跑=async(tab,code,ms)=>{const t=await 目标(tab),r=await 发('runPage',{req:{frameName:t.name,code,world:'MAIN'}},ms||30000);if(r.error)throw Error(r.error);return r.result};
const 页码=(fn,...args)=>'('+String(fn)+')('+args.map(x=>JSON.stringify(x)).join(',')+')';
const 元素=String(function(q){if(q.ref!=null){const e=document.querySelector('[data-ccb-ref="'+q.ref+'"]');if(e)return e}if(q.selector){const e=document.querySelector(q.selector);if(e)return e}const xs=[...document.querySelectorAll('button,a,input,textarea,select,[role=button],[role=tab],[contenteditable=true]')],v=e=>String(e.innerText||e.value||e.getAttribute('aria-label')||e.placeholder||'').trim();return xs.find(e=>v(e)===q.text)||xs.find(e=>v(e).includes(q.text))});
P('browser.frameTabs',()=>应用状态(),'桌面浏览器标签，零 CDP');
P('browser.frameOpen',async a=>{const t=await 应用做('window.__browser.open('+JSON.stringify(a.url)+','+(a.active!==false)+')');if(a.wait!==false)await 睡(Math.min(a.timeout||3000,3000));return t},'打开桌面浏览器标签，零 CDP',{url:'string',active:'boolean?',wait:'boolean?',timeout:'number?'});
P('browser.frameGo',async a=>{const t=await 应用做('window.__browser.go('+JSON.stringify(a.url)+','+(a.tab==null?'undefined':JSON.stringify(a.tab))+')');if(a.wait!==false)await 睡(Math.min(a.timeout||3000,3000));return t},'跳转桌面浏览器标签，零 CDP',{url:'string',tab:'number?',wait:'boolean?',timeout:'number?'});
P('browser.frameNav',a=>应用做((a.tab!=null?'window.__browser.select('+JSON.stringify(a.tab)+'),':'')+'window.__browser.'+({back:'back',forward:'forward',reload:'reload',close:'close',select:'select'}[a.op]||'state')+'()'),'桌面浏览器导航，零 CDP',{op:'string',tab:'number?'});
P('browser.frameEval',a=>页跑(a.tab,a.expr),'在内嵌网页执行 JS，frameName 定点，零 CDP',{tab:'number?',expr:'string'});
P('browser.frameRead',a=>页跑(a.tab,页码(function(sel,max){if(sel)return[...document.querySelectorAll(sel)].slice(0,100).map(e=>({text:(e.innerText||e.textContent||'').trim().slice(0,2000),href:e.href||undefined,src:e.currentSrc||e.src||undefined}));return{url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,max)}},a.selector||'',a.max||20000)),'读取内嵌网页，零 CDP',{tab:'number?',selector:'string?',max:'number?'});
P('browser.frameSnapshot',a=>页跑(a.tab,页码(function(max){const out=[];for(const e of document.querySelectorAll('button,a,input,textarea,select,[role=button],[role=tab],[contenteditable=true]')){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width<2||r.height<2||s.display==='none'||s.visibility==='hidden')continue;e.setAttribute('data-ccb-ref',String(out.length+1));out.push({ref:out.length+1,role:e.getAttribute('role')||e.tagName.toLowerCase(),name:(e.getAttribute('aria-label')||e.innerText||e.value||e.placeholder||'').replace(/\s+/g,' ').trim().slice(0,120)});if(out.length>=max)break}return{url:location.href,title:document.title,items:out,text:(document.body?.innerText||'').slice(0,4000)}},a.max||300)),'看内嵌网页控件，零 CDP',{tab:'number?',max:'number?'});
P('browser.frameClick',a=>页跑(a.tab,'('+元素+')(q=>{const e=('+元素+')(q);if(!e)throw Error("找不到元素");e.scrollIntoView({block:"center"});e.click();return true})('+JSON.stringify({ref:'REF',selector:'',text:''})+'.replace("REF",'+JSON.stringify(String(a.ref??''))+'))'),'点击内嵌网页元素，零 CDP',{tab:'number?',ref:'number?',selector:'string?',text:'string?'});
P('browser.frameType',a=>页跑(a.tab,'('+元素+')(q=>{const e=('+元素+')(q);if(!e)throw Error("找不到输入框");e.focus();const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),"value");if(d&&d.set)d.set.call(e,q.text);else e.textContent=q.text;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return String(e.value||e.innerText||"")})('+JSON.stringify({ref:'REF',selector:a.selector||'',text:String(a.text||'')})+'.replace("REF",'+JSON.stringify(String(a.ref??''))+'))'),'填内嵌网页输入框，零 CDP',{tab:'number?',ref:'number?',selector:'string?',text:'string'});
P('browser.frameScroll',a=>页跑(a.tab,'scrollBy(0,'+(Number(a.y)||700)+');[scrollY,document.documentElement.scrollHeight]'),'滚内嵌网页，零 CDP',{tab:'number?',y:'number?'});
P('browser.frameWait',async a=>{const end=Date.now()+(a.timeout||15000);while(Date.now()<end){if(await 页跑(a.tab,a.expr||'document.readyState==="complete"',3000).catch(()=>false))return{ok:true};await 睡(300)}return{ok:false}},'等内嵌网页状态，零 CDP',{tab:'number?',expr:'string?',timeout:'number?'});
P('browser.frameShot',async a=>{const s=await 应用状态(),r=await ctx.call('frame.screenshot',{frame:s.frame});return Object.assign({note:'浏览器小应用窗截图，零 CDP'},r&&r.value!==undefined?r.value:r)},'截浏览器小应用窗，零 CDP',{tab:'number?'});
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
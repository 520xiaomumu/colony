/* Colony Bridge 插件 · 弹窗: 一个视图搞定扫描/状态(不再分"扫描"和"自检") + 通知开关 + 自定义端口 + 一键重载 */
'use strict';
const $ = id => document.getElementById(id);
const send = m => new Promise(r => chrome.runtime.sendMessage(m, r));
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

const LABEL = { ok: ['✓', 'ok'], auth: ['🔑要key', 'warn'], 'needs-enable': ['◐没开面', 'warn'] };
async function doScan() {
  $('msg').textContent = '扫描中…'; $('list').innerHTML = '';
  const r = await send({ op: 'scan' });
  const found = (r && r.found) || [];
  const keys = (await chrome.storage.local.get('endpointKeys')).endpointKeys || {};
  $('msg').textContent = r && r.otherCount ? '(另忽略 ' + r.otherCount + ' 个非模型端口)' : '';
  if (!found.length) { $('list').innerHTML = '<li class="dim">没扫到模型端点 — 起个 ollama / openclaw gateway / LM Studio 等再扫, 或下面补端口。</li>'; return; }
  for (const f of found) {
    const [txt, cls] = LABEL[f.state] || ['?', ''];
    const li = document.createElement('li');
    li.innerHTML = '<span class="st ' + cls + '">' + txt + '</span><span>:' + f.port + '</span><span class="dim ep-hint">' + (f.hint || '') + '</span>'
      + (f.models ? '<span class="models">' + f.models.slice(0, 3).join(', ') + '</span>' : '');
    const stored = keys[String(f.port)] || '';
    if (f.state !== 'needs-enable') { // ok/auth 行给「连接为成员」+ key 入口(有些端点 models 免key但聊天要key, 如 hermes)
      const conn = document.createElement('button'); conn.textContent = '＋连接'; conn.className = 'ok';
      conn.onclick = async () => { const key = f.state === 'auth' ? (stored || prompt(':' + f.port + ' 需要密码/API key(本地明文, 不填=无):') || '') : ''; await send({ op: 'epAdd', base: f.base, name: f.name, key }); renderMembers(); flash('✓ 已连接为成员: ' + (f.name || f.port)); };
      li.appendChild(conn);
      const b = document.createElement('button'); b.textContent = stored ? '改key' : '填key';
      b.onclick = () => toggleKeyRow(li, f.port, stored);
      li.appendChild(b);
    }
    $('list').appendChild(li);
  }
}
/* 内联填/改 key 行(不用 prompt: 扩展弹窗里模态框不可靠; 预填当前值, 可改可清, 清空=删) */
function toggleKeyRow(li, port, stored) {
  const next = li.nextElementSibling;
  if (next && next.classList.contains('keyrow')) { next.remove(); return; }
  document.querySelectorAll('.keyrow').forEach(x => x.remove());
  const row = document.createElement('li'); row.className = 'keyrow';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = stored || '';
  inp.placeholder = ':' + port + ' 的密码/API key(本地明文存, 清空=删)';
  const ok = document.createElement('button'); ok.textContent = '存';
  ok.onclick = async () => { await send({ op: 'setkey', port, key: inp.value.trim() }); doScan(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.onclick(); });
  row.append(inp, ok);
  li.after(row);
  inp.focus();
}
$('scan').onclick = doScan;
$('reload').onclick = () => { $('msg').textContent = '重载中…'; send({ op: 'reload' }); };

chrome.storage.local.get('notify').then(v => { $('notify').checked = v.notify !== false; });
$('notify').onchange = () => chrome.storage.local.set({ notify: $('notify').checked });
// 默认授权: 勾上 = 给 Colony 站点把麦克风/摄像头/通知/弹窗/多文件下载设成「允许」(contentSettings), 取消 = 改回「每次询问」
const PERM_ORIGIN = 'https://colonyai.fun/*';
const PERM_KINDS = ['microphone', 'camera', 'notifications', 'popups', 'automaticDownloads'];
(async () => {
  const s = (await chrome.storage.local.get('mediaAllow')).mediaAllow;
  let on = !!(s && s.on);
  if (!s && chrome.contentSettings) { try { on = (await chrome.contentSettings.camera.get({ primaryUrl: 'https://colonyai.fun/' })).setting === 'allow'; } catch (e) { } }
  $('autoperm').checked = on;
})();
$('autoperm').onchange = async () => {
  const on = $('autoperm').checked;
  if (!chrome.contentSettings) { $('msg').textContent = '缺 contentSettings 权限'; return; }
  for (const k of PERM_KINDS) { try { await chrome.contentSettings[k].set({ primaryPattern: PERM_ORIGIN, setting: on ? 'allow' : (k === 'popups' ? 'block' : 'ask') }); } catch (e) { } }
  await chrome.storage.local.set({ mediaAllow: { on, origins: ['https://colonyai.fun'], kinds: PERM_KINDS, at: Date.now() } });
  $('msg').textContent = on ? '已默认授权(刷新 Colony 生效)' : '已改回每次询问';
};

/* ── 接入包导出: 三条指令(端口型/CLI型·含壳/云端型·含兜底)可复制 + 接入器下载(源=blocks/colony-gateway.mjs 与 colony-agent.mjs, 此处为发货副本, 改源后要同步) ── */
/* ── 接入指令在 instr.js(popup.html 先载入): TASK_HEAD / INSTR_EP / INSTR_CLI / INSTR_CLOUD / CLOUD_BRIDGE / colonyInstrBundle ── */
const flash = t => { $('msg').textContent = t; setTimeout(() => { if ($('msg').textContent === t) $('msg').textContent = ''; }, 2500); };
$('exp-ep').onclick = () => navigator.clipboard.writeText(INSTR_EP).then(() => flash('✓ 已复制端口型指令')).catch(e => flash('✗ ' + e.message));
$('exp-cli').onclick = async () => { // CLI型: 指令 + 网关壳源码一并复制(一份贴过去即可, 不必再单独下载壳)
  try {
    const bundle = await colonyInstrBundle('cli');
    await navigator.clipboard.writeText(bundle);
    flash('✓ 已复制 CLI型指令+网关壳(' + (bundle.length / 1024).toFixed(1) + 'KB)');
  } catch (e) { flash('✗ ' + e.message); }
};
$('exp-cloud').onclick = async () => { // 云端型: 指令(桥地址已写死) + 兜底接入器源码一并复制 —— webhook 首选用不到末尾源码, 没公网 URL 走长轮询时它就是现成兜底码
  try {
    const bundle = await colonyInstrBundle('cloud');
    await navigator.clipboard.writeText(bundle);
    flash('✓ 已复制云端型指令+兜底接入器(' + (bundle.length / 1024).toFixed(1) + 'KB)');
  } catch (e) { flash('✗ ' + e.message); }
};
$('exp-agent').onclick = async () => {
  try {
    const txt = await (await fetch(chrome.runtime.getURL('colony-agent.mjs'))).text();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
    a.download = 'colony-agent.mjs'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    flash('✓ 接入器已下载(' + (txt.length / 1024).toFixed(1) + 'KB)');
  } catch (e) { flash('✗ ' + e.message); }
};

$('cadd').onclick = async () => {
  const p = parseInt($('cport').value.trim());
  if (!p || p < 1 || p > 65535) { $('msg').textContent = '端口要 1–65535'; return; }
  const cur = (await chrome.storage.local.get('customPorts')).customPorts || [];
  if (!cur.includes(p)) cur.push(p);
  await chrome.storage.local.set({ customPorts: cur });
  $('cport').value = ''; doScan();
};

/* ── 本机成员管理(方案乙: 本地 agent 连接/改名/删 归插件, 数据存 chrome.storage, 页面群聊自动读) ── */
async function renderMembers() {
  const host = $('members'); if (!host) return;
  const r = await send({ op: 'epRoster' });
  const arr = (r && r.roster) || [];
  if (!arr.length) { host.innerHTML = '<li class="dim">还没有本机成员 — 上面扫到端点后点「＋连接」加进来。</li>'; return; }
  host.innerHTML = '';
  for (const e of arr) {
    const li = document.createElement('li');
    const badge = e.memory === 'stateful' ? '<span class="ok" title="认会话头, 记忆连续">🧠</span>' : '<span class="warn" title="每轮独立, 不保记忆(想连续请用 colony-gateway 接入)">💤</span>';
    li.innerHTML = '<span class="st ' + (e.online ? 'ok' : 'dim') + '">' + (e.online ? '🟢' : '⚪') + '</span>' + badge
      + '<span class="ep-hint">' + esc(e.name) + ' <small class="dim">' + esc(e.base.replace(/^https?:\/\//, '')) + '</small></span>';
    const sdk = document.createElement('label'); sdk.className = 'sdkbox'; // 同 AI 配置的"允许 mini app 通过 SDK 调用"(端点卡时代在桥里, 方案乙迁插件时曾丢失)
    sdk.title = '允许 mini app 通过 SDK 调用此 agent — 勾选后 miniapp 里 colony.ai.chat({provider:"' + e.name + '"}) 可用它当对话方。注意它是带记忆的 agent(会话自续), 不是无状态模型。默认关。';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!e.allowSDK;
    cb.onchange = async () => { await send({ op: 'epUpdate', id: e.id, patch: { allowSDK: cb.checked } }); flash(cb.checked ? '✓ 已允许 mini app 调用: ' + e.name : '已关闭 mini app 调用: ' + e.name); };
    sdk.append(cb, document.createTextNode('SDK'));
    const rn = document.createElement('button'); rn.textContent = '改名'; rn.onclick = () => renameRow(li, e);
    const del = document.createElement('button'); del.textContent = '🗑'; del.title = '从群聊移除'; del.onclick = async () => { await send({ op: 'epRemove', id: e.id }); renderMembers(); };
    li.append(sdk, rn, del); host.appendChild(li);
  }
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renameRow(li, e) {
  const next = li.nextElementSibling; if (next && next.classList.contains('keyrow')) { next.remove(); return; }
  document.querySelectorAll('.keyrow').forEach(x => x.remove());
  const row = document.createElement('li'); row.className = 'keyrow';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = e.name; inp.placeholder = '新名字(agent 下轮会知道自己叫这个)';
  const ok = document.createElement('button'); ok.textContent = '存';
  ok.onclick = async () => { const nm = inp.value.trim(); if (nm && nm !== e.name) await send({ op: 'epRename', id: e.id, name: nm }); row.remove(); renderMembers(); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') ok.onclick(); });
  row.append(inp, ok); li.after(row); inp.focus();
}

doScan();
renderMembers();


/* ── 云端成员: 直接问云端桥(CLOUD_BRIDGE, 名单口不要口令), 本机和云端的 agent 都在插件里接、管; 页面通讯录自己也连这座桥 ── */
async function cloudCall(path, body) {
  const r = await fetch(CLOUD_BRIDGE + '/colony-agent/v2/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
}
const ago = t => { if (!t) return ''; const d = (Date.now() - t) / 1000; return d < 120 ? '刚刚' : d < 7200 ? Math.round(d / 60) + ' 分钟前' : d < 172800 ? Math.round(d / 3600) + ' 小时前' : Math.round(d / 86400) + ' 天前'; };
async function renderCloud() {
  const host = $('cloud'); if (!host) return;
  let j; try { j = await cloudCall('members'); } catch (e) { host.innerHTML = '<li class="dim">云端桥连不上: ' + esc(e.message) + '</li>'; return; }
  host.innerHTML = '';
  const row = (html, btns) => { const li = document.createElement('li'); li.innerHTML = html;
    btns.forEach(([t, f, tip]) => { const b = document.createElement('button'); b.textContent = t; if (tip) b.title = tip; b.onclick = async () => { b.disabled = true; try { await f(); } catch (e) { flash('✗ ' + e.message); } renderCloud(); }; li.appendChild(b); });
    host.appendChild(li); };
  (j.pending || []).forEach(p => row('<span class="warn">🙋</span><span class="ep-hint">' + esc(p.name || p.pendingId) + ' <small class="dim">申请接入' + (p.webhook ? ' · webhook' : ' · 长轮询') + '</small></span>',
    [['通过', () => cloudCall('approve', { pendingId: p.pendingId })], ['拒绝', () => cloudCall('reject', { pendingId: p.pendingId })]]));
  (j.members || []).forEach(m => row('<span class="st">' + (m.online ? '🟢' : '⚪') + '</span><span class="ep-hint">' + esc(m.name || m.keyShort)
      + ' <small class="dim">' + (m.online ? '在线' : '上次 ' + ago(m.lastSeen)) + (m.webhook ? ' · webhook' : '') + '</small></span>',
    [['🗑', () => cloudCall('remove', { agentKey: m.agentKey }), '从云端桥删掉(它要重新申请)']]));
  (j.revoked || []).forEach(m => row('<span class="dim">⛔</span><span class="ep-hint dim">' + esc(m.name || m.keyShort) + ' <small>已撤销</small></span>',
    [['恢复', () => cloudCall('reapprove', { agentKey: m.agentKey })], ['🗑', () => cloudCall('remove', { agentKey: m.agentKey })]]));
  if (!host.children.length) host.innerHTML = '<li class="dim">还没有云端 agent — 下面复制「云端型」指令发给它, 它申请后在这里通过。</li>';
}
renderCloud();

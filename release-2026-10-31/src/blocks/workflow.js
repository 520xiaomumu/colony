'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ↦ 借 petri:ai 的 厂商配置
// ↦ 借 petri:ai 的 选模型
// ↦ 借 petri:ai 的 登记能力 · 按需: 存储.模态
// ═ 小工具 · 跟着: 工作室外壳 ═
// 块内事件是 document 上的 CustomEvent('wf:<名>'), 画布、别的块都能听; 块卸载时自动摘掉监听
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => ('0' + n).slice(-2);
const uid = p => (p || '') + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8)
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const withTimeout = (p, ms, onTimeout) => new Promise((res, rej) => {
  const t = setTimeout(() => {
    try { onTimeout?.(); } catch (e) { }
    rej(new Error('节点执行超时 ' + ms + 'ms'));
  }, ms);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
const 事件 = {
  发: (名, detail) => document.dispatchEvent(new CustomEvent('wf:' + 名, { detail })),
  听(名, fn) {   // 名带冒号就是全名(colony:apps), 不带就是 wf:<名>
    const type = 名.includes(':') ? 名 : 'wf:' + 名;
    const h = e => { try { fn(e.detail); } catch (err) { console.warn('[workflow]', type, err); } };
    document.addEventListener(type, h);
    const off = () => document.removeEventListener(type, h);
    ctx.cleanup(off);
    return off;
  }
};
// 提示条: 工作流窗开着就画在窗里; 窗关着或收起了画在整页上, 后台跑完也看得到
const toast = msg => {
  if (!studio) return console.info('[workflow]', msg);
  const 窗 = 露() && !ctx.root.closest('.u-min'), box = 窗 ? studio : document.body;   // 收起的窗里也看不见
  const el = document.createElement('div');
  box.querySelectorAll(':scope > .wf-toast').forEach(x => x.remove());
  el.className = 'wf-toast';
  el.textContent = msg;
  if (!窗) el.style.cssText = 'position:fixed;z-index:300';
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};
// ═ 连线与端口 · 跟着: 节点应用, 判断循环数据, AI 节点 ═
// 无端口边的合并: 上游是 JSON 文本先解析(模型常给字符串); 非对象值收进 value, 直接 assign 字符串会按字符拆散
const mergeUp = (inputs, v) => {
  if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { v = JSON.parse(v); } catch (e) { } }
  if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(inputs, v);
  else if (v !== undefined) inputs.value = v;
  return inputs;
};
// 入边折成 inputs(引擎和单跑共用): 有 to.port 定向写, 没有就合并; 带 from.port 只取那一口;
// 原值口(e) 说这条边要原值时, 判断只收到一个值(在 value 里)就往下传那个值, 不传 {result, value} 整包
const foldEdgeInputs = (inputs, incoming, getOut, skipped, 原值口) => {
  for (const e of incoming) {
    if (skipped?.has(e.from.node)) continue;
    const raw = getOut(e.from.node);
    if (raw == null) continue;
    const up = raw.outputs || raw;
    let v = e.from.port ? up[e.from.port] : up;
    if (e.to.port && 原值口?.(e) && Object.keys(v || {}).join() === 'result,value') v = v.value;
    if (e.to.port) inputs[e.to.port] = v; else mergeUp(inputs, v);
  }
  return inputs;
};
// 判断连进文本这类单个口(端口类型不是 any/json/object)要原值; 代码模态和没标类型的口照旧收整包。kindOf(节点 id) 回种类
const 原值口 = (n, nd, kindOf) => e => kindOf(e.from.node) === 'condition'
  && !(n.miniappId === AI_NODE_ID && n.params?.mode === '代码')
  && !['any', 'json', 'object'].includes((nd?.inputs || []).find(p => p.name === e.to.port)?.type ?? 'any');
// 运行前按节点 schema 补缺省参数(只补缺的)
function resolveParams(entry) {
  const out = Object.assign({}, entry.node?.params);
  for (const p of entry.miniapp?.node?.params || [])
    if (out[p.name] == null && p.default != null) out[p.name] = p.default;
  return out;
}
// 端口显示序: 去尾号的基名按首现位置归组, 组内按尾号。连线按名不按位置, 排序只管显示
function sortPorts(list) {
  const first = {}, base = p => String(p.name).replace(/\d+$/, ''),
    num = p => +(String(p.name).match(/\d+$/) || [1])[0];
  (list || []).forEach((p, i) => { first[base(p)] ??= i; });
  return (list || []).map((p, i) => [p, i]).sort((a, b) =>
    first[base(a[0])] - first[base(b[0])] || num(a[0]) - num(b[0]) || a[1] - b[1]).map(x => x[0]);
}
// 实例级端口定制 n.ports 合并进 schema(同名忽略); 引擎和画布共用
function mergeNodePorts(nd, ports) {
  if (!nd || !ports || (!ports.inputs?.length && !ports.outputs?.length)) return nd;
  const add = (b, x) => (b || []).concat((x || [])
    .filter(p => p?.name && !(b || []).some(q => q.name === p.name)));
  return Object.assign({}, nd, { inputs: sortPorts(add(nd.inputs, ports.inputs)),
    outputs: sortPorts(add(nd.outputs, ports.outputs)) });
}
// 节点的端口表(画布、打包、目录共用)
async function portsOf(n) {
  const 无口 = { inputs: [], outputs: [] };
  if (n.kind && n.kind !== 'miniapp') return KIND_DEF[n.kind]?.nd || 无口;
  if (n.miniappId === AI_NODE_ID) return mergeNodePorts(AI_NODE_SCHEMA, n.ports);
  const m = await Apps.get(n.miniappId);
  return m?.node ? mergeNodePorts(m.node, n.ports) : 无口;
}
// ═ 节点应用 · 跟着: 小工具 ═
// 小应用库归界面块, 读写都走 apps.* 能力。单独打开时没有: 读回空, 写就说清还能用什么
const Apps = {
  无: '单独打开的工作流没有小应用库, 小应用节点和打包节点用不了; 判断、循环、数据(工作流)、AI 节点照样能用。'
    + '放进 Colony 就都能用',
  调: (path, a) => colony.has(path) ? ctx.call(path, a) : Promise.reject(new Error(Apps.无)),
  get: async id => id && colony.has('apps.get') ? ctx.call('apps.get', { id }).catch(() => null) : null,
  async all() {   // 整条记录(带 node、pack 字段)
    const 摘 = colony.has('apps.list') ? await Apps.list() : [];
    return (await Promise.all(摘.map(m => Apps.get(m.id)))).filter(Boolean);
  },
  // 数据节点用的, 形状和存储一样; list 回摘要
  list: () => Apps.调('apps.list', {}),
  create: r => Apps.调('apps.create', r),
  update: (id, patch) => Apps.调('apps.update', { id, patch }),
  remove: id => Apps.调('apps.remove', { id })
};
// 挂一个节点应用跑一次: 挂上就算握手过了; 还没 expose 就短重试。live = 这次运行的 {停, kills}:
// 挂载前就登记, 握手那几秒里点停也停得住
async function invokeApp(app, payload, context, execMs, exposeMs, live) {
  if (live?.停) throw new Error('已停止');
  const host = document.createElement('div');
  let f = null;
  const kill = () => { try { f?.colony.destroy(); } catch (e) { } host.remove(); };
  host.style.display = 'none';
  document.body.appendChild(host);
  live?.kills.add(kill);
  try {
    const mount = { code: app.code, host, hidden: true, timeout: exposeMs || 8000,
      context: Object.assign({ miniappId: app.id, mode: 'node' }, context) };
    f = await ctx.call('stem.mount', mount).catch(e => { f = e.frame; throw e; });   // 握手超时也收掉半挂的窗
    if (live?.停) throw new Error('已停止');
    const deadline = Date.now() + (exposeMs || 8000);
    for (; ;) {
      try { return await withTimeout(f.colony.call('node:invoke', payload), execMs, kill); }
      catch (e) {
        if (!/未暴露/.test(e?.message || '') || Date.now() >= deadline || live?.停) throw e;
        await sleep(50);
      }
    }
  } finally { live?.kills.delete(kill); kill(); }
}
// ═ 检查图 · 跟着: 连线与端口, 节点应用, AI 模态, AI 节点, 节点模型 ═
// 引擎: 并行 DAG + 动态扩图 + 内建 kind(判断/循环/数据) + AI 节点直执。普通节点 = 带 node 字段的小应用,
// 挂进隐藏隔离窗, 调它 expose 的 node:invoke; 包节点(pack.workflowId)直接跑子工作流
// 节点错误归类: AI_PROVIDER_ERROR 是配置类, 能被「补齐配置后重跑」接住
function classifyNodeErr(msg) {
  msg = String(msg || '');
  if (/未暴露|node:invoke|未就绪/.test(msg)) return { phase: 'expose', code: 'NODE_INVOKE_NOT_EXPOSED' };
  if (/执行超时/.test(msg)) return { phase: 'execute', code: 'NODE_EXEC_TIMEOUT' };
  return { phase: 'execute', code: AI_CFG_ERR.test(msg) ? 'AI_PROVIDER_ERROR'
    : /表达式错误|循环字段|不是数组|未知资源|不存在/.test(msg) ? 'NODE_INPUT_ERROR' : 'NODE_RUNTIME_ERROR' };
}
// 话里怎么叫一个节点: 起过名的说「名字」, 没起名的说 id(检查图、模型提醒、agent 扩图都用)
const 叫 = (n, id) => n?.title ? '「' + n.title + '」' : String(n?.id ?? id);
const 节点话 = n => '节点' + (n?.title ? '' : ' ') + 叫(n);
const Engine = {
  async buildEntry(n) {
    const kind = n.kind || 'miniapp', bad = error => ({ ok: false, error });
    const ok = x => ({ ok: true, entry: Object.assign({ node: n, kind }, x) });
    if (kind === 'condition') return n.expr ? ok() : bad('缺 expr 表达式');
    if (kind === 'loop') return n.over ? ok() : bad('缺 over(要循环的数组字段名)');
    if (kind === 'data') return n.op && n.resType ? ok() : bad('缺 op 或 resType');
    if (kind !== 'miniapp') return bad('未知类型 ' + kind);
    if (n.miniappId === AI_NODE_ID) return ok({ builtin: 'ai',
      miniapp: { id: AI_NODE_ID, name: 'AI 节点', icon: '✨', node: mergeNodePorts(AI_NODE_SCHEMA, n.ports) } });
    const m = await Apps.get(n.miniappId);
    if (!m) return bad(colony.has('apps.get') ? '小应用已删除' : Apps.无);
    if (!m.node) return bad('不是节点应用(记录缺顶层 node 字段)');
    const node = mergeNodePorts(m.node, n.ports);
    return ok({ miniapp: node === m.node ? m : Object.assign({}, m, { node }) });
  },
  summarize(o) {   // 结果摘要: 数组写几项, 对象写几个字段, 长字截到 40
    if (o == null || typeof o !== 'object') return o;
    const s = {};
    for (const [k, v] of Object.entries(o)) s[k] = Array.isArray(v) ? v.length + ' 项'
      : v && typeof v === 'object' ? '{' + Object.keys(v).length + ' 字段}'
      : typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v;
    return s;
  },
  async validate(wf) {   // 话里的节点起过名的说名字, 没起名的说 id; 端点节点已经报过错的线不再报
    const errors = [], map = new Map(), 报过 = new Set(), 节点 = new Map((wf.nodes || []).map(n => [n.id, n]));
    for (const n of wf.nodes || []) {
      const r = await this.buildEntry(n);
      if (r.ok) map.set(n.id, r.entry);
      else { 报过.add(n.id); errors.push(节点话(n) + ': ' + r.error); }
    }
    for (const e of wf.edges || []) {
      if (报过.has(e.from.node) || 报过.has(e.to.node)) continue;
      const f = map.get(e.from.node), t = map.get(e.to.node);
      const 边 = 叫(节点.get(e.from.node), e.from.node) + '→' + 叫(节点.get(e.to.node), e.to.node);
      if (!f || !t) { errors.push('边 ' + 边 + ': 节点缺失'); continue; }
      if (f.kind === 'condition' && e.label !== 'true' && e.label !== 'false') {
        errors.push('condition 出边 ' + 边 + ' 必须带 label:"true" 或 "false"(不带两路都会执行)');
        continue;
      }
      if (f.kind !== 'miniapp' || t.kind !== 'miniapp') continue;
      const out = (f.miniapp.node.outputs || []).find(p => p.name === e.from.port),
        inp = (t.miniapp.node.inputs || []).find(p => p.name === e.to.port);
      if (e.from.port && !out) errors.push('边 ' + 边 + ': 上游无输出端口 ' + e.from.port);
      if (e.to.port && !inp) errors.push('边 ' + 边 + ': 下游无输入端口 ' + e.to.port);
      if (out?.type && inp?.type && out.type !== 'any' && inp.type !== 'any' && out.type !== inp.type)
        errors.push('边 ' + 边 + ': 类型不匹配 ' + out.type + ' → ' + inp.type);
    }
    // 生成类模态填了不像这一类的模型: 如实带回(保存不拦), 不必等运行才炸; 查不成也照原话带回
    errors.push(...await AI.suspectModels(wf.nodes || []).catch(e => ['模型没查成: ' + e.message]));
    return { ok: errors.length === 0, errors, map };
  },
  topo(nodes, edges) {   // 拓扑序, 有环就抛
    const inDeg = new Map(nodes.map(n => [n.id, 0])), adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
      inDeg.set(e.to.node, (inDeg.get(e.to.node) || 0) + 1);
      adj.get(e.from.node)?.push(e.to.node);
    }
    const q = [...inDeg].filter(([, d]) => d === 0).map(([id]) => id), out = [];
    while (q.length) {
      const id = q.shift();
      out.push(id);
      for (const x of adj.get(id) || []) {
        inDeg.set(x, inDeg.get(x) - 1);
        if (inDeg.get(x) === 0) q.push(x);
      }
    }
    if (out.length !== nodes.length) throw new Error('工作流有环');
    return out;
  },
  成环(edges, a, b) {   // 再连一条 a→b 会不会成环: 从 b 顺着线走得到 a 就会
    const 走过 = new Set(), 栈 = [b];
    while (栈.length) {
      const x = 栈.pop();
      if (x === a) return true;
      if (走过.has(x)) continue;
      走过.add(x);
      for (const e of edges) if (e.from.node === x) 栈.push(e.to.node);
    }
    return false;
  }
};
// ═ 判断循环数据 · 跟着: 小工具, 工作室外壳, 工作流列表, 画布交互, 画节点与连线, 加节点与菜单 ═
// 三种内建 kind 的画布样子: 入口名空串 = 无端口合并; 判断的出口 true/false 连成边时写成 label。用法写在技能段
const KIND_DEF = {
  condition: { icon: '⑂', name: '判断', nd: {
    inputs: [{ name: '', label: '输入(合并上游)' }],
    outputs: [{ name: 'true', label: '真' }, { name: 'false', label: '假' }],
    params: [{ name: 'expr', label: '表达式(input=上游输出, 单个口的值在 input.value, 如 input.value>=6)',
      control: 'textarea',
      topLevel: true }] } },
  loop: { icon: '⟳', name: '循环', nd: {
    inputs: [{ name: '', label: '输入(含数组字段)' }],
    outputs: [{ name: 'results', label: '结果集' }, { name: 'count', label: '数量' }],
    params: [{ name: 'over', label: '要循环的数组字段名', topLevel: true },
      { name: 'bodyMiniappId', label: '循环体节点 id(留空=仅展开数组)', topLevel: true }] } },
  data: { icon: '🗃', name: '数据', nd: {
    inputs: [{ name: '', label: '输入(id/record/patch)' }, { name: 'value', label: '写回值' }],
    outputs: [{ name: '', label: '结果' }],
    params: [
      { name: 'op', label: '操作', control: 'select', options: ['get', 'list', 'create', 'update', 'delete'],
        topLevel: true, default: 'get' },
      { name: 'resType', label: '资源类型', control: 'select', options: ['miniapp', 'workflow'], topLevel: true,
        default: 'miniapp' },
      { name: 'resId', label: '资源 id(留空=吃上游 id 字段)', topLevel: true },
      { name: 'patchKey', label: '写回字段名(update 用: 把输入包成 {字段:值}, 值走 value 口)', topLevel: true }] } }
};
// 给 catalog 的种类表: 只是数据(每种的参数名、说明、可选值、缺省值)
const KINDS_USE = Object.entries(KIND_DEF).map(([kind, { name, nd }]) => ({ kind, name,
  params: nd.params.map(({ name, label, options, default: v }) => ({ name, label, options, default: v })) }));
async function addKindNode(kind) {   // 加一个内建节点, 带上能直接跑的样例参数
  if (!cur) await openWorkflow(null);
  const p = nextPos(), seed = kind === 'condition' ? { expr: 'input.value >= 6' }
    : kind === 'loop' ? { over: 'items' } : { op: 'get', resType: 'miniapp' };
  const id = uid(kind.slice(0, 4) + '_');
  cur.nodes.push(Object.assign({ id, kind, params: {}, x: p.x, y: p.y }, seed));
  renderCanvas().then(() => 露出(id));
}
// ═ 并行调度 · 跟着: 连线与端口, 节点应用, 检查图, 资产与成果, 存储, 运行跑道, AI 模态, AI 节点, 打包成节点 ═
Object.assign(Engine, {
  // 子工作流(包节点、包当循环体): 深度和链跟着父图走, 防套娃; 不进历史和成果; 上层停了(live.停)它也停
  async runSub(pack, inputs, wf, what, live) {
    if (live?.停) throw new Error('已停止');
    const def = await Pack.defFor(pack, inputs);
    const r = await Eph.run(def, { depth: (wf._wfDepth || 0) + 1, chain: wf._wfChain || [], noHistory: true,
      noOutcome: true, source: 'sub', onStart: rec => live?.kills.add(() => rec.control.abort?.('上层已停止')) });
    if (r.status !== 'done')
      throw new Error(what + '未完成(' + r.status + '): ' + JSON.stringify(r.error || []).slice(0, 180));
    return Assets.normalize(r.outputs || {});
  },
  async execNode(entry, inputs, nid, wf, edges, skipped, live) {
    const { node, kind } = entry, rc = wf.runConfig || {}, 名 = (wf.name || '工作流') + ' · ' + nid;
    if (entry.builtin === 'ai') {
      const r = await AI.exec(inputs, resolveParams(entry), { wf, nid, signal: live?.ac.signal });   // 停了撤请求
      return { o: await Assets.normalize(r.o, 名), picked: r.picked };
    }
    const ctxOf = () => ({ workflowId: wf.id, nodeId: nid, _wfDepth: wf._wfDepth || 0,
      _wfChain: wf._wfChain || [] });
    if (kind === 'miniapp') {
      const app = entry.miniapp, context = ctxOf();
      if (app.pack?.workflowId) return { o: await this.runSub(app.pack, inputs, wf, '子工作流', live) };
      const execMs = node.timeoutMs || app.node?.timeoutMs || rc.timeoutMs || 60000;
      const raw = (await invokeApp(app, { inputs, params: resolveParams(entry), context }, context, execMs,
        rc.exposeTimeoutMs || 8000, live)) || {};
      return { o: await Assets.normalize(raw.outputs || raw, 名) };
    }
    if (kind === 'condition') {
      // 引用的字段全缺 = 接线错的强信号, 点名实收的键; 部分缺不拦(如 !input.err 这类故意探空)
      const refs = [...new Set([...String(node.expr).matchAll(/input\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))];
      const miss = refs.filter(k => !(k in inputs));
      if (refs.length && miss.length === refs.length) throw new Error('表达式引用的字段不存在: ' + miss.join(',')
        + ', 实际收到的键: [' + Object.keys(inputs).join(',') + '] — 检查边的 from.port 是否指错口, 或去掉端口整包透传');
      let result;
      try { result = Function('input', 'return (' + node.expr + ');')(inputs); }
      catch (e) { throw new Error('表达式错误: ' + e.message); }
      const branch = result ? 'true' : 'false';
      for (const e of edges) if (e.from.node === nid && e.label && e.label !== branch) skipped.add(e.to.node);
      return { o: Object.assign({ result: !!result }, inputs), branch };
    }
    if (kind === 'loop') {
      const arr = inputs[node.over], results = [];
      if (!Array.isArray(arr)) throw new Error('循环字段 ' + node.over + ' 不是数组');
      if (!node.bodyMiniappId) return { o: { results: arr.map((item, index) => ({ item, index })),
        count: arr.length } };
      const bm = await Apps.get(node.bodyMiniappId);
      if (!bm) throw new Error(colony.has('apps.get') ? '循环体小应用不存在: ' + node.bodyMiniappId : Apps.无);
      const execMs = node.timeoutMs || bm.node?.timeoutMs || 60000, params = node.params || {};
      for (let i = 0; i < arr.length; i++) {
        const inp = Object.assign({ item: arr[i], index: i }, params), context = ctxOf();
        if (bm.pack?.workflowId) results.push(await this.runSub(bm.pack, inp, wf, '循环体第 ' + i + ' 项', live));
        else {
          const r = await invokeApp(bm, { inputs: inp, params, context }, context, execMs, 8000, live);
          results.push(await Assets.normalize(r?.outputs || r, 名));
        }
      }
      return { o: { results, count: results.length } };
    }
    if (kind === 'data') {
      const crud = node.resType === 'workflow' ? 存储 : node.resType === 'miniapp' ? Apps : null;
      if (!crud) throw new Error('未知资源类型: ' + node.resType + '(支持 miniapp/workflow)');
      const resId = inputs.id || node.resId || node.id;   // 上游喂 > 显式 resId > 节点自身 id(旧图兼容)
      if (node.op === 'list') return { o: { items: await crud.list() } };
      if (node.op === 'get') return { o: await crud.get(resId) };
      if (node.op === 'create') return { o: await (crud.create || crud.save)(inputs.record || inputs) };
      if (node.op === 'delete') return { o: await crud.remove(resId) };
      if (node.op !== 'update') throw new Error('未知数据操作: ' + node.op);
      let patch = inputs.patch || inputs;
      if (node.patchKey) {   // 写回形状: 包成 {patchKey: 值}, 值先取 value 口, 没有就整包(去 id); JSON 串存成结构
        let v = inputs.value;
        if (v === undefined) { v = Object.assign({}, inputs); delete v.id; }
        if (typeof v === 'string') try {
          const j = JSON.parse(stripFence(v));
          if (j && typeof j === 'object') v = j;
        } catch (e) { }
        patch = { [node.patchKey]: v };
      }
      return { o: await crud.update(resId, patch) };
    }
    return { o: {} };
  },
  // 一次运行 = 异步生成器, 逐个吐事件: workflow:config → node:queued/start/done/error … → graph:patch(扩图)
  // → workflow:done|error|cancelled。输入优先级: initial(只给入口) < seedInputs < 入边 < params。
  // disabled 和被判断剪掉的都算跳过, 下游照常解锁。control.patch(扩图, patchId 幂等)、control.abort(停: 不再调度,
  // 焚掉在途隔离窗)挂到运行跑道给的 control 上
  async* run(wf, initial, control) {
    control = control || {};
    const v = await this.validate(wf);
    if (!v.ok) { yield { type: 'workflow:error', errors: v.errors }; return; }
    let order;
    try { order = this.topo(wf.nodes, wf.edges || []); }
    catch (e) { yield { type: 'workflow:error', errors: [e.message] }; return; }
    const rc = wf.runConfig || {}, edges = (wf.edges || []).slice();
    const nodeConcurrency = Math.max(1, rc.nodeConcurrency || 4), maxNodes = Math.max(1, rc.maxNodes || 120),
      maxDepth = Math.max(0, rc.maxDepth ?? 5);
    const outs = new Map(), skipped = new Set(), errored = new Set(), done = new Set(), started = new Set();
    const remaining = new Map(order.map(id => [id, 0])), downstream = new Map(order.map(id => [id, []])),
      depthMap = new Map(order.map(id => [id, 0]));
    for (const e of edges) {
      remaining.set(e.to.node, remaining.get(e.to.node) + 1);
      downstream.get(e.from.node).push(e.to.node);
    }
    const applied = new Map(), queue = [], ready = [];
    const live = { 停: false, kills: new Set([() => live.ac.abort()]), ac: new AbortController() };   // 停时都掐
    let patchSeq = 0, wake = null, finished = false, fatalErr = null, aborted = false, active = 0, resolveAll;
    const allDone = new Promise(r => { resolveAll = r; });
    const push = ev => { queue.push(ev); if (wake) { const w = wake; wake = null; w(); } };
    const titleOf = ({ node, kind, miniapp }) => kind === 'miniapp' ? miniapp.name
      : kind === 'condition' ? '判断: ' + node.expr : kind === 'loop' ? '循环 ' + node.over
      : kind === 'data' ? '数据 ' + node.op + ' ' + node.resType : kind;
    const enqueue = nid => { ready.push(nid); push({ type: 'node:queued', nodeId: nid }); };
    const unlock = nid => {
      for (const d of downstream.get(nid) || []) {
        remaining.set(d, remaining.get(d) - 1);
        if (remaining.get(d) === 0) enqueue(d);
      }
    };
    const runOne = async nid => {
      const entry = v.map.get(nid), incoming = edges.filter(e => e.to.node === nid);
      const 跳过 = entry.node.disabled || skipped.has(nid)
        || incoming.length && incoming.every(e => skipped.has(e.from.node));
      if (跳过) { skipped.add(nid); return unlock(nid); }
      started.add(nid);
      const inputs = Object.assign({}, incoming.length ? null : initial, entry.node.seedInputs);
      foldEdgeInputs(inputs, incoming, id => outs.get(id) || {}, skipped,
        原值口(entry.node, entry.miniapp?.node, id => v.map.get(id)?.kind));
      Object.assign(inputs, entry.node.params);
      if (aborted) return;
      const params = entry.kind === 'miniapp' ? resolveParams(entry) : entry.node.params || {};
      push({ type: 'node:start', nodeId: nid, title: titleOf(entry), name: entry.node.title || '',
        kind: entry.kind, inputs, params, miniappId: entry.miniapp?.id });
      const t0 = Date.now();
      try {
        const { o, branch, picked } = await this.execNode(entry, inputs, nid, wf, edges, skipped, live);
        if (aborted) return;
        outs.set(nid, o);
        done.add(nid);
        // picked = 智选换了模型才有, 如实回报
        push(Object.assign({ type: 'node:done', nodeId: nid, kind: entry.kind, duration: Date.now() - t0,
          outputs: o, outputsSummary: this.summarize(o) }, branch && { branch }, picked && { picked }));
        unlock(nid);
      } catch (err) {
        if (aborted) return;
        const cl = classifyNodeErr(err.message), policy = entry.node.onError || 'fail';
        push({ type: 'node:error', nodeId: nid, kind: entry.kind, error: err.message, phase: cl.phase,
          code: cl.code });
        if (policy === 'fail') {   // 和停止一样掐掉在途的节点(关它们的隔离窗), 不让它们在后台照样跑完、照样花钱
          aborted = live.停 = true;
          live.kills.forEach(kill => kill());
          push({ type: 'workflow:error', errors: [节点话(entry.node) + ' [' + cl.code + ']: ' + err.message] });
          return resolveAll();
        }
        errored.add(nid);
        if (policy === 'skip') skipped.add(nid); else outs.set(nid, {});
        unlock(nid);
      }
    };
    const pump = () => {
      if (aborted) return;
      while (active < nodeConcurrency && ready.length) {
        active++;
        runOne(ready.shift())
          .then(() => { active--; pump(); }, e => { fatalErr = e; aborted = true; resolveAll(); });
      }
      if (!aborted && active === 0 && !ready.length) resolveAll();
    };
    control.patch = async patch => {
      patch = patch || {};
      const patchId = patch.patchId || 'patch_' + (++patchSeq) + '_' + Date.now();
      if (applied.has(patchId)) return applied.get(patchId);
      const fail = (code, message) => ({ ok: false, patchId, code, message });
      if (aborted || finished) return fail('WORKFLOW_ENDED', '工作流已结束');
      const addNodes = patch.addNodes || [], addEdges = patch.addEdges || [];
      if (!addNodes.length && !addEdges.length) return fail('EMPTY_PATCH', 'patch 为空');
      if (order.length + addNodes.length > maxNodes) return fail('MAX_NODES_EXCEEDED', '超过最大节点数 ' + maxNodes);
      const newIds = new Set(), entries = [];
      for (const n of addNodes) {
        if (!n?.id) return fail('MISSING_NODE_ID', 'addNode 缺 id');
        if (v.map.has(n.id) || newIds.has(n.id)) return fail('DUPLICATE_NODE_ID', '节点 id 已存在: ' + n.id);
        newIds.add(n.id);
      }
      for (const n of addNodes) {
        const r = await this.buildEntry(n);
        if (!r.ok) return fail('INVALID_NODE', 节点话(n) + ': ' + r.error);
        entries.push(r.entry);
      }
      const exists = id => v.map.has(id) || newIds.has(id);
      const 动过 = id => started.has(id) || done.has(id) || errored.has(id);
      for (const e of addEdges) {
        if (!e?.from?.node || !e.to?.node) return fail('BAD_EDGE', '边缺端点');
        if (!exists(e.from.node) || !exists(e.to.node)) return fail('DANGLING_EDGE', '边引用不存在节点');
        if (v.map.has(e.to.node) && 动过(e.to.node))
          return fail('TARGET_ALREADY_ACTIVE', '不能给已开始/完成的节点加上游: ' + e.to.node);
      }
      const ups = {}, depthOf = {};
      for (const e of addEdges) if (newIds.has(e.to.node)) (ups[e.to.node] ??= []).push(e.from.node);
      for (const n of addNodes) {
        const u = ups[n.id] || [];
        depthOf[n.id] = u.length ? Math.max(...u.map(x => (depthMap.get(x) ?? depthOf[x] ?? 0) + 1)) : 0;
        if (depthOf[n.id] > maxDepth) return fail('MAX_DEPTH_EXCEEDED', '超过最大深度 ' + maxDepth);
      }
      addNodes.forEach((n, i) => {
        v.map.set(n.id, entries[i]);
        order.push(n.id);
        depthMap.set(n.id, depthOf[n.id]);
        remaining.set(n.id, 0);
        downstream.set(n.id, []);
      });
      for (const e of addEdges) {
        edges.push(e);
        downstream.get(e.from.node).push(e.to.node);
        if (!done.has(e.from.node) && !errored.has(e.from.node))
          remaining.set(e.to.node, remaining.get(e.to.node) + 1);
      }
      const sourceNodeId = patch.sourceNodeId || null;
      const result = { ok: true, patchId, sourceNodeId,
        added: { nodes: addNodes.map(n => n.id), edges: addEdges.length } };
      applied.set(patchId, result);
      push({ type: 'graph:patch', patchId, sourceNodeId, reason: patch.reason || '', addEdges,
        addNodes: addNodes.map((n, i) => ({ id: n.id, kind: n.kind || 'miniapp', miniappId: n.miniappId,
          title: titleOf(entries[i]), x: n.x, y: n.y, params: n.params || {}, ports: n.ports || null,
          seedInputs: n.seedInputs || null, expr: n.expr, over: n.over, op: n.op, resType: n.resType })) });
      for (const n of addNodes) if (remaining.get(n.id) === 0) enqueue(n.id);
      pump();
      return result;
    };
    control.abort = reason => {
      if (aborted || finished) return 跑完了();
      aborted = live.停 = true;
      live.kills.forEach(kill => kill());
      push({ type: 'workflow:cancelled', reason: reason || '用户停止' });
      resolveAll();
      return { ok: true };
    };
    push({ type: 'workflow:config', runConfig: { nodeConcurrency, maxNodes, maxDepth },
      nodeCount: order.length, edgeCount: edges.length });
    order.forEach(id => { if (remaining.get(id) === 0) enqueue(id); });
    pump();
    allDone.then(() => { finished = true; push(null); });
    for (; ;) {
      while (queue.length) { const ev = queue.shift(); if (ev) yield ev; }
      if (finished) break;
      await new Promise(r => { wake = r; });
    }
    if (fatalErr) { yield { type: 'workflow:error', errors: [fatalErr.message] }; return; }
    if (aborted) return;
    const final = {};
    if (Array.isArray(wf.outputs) && wf.outputs.length) {
      for (const o of wf.outputs) {
        const src = o.from ? outs.get(o.from.node) : null;
        if (!src) continue;
        const val = o.from.port ? (src.outputs || src)[o.from.port] : src;
        if (val !== undefined) final[o.name] = val;
      }
    } else {
      const terminals = order.filter(id => !skipped.has(id) && !edges.some(e => e.from.node === id));
      if (terminals.length <= 1) Object.assign(final, outs.get(terminals[0]));
      else {   // 多终端: 键先用节点 title, 没有或撞名退回 id
        const seen = {};
        for (const tid of terminals) {
          let k = String((wf.nodes || []).find(x => x.id === tid)?.title || '').trim() || tid;
          if (seen[k]) k = tid;
          seen[k] = 1;
          final[k] = outs.get(tid) || {};
        }
      }
    }
    yield { type: 'workflow:done', outputs: final };
  }
});
// ═ 运行记录 · 跟着: 小工具, 资产与成果 ═
// 运行记录 wfrun:<id>: 只留最近 runKeep 条(settings:workflow.runKeep, 默认 50); 超大的值摘要化, 不撑爆库
const Runs = {
  KEY: 'wfrun:', KEEP: 50, STR_MAX: 4000, ARR_MAX: 50, DEPTH_MAX: 8, warned: 0,
  async keep() {
    const v = await ctx.kv.get('settings:workflow.runKeep').catch(() => null);
    const n = v != null && isFinite(+v) ? Math.round(+v) : Runs.KEEP;
    return Math.max(1, Math.min(1000, n || Runs.KEEP));
  },
  compactValue(v, d = 0) {
    const { STR_MAX: S, ARR_MAX: A } = Runs;
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > S ? v.slice(0, S) + '…[+' + (v.length - S) + '字符]' : v;
    if (d > Runs.DEPTH_MAX) return '[深度截断]';
    if (Array.isArray(v)) {
      const out = v.slice(0, A).map(x => Runs.compactValue(x, d + 1));
      if (v.length > A) out.push('…[+' + (v.length - A) + '项]');
      return out;
    }
    if (typeof v === 'object') {
      const o = {}, ks = Object.keys(v);
      ks.slice(0, 60).forEach(k => { o[k] = Runs.compactValue(v[k], d + 1); });
      if (ks.length > 60) o['…'] = '[+' + (ks.length - 60) + '字段]';
      return o;
    }
    return null;
  },
  compact(rec) {
    const wf = rec.workflow || {};
    const out = {
      id: rec.id, workflowId: rec.workflowId || wf.id || null, name: rec.name || wf.name || '工作流运行',
      source: rec.source || 'ephemeral', status: rec.status || 'done',
      startedAt: rec.startedAt || null, finishedAt: rec.finishedAt || null,
      duration: rec.finishedAt && rec.startedAt ? rec.finishedAt - rec.startedAt : null,
      workflow: { id: wf.id || null, name: wf.name || '', nodes: wf.nodes || [], edges: wf.edges || [],
        inputs: wf.inputs || null, outputs: wf.outputs || null, runConfig: wf.runConfig || null },
      initialInputs: rec.initialInputs ?? null,
      events: rec.events || [], outputs: rec.outputs ?? null, error: rec.error || null
    };
    try { return JSON.parse(JSON.stringify(Runs.compactValue(out))); }
    catch (e) {
      const { id, workflowId, name, source, status, startedAt, finishedAt } = out;
      return { id, workflowId, name, source, status, startedAt, finishedAt,
        error: ['运行记录序列化失败: ' + e.message] };
    }
  },
  async persist(rec) {   // 落盘: 记录 → 成果 → 清掉超出保留量的
    try { await ctx.kv.set(Runs.KEY + rec.id, Runs.compact(rec)); }
    catch (e) { return console.warn('[workflow] 运行记录落盘失败', e); }
    await Runs.outcome(rec).catch(e => console.warn('[workflow] 成果落盘失败', e));
    await Runs.trim().catch(() => { });
  },
  async trim() {
    const keep = await Runs.keep(), drop = (await Runs.list()).slice(keep);
    if (!drop.length) return;
    await Runs.remove(...drop.map(r => r.id));
    if (Date.now() - Runs.warned < 60000) return;
    Runs.warned = Date.now();
    toast('工作流运行历史已达上限 ' + keep + ' 条, 已清掉最旧的 ' + drop.length + ' 条(改 settings:workflow.runKeep 调保留量)');
  },
  async get(id) { return id ? (await ctx.kv.get(Runs.KEY + id).catch(() => null)) || null : null; },
  async list() {   // 新的在前
    const t = r => r.finishedAt || r.startedAt || 0;
    return (await ctx.kv.list(Runs.KEY)).map(e => e.value).filter(Boolean).sort((a, b) => t(b) - t(a));
  },
  async 改挂(rec, wid, 名) {   // 这次运行(记录和成果)改挂到工作流 wid 上, 名字换成 名: 内存里的、库里的都改
    const 挂 = x => {
      if (名) { x.name = 名; if (x.workflow) x.workflow.name = 名; }
      return Object.assign(x, { workflowId: wid });
    };
    挂(rec);
    const r = await Runs.get(rec.id);
    if (r) await ctx.kv.set(Runs.KEY + rec.id, 挂(r));
    for (const e of await ctx.kv.list('wfout:' + rec.id + ':'))
      await ctx.kv.set(e.key, Object.assign(e.value, { workflowId: wid }, 名 && { workflowName: 名 }));
  },
  async 改名(wid, 名, 内存 = []) {   // 工作流改了名: 它的运行记录(内存里给的、库里的)和成果里的工作流名跟着换
    const 换 = x => { x.name = 名; if (x.workflow) x.workflow.name = 名; return x; };
    内存.filter(r => r?.workflowId === wid).forEach(换);
    for (const e of await ctx.kv.list(Runs.KEY))
      if (e.value?.workflowId === wid) await ctx.kv.set(e.key, 换(e.value));
    for (const e of await ctx.kv.list('wfout:'))
      if (e.value?.workflowId === wid) await ctx.kv.set(e.key, { ...e.value, workflowName: 名 });
  },
  async remove(...ids) {   // 删运行(清理也走这里): 只删记录和它的成果索引; 资产本体不动, 别处可能还引用着,
    for (const id of ids)   // 回收只在成果抽屉里点两下删成果、点两下 🧹 时做
      for (const k of [Runs.KEY + id, ...(await ctx.kv.list('wfout:' + id + ':')).map(e => e.key)])
        await ctx.kv.del(k).catch(() => { });
  }
};
// ═ 资产与成果 · 跟着: 小工具, 运行记录, 运行跑道, 工作室外壳 ═
// 资产 wfasset:<id>: 大的 data 网址卸到这里, 节点间只传引用 {__wfasset, mimeType}; 媒体阈值 = 运行记录截断线。
// 记录和口袋、agent 的引用一个样子 {name, mimeType, from, at, dataUrl}(老记录的 data 也认)。远程网址固化
// (默认关, settings:workflow.archiveAssets 开)借次元口袋的 data.get(配了代理就绕跨域), 取不到就留原网址
const Assets = {
  THRESH: 65536, MEDIA_THRESH: 4000,
  async save(dataUrl, mimeType, name) {
    const id = uid('a_');
    await ctx.kv.set('wfasset:' + id, { name: name || '工作流素材', mimeType: mimeType || '', from: '工作流',
      at: Date.now(), dataUrl });
    return { __wfasset: id, mimeType: mimeType || '' };
  },
  async get(id) { const r = await ctx.kv.get('wfasset:' + id); return r ? r.dataUrl || r.data : null; },
  async normalize(o, 来 = '') {   // 输出里过大的 data 网址换成资产引用; 资产名 = 来处 · 字段名
    if (o == null || typeof o !== 'object') return o;
    const walk = async (v, k) => {
      if (typeof v === 'string' && v.startsWith('data:')) {
        const mime = (/^data:([^;,]+)/.exec(v) || [])[1] || '';
        const 线 = /^(image|audio|video)\//.test(mime) ? Assets.MEDIA_THRESH : Assets.THRESH;
        if (v.length > 线) return Assets.save(v, mime, k);
      }
      const out = Array.isArray(v) ? [] : v && typeof v === 'object' ? {} : null;
      if (!out) return v;
      for (const [kk, x] of Object.entries(v))
        out[kk] = await walk(x, Array.isArray(v) ? k : (k && k + ' · ') + kk);
      return out;
    };
    return walk(o, 来);
  },
  async archiveOn() { return !!(await ctx.kv.get('settings:workflow.archiveAssets').catch(() => null)); },
  async archive(url, mimeType, name) {   // 取不到回 null, 原因记在 Assets.错
    Assets.错 = '';
    if (!/^https?:\/\//.test(url || '')) return null;
    try {
      const r = await ctx.call('data.get', { key: url, path: '' });
      const 名 = name || url.split(/[?#]/)[0].split('/').pop();
      return r?.dataUrl ? Assets.save(r.dataUrl, mimeType || r.mimeType || '', 名) : null;
    } catch (e) { Assets.错 = String(e?.message || e); return null; }
  }
};
// 值里提到的资产号: {__wfasset:号}(转义过的字里的也认)和写成键的 wfasset:号
const 资产号 = v => [...JSON.stringify(v ?? null).matchAll(/__wfasset\W{1,12}([\w-]+)|wfasset:([\w-]+)/g)]
  .map(m => m[1] || m[2]);
// 还在用的资产号: 全库(别的块存的也算, 资产自己不算; 还存着的运行记录在这里头)、还没存好的运行(在跑的、跑完了
// 记录和成果还没写完的)、画布上的(没存的改动、正看着的那次运行)、切走的现场(没存的改动; 那次运行只在记录还存着时算)。
// 存好了的在内存里不占着: 记录被自动清掉的当场就能清, 刷没刷新都一样
async function 在用资产() {
  const 跑 = [...running.values()].filter(r => 没存好.has(r.id) || r.id === ephView)   // 先记下: 读库时存好的也算
    .map(r => [r.initialInputs, r.events, r.outputs]);
  const 全库 = await ctx.kv.list(''), 键 = e => String(e.key);
  const 库 = 全库.filter(e => !键(e).startsWith('wfasset:')).map(e => e.value);
  const 有记录 = new Set(全库.map(键).filter(k => k.startsWith(Runs.KEY)).map(k => k.slice(Runs.KEY.length)));
  const 现场 = [...sessions.values()].map(s => [s.改?.cur, s.rec && 有记录.has(s.rec.id) ? s.rec : null]);
  return new Set(资产号([库, 跑, cur, curRec, 现场]));
}
// 成果抽屉里删成果走这里: 删掉这些键, 它们引用过的资产没人再用(见 在用资产)就删
async function delOutputs(keys) {
  const 删的 = [];
  for (const k of keys) {
    删的.push(await ctx.kv.get(k).catch(() => null));
    await ctx.kv.del(k).catch(() => { });
  }
  const 候 = new Set(资产号(删的));
  if (候.size) try {
    const 还用 = await 在用资产();
    for (const a of 候) if (!还用.has(a)) await ctx.kv.del('wfasset:' + a).catch(() => { });
  } catch (e) { console.warn('[workflow] 回收资产没做成', e); }
  return keys.length;
}
// 成果抽屉 🧹 点两下: 删掉没人用的资产(删运行、自动清理都不删资产, 留下的孤儿在这里收), 回 {n 份, b 字节}
async function gcAssets() {
  const 用 = await 在用资产();
  let n = 0, b = 0;
  for (const e of await ctx.kv.list('wfasset:')) if (!用.has(e.key.slice(8))) {
    await ctx.kv.del(e.key).catch(() => { });
    n++;
    b += String(e.value?.dataUrl || e.value?.data || '').length;
  }
  return { n, b };
}
// 认媒体: data 网址 / 带扩展名的远程网址 / 资产引用 / {url|src|dataUrl, mimeType}
function detectMedia(v) {
  if (typeof v === 'string') {
    const m = /^data:(image|audio|video)\//.exec(v);
    if (m) return { kind: m[1], src: v };
    const e = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|(mp3|wav|ogg|m4a)|(mp4|webm|mov))(\?\S*)?$/i.exec(v);
    return e && { kind: e[2] ? 'audio' : e[3] ? 'video' : 'image', src: v };
  }
  if (!v || typeof v !== 'object') return null;
  if (v.__wfasset) return { kind: 'asset', assetId: v.__wfasset, mimeType: v.mimeType || '' };
  const s = v.dataUrl || v.url || v.src, k = /^(image|audio|video)\//.exec(v.mimeType || '');
  if (typeof s !== 'string') return null;
  return detectMedia(s) || (k ? { kind: k[1], src: s } : null);
}
// 成果 wfout:<运行>:<i>: 只扫最终输出里的图/音/视频和卸成资产的大文件(多终端按节点嵌套, 所以递归两层),
// 没扩展名的远程网址按字段名猜
Object.assign(Runs, {
  collect(outputs) {
    const items = [], seen = new Set();
    const mimeOf = (kind, src) => (/^data:([\w.+-]+\/[\w.+-]+)/.exec(src || '') || [])[1]
      || kind + '/' + ((String(src || '').split('?')[0].match(/\.(\w+)$/) || [])[1] || '*').toLowerCase();
    const 猜 = k => /(image|img|photo|picture|图|封面|cover)/.test(k) ? 'image'
      : /(audio|sound|music|voice|音|语音|歌)/.test(k) ? 'audio' : /(video|movie|视频|影)/.test(k) ? 'video' : null;
    const add = (name, v) => {
      let m = detectMedia(v);
      if (!m && typeof v === 'string' && /^https?:\/\//.test(v)) {
        const kind = 猜(String(name).toLowerCase());
        if (kind) m = { kind, src: v };
      }
      if (!m) return false;
      const key = m.src || m.assetId;
      if (key) { if (seen.has(key)) return true; seen.add(key); }
      const kind = m.kind !== 'asset' ? m.kind   // 资产: 图音视频以外的(文本、PDF 这些)算文件, 不算图片
        : /(image|audio|video)\//.exec(m.mimeType || '')?.[1] || (m.mimeType ? 'file' : 'image');
      items.push({ name, type: kind, src: m.src || null, assetId: m.assetId || null,
        mimeType: m.mimeType || mimeOf(kind, m.src) });
      return true;
    };
    const scan = (o, d) => {
      if (!o || typeof o !== 'object' || d > 2) return;
      for (const [k, v] of Object.entries(o)) if (!add(k, v) && v && typeof v === 'object') scan(v, d + 1);
    };
    scan(outputs, 0);
    return items;
  },
  async outcome(rec) {
    if (rec?.status !== 'done') return;
    const items = Runs.collect(rec.outputs);
    if (!items.length) return;
    const base = { kind: 'workflow-output', workflowId: rec.workflowId || null,
      workflowName: rec.name || '工作流', runId: rec.id, createdAt: rec.finishedAt || Date.now() };
    const arch = await Assets.archiveOn();
    for (const [i, it] of items.entries()) {
      let asset = it.assetId ? { __wfasset: it.assetId } : null;
      if (arch && !asset && /^https?:\/\//.test(it.src || '')) {
        const a = await Assets.archive(it.src, it.mimeType, it.name);
        if (a) asset = { __wfasset: a.__wfasset };
      }
      await ctx.kv.set('wfout:' + rec.id + ':' + i, Object.assign({}, base, { name: it.name, type: it.type,
        mimeType: it.mimeType, src: it.src, url: it.src }, asset)).catch(() => { });
    }
  }
});
// ═ 存储 · 跟着: 小工具, 节点应用, AI 模态, AI 节点, 工作流列表 ═
// 工作流定义 workflow:<id>; 存了、删了都发 wf:defs, 画布和列表跟着刷新
const 存储 = {
  async list() {
    return (await ctx.kv.list('workflow:')).map(e => e.value)
      .filter(w => !w?.deleted && Array.isArray(w?.nodes))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async get(id) { const w = await ctx.kv.get('workflow:' + id); return Array.isArray(w?.nodes) ? w : null; },
  async save(w) {
    const id = w.id || uid('wf_'), now = Date.now();
    const full = Object.assign({ createdAt: now }, w, { id, updatedAt: now });
    await ctx.kv.set('workflow:' + id, full);
    事件.发('defs');
    return full;
  },
  async remove(id) { await ctx.kv.del('workflow:' + id); 事件.发('defs'); },
  async update(id, patch) {   // 合并写(数据节点用): 整条覆盖会把 nodes 冲掉
    const w = await 存储.get(id), p = Object.assign({}, patch);
    if (!w) throw new Error('工作流不存在: ' + id);
    delete p.id;
    return 存储.save(Object.assign({}, w, p, { id }));
  },
  // 按需(单独导出时带 AI 配置的哪几类): 库里各工作流的 AI 节点用到的, 写成 AI 类型表里的名; 生图带图就是改图, 两类都带
  async 模态() {
    const 名 = { 生图: ['图片', '图片编辑'], 生视频: ['视频'], 语音合成: ['语音'], 语音转写: ['转录'], 音乐: ['音乐'] };
    return [...new Set((await 存储.list()).flatMap(w => w.nodes.flatMap(n => n?.miniappId === AI_NODE_ID
      && 名[模态(n.params?.mode || '对话')?.zh] || [])))];
  }
};
// 导入导出 .workflow.json: 工作流变成攥在手里的文件。导出连带 ▣ 包节点的零件(包装小应用 + 子工作流, 子图里的包接着收)
async function exportWorkflow(id, 画布版) {   // 画布版: 正开着的这个(没存的改动也导出去), 别的从库里读
  try {
    const def = 画布版 || await 存储.get(id), packs = [], seen = new Set();
    if (!def) return toast('工作流不在: ' + id);
    const collect = async d => {
      for (const n of d.nodes || []) {
        if (!n.miniappId || seen.has(n.miniappId)) continue;
        const m = await Apps.get(n.miniappId);
        if (!m?.pack) continue;
        seen.add(n.miniappId);
        const sub = await 存储.get(m.pack.workflowId);
        delete m.导自;   // 导进来时记下的来处只在本地认零件用, 不往外带
        packs.push({ miniapp: m, sub });
        if (sub) await collect(sub);
      }
    };
    await collect(def);
    const bundle = { format: 'colony.workflow/v1', exportedAt: Date.now(), workflow: def, packs };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' }));
    a.download = String(def.name || 'workflow').replace(/[\\/:*?"<>|]/g, '_') + '.workflow.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出' + (packs.length ? '(含 ' + packs.length + ' 个打包零件)' : ''));
  } catch (e) { toast('导出失败: ' + e.message); }
}
// 导入时起名: 名字被占了就叫「名字 2」(有了就「名字 3」…); 名字本身以「 数字」结尾的, 接着那个数往上加(「名字 2」再导是
// 「名字 3」)。用 BigInt 加, 数再大也照样加上去(普通的数过了 2 的 53 次方加 1 不变, 会一直重名、停不下来)
function 起新名(名, 名们) {
  const m = / (\d+)$/.exec(名), 头 = m ? 名.slice(0, m.index) : 名;
  for (let i = m ? BigInt(m[1]) + 1n : 2n; 名们.has(名); i++) 名 = 头 + ' ' + i;
  return 名;
}
async function importWorkflowFile(file) {
  let bundle;
  try { bundle = JSON.parse(await file.text()); } catch (e) { return toast('不是合法 JSON 文件: ' + file.name); }
  const def = bundle?.workflow || bundle;   // 裸定义和 v1 打包件都收
  if (!Array.isArray(def?.nodes)) return toast('文件里没有工作流定义(缺 nodes): ' + file.name);
  try {
    let packOk = 0, packSkip = 0, packNo = 0;
    const 新号 = {}, 本地 = await Apps.all();   // 应用库给零件起了新 id, 节点里的旧 id 跟着改
    for (const p of bundle.packs || []) {   // 零件先落地: 本地有(同 id, 或上回从它导进来的)就跳过, 不覆盖本地的
      if (!p?.miniapp) continue;
      const 在 = 本地.find(m => m.id === p.miniapp.id || m.导自 === p.miniapp.id);
      if (!colony.has('apps.create')) packNo++;   // 单独打开没有小应用库: 零件装不了, 工作流和子工作流照收
      else if (在) { 新号[p.miniapp.id] = 在.id; packSkip++; }
      else { 新号[p.miniapp.id] = (await Apps.create({ ...p.miniapp, 导自: p.miniapp.id })).id; packOk++; }
    }
    const 名们 = new Set((await 存储.list()).map(w => w.name || '工作流'));
    const 改号 = d => {   // 零件改了号的跟着改; 库里已有同名的存成「名字 2」(有了就「名字 3」…), 原来那份不动
      for (const n of d.nodes || []) if (新号[n.miniappId]) n.miniappId = 新号[n.miniappId];
      名们.add(d.name = 起新名(d.name || '工作流', 名们));
      return d;
    };
    for (const p of bundle.packs || []) {
      if (p?.sub && !(await 存储.get(p.sub.id))) await 存储.save(改号(p.sub));
    }
    const copy = 改号(clone(def));   // 总是存成新的一份, 不覆盖同名的
    delete copy.id;
    const saved = await 存储.save(copy), 存为 = await 留下没存的(true);   // 画布上没存的新工作流先替用户存下
    toast((存为 ? '画布上没存的已替你存为「' + 存为 + '」; ' : '')
      + '已导入「' + copy.name + '」' + (copy.name !== (def.name || '工作流') ? '(已有同名的, 原来那份没动)' : '')
      + (packOk ? ' +' + packOk + ' 零件' : '')
      + (packSkip ? '(' + packSkip + ' 零件本地已有, 未覆盖)' : '')
      + (packNo ? '(单独打开装不了 ' + packNo + ' 个 ▣ 零件, 用到的节点跑不了; 放进 Colony 再导一次就全了)' : '')
      + (bundle.format && !/^colony\.workflow\/v1/.test(bundle.format)   // 一句说完, 免得后一句顶掉前一句
        ? '(文件格式版本 ' + bundle.format + ' 较新, 按 v1 尽力导入)' : ''));
    openWorkflow(saved.id);
  } catch (e) { toast('导入失败: ' + e.message); }
}
// ═ 运行跑道 · 跟着: 小工具, 检查图, 并行调度, 运行记录, 资产与成果 ═
// 所有运行(画布、单跑、runEphemeral、debugRun、包节点、嵌套)走同一条跑道: 进 running 表 → 消费引擎事件 → 落盘。
// 事件: wf:runs(表变了) / wf:run {phase: start|event|done, rec, ev}, 画布靠它把别处发起的运行也画出来。
// 配置类失败(缺模型、缺 key)记下现场 pendingRecover, 去 AI 配置补齐后一键重跑
const MAX_WF_DEPTH = 5, MEM_RUN_KEEP = 20;
const running = new Map(), 没存好 = new Set();   // 没存好: 开跑到记录和成果写完库之间的运行 id(这时 🧹 照旧当它在用)
let pendingRecover = null;
const 摘要 = r => ({ id: r.id, workflowId: r.workflowId || null, name: r.name, status: r.status,
  source: r.source, nodeCount: r.workflow?.nodes?.length || 0, startedAt: r.startedAt,
  finishedAt: r.finishedAt });
const 跑完了 = () => ({ ok: false, code: 'WORKFLOW_ENDED', message: '工作流已结束' });
const Eph = {
  // 运行列表只列人和 agent 发起的: 画布编辑时跑的、单跑节点、子工作流(包节点、包当循环体)都不列
  list: () => [...running.values()].filter(r => !['editor', 'single', 'sub'].includes(r.source)).map(摘要),
  get: id => running.get(id) || null,
  在跑(id) {   // 还在跑的那次运行; 不在跑就回报错(ok: false)
    const rec = running.get(id);
    if (!rec) return { ok: false, code: 'NO_RUN', message: '找不到运行中工作流: ' + id };
    return rec.status === 'running' ? rec : 跑完了();
  },
  remove(id) { if (running.delete(id)) 事件.发('runs'); },
  trim() {   // 内存里只留最近几条跑完的, 更早的在 wfrun: 里
    const ended = [...running.values()].filter(r => r.status !== 'running');
    ended.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    ended.slice(MEM_RUN_KEEP).forEach(r => running.delete(r.id));
  },
  async run(workflow, opts = {}) {
    const depth = opts.depth || 0, chain = opts.chain || [], id = opts.id || uid('eph_'), control = {};
    const 不跑 = depth > MAX_WF_DEPTH ? '工作流嵌套超过深度上限 ' + MAX_WF_DEPTH
      : workflow.id && chain.includes(workflow.id) ? '工作流自引用(环): ' + workflow.id : '';
    if (不跑) return { id: null, status: 'error', error: [不跑] };
    const wf = Object.assign({}, workflow, { id, ephemeral: true, _wfDepth: depth,
      _wfChain: chain.concat(workflow.id || id) });
    const rec = { id, workflowId: workflow.id || null, source: opts.source || 'ephemeral',
      name: workflow.name || '临时工作流', workflow: wf, status: 'running', events: [], outputs: null, error: null,
      initialInputs: workflow.initialInputs || {}, startedAt: Date.now(), finishedAt: null, control };
    running.set(id, rec);
    没存好.add(id);
    事件.发('runs');
    try { opts.onStart?.(rec); } catch (e) { console.warn('[workflow] onStart', e); }
    事件.发('run', { phase: 'start', rec });
    const consume = (async () => {
      try {
        for await (const ev of Engine.run(wf, rec.initialInputs, control)) {
          rec.events.push(ev);
          if (ev.type === 'workflow:done') { rec.outputs = ev.outputs; rec.status = 'done'; }
          else if (ev.type === 'workflow:error') { rec.error = ev.errors; rec.status = 'error'; }
          else if (ev.type === 'workflow:cancelled') rec.status = 'cancelled';
          try { opts.onEvent?.(ev, rec); } catch (e) { console.warn('[workflow] onEvent', e); }
          事件.发('run', { phase: 'event', rec, ev });
        }
      } catch (e) { rec.error = [e.message]; rec.status = 'error'; }
      finally {
        rec.finishedAt = Date.now();
        if (rec.status === 'running') rec.status = 'done';
        const pe = rec.status !== 'done'
          && rec.events.find(ev => ev.type === 'node:error' && ev.code === 'AI_PROVIDER_ERROR');
        if (pe && opts.source !== 'single')   // 单跑不登记; 带回原工作流 id, 重跑画在它的画布上、回放找得到
          pendingRecover = { def: Object.assign(clone(rec.workflow), { id: rec.workflowId || undefined }),
          inputs: rec.initialInputs, name: rec.name,
          mode: wf.nodes?.find(x => x.id === pe.nodeId)?.params?.mode || '',
          err: String(pe.error || '').slice(0, 120) };
        // 历史(wfrun)和成果(wfout)分开: debugRun 不进历史, 成果照进; 单跑两样都不落
        try {
          if (!opts.noHistory) await Runs.persist(rec);
          else if (!opts.noOutcome) await Runs.outcome(rec);
        } catch (e) { console.warn('[workflow] 落盘', e); }
        没存好.delete(id);
        Eph.trim();
        事件.发('run', { phase: 'done', rec });
        事件.发('runs');
      }
    })();
    if (workflow.detached) return { id, status: 'running' };
    await consume;
    return { id, outputs: rec.outputs, error: rec.error, status: rec.status };
  },
  cancelRun(id) {
    const rec = Eph.在跑(id);
    return rec.ok === false ? rec : rec.control.abort ? rec.control.abort('用户停止') : 跑完了();
  }
};
// 提示条上的话截到 n 个看得见的字(国旗、肤色、家庭这类几个码位拼成的表情算一个字, 不拆开): 回 [截好的, 截没截]。
// 后台跑完、画布 ▶ 没跑成都用它, 判断长短也按它
const 截字 = (s, n) => {
  const 字 = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)];
  return [字.slice(0, n).map(x => x.segment).join(''), 字.length > n];
};
// 后台跑(detach): 立刻回执; 跑完在提示条上说一声(窗关着也看得到, 顶替厂商的 ⚠ 一起说),
// agent 发起的再用 agent.send 把结果发回它的对话(它忙时排成插话)
const BG_HINT = '已后台运行; 跑完会把结果发回对话, 没收到前别说已完成; 进度用 workflow.getRun {id} 查';
async function bgRun(name, p, rid, meta) {
  const r = await p.catch(e => ({ status: 'error', error: [String(e?.message || e)] }));
  const ok = r.status === 'done', 停 = r.status === 'cancelled', 错 = JSON.stringify(r.error || r.status);
  const notes = [...new Set((running.get(rid)?.events || []).map(e => e.picked).filter(s => s?.[0] === '⚠'))];
  const [话, 长] = 截字([].concat(r.error || r.status).join('; '), 80);   // 截掉的说一声(窗可能关着, 没日志看)
  toast(['后台工作流「' + name + '」' + (ok ? '跑完了' : 停 ? '已停止'
    : '没跑成: ' + 话 + (长 ? '…(详情用 workflow.getRun 看)' : '')), ...notes].join(' · '));
  if (meta?.by !== 'petri:agent' || !colony.has('agent.send')) return;
  const text = ['【后台工作流】「' + name + '」' + (ok ? '跑完了' : 停 ? '已停止' : '没跑成') + '(runId ' + rid + ')',
    ok ? '成果: ' + JSON.stringify(r.outputs ?? null).slice(0, 1500) : 停 ? '被停掉了(cancelRun 或用户停)'
      : '错误: ' + 错, ...notes,
    '细节用 workflow.getRun {id} 看'];
  await ctx.call('agent.send', { text: text.join('\n') }).catch(e => console.warn('[workflow] 回报 agent', e));
}
// ═ 动态扩图 · 跟着: 运行跑道 ═
// 给在跑的运行加节点和边(节点里调会自动带 workflowId、sourceNodeId)
Object.assign(Eph, {
  async patchGraph(a = {}) {
    const rec = Eph.在跑(a.workflowId);
    if (rec.ok === false) return rec;
    return rec.control.patch ? rec.control.patch(a) : { ok: false, code: 'NOT_READY', message: '尚未进入调度循环' };
  }
});
// ═ AI 模态 · 跟着: AI 节点, 画节点与连线 ═
// 七种模态一行一个: [画布上的样式尾巴, 徽章, AI 配置里的类, 出的是媒体, 模型名该像什么(只挡拿对话模型充数)]
const AI_MODE_META = {
  对话: ['chat', '💬', 'chat'],
  生图: ['img', '🖼', 'image', 1,
    /imag(e|ine)|dall|flux|sd|diffusion|seedream|kolors|cogview|wanx|banana|recraft|ideogram|mj|midjourney/i],
  生视频: ['video', '🎬', 'video', 1, /video|veo|kling|sora|wan|hailuo|seedance|vidu|runway|pika|luma|hunyuan/i],
  语音合成: ['tts', '🎤', 'tts', 1, /tts|speech|audio|voice|sambert|cosy|eleven|fish/i],
  语音转写: ['asr', '📝', 'stt', 0, /asr|whisper|transcri|stt|audio|paraformer|sensevoice/i],
  音乐: ['music', '🎵', 'music', 1, /music|suno|song|udio|audio|lyria/i],
  代码: ['js', '⌨', 'js'],
};
const 模态名 = Object.keys(AI_MODE_META), 生成类 = 模态名.filter(z => !/^(chat|js)$/.test(AI_MODE_META[z][2]));
// 中文名或类 → {zh, t, re}; 认不出回 null
const 模态 = m => {
  const zh = AI_MODE_META[m] ? m : 模态名.find(z => AI_MODE_META[z][2] === m);
  return zh ? { zh, t: AI_MODE_META[zh][2], re: AI_MODE_META[zh][4] } : null;
};
// 面板里换了模态, 画布上那个节点的色条和徽章就地跟着换
function syncNodeModeUI(n) {
  const el = 卡(n.id);
  if (!el || n.miniappId !== AI_NODE_ID) return;
  const mm = AI_MODE_META[n.params?.mode] || AI_MODE_META.对话;
  el.className = el.className.replace(/ mode-\w+/g, '') + ' mode-' + mm[0];
  const b = el.querySelector('.wf-mode-badge');
  if (b) b.textContent = mm[1];
}
const AI = {
  拆: s => {   // data 网址 → {mimeType, data}
    const m = /^data:([^;,]+);base64,(.*)$/.exec(s || '');
    return m ? { mimeType: m[1], data: m[2] } : null;
  },
  读: b => new Promise((res, rej) => {   // 文件 → {data, mimeType}
    const r = new FileReader();
    r.onload = () => res(AI.拆(r.result));
    r.onerror = rej;
    r.readAsDataURL(b);
  }),
  async shrink(m, max = 960) {   // 图片压成 JPEG、长边不超过 max, 回 {data, mimeType}; 不是图或压不了就原样回
    if (!/^image\//.test(m.mimeType)) return m;
    try {
      const 图 = await fetch('data:' + m.mimeType + ';base64,' + m.data).then(r => r.blob());
      const bmp = await createImageBitmap(图), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return (await AI.读(await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 }))) || m;
    } catch (e) { return m; }
  },
};
// ═ AI 节点 · 跟着: 资产与成果, AI 模态, 代码节点, 自生长, 节点模型 ═
// 内建「AI 节点」(wfnode-ai): 一个节点七种模态, 模态是旋钮不是节点种类。全走 petri:ai 的 ai.* 能力,
// 不另外重试(AI 配置块故意不重发, 免得多扣钱); 单独打开时用块里带着的那份(只带导出时用到的几类), 缺什么如实说
const stripFence = s => String(s ?? '').replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '');
const AI_NODE_ID = 'wfnode-ai';
const AI_NODE_DESC = 'AI 能力包: 一个节点七模态(params.mode=' + 模态名.join('/') + '); '
  + 'provider/model 留空走 AI 配置里为这一类选的模型; task 口可加 task2/task3 按名序拼接, '
  + 'media 宽容(dataURL/资产引用/网址/kv 键; 对话带 media=看图, 生图带 media=改图, 生视频 media=首帧、media2=尾帧, '
  + '语音转写吃 media); 对话模态让模型输出 JSON + 自定义输出端口 → 自动拆到同名端口(text 恒为原文); '
  + 'grow=true 自生长, 输出 {text,plan,spawned}; mode=代码: params.code 函数体(收 input 返回对象=输出端口, 5s 超时无 IO); '
  + '模态专属参数与 extras(JSON) 见参数表';
const 调模型 = 模态名.filter(z => z !== '代码');
const AI_NODE_SCHEMA = {
  inputs: [{ name: 'task', type: 'text', label: '文本' }, { name: 'media', type: 'any', label: '媒体' }],
  outputs: [{ name: 'plan', type: 'any', label: '规划' }, { name: 'text', type: 'text', label: '文本' },
    { name: 'media', type: 'any', label: '媒体' }],
  params: [
    { name: 'mode', label: '模态', control: 'select', options: 模态名, default: '对话' },
    { name: 'code', control: 'textarea', showIf: { mode: ['代码'] },
      label: '代码(函数体: 收 input=全部输入端口对象, return 对象=键名即输出端口; 5s 超时, 无 IO)' },
    { name: 'model', label: '厂商与模型', control: 'model-select', modeFrom: 'mode', providerParam: 'provider',
      showIf: { mode: 调模型 } },
    { name: 'provider', label: '厂商(上方选择器自动填; 留空 = 这一类选的厂商)', showIf: { mode: 调模型 } },
    { name: 'prompt', label: '系统提示词(怎么做; 素材走 task 输入; 对话模态走 system 角色)', control: 'textarea' },
    { name: 'grow', label: '🌱 自生长(收到任务后自己规划并长出下游节点)', control: 'toggle', type: 'boolean',
      showIf: { mode: ['对话'] } },
    { name: 'maxSpawn', label: '单次最多长几个节点', type: 'number', default: 4, showIf: { mode: ['对话'] } },
    { name: 'voice', label: '音色', control: 'voice-select', showIf: { mode: ['语音合成'] } },
    { name: 'speed', label: '语速(0.5~2, 留空=默认)', type: 'number', showIf: { mode: ['语音合成'] } },
    { name: 'aspectRatio', label: '长宽比(留空=默认)', control: 'select',
      options: ['', '1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'], showIf: { mode: ['生图', '生视频'] } },
    { name: 'lyrics', label: '歌词(留空=按提示词生成)', control: 'textarea', showIf: { mode: ['音乐'] } },
    { name: 'instrumental', label: '纯音乐(无人声)', control: 'toggle', type: 'boolean', showIf: { mode: ['音乐'] } },
    { name: 'extras', type: 'json', control: 'textarea',
      label: '高级参数(可空 JSON: pick 提取 / size / duration / resolution / temperature / language 等)' }
  ],
  timeoutMs: 660000
};
// AI 没配好的报错(AI 配置块的原话和本块自己的): 节点出错时归成 AI_PROVIDER_ERROR, 配好后能一键重跑
const AI_CFG_ERR = new RegExp(['AI 配置', '在多家都有', '模型清单里', '找不到厂商', '没填 API 网址', 'HTTP 40[24]',
  '401', '403', 'api key', 'provider', '额度', '无效.*key', 'unauthorized', '未配置', '没配「'].join('|'), 'i');
Object.assign(AI, {
  chat: (messages, opt) => AI.call('ai.chat', Object.assign({ messages }, opt), '对话'),
  缺块: 名 => colony.has('ai.providers') ? 'AI 配置没带「' + 名 + '」这一类'
    + (colony.单独 ? '(导出时库里的工作流没用到它): 导入回 Colony 后可用' : '')
    : '「' + 名 + '」要 AI 配置块(petri:ai), 它现在不在或没启用',
  async call(path, a, 名) { if (!colony.has(path)) throw new Error(AI.缺块(名)); return ctx.call(path, a); },
  能力: t => ({ tts: 'ai.speak', stt: 'ai.transcribe' })[t] || 'ai.' + t,   // AI 配置里这一类登记成的能力
  async media(v) {   // 各种写法的媒体统一成 {data, mimeType} 或 {url}; 认不出回 null
    if (typeof v === 'string' && /^\s*\{/.test(v)) try { v = JSON.parse(v); } catch (e) { }   // 存成字的资产引用
    if (v?.__wfasset) v = await Assets.get(v.__wfasset).catch(() => null);
    if (v?.data) return { data: v.data, mimeType: v.mimeType || 'application/octet-stream' };
    if (v && typeof v === 'object') v = v.dataUrl || v.url || v.src;
    if (typeof v !== 'string') return null;
    if (/^https?:/.test(v))   // 网址: 取回来变成 data, 取不到就原样传网址
      return (await fetch(v).then(r => r.blob()).then(AI.读).catch(() => null)) || { url: v };
    if (/^[\w.-]+:/.test(v) && !v.startsWith('data:')) {   // kv 键当素材: 命中而且带字节才算
      const r = await ctx.kv.get(v).catch(() => null);
      v = typeof r === 'string' ? r : r?.dataUrl || r?.data;
    }
    return AI.拆(v);
  },
  pickPath(raw, spec) {   // extras.pick: 按路径从上游 JSON 里取字段, 几条就几行
    let obj = raw;
    try { if (typeof obj === 'string') obj = JSON.parse(stripFence(obj)); }
    catch (e) { throw new Error('extras.pick 提取失败: 上游 task 不是合法 JSON'); }
    return [].concat(spec).map(path => {
      const c = String(path).split('.').reduce((c, k) => c?.[k], obj);
      if (c == null) throw new Error('extras.pick 路径不存在: ' + path);
      return typeof c === 'string' ? c : JSON.stringify(c);
    }).join('\n');
  },
  async exec(inputs, params, wfCtx) {   // 跑一个 AI 节点: 回 {o, picked?}(picked = 这次实际用了谁)
    const m = 模态(params.mode || '对话'), str = v => typeof v === 'string' ? v : JSON.stringify(v);
    if (!m) throw new Error('未知模态: ' + params.mode + '(可选: ' + 模态名.join('/') + ')');
    let task = Object.keys(inputs).filter(k => /^task\d*$/.test(k) && inputs[k] != null && inputs[k] !== '')
      .sort().map(k => str(inputs[k])).join('\n\n');
    if (!task && inputs.item != null) task = str(inputs.item);
    const prompt = params.prompt ? String(params.prompt) : '';
    let ex = params.extras || {};
    try { if (typeof ex === 'string') ex = JSON.parse(ex); }
    catch (e) { throw new Error('extras 不是合法 JSON(多半是引号/逗号): ' + ex.slice(0, 80)); }
    if (ex.pick) task = AI.pickPath(task, ex.pick);
    const full = prompt && task ? prompt + '\n\n' + task : prompt || task, base = {};
    if (params.provider) base.provider = params.provider;
    if (params.model) base.model = params.model;
    if (wfCtx?.signal) base.signal = wfCtx.signal;   // 运行停了, 发出去的请求一起撤(不再让厂商白算)
    if (m.t === 'js') {
      const code = String(params.code || '').trim() || prompt;
      if (!code) throw new Error('代码模态要 params.code: 函数体, 如 return {sum: Number(input.task) * 2}');
      const 配置 = new Set(['temperature'].concat(AI_NODE_SCHEMA.params.map(p => p.name)));   // 引擎把参数并进了输入
      const input = Object.fromEntries(Object.entries(inputs).filter(e => !配置.has(e[0])));
      const out = await AI.runJs(code, input, 5000);
      if (!out || typeof out !== 'object' || Array.isArray(out)) return { o: { text: String(out ?? '') } };
      let text = out.text;
      const 短 = (k, v) => /^data:/.test(v) && v.length > Assets.MEDIA_THRESH ? '[大文件, 见 ' + k + ' 口]' : v;
      if (text == null) try { text = JSON.stringify(out, 短); } catch (e) { text = '[含循环引用]'; }
      return { o: Object.assign({ text: String(text) }, out) };
    }
    if (params.grow && m.t === 'chat')
      return AI.grow(task, prompt, base, +params.maxSpawn > 0 ? +params.maxSpawn : 4, wfCtx);
    const medias = [];
    for (const k of Object.keys(inputs).filter(k => /^media\d*$/.test(k) && inputs[k])
      .sort((a, b) => (+a.slice(5) || 1) - (+b.slice(5) || 1))) {
      const x = await AI.media(inputs[k]), 图 = /^(image\/|application\/octet|$)/.test(x?.mimeType || '');
      if (x && (m.t !== 'image' || 图)) medias.push(x);   // 生图只收图: 声音这些不当图发去改图
    }
    // 生图带了图就改图; 一家都没选改图模型(或选了「不用」、节点也没填有它的厂商)就照样用生图模型, 并说一声
    const [media, media2] = medias, 有图 = m.t === 'image' && media?.data, 有它 = rs => rs.auto
      || rs.some(r => [r.providerId, r.provider].includes(base.provider));
    const 改 = 有图 && 有它(await AI.rows('imageEdit'));
    const type = 改 ? 'imageEdit' : m.t, ar = params.aspectRatio || ex.aspectRatio;
    const path = AI.能力(type);
    if (!colony.has(path)) throw new Error(AI.缺块(m.zh));   // 这里没带这一类: 先说没带, 不去挑模型
    const picked = [有图 && !改 && '⚠ 没有可用的改图模型, 用生图模型跑(图只在接口改法里写了 {image} 时发出去)',
      await AI.pick(m, base, type)].filter(Boolean).join('; ') || null;
    if (m.t === 'chat') {
      const msgs = prompt ? [{ role: 'system', content: prompt }] : [];
      const imgs = medias.filter(x => x.data && /^image\//.test(x.mimeType));
      msgs.push({ role: 'user', content: imgs.length ? [{ type: 'text', text: task || '请描述这份素材' }]
        .concat(imgs.map(x => ({ type: 'image', data: x.data, mimeType: x.mimeType }))) : task || '你好' });
      const temp = params.temperature != null ? +params.temperature : ex.temperature;
      const r = await AI.chat(msgs, Object.assign({}, base, temp != null && { temperature: temp }));
      let o;   // 回的是 JSON 对象就拆到同名端口, text 总是原文
      try { o = JSON.parse(stripFence(r.content)); } catch (e) { }
      const 拆开 = typeof o === 'object' && !Array.isArray(o) && o;
      return { o: Object.assign({}, 拆开, { text: r.content || '' }), picked };
    }
    if (m.t === 'stt') {
      if (!media?.data) throw new Error('语音转写要音频: 把音频接到 media 输入(data 网址、资产引用或网址)');
      const a = Object.assign({ audio: media.data, mimeType: media.mimeType }, base, prompt && { prompt });
      if (ex.language) a.language = ex.language;
      return { o: { text: (await ctx.call(path, a))?.text || '' }, picked };
    }
    let a, text;
    if (m.t === 'image') {
      a = { prompt: (full || '一张图') + (ar && !ex.size ? '\n(画幅 ' + ar + ')' : '') };
      if (ex.size) a.size = ex.size;
      if (有图) a.image = media;   // 带着图片类型发
      if (改 && medias.length > 1) a.images = medias.filter(x => x.data);
      text = '';
    } else if (m.t === 'video') {
      // 首帧 media、尾帧 media2, 压成 JPEG(长边 ≤ 960)带着类型发: 两张 PNG 的 base64 会撑爆网关的请求体上限
      a = { prompt: full || '一段视频' };
      if (media) a.image = media.data ? await AI.shrink(media) : media.url;
      if (media2) a.lastImage = media2.data ? await AI.shrink(media2) : media2.url;
      if (ar) a.ratio = ar;
      // 时长 1~15 秒, 输入口 duration(编剧按剧情给)优先
      const dur = inputs.duration != null && inputs.duration !== '' ? inputs.duration : ex.duration;
      if (dur != null && isFinite(+dur)) a.duration = Math.max(1, Math.min(15, Math.round(+dur)));
      if (ex.resolution) a.resolution = ex.resolution;
    } else if (m.t === 'tts') {
      text = task || prompt;
      if (!text) throw new Error('语音合成要文本: 上游接 task, 或在提示词里写要念的内容');
      a = { text };
      const vo = params.voice || ex.voice, sp = params.speed || ex.speed;
      if (vo) a.voice = vo;
      if (sp) a.speed = +sp;
      if (task && prompt) a.instructions = prompt;
    } else {
      const inst = params.instrumental ?? ex.instrumental, ly = params.lyrics || ex.lyrics;
      a = { prompt: (full || '一段轻快的音乐') + (inst ? '\n(纯音乐, 无人声)' : '') };
      if (ly && !inst) a.lyrics = ly;
    }
    const r = await ctx.call(path, Object.assign(a, base));
    const s = r?.url || r?.data && 'data:' + (r.mimeType || 'application/octet-stream') + ';base64,' + r.data;
    if (!s) throw new Error(m.zh + '没有返回' + (m.t === 'image' ? '图片' : m.t === 'video' ? '视频' : '音频'));
    return { o: text == null ? { media: s } : { media: s, text }, picked };
  }
});
// ═ 代码节点 · 跟着: AI 模态 ═
// 代码模态在 Worker 里跑: 先缴掉网络, 能 await; 函数体、完整函数、箭头函数都认; 超时就掐掉 Worker
const 工人 = C => {   // 整段转成文字送进 Worker 跑, 本页不调用
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'EventSource'].forEach(k => {
    try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); }
    catch (e) { self[k] = undefined; }
  });
  const AF = (async () => { }).constructor;
  const 式 = /^\s*(async\s+)?(function\b|\(.*?\)\s*=>|[\w$]+\s*=>)/.test(C);   // 整段是个函数(不是函数体)
  const 装 = 先当式子 => 先当式子 ? new AF('input', 'return (' + C + ')(input)') : new AF('input', C);
  self.onmessage = e => {
    const 回 = (ok, x) => postMessage(ok ? { ok: 1, r: x } : { ok: 0, e: String(x?.message || x) });
    try {
      let fn;
      try { fn = 装(式); } catch (se) { fn = 装(!式); }
      Promise.resolve(fn(e.data)).then(r => {
        try { 回(1, r); } catch (er) { 回(0, '返回值不能跨线程(函数/DOM 之类): ' + (er?.message || er)); }
      }, er => 回(0, er));
    } catch (er) { 回(0, er); }
  };
};
Object.assign(AI, {
  runJs: (code, input, ms) => new Promise((res, rej) => {
    let w;
    const t = setTimeout(() => { w?.terminate(); rej(new Error('代码节点超时 ' + ms + 'ms(死循环或长阻塞)')); }, ms);
    const 完 = f => ev => { clearTimeout(t); w.terminate(); f(ev); };
    try {
      const 文 = '(' + 工人 + ')(' + JSON.stringify(String(code)) + ')';
      const u = URL.createObjectURL(new Blob([文], { type: 'text/javascript' }));
      w = new Worker(u);
      URL.revokeObjectURL(u);
      w.onmessage = 完(ev => ev.data?.ok ? res(ev.data.r) : rej(new Error('代码节点出错: ' + (ev.data?.e || '未知'))));
      w.onerror = 完(ev => rej(new Error('代码节点出错: ' + (ev.message || 'worker error'))));
      w.postMessage(input);
    } catch (e) { clearTimeout(t); w?.terminate(); rej(e); }
  }),
});
// ═ 自生长 · 跟着: 运行跑道, AI 模态, AI 节点 ═
Object.assign(AI, {
  async grow(task, prompt, base, maxSpawn, wfCtx) {   // 自生长: 模型把任务拆成子图, 经这次运行的扩图通道长出来
    const META = '你是工作流规划器。把任务拆成若干个节点组成的子工作流, 并规划它们之间的连接。'
      + '节点=AI 节点(' + 调模型.join('/') + ')或代码节点(确定性加工)。\n'
      + '严格只输出 JSON(不要 markdown 围栏, 不要解释): {"text":"一句话说明你的规划","nodes":[{"id":"英文短id",'
      + '"mode":"' + 模态名.join('|') + '","prompt":"该节点的系统提示词","task":"可选:直接写清给该节点的完整输入文本",'
      + '"code":"可选:mode=代码时的函数体(收 input 返回对象, 键名=输出端口)","needs":["可选:上游节点id"]}]}\n'
      + '规则: 1)任务能一句话写清就用 task 字段直接派活; 需要别的节点先产出才能做, 就用 needs 接线, '
      + '不要让生图/语音节点自己去"提取"上游JSON。2)上游是生图/生视频/语音/音乐→输出媒体, 自动接到媒体输入; '
      + '上游是对话/语音转写/代码→输出文本, 接到文本输入。3)要把多个分支汇总成一个成品, 就加一个 mode:对话 的节点, '
      + 'needs 指向所有分支。4)最多 ' + maxSpawn + ' 个节点; 没必要拆就返回 nodes:[]。'
      + '5)provider/model/voice/aspectRatio 一律省略, 除非领域指令点名。6)字段提取/计算/排序/拼装这类确定性加工用 mode:代码。\n'
      + '领域指令: ' + (prompt || '(无)');
    const r0 = await AI.chat([{ role: 'system', content: META }, { role: 'user', content: task || '(空任务)' }],
      base);
    let plan;
    try { plan = JSON.parse(stripFence(r0.content)); } catch (e) {
      return { o: { text: r0.content || '', plan: null, grewError: '规划输出不是合法 JSON, 未扩图' } };
    }
    const list = (plan?.nodes || []).slice(0, maxSpawn), idmap = {}, addNodes = [], addEdges = [];
    if (!list.length) return { o: { text: plan?.text || '', plan, spawned: 0 } };
    const 前 = (wfCtx.nid || 'g') + '_';   // 新节点 id = 父节点 id _ 规划里的 id _ 序号
    list.forEach((x, i) => { idmap[x.id] = 前 + String(x.id || 'n' + i).replace(/\W/g, '') + '_' + i; });
    list.forEach(x => {
      const ps = { mode: x.mode || '对话' };
      for (const k of ['prompt', 'provider', 'model', 'aspectRatio', 'voice', 'code']) if (x[k]) ps[k] = x[k];
      if (ps.mode === '对话' && !ps.provider && !ps.model) {   // 长出来的对话节点跟父节点用同一家
        if (base.provider) ps.provider = base.provider;
        if (base.model) ps.model = base.model;
      }
      const an = { id: idmap[x.id], miniappId: AI_NODE_ID, params: ps };
      if (x.task) an.seedInputs = { task: String(x.task) };
      if (x.ports && (x.ports.inputs || x.ports.outputs)) an.ports = x.ports;
      addNodes.push(an);
      (x.needs || []).forEach(up => {
        if (!idmap[up]) return;
        const 媒 = AI_MODE_META[list.find(y => y.id === up)?.mode]?.[3];   // 上游出媒体: 媒体口接媒体口
        addEdges.push({ from: { node: idmap[up], port: 媒 ? 'media' : 'text' },
          to: { node: idmap[x.id], port: 媒 ? 'media' : 'task' } });
      });
    });
    const rec = running.get(wfCtx.wf?.id), o = { text: plan.text || '', plan, spawned: addNodes.length };
    const pr = rec?.control?.patch ? await rec.control.patch({ addNodes, addEdges, sourceNodeId: wfCtx.nid,
      reason: 'AI 节点自生长' }) : { ok: false, message: '这次运行不支持扩图' };
    if (pr && !pr.ok)
      Object.assign(o, { spawned: 0, grewError: (pr.code || '') + ': ' + (pr.message || '扩图失败') });
    return { o };
  },
});
// ═ 节点模型 · 跟着: 厂商配置, 小工具, 检查图, 运行跑道, AI 模态, AI 节点, 工作室外壳 ═
// 生成类节点留空时用谁, 就照 AI 配置的规矩(厂商配置.用): 选模型里给这一类选的那家 > 默认厂商 > 第一家选了的; 选「不用」就没有。
// 运行、存图定型、参数面板、节点目录、重跑提示都问这一处; 节点里填的厂商认 id 也认名字
Object.assign(AI, {
  // 这一类各家的模型: ai.models 全都列的那份 [{providerId, provider, model, tested}](对话列每一家的, 没测通的也列;
  // 别的类列选了这一类模型的), 参数面板、▣ 运行器、运行时同一份。这里没带这一类(能力不在)就没有。
  // .auto = 留空时用的那家, 没有时 .缺 说为什么
  async rows(t) {
    if (!colony.has(AI.能力(t))) return Object.assign([], { auto: null, 缺: '' });
    const rows = await ctx.call('ai.models', { type: t, all: true });
    if (t === 'chat') return rows;
    const 用 = await 厂商配置.用(t), 不用 = ((await ctx.kv.get(厂商配置.用键)) || {})[t] === '';
    rows.auto = 用 && rows.find(r => r.providerId === 用.id) || null;
    rows.缺 = 不用 ? '选了「不用」' : 用 && !rows.auto ? '用「' + 用.name + '」, 但它没选这一类的模型' : '';
    return rows;
  },
  // 「厂商与模型」参数面板和 ▣ 运行器同一份: 每家一项 {provider, providerId, tested, models}, 照 rows 的先后(对话类的是 AI
  // 配置按名字排过的文本模型, 这里不再挑)。带着 rows 的 auto、缺
  async 家们(t) {
    const rows = await AI.rows(t), 家 = new Map();
    for (const r of rows) {
      const x = 家.get(r.provider) || 家.set(r.provider, { provider: r.provider, providerId: r.providerId,
        tested: false, models: [] }).get(r.provider);
      x.tested ||= !!r.tested;
      if (r.model && !x.models.includes(r.model)) x.models.push(r.model);
    }
    return Object.assign([...家.values()], { auto: rows.auto, 缺: rows.缺 });
  },
  label: r => r.provider + '·' + r.model + (r.tested ? '(已测通)' : ''),
  async pick(m, base, type) {   // 发请求前定厂商和模型: 改 base, 回一句用了谁(换了的带 ⚠), 不行就抛人话
    const rows = 生成类.includes(m.zh) && await AI.rows(type);
    if (!rows) return null;   // 对话、代码不用选
    const p = base.provider, 有 = p && rows.find(r => r.providerId === p || r.provider === p);
    if (base.model && (有 || !p)) {   // 填了模型: 只挡明显填错的; 没填厂商就交给选了这个模型的那家
      if (!m.re.test(base.model) && !rows.some(r => r.model === base.model))
        throw new Error('模型「' + base.model + '」不像「' + m.zh + '」模型(疑似拿对话模型充数)'
          + (rows.auto ? '; 这一类现在用的是 ' + AI.label(rows.auto) : '') + ' — 留空就自动用 AI 配置里选的');
      base.provider = p || rows.find(r => r.model === base.model)?.providerId;
      return null;
    }
    const 类名 = type === 'imageEdit' ? '改图' : m.zh;
    const b = 有 || rows.auto, 换 = p && !有 ? '厂商「' + p + '」现在没有「' + 类名 + '」模型' : '';
    if (!b) throw new Error((换 && 换 + ', 别家也') + '没配「' + m.zh + '」模型'
      + (rows.缺 ? '(AI 配置里' + rows.缺 + ')' : '') + ': 去 AI 配置给某家选这一类的模型, 或在节点里填厂商和模型');
    Object.assign(base, { provider: b.providerId, model: b.model });   // 发请求用 id: 认得准
    return (换 && '⚠ ' + 换 + ', 已改用 ') + AI.label(b);
  },
  async pin(nodes) {   // 存图时给空着的生成类 AI 节点定型: 填上现在会用的厂商和模型
    const 各类 = {};
    for (const n of nodes || []) {
      const m = n?.miniappId === AI_NODE_ID && n.params && 模态(n.params.mode);
      if (!生成类.includes(m?.zh) || n.params.provider || n.params.model) continue;
      const b = (各类[m.t] = 各类[m.t] || await AI.rows(m.t)).auto;
      if (b) Object.assign(n.params, { provider: b.provider, model: b.model });
    }
  },
  async suspectModels(nodes) {   // 检查图时点名填错模态的模型(存图不拦)
    const out = [];
    for (const n of nodes || []) {
      const m = n?.miniappId === AI_NODE_ID && n.params?.model && 模态(n.params.mode), model = n.params?.model;
      if (m?.re && !m.re.test(model) && !(await AI.rows(m.t)).some(r => r.model === model))
        out.push(节点话(n) + ': 模型「' + model + '」不像「' + m.zh + '」模型(留空就自动用 AI 配置里选的)');
    }
    return out;
  },
});
// 参数面板「厂商与模型」: 列给这一类选了模型的厂商(测通的标 ✓); 「自动」写明留空时用谁, 和运行时同一个规矩
async function fillModelSelect(panel, n, nd) {
  const sel = panel.querySelector('[data-modelsel]');
  if (!sel) return;
  const pname = sel.dataset.modelsel, pp = sel.dataset.provparam || 'provider', mf = sel.dataset.modefrom;
  const m = 模态((mf && (n.params[mf] ?? nd.params?.find(x => x.name === mf)?.default)) || '对话') || 模态('对话');
  const inp = panel.querySelector('[data-modelinp]'), dl = panel.querySelector('[data-modelpick]');
  const 只说 = s => { sel.innerHTML = '<option value="">' + esc(s) + '</option>'; dl?.remove(); };
  if (!colony.has('ai.providers')) return 只说('(没有 AI 配置块: 模型只能手填, 跑不了)');
  if (!colony.has(AI.能力(m.t))) return 只说('(' + AI.缺块(m.zh) + ')');   // 单独文件没带这一类
  let 家;
  try { 家 = await AI.家们(m.t); } catch (e) {
    return 只说('(厂商清单拉不到: ' + String(e.message).slice(0, 60) + '; 重开面板再试, 也可以留空)');
  }
  const cur = n.params[pp] || '', 有 = 家.find(x => x.providerId === cur || x.provider === cur);
  const 自动 = m.t === 'chat' ? 'AI 配置的默认厂商'
    : 家.auto ? AI.label(家.auto) : '没有, AI 配置里' + (家.缺 || '还没有哪家选这一类的模型');
  sel.innerHTML = '<option value="">(自动: ' + esc(自动) + ')</option>' + 家
    .map(x => '<option value="' + esc(x.provider) + '"' + (x === 有 ? ' selected' : '') + '>' + esc(x.provider)
      + (x.tested ? ' ✓已测通' : ' · 未测通') + '</option>').join('')
    + (cur && !有 ? '<option selected value="' + esc(cur) + '">' + esc(cur) + ' ⚠ 现在没有这一类模型'
      + (家.auto ? ', 跑时改用 ' + esc(AI.label(家.auto)) : '') + '</option>' : '');
  const 同步 = () => {
    if (!dl || !inp) return;
    const x = 家.find(y => y.provider === sel.value);
    const 名 = sel.value ? x?.models || [] : [...new Set(家.flatMap(y => y.models))];
    const 头 = x?.models.length ? { provider: x.provider, model: x.models[0], tested: x.tested } : 家.auto;
    dl.innerHTML = `<option value="">${名.length ? '↑ 从 ' + 名.length + ' 个模型里挑' : '(清单是空的, 手填)'}</option>`
      + 名.map(x => '<option>' + esc(x)).join('');
    inp.placeholder = '留空 = ' + (m.t === 'chat' ? (sel.value ? '这家的默认对话模型' : 'AI 配置的默认对话模型')
      : 头 ? AI.label(头) : '没有可用的, 去 AI 配置给这一类选一家');
  };
  const pi = panel.querySelector('input[data-p="' + pp + '"]');
  if (pi) pi.value = cur;
  if (dl && inp) dl.onchange = () => { if (dl.value) { inp.value = dl.value; inp.onchange(); } };
  sel.onchange = () => {
    if (sel.value) n.params[pp] = sel.value; else delete n.params[pp];
    if (pi) pi.value = sel.value;
    delete n.params[pname];   // 换厂商清掉旧模型: 不清会拿 A 家的模型去打 B 家
    delete n.params.voice;   // 旧音色多半是上一家的, 一起作废
    if (inp) inp.value = '';
    同步();
    fillVoiceSelect(panel, n);
  };
  同步();
}
// 音色: 按这个节点(或运行时会用)的语音厂商问 ai.voices 要真名单; 拉不到就手填
async function fillVoiceSelect(panel, n) {
  let sel = panel.querySelector('[data-voicesel]');
  if (!sel) return;
  const pname = sel.dataset.voicesel, cv = n.params[pname] || '';
  let voices = [];
  try {
    const b = n.params.provider ? null : (await AI.rows('tts')).auto, p = n.params.provider || b?.provider;
    const model = n.params.model || b?.model;
    if (p) voices = (await ctx.call('ai.voices', { provider: p, type: 'tts', model })) || [];
  } catch (e) { console.warn('[workflow] 拉音色失败(改手填):', e); }
  if (!voices.length) {
    sel.outerHTML = '<input data-voicesel="' + esc(pname) + '" data-p="' + esc(pname) + '" value="' + esc(cv)
      + '" placeholder="音色 id 手填(这家拉不到音色表)">';
    const inp = panel.querySelector('input[data-p="' + esc(pname) + '"]');
    if (inp) inp.onchange = () => { n.params[pname] = inp.value; };
    return;
  }
  if (sel.tagName !== 'SELECT') {   // 上一家拉不到音色表时换成了手填框, 这家有表: 换回下拉
    sel.outerHTML = '<select data-voicesel="' + esc(pname) + '"></select>';
    sel = panel.querySelector('[data-voicesel]');
  }
  sel.innerHTML = '<option value="">(厂商默认音色)</option>' + voices.map(v => {
    const id = v?.id ?? String(v);
    return '<option value="' + esc(id) + '"' + (id === cv ? ' selected' : '') + '>' + esc(v?.name || id)
      + '</option>';
  }).join('') + (cv && !voices.some(v => (v?.id ?? String(v)) === cv)
    ? '<option selected value="' + esc(cv) + '">' + esc(cv) + ' ⚠ 不在这家的音色表里</option>' : '');
  sel.onchange = () => { if (sel.value) n.params[pname] = sel.value; else delete n.params[pname]; };
}
// 卡在配置上的运行: AI 配置一变就看缺的补上没有, 补上了给一条「重跑」(要人点, 不悄悄花钱)
async function checkRecover() {
  const p = pendingRecover, m = 模态(p?.mode);
  if (!p || !studio) return;
  let picked = '';
  if (生成类.includes(m?.zh)) {
    const b = (await AI.rows(m.t)).auto;
    if (!b) return;
    picked = AI.label(b);
  }
  let bar = studio.querySelector('.wf-recover-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'wf-recover-bar';
    studio.querySelector('.wf-canvas-wrap').appendChild(bar);
  }
  bar.innerHTML = '<span>「' + esc(p.mode || 'AI') + '」已就绪' + (picked ? ': ' + esc(picked) : '')
    + ' — 上次因配置失败的「' + esc(p.name || '运行') + '」可以续上了</span>'
    + '<button class="cl-btn-primary" data-rr>重跑</button><span class="wf-od-x" data-rx>✕</span>';
  const 收 = () => { pendingRecover = null; bar.remove(); };
  bar.querySelector('[data-rr]').onclick = () => {
    收();
    toast('已重跑「' + (p.name || '工作流') + '」(后台, 列表里可见)' + (picked ? ' · 模型: ' + picked : ''));
    Eph.run(Object.assign({}, p.def, { initialInputs: p.inputs, detached: true }), { source: 'ephemeral' });
  };
  bar.querySelector('[data-rx]').onclick = 收;
}
// ═ 节点目录 · 跟着: 节点应用, 判断循环数据, AI 模态, AI 节点, 节点模型 ═
const 门面 = {
  async catalog() {   // 搭图前看: 有哪些节点、生成类模态各自现在会用的厂商和模型(和运行时同一个规矩); 规则在技能段
    const port = p => ({ name: p.name, type: p.type || 'any', label: p.label || '' });
    const entry = m => ({ miniappId: m.id, name: m.name, icon: m.icon || '', desc: m.desc || '',
      inputs: (m.node.inputs || []).map(port), outputs: (m.node.outputs || []).map(port),
      params: (m.node.params || []).map(p => ({ name: p.name, type: p.type || '', label: p.label || '',
        default: p.default, options: p.options })),
      timeoutMs: m.node.timeoutMs || null, pack: !!m.pack });
    const 有 = colony.has('ai.providers'), aiDefaults = {};
    for (const zh of 有 ? 生成类 : []) {
      const b = (await AI.rows(AI_MODE_META[zh][2])).auto;
      if (b) aiDefaults[zh] = { provider: b.provider, model: b.model, verified: b.tested };
    }
    const ai = { id: AI_NODE_ID, name: 'AI 节点' + (有 ? '' : '(这里没有 AI 配置: 只有代码模态能跑)'), icon: '✨',
      desc: AI_NODE_DESC, node: AI_NODE_SCHEMA };
    const nodes = [ai].concat((await Apps.all()).filter(m => m.node && m.id !== AI_NODE_ID)).map(entry);
    return { nodes, aiDefaults, kinds: KINDS_USE };
  },
};
// ═ 打包成节点 · 跟着: 小工具, 连线与端口, 节点应用, 判断循环数据, 存储, AI 节点, 运行器, 工作室外壳, 画节点与连线 ═
// 一组节点存成子工作流「…·内」, 再生成一个 ▣ 小应用(只记子工作流和端口), 进节点目录; 当节点跑时引擎直接跑子图。
// 端口: 跨界的边变成包口; 整图打包(没有跨界边)时, 入口节点的输入、末端节点的输出升成包口
const Pack = {
  AI_KEYS: ['mode', 'prompt', 'provider', 'model', 'aspectRatio', 'voice'],   // 单 AI 包在运行器里能改的参数
  ai1: def => {   // 只有一个 AI 节点的包: 运行器给它出模态、提示词、模型这些框
    const ns = (def && def.nodes) || [];
    return ns.length === 1 && ns[0].miniappId === AI_NODE_ID ? ns[0] : null;
  },
  没库: () => colony.has('apps.create') ? '' : '放进 Colony 后可用',   // 没有应用库(界面块)就建不了 ▣ 小应用
  // 包的输入投递成子工作流的 seedInputs; ov = 单 AI 包在运行器里临时改的参数
  async defFor(pack, inputs, ov) {
    const def = clone(await 存储.get(pack.workflowId));
    if (!def || !(def.nodes || []).length) throw new Error('包的子工作流不存在: ' + pack.workflowId);
    inputs = inputs || {};
    const seed = n => n.seedInputs = n.seedInputs || {};
    for (const m of pack.inputs || []) {
      const v = inputs[m.port], n = def.nodes.find(x => x.id === m.node), to = m.toPort;
      if (!n || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (Array.isArray(v) && (!to || to === 'media')) {   // 多个媒体拆成 media/media2/…
        v.forEach((it, i) => { seed(n)[i ? 'media' + (i + 1) : 'media'] = it; });
      }
      else if (to) seed(n)[to] = v;
      else if (v && typeof v === 'object') Object.assign(seed(n), v);
      else seed(n).value = v;
    }
    // 没对上包口的输入(比如循环送来的 item/index)送进入口节点, 不盖已投递的
    const mapped = new Set((pack.inputs || []).map(m => m.port));
    const hasIn = new Set((def.edges || []).map(e => e.to.node));
    for (const k of Object.keys(inputs)) {
      if (mapped.has(k) || inputs[k] === undefined) continue;
      for (const n of def.nodes) if (!hasIn.has(n.id) && !(k in seed(n))) seed(n)[k] = inputs[k];
    }
    const n0 = ov && Pack.ai1(def);
    if (n0) {
      const p = n0.params = n0.params || {};
      for (const k of Pack.AI_KEYS) {   // 厂商、模型留空 = 交给 AI 配置选, 旧的要删
        if (ov[k] != null && ov[k] !== '') p[k] = ov[k];
        else if (k === 'provider' || k === 'model') delete p[k];
      }
    }
    delete def.detach; def.detached = false;
    return def;
  },
  // 打包(画布右键和 workflow.packAsNode 共用): sel = {nodes, edges, ids: Set, name?}
  // 回 {app, sub, inPorts, outPorts, fix}; fix = [[边, 'to' 或 'from', 包口名]…]: 跨界的线改接到包的哪一口
  async selection(sel) {
    if (Pack.没库()) return { error: Pack.没库() };
    const ids = sel.ids, inner = sel.nodes.filter(n => ids.has(n.id)), edges = sel.edges || [];
    if (!inner.length) return { error: '没选中节点' };
    const t = new Date(), k0 = inner[0], kind = (KIND_DEF[k0.kind] || {}).name;
    const name = sel.name ? String(sel.name).slice(0, 48)
      : '包·' + (k0.title || kind || 'AI') + '组 ' + pad2(t.getHours()) + pad2(t.getMinutes());
    const innerEdges = edges.filter(e => ids.has(e.from.node) && ids.has(e.to.node));
    const inEdges = edges.filter(e => !ids.has(e.from.node) && ids.has(e.to.node));
    const outEdges = edges.filter(e => ids.has(e.from.node) && !ids.has(e.to.node));
    // 判断的分支边一跨包界就变成普通输出, 真假两路都会跑: 直接拦下, 说清怎么框
    const isCond = id => inner.some(n => n.id === id && n.kind === 'condition');
    const cut = outEdges.find(e => e.label && isCond(e.from.node));
    if (cut) return { error: '判断节点「' + cut.from.node + '」的分支边会被包切断(包外无法按真假分流): '
      + '把它的分支节点一起框进来, 或不把判断框进来' };
    const inPorts = [], outPorts = [], inputs = [], outputs = [], fix = [], outOf = {};
    const port = (list, base, p) => {   // 起一个不重名的包口
      let pn = base, i = 2;
      while (list.some(x => x.name === pn)) pn = base + (i++);
      list.push({ name: pn, type: (p && p.type) || 'any', label: (p && p.label) || pn });
      return pn;
    };
    for (const e of inEdges) {
      const pn = port(inPorts, e.to.port || 'in');
      inputs.push({ port: pn, node: e.to.node, toPort: e.to.port || '' });
      fix.push([e, 'to', pn]);
    }
    for (const e of outEdges) {
      const key = e.from.node + ':' + (e.from.port || '');
      if (!outOf[key]) {
        outOf[key] = port(outPorts, e.from.port || 'out');
        outputs.push({ name: outOf[key], from: { node: e.from.node, port: e.from.port || undefined } });
      }
      fix.push([e, 'from', outOf[key]]);
    }
    const ends = side => inner.filter(n => !innerEdges.some(e => e[side].node === n.id));
    if (!inPorts.length) for (const n of ends('to'))
      for (const p of (await portsOf(n)).inputs || [])
        if (p.name) inputs.push({ port: port(inPorts, p.name, p), node: n.id, toPort: p.name });
    // 判断的 true/false 是分支不是值, 不升成包口
    if (!outPorts.length) for (const n of ends('from').filter(n => n.kind !== 'condition'))
      for (const p of (await portsOf(n)).outputs || [])
        if (p.name) outputs.push({ name: port(outPorts, p.name, p), from: { node: n.id, port: p.name } });
    const nodes = inner.map(n => { const c = clone(n); delete c._spawnedBy; return c; });
    const sub = await 存储.save({ name: name + '·内', nodes, edges: clone(innerEdges), outputs });
    // 壳不写自己的 id: 运行窗打开小应用时带着 context.miniappId, 运行器靠它认是哪个包
    const app = await Apps.create({ name, icon: '▣', code: Pack.shell, pack: { workflowId: sub.id, inputs },
      desc: '打包节点: 内嵌「' + sub.name + '」(' + inner.length + ' 节点)。改那个工作流就是改这个节点; '
        + '桌面打开 = 运行器',
      node: { inputs: inPorts, outputs: outPorts, params: [], timeoutMs: 660000 } })
      .catch(async e => { await 存储.remove(sub.id); throw e; });   // 小应用没建成就别留下「…·内」
    return { app, sub, inPorts, outPorts, fix };
  }
};
// 画布上把 ids 这些节点换成一个包节点 node, 跨界的线照 fix 改接到包上(打包、收拢共用)
function 换成包(ids, node, fix) {
  cur.nodes = cur.nodes.filter(n => !ids.has(n.id)).concat(node);
  cur.edges = (cur.edges || []).filter(e => !(ids.has(e.from.node) && ids.has(e.to.node)));
  for (const [e, end, port] of fix) e[end] = { node: node.id, port };
  for (const id of ids) selected.delete(id);
  renderCanvas();
}
async function packSelection() {   // 画布右键框选打包: 核心在 Pack.selection, 这里只管原地换成包节点
  if (ephView) return toast('只读视图不能打包');
  if (!cur || !selected.size) return toast('先右键框选节点再打包(单个 AI 节点也可打成 app)');
  const ids = new Set(selected), inner = cur.nodes.filter(n => ids.has(n.id));
  const r = await Pack.selection({ nodes: cur.nodes, edges: cur.edges || [], ids })
    .catch(e => ({ error: e.message }));
  if (r.error) return toast('打包失败: ' + r.error);
  换成包(ids, { id: uid('pack_'), miniappId: r.app.id, x: Math.min(...inner.map(n => n.x || 0)),
    y: Math.min(...inner.map(n => n.y || 0)), params: {}, title: r.app.name }, r.fix);
  toast('已打包「' + r.app.name + '」· 子工作流在列表里(可改), 节点已进目录(桌面打开=运行器)');
}
// ═ 运行器 · 跟着: 小工具, 资产与成果, 存储, AI 模态, AI 节点, 节点模型, 打包成节点, 参数面板, 结果查看 ═
// ▣ 小应用开窗时现取的运行页: 填输入、单 AI 包能改模态和模型并「设为默认」、后台跑、看最近一次的成果
Object.assign(Pack, {
  // 运行页要的: 输入口来自 app.node; 单 AI 包再带上那个 AI 节点现在的参数当初值, 和每类的「厂商与模型」清单: 就是参数面板
  // 那一份(AI.家们), 运行页不自己去问 ai.*(它在小应用的隔离窗里, AI 配置块停着时问不到工作流剪进来的那份)
  async uiFor(app) {
    const n0 = Pack.ai1(await 存储.get(app.pack.workflowId).catch(() => null)), p = (n0 && n0.params) || {};
    const ui = { inPorts: ((app.node || {}).inputs || []).map(x => ({ n: x.name, t: x.type || 'any' })) };
    if (n0) {
      const ar = AI_NODE_SCHEMA.params.find(x => x.name === 'aspectRatio') || {}, 家 = {};
      for (const t of 模态名.map(z => 模态(z).t).filter(t => t !== 'js'))   // 拉不到的照原话交过去, 运行页写在下拉底下
        家[t] = await AI.家们(t).then(列 => ({ 列 }), e => ({ 错: e.message }));
      ui.ai = { nodeId: n0.id, keys: Pack.AI_KEYS, modes: Object.fromEntries(模态名.map(z => [z, 模态(z).t])),
        ar: ar.options || [''], 家 };
      for (const k of Pack.AI_KEYS) ui.ai[k] = p[k] || '';
      ui.ai.mode = ui.ai.mode || '对话';
    }
    return ui;
  },
  // 运行页开在隔离窗里, 读不到外面的设计变量: 把界面块此刻的值抄进去(换了强调色也跟着); 媒体箱带着自己的样子
  runnerBody(name) {
    const cs = getComputedStyle(document.documentElement);
    const vars = '--bg --bg-2 --surface --border --text --text-muted --text-dim --accent --danger --mono'
      .split(' ').map(k => k + ':' + cs.getPropertyValue(k)).join(';');
    return '<style>:root{' + vars + '}#pkui{max-width:640px;margin:0 auto;padding:18px;font-size:12px}'
      + 'h3{margin:0 0 4px;font-size:16px}label{display:block;margin:8px 0 2px}'
      + 'label,.d{font-size:11px;color:var(--text-muted)}.d{margin:0 0 12px}'
      + 'textarea,select,input,button{width:100%;background:var(--bg-2);border:1px solid var(--border);'
      + 'color:var(--text);border-radius:6px;padding:6px;font:inherit;box-sizing:border-box}'
      + 'button{width:auto;cursor:pointer}#ai-setdef{margin-top:6px}#pk-run{background:var(--accent);'
      + 'border:0;color:#000;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;margin:10px 0}'
      + '#pk-out{line-height:1.6}.ai{border-top:1px solid var(--border);margin-top:10px;padding-top:8px}'
      + '.ok,.k{color:var(--accent)}.er{color:var(--danger)}.k{font:10px var(--mono);margin-top:8px}'
      + '#pk-out img,#pk-out video{max-width:100%;border-radius:8px;display:block;margin:4px 0}'
      + '#pk-out audio{width:100%}#pk-out pre{white-space:pre-wrap;background:var(--bg-2);padding:8px;'
      + 'border-radius:6px;font-size:11px}'
      + 媒体箱.样式 + 文件格.样式 + '</style>'
      + '<div id="pkui"><h3>▣ ' + esc(name) + '</h3><p class="d">打包节点运行器 — 行为 = 同名「·内」工作流'
      + '(在工作流工作室里可改)。填输入 → 运行 → 看成果。</p><div id="pk-form"></div>'
      + '<button id="pk-run">▶ 运行</button><div id="pk-out"></div></div>';
  },
  // 运行页的脚本: 运行页这个函数原样送过去, 它用的媒体箱、看值(连同它们用的 媒体、文件格、detectMedia)和工作室是同一份
  runnerScript: (pack, ui) => [媒体, 文件格, detectMedia, 媒体箱, 看值].map(f => 'var ' + f.name + ' = ' + f + ';\n')
    .join('') + '(' + 运行页 + ')(' + JSON.stringify(pack) + ', ' + JSON.stringify(ui) + ');',
  // ▣ 小应用的壳: 开窗时现取运行页(工作流块按窗的 miniappId 认是哪个包), 所以改这里所有包立刻生效
  shell: '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body style="margin:0;background:#0a0a0a;color:#eee;font-family:sans-serif">'
    + '<div id="pk-boot" style="padding:18px;font-size:12px;color:#8a8a8a">▣ 装载运行器…</div><scr' + 'ipt>\n'
    + 'colony.call("workflow.runnerHtml", {}).then(function (r) {\n'
    + '  if (!r || r.error || !r.script) throw new Error((r && r.error) || "工作流块不在");\n'
    + '  document.body.innerHTML = r.body; (0, eval)(r.script);\n'
    + '}).catch(function (e) {\n  var el = document.getElementById("pk-boot"); el.style.color = "#ff5757";\n'
    + '  el.textContent = "✗ 运行器装载失败: " + e.message + "(需要工作流块在场)";\n});\n</scr' + 'ipt></body></html>',
});
// 运行页: 跑在 ▣ 小应用的隔离窗里, 只用 colony.call 调 workflow.*(「厂商与模型」清单在 UI 里交过来); 块里的名字只能用
// 和它一起送过去的那几个
async function 运行页(PACK, UI) {
  const C = (p, a) => colony.call(p, a || {}), $ = s => document.querySelector(s), form = $('#pk-form');
  const out = $('#pk-out'), lab = t => '<label>' + t + '</label>', media = {};
  const say = (t, bad) => { out.innerHTML = '<p class="' + (bad ? 'er' : 'ok') + '">' + t + '</p>'; };
  const isMedia = p => /^media/i.test(p.n) || /media|image|audio|video/i.test(p.t);
  form.innerHTML = UI.inPorts.map(p => isMedia(p)
    ? lab(p.n + ' · 图/音/视频 可多个') + '<div data-mb="' + p.n + '"></div>'
    : lab(p.n) + '<textarea data-in="' + p.n + '" rows="2"></textarea>').join('')
    || '<p class="d">(无输入端口, 直接运行)</p>';
  form.querySelectorAll('[data-mb]').forEach(box => {
    const vals = media[box.dataset.mb] = [];
    媒体箱(box, () => vals.slice(), vs => { vals.splice(0, vals.length, ...vs); }, t => say(t, 1));
  });
  let collect = () => null;
  const ai = UI.ai;
  if (ai) {
    const box = document.createElement('div');
    box.className = 'ai';
    box.innerHTML = lab('模态') + '<select id="ai-mode"><option>' + Object.keys(ai.modes).join('<option>')
      + '</select>' + lab('系统提示词')
      + '<textarea id="ai-prompt" rows="2" placeholder="怎么做(可留空)"></textarea>'
      + lab('厂商与模型(留空 = 用 AI 配置里为这一类选的)') + '<select id="ai-pm"></select>'
      + '<div id="ai-pmerr" class="er"></div><div id="ai-extra"></div>'
      + '<button id="ai-setdef">设为默认(写回子工作流)</button>';
    form.appendChild(box);
    const mode = $('#ai-mode'), pm = $('#ai-pm');
    const opt = (v, t) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t; pm.appendChild(o);
    };
    const sync = () => {   // 换模态: 重画这一类的厂商与模型、长宽比或音色
      const m = mode.value, t = ai.modes[m], saved = m === ai.mode && ai.provider && ai.model;
      $('#ai-extra').innerHTML = /生图|生视频/.test(m) ? lab('长宽比') + '<select id="ai-ar">'
        + ai.ar.map(a => '<option value="' + a + '">' + (a || '(默认)')).join('') + '</select>'
        : m === '语音合成' ? lab('音色(留空=默认)') + '<input id="ai-voice">' : '';
      if ($('#ai-ar')) $('#ai-ar').value = ai.aspectRatio;
      if ($('#ai-voice')) $('#ai-voice').value = ai.voice;
      pm.innerHTML = '';
      opt('', '(自动)');
      // 参数面板那一份(没测通的也列、标出来): 每家每个模型一项, 一个模型都没有的那家只列厂商(用这家默认的); 拉不到的原因
      // 写在下拉底下, 不写进成果区(看最近一次运行会清掉那里)
      const 这类 = ai.家[t] || { 列: [] };
      $('#ai-pmerr').textContent = 这类.错 ? '「厂商与模型」清单拉不到: ' + 这类.错 : '';
      for (const x of 这类.列 || []) for (const md of x.models.length ? x.models : ['']) {
        opt(x.provider + '\u0001' + md, x.provider + (md ? ' · ' + md : '') + (x.tested ? ' ✓' : ' · 未测通'));
      }
      const v = saved ? ai.provider + '\u0001' + ai.model : '';
      if (v && ![...pm.options].some(o => o.value === v)) {
        opt(v, ai.provider + ' · ' + ai.model + ' ⚠ 不在这一类的清单里');
      }
      pm.value = v;
    };
    mode.value = ai.mode;
    $('#ai-prompt').value = ai.prompt;
    mode.onchange = sync;
    sync();
    collect = () => {
      const [provider = '', model = ''] = pm.value.split('\u0001'), ar = $('#ai-ar'), vo = $('#ai-voice');
      const o = { mode: mode.value, prompt: $('#ai-prompt').value, provider, model };
      if (ar) o.aspectRatio = ar.value;
      if (vo) o.voice = vo.value;
      return o;
    };
    $('#ai-setdef').onclick = async () => {
      try {
        const def = await C('workflow.get', { id: PACK.workflowId }), o = collect();
        const n = def.nodes.find(x => x.id === ai.nodeId);
        if (!n) throw new Error('找不到节点');
        const p = n.params = n.params || {};
        for (const k of ai.keys) if (o[k]) p[k] = o[k]; else delete p[k];
        await C('workflow.save', def);
        Object.assign(ai, o);
        say('已设为默认(写回子工作流)');
      } catch (e) { say('设默认失败: ' + e.message, 1); }
    };
  }
  let poll = 0;
  const time = ts => new Date(ts).toLocaleTimeString();
  const again = () => { clearTimeout(poll); poll = setTimeout(latest, 3000); };
  const show = async rec => {   // 最近一次运行: 还在跑就过 3 秒再看
    out.innerHTML = '';
    if (!rec) return;
    if (rec.status === 'running') { say('● 后台运行中(' + time(rec.startedAt) + ' 起) — 关掉窗口不影响'); return again(); }
    const o = rec.outputs || {}, ks = Object.keys(o), done = rec.status === 'done';
    out.innerHTML = '<p class="d">最近一次运行 · ' + time(rec.finishedAt || rec.startedAt) + ' · '
      + (done ? '完成' : rec.status) + '</p>' + (done ? (ks.length ? '' : '<p>完成, 无输出。</p>')
        : '<p class="er">' + ((rec.error || []).join('; ') || rec.status) + '</p>');
    for (const k of ks) {
      const row = document.createElement('div'), v = document.createElement('div');
      row.innerHTML = '<div class="k">' + k + '</div>';
      row.appendChild(v);
      out.appendChild(row);
      await 看值(v, o[k], true, id => C('workflow.assetGet', { id }).then(r => r.data));
    }
  };
  const latest = async () => {
    try {
      const mine = ((await C('workflow.listRuns', { history: true })) || [])
        .filter(r => r.workflowId === PACK.workflowId)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
      await show(mine && ((await C('workflow.getRun', { id: mine.id })) || mine));
    } catch (e) { if (!out.innerHTML) say('读取运行记录失败: ' + e.message, 1); }
  };
  $('#pk-run').onclick = async () => {
    const inputs = {};
    form.querySelectorAll('[data-in]').forEach(t => { inputs[t.dataset.in] = t.value; });
    for (const p in media) if (media[p].length) inputs[p] = media[p].slice();
    try {   // appId 只有老包的 pack 里有; 新包靠窗的 miniappId
      const r = await C('workflow.runPack', { appId: PACK.appId, inputs, ov: collect(), detach: 1 });
      if (r && r.ok === false) throw new Error(r.error || '跑包失败');
      say('▶ 已在后台开跑 — 可以关掉这个窗口, 回来就能看到成果');
      again();
    } catch (e) { say('✗ ' + e.message, 1); }
  };
  latest();
}
// ═ 样式 ═
// 各段把自己的样子 样式.push 进来, 工作室第一次打开时一起装进页面, 块卸载时摘掉。颜色都用界面块的设计变量;
// 默认色只在没有界面块时起作用(单独打开、界面块禁用): :where 的权重是 0, 界面块的 :root 和它设的强调色都盖得过它
const 默认色 = ':where(:root){color-scheme:dark;--bg:#0a0a0a;--bg-2:#131313;--bg-3:#1a1a1a;'
  + '--surface:rgba(255,255,255,.035);--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.18);'
  + '--text:#fafafa;--text-muted:#8a8a8a;--text-dim:#555;--accent:#B5FF00;--accent-soft:rgba(181,255,0,.12);'
  + '--warn:#FF9500;--danger:#FF4444;--mono:ui-monospace,Menlo,Consolas,monospace;--serif:Georgia,serif}';
// 按钮、提示条(小工具段的「提示」画它)、续跑条(节点模型段画它)几段共用, 放这里
const 样式 = [默认色, `
.wf-studio{display:flex;height:100%;min-height:0;position:relative;
--wf-line:color-mix(in srgb,var(--accent) 30%,transparent)}
.cl-btn,.cl-btn-primary{border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;
white-space:nowrap;flex-shrink:0}
.cl-btn{background:var(--bg-3);border:1px solid var(--border);color:var(--text)}
.cl-btn:hover{border-color:var(--accent)}
.cl-btn-primary{background:var(--accent);border:0;color:#000;font-weight:600}
.wf-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);background:var(--bg-3);
border:1px solid var(--accent);color:var(--text);padding:7px 14px;border-radius:8px;font-size:12px;z-index:60;
max-width:80%;pointer-events:none}
.wf-recover-bar{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:16;
background:var(--bg-2);border:1px solid var(--accent);border-radius:10px;padding:7px 12px;display:flex;
align-items:center;gap:10px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:80%}`];
function 装样式() {
  if (document.getElementById('wf-style')) return;
  const s = document.createElement('style');
  s.id = 'wf-style';
  s.textContent = 样式.join('\n');
  document.head.appendChild(s);
  ctx.cleanup(() => s.remove());
}
// ═ 模型小表 · 跟着: 小工具, 厂商配置, 选模型, 样式, 工作室外壳, 加节点与菜单 ═
// ⚙ 模型: 借 AI 配置的「选模型」小表, 工作流用得上的几类各一行(单独打开时只有导出时带进来的那几类);
// 块里带着 AI 的那份(单独打开、AI 配置块停着)或一家厂商都没配时, 顶上多网址、Key、文本模型
样式.push(`
.wf-ai-set{position:absolute;top:8px;right:12px;z-index:30;width:300px;max-height:calc(100% - 16px);
overflow:auto;background:var(--bg-2);border:1px solid var(--border-strong);border-radius:12px;
padding:4px 12px 12px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.wf-ai-set label{display:block;margin:8px 0 4px;font-size:11px;color:var(--text-muted)}
.wf-ai-set div{display:flex;gap:6px;margin-top:4px}.wf-ai-set div>*{flex:1}
.wf-ai-set input,.wf-ai-set select,.wf-ai-set button{min-width:0;background:var(--bg);color:var(--text);
border:1px solid var(--border);border-radius:7px;padding:5px 7px;font-size:12px;box-sizing:border-box}
.wf-ai-set>input{width:100%}.wf-ai-set button{flex:none;cursor:pointer}
.wf-ai-set [type=number]{flex:none;width:56px}
.wf-ai-set p{margin:8px 0 0;font-size:11px;color:var(--text-muted)}`);
async function 开模型表(键) {   // 开着再点一下就关; 点外面、按 Esc 也关
  const 开着 = studio.querySelector('.wf-ai-set'), 关 = x => { x.摘?.(); x.remove(); };
  if (开着) return 关(开着);
  const el = studio.querySelector('.wf-canvas-wrap').appendChild(document.createElement('div'));
  el.className = 'wf-ai-set';
  try {   // AI 配置块不在船上: 借不到小表, 照原话说
    const 厂商 = typeof 模型调用 !== 'undefined' || !(await 厂商配置.列表()).length;
    if (el.isConnected) el.摘 = 选模型.挂(el, { 类: ['image', 'imageEdit', 'video', 'tts', 'stt', 'music'], 厂商 });
  } catch (e) { el.remove(); return toast('模型小表开不了: ' + e.message); }
  dismissOnOutside(el, () => 关(el), 键);
}
ctx.cleanup(() => studio?.querySelector('.wf-ai-set')?.摘?.());   // 块卸载时小表开着: 摘掉它听的事件
// ═ 工作室外壳 · 跟着: 小工具, 运行记录, 存储, 节点模型, 模型小表, 样式, 工作流列表, 画布交互, 画节点与连线, 加节点与菜单, 整理布局, 跑起来看, 成果抽屉 ═
// 工作室: 左栏工作流列表, 右边顶栏 + 画布 + 日志 + 成果抽屉, 画在 ctx.root。Colony 里界面块把它装进窗, 单独打开时占满整页
样式.push(`
.wf-main{flex:1;min-width:0;display:flex;flex-direction:column}
.wf-topbar{display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid var(--border);
background:var(--bg-2);flex-shrink:0}.wf-topbar .sp{flex:1}
.wf-tb-name{font-size:14px;font-weight:600;font-style:italic;font-family:var(--serif);min-width:3em;
overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-tb-time{font-size:11px;color:var(--text-dim);font-family:var(--mono);min-width:0;overflow:hidden;
white-space:nowrap}
.wf-zoom-inline{display:flex;align-items:center;background:var(--bg);border:1px solid var(--border);
border-radius:8px;padding:2px;flex-shrink:0}
.wf-zoom-inline button{width:22px;height:24px;border:0;background:none;color:var(--text);cursor:pointer;
font-size:14px;border-radius:6px}.wf-zoom-inline button:hover{background:var(--surface)}
.wf-zoom-inline .pct{font-size:11px;color:var(--text-muted);font-family:var(--mono);min-width:38px;
text-align:center;cursor:pointer}.wf-canvas-wrap{flex:1;position:relative;min-width:0;overflow:hidden}
.wf-two{color:var(--danger)!important;opacity:1!important}`);
// 露 = 用户看得见工作室: 单独打开时总看得见; Colony 里要界面块把 ctx.root 搬进了窗
const 露 = () => !colony.has('ui.host') || !!(ctx.root.parentNode && ctx.root.parentNode.id !== 'colony-root');
let studio = null, cur = null, view = { scale: 1, panX: 0, panY: 0 }, selected = new Set();
let linkFrom = null, ephView = null, activeWf = null;
const ZMIN = .35, ZMAX = 2.2;   // 缩放上下限, 按钮和滚轮同用
const sessions = new Map();     // 切走的工作流 id → {view, sel, rec, 改}: 切回来原样还原; 改 = 没存的改动 {cur, 底}
const runningWf = new Map();    // 在跑的工作流 → 几次(没存过的用对象本身当键): 列表标「运行中」, 再点运行就是停止
let curRec = null;              // 当前工作流最近一次(或正在跑)的运行记录: 切走时存进会话, 切回时回放
function ensureStudio() {
  if (studio) return studio;
  装样式();
  studio = document.createElement('div');
  studio.className = 'wf-studio';
  studio.innerHTML = `<div class="wf-ss"><div class="wf-ss-head">Workspaces</div>
<div class="wf-ss-list" id="wf-ss-list"></div><div class="wf-ss-foot">
<div class="wf-ss-new" id="wf-ss-new">+ 新工作流</div></div></div><div class="wf-main"><div class="wf-topbar">
<span class="wf-tb-name" id="wf-tb-name">工作流</span><span class="wf-tb-time" id="wf-tb-time"></span>
<span class="sp"></span>
<div class="wf-zoom-inline"><button id="wf-zout">−</button>
<span class="pct" id="wf-zpct" title="复位 100%">100%</span><button id="wf-zin">+</button></div>
<button class="cl-btn" id="wf-ai" title="各类用哪家哪个模型(借 AI 配置的小表)">⚙ 模型</button>
<button class="cl-btn" id="wf-tidy" title="自动分层整理布局">⤢ 整理</button>
<button class="cl-btn" id="wf-addnode">+ 加节点</button><button class="cl-btn" id="wf-save">保存</button>
<button class="cl-btn-primary" id="wf-run">▶ 运行</button></div><div class="wf-canvas-wrap">
<div class="wf-canvas" id="wf-canvas"></div><div class="wf-log" id="wf-log"></div></div></div>`;
  ctx.root.appendChild(studio);
  const $ = id => studio.querySelector('#' + id);
  $('wf-ss-new').onclick = () => openWorkflow(null);
  $('wf-save').onclick = saveCurrent;
  $('wf-run').onclick = runCurrent;
  $('wf-addnode').onclick = e => openNodePicker(e.currentTarget);
  $('wf-tidy').onclick = () => { if (cur) autoLayout(); };   // 重画时照运行记录回放, 结果卡不丢
  $('wf-ai').onclick = e => 开模型表(e.currentTarget);
  $('wf-zin').onclick = () => 缩放(1.15);
  $('wf-zout').onclick = () => 缩放(.87);
  $('wf-zpct').onclick = () => { view = { scale: 1, panX: 0, panY: 0 }; applyTransform(); };
  bindCanvasInteractions();
  wireDrawer();
  bindLiveRunViz();
  接左栏($('wf-ss-list'));
  studio.addEventListener('click', 点两下, true);
  // 框选后按 Delete/退格删这些节点(连边): 只认最后一下点在工作室里的时候, 正在输入框里打字不算
  let 点在里面 = false;
  const 按下 = e => { 点在里面 = studio.contains(e.target) && !e.target.closest('.wf-param'); };
  const 删键 = e => {
    if (e.key !== 'Delete' && e.key !== 'Backspace' || !点在里面 || !露()) return;
    if (!cur || ephView || !selected.size) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
    deleteNodes(selected);
    closeCtx();
  };
  // Esc 先关工作室自己的浮层(一次一层: ⚙ 模型小表、弹层和右键菜单、结果大窗、参数面板), 都没有才轮到界面块关窗
  const 关浮层 = e => {
    const a = document.activeElement;
    if (e.key !== 'Escape' || !露() || !(点在里面 || studio.contains(a))) return;
    if (a?.classList.contains('wf-rename')) return;   // 改名框自己收 Esc(不存)
    const 层 = ['.wf-ai-set', '.wf-picker', '.wf-result-modal', '.wf-param']
      .map(s => studio.querySelector(s)).find(Boolean);
    if (!层) return;
    if (层.contains(a)) a.blur();   // 先失焦: 打了一半的字照常存上
    层.摘?.();   // 小表摘掉它听的事件
    层.remove();
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener('pointerdown', 按下, true);
  document.addEventListener('keydown', 删键);
  document.addEventListener('keydown', 关浮层, true);   // 捕获阶段, 先于界面块在 document 上收的 Esc
  ctx.cleanup(() => {
    document.removeEventListener('pointerdown', 按下, true);
    document.removeEventListener('keydown', 删键);
    document.removeEventListener('keydown', 关浮层, true);
  });
  return studio;
}
// 点两下再做: 键上写 data-two="第二下前显示的短话"; 第一下只换字、变红, 3 秒内再点才交给键自己的处理, 不点就复原
function 点两下(e) {
  const b = e.target.closest('[data-two]');
  if (!b) return;
  clearTimeout(b.两);
  if (b.原 != null) return 复原(b);
  e.stopPropagation();
  e.preventDefault();
  b.原 = b.textContent;
  b.textContent = b.dataset.two;
  b.classList.add('wf-two');
  b.两 = setTimeout(() => 复原(b), 3000);
}
function 复原(b) {
  b.textContent = b.原;
  b.原 = null;
  b.classList.remove('wf-two');
}
function openStudio() {   // Colony 里窗没开就请界面块开窗; 收起了、被别的窗盖着就提到最前(收起的会放出来)
  const w = ctx.root.closest('.u-win'), 盖 = w && (w.classList.contains('u-min')
    || [...document.querySelectorAll('.u-win[data-k]')].some(x => +x.style.zIndex > +w.style.zIndex));
  if (露() && !盖) return;   // 已在眼前(人点左栏打开的都是): 不打扰
  const [t, a] = 露() ? ['win:block:', '到最前'] : ['block:', '打开'];
  ctx.call('ui.do', { target: t + ctx.id, action: a }).catch(e => console.warn('[workflow] 开窗', e));
}
function applyTransform() {
  if (!studio) return;
  const inner = studio.querySelector('.wf-canvas-inner');
  if (inner) inner.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${view.scale})`;
  studio.querySelector('#wf-zpct').textContent = Math.round(view.scale * 100) + '%';
}
// 库里那份打开后被别处(agent 等)存过或删了: 不盖它, 照切回来的规矩另存我的、画布开另存的; 没改动就换成库里的
async function saveCurrent() {
  if (!cur) return;
  if (ephView) return toast('即焚工作流只读');
  const 库 = cur.id && await 存储.get(cur.id), 别处 = cur.id && JSON.stringify(库) !== 底.库, 改 = 没存的(),
    话 = '「' + cur.name + '」' + (库 ? '在别处改过了' : '在别处删了');
  if (别处 && !改) return openWorkflow(cur.id).then(() => toast(话 + (库 ? ', 你这边没改动, 画布换成了库里的' : '')));
  if (别处) {
    const w = await 另存我的(改);
    Object.assign(cur, { id: w.id, name: w.name, createdAt: w.createdAt, updatedAt: w.updatedAt });
    记底(JSON.stringify(w));
  } else await 存当前();
  activeWf = cur.id;
  toast(别处 ? 话 + (库 ? ', 库里那份没动' : '') + '; 你没存的改动另存成了「' + cur.name + '」, 画布上开着的是它' : '已保存');
  renderTopbar();
  refreshHome();
  refreshDrawerIfOpen();   // 第一次存: 没存时跑出的成果刚改挂过来, 开着的抽屉当场换上
}
async function 存当前() {   // 存画布上这个; 第一次存时, 没存过就跑的那次运行和成果改挂到正式编号(回放、抽屉才找得到)
  const 首存 = !cur.id, w = await 存储.save(cur);
  cur.id = w.id;
  if (w.createdAt) cur.createdAt = w.createdAt;
  记底(JSON.stringify(w));
  if (首存 && curRec) await Runs.改挂(curRec, w.id, w.name);
  if (首存 && runningWf.has(cur)) {   // 跑着存的: 在跑登记换成正式编号, 左栏标「运行中」、■ 停得住
    runningWf.set(w.id, runningWf.get(cur));
    runningWf.delete(cur);
  }
  return w;
}
const Studio = {
  changed(what) {   // 工作流、运行、小应用、AI 配置有变: 歇 80 毫秒刷新列表; AI 配置变了再看卡住的运行能不能续上
    if (!studio) return;
    clearTimeout(Studio._t);
    Studio._t = setTimeout(() => {
      try { refreshHome(); } catch (e) { console.warn('[workflow] 刷新', e); }
    }, 80);
    if (what !== 'providers') return;
    clearTimeout(Studio._r);
    Studio._r = setTimeout(() => checkRecover()
      .catch(e => toast('查卡住的运行能不能续上时出错: ' + e.message)), 800);
  },
  boot() {      // 界面块只把「有高度的页」搬进窗, 所以一装载就画(画布等打开工作流才建)
    ctx.root.style.cssText += (colony.has('ui.host') ? ';height:100%;min-height:520px'
      : ';position:fixed;inset:0;z-index:1') + ';display:flex;flex-direction:column';   // 单独打开时铺满整页
    ensureStudio();
    refreshHome();
    ctx.cleanup(留现场);
    ctx.cleanup(() => { if (studio) studio.remove(); studio = null; });
    接现场().catch(e => toast('接着块重开前的现场时出错: ' + e.message));
  },
  async open(id) {
    ensureStudio();
    if (id) return openWorkflow(id);
    refreshHome();
    openStudio();
  }
};
// ═ 工作流列表 · 跟着: 小工具, 运行记录, 资产与成果, 存储, 运行跑道, 样式, 工作室外壳, 画节点与连线, 跑起来看, 回放, 成果抽屉 ═
// 左栏: 存下的工作流(单击打开、双击改名、⇩ 导出、✕ 点两下删)和别处正在跑的即焚运行; 换工作流时保留现场
// 名字区宽不随别的变: 留着滚动条的位; 开着的那项的框画在里面(不占地方); 在跑的绿点画在右边的空白里; ⇩ ✕ 停上来才盖在名字右边(字和名字第一行齐),
// 按住名字一动就藏起来, 改名时不露(改名框占整行)。等第二下的「再点删除」排进行里, 框和字都和 ✕ 一样贴着上边, 名字
// 折几行它都不挪
样式.push(`
.wf-ss{width:150px;flex-shrink:0;display:flex;flex-direction:column;background:var(--bg);
border-right:1px solid var(--border)}
.wf-ss-head{padding:13px 14px 10px;border-bottom:1px solid var(--border);font-family:var(--serif);
font-style:italic;font-size:14px;color:var(--text)}
.wf-ss-list{flex:1;overflow-y:auto;padding:8px;scrollbar-gutter:stable}
.wf-ss-foot{padding:8px 8px 12px;border-top:1px solid var(--border)}
.wf-ss-new{background:var(--accent-soft);border:1px dashed var(--wf-line);color:var(--accent);
padding:8px 10px;border-radius:8px;cursor:pointer;font-size:12px;text-align:center}
.wf-ss-new:hover{background:color-mix(in srgb,var(--accent) 20%,transparent)}
.wf-sb-item{display:flex;align-items:center;gap:6px;padding:7px 8px;margin:2px 0;border-radius:8px;
cursor:pointer;color:var(--text-muted);font-size:12.5px;position:relative}
.wf-sb-item:hover{background:var(--surface);color:var(--text)}
.wf-sb-item.active{background:var(--accent-soft);color:var(--text);box-shadow:inset 0 0 0 1px var(--wf-line)}
.wf-sb-item .nm{flex:1;min-width:0;overflow:hidden;white-space:pre}
.wf-sb-item .nx{font-size:0}.wf-sb-item .nx::before{content:'…';content:'…'/'';font-size:12.5px}
.wf-sb-item .nm.wrap,.wf-sb-item:has(.wf-two) .nm{white-space:pre-wrap;overflow-wrap:anywhere}
.wf-sb-item:has(.wf-two) .nx{font-size:inherit}.wf-sb-item:has(.wf-two) .nx::before{content:none}
.wf-sb-item .st{position:absolute;right:0;top:0;bottom:0;width:8px;display:flex;align-items:center;
justify-content:center;font-size:0;user-select:none}.wf-sb-item .st::before{content:'';width:5px;height:5px;
border-radius:50%;background:var(--accent)}
.wf-sb-del{position:absolute;top:3px;bottom:3px;right:8px;width:16px;display:flex;align-items:flex-start;
justify-content:center;padding-top:4px;border-radius:5px;opacity:0;color:var(--text-dim);font-size:12px;
flex-shrink:0;user-select:none;background:linear-gradient(var(--surface),var(--surface)) var(--bg)}
[data-exp].wf-sb-del{right:24px}
.wf-sb-item.active .wf-sb-del{background:linear-gradient(var(--accent-soft),var(--accent-soft)) var(--bg)}
.wf-sb-item:hover .wf-sb-del{opacity:1}.wf-sb-del:hover{color:var(--danger)}
.wf-sb-item:has(.wf-two) .wf-sb-del{position:static;width:auto;align-self:stretch;margin:-4px 0;
padding:4px 2px 0;background:none}
.wf-ss-list.dragging:active:not(:has(.wf-sb-del:active)) .wf-sb-del{visibility:hidden}
.wf-run-dot{width:7px;height:7px;border-radius:50%;background:var(--warn);flex-shrink:0;
animation:wf-dot 1.1s ease-in-out infinite}
.wf-sb-item:has(.wf-two) [data-exp],.wf-sb-item:has(.wf-two)>span:first-child,
.wf-sb-item:has(.wf-rename) .wf-sb-del{display:none}
@keyframes wf-dot{0%,100%{box-shadow:0 0 0 0 var(--warn)}50%{box-shadow:0 0 0 5px transparent}}`);
// 月-日 时:分: 顶栏的创建时间和成果抽屉都用它
const 时刻 = ts => {
  const d = new Date(+ts || 0);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + d.toTimeString().slice(0, 5);
};
// 底: 打开、存、改名时库里那份和画布的样子。画布变了 = 有没存的改动, 库里变了 = 别处动过
let 底 = null;
const 记底 = 库文 => { 底 = { 库: 库文, 画: JSON.stringify(cur) }; },
  没存的 = () => 底 && JSON.stringify(cur) !== 底.画 ? { cur, 底 } : null,
  // 避让、长出节点再分层、去掉长出的、回放合进长出的是自动改的, 不算人改的: 改前没有没存的改动, 改完重记底
  自动改 = fn => {
    const 净 = 底 && !没存的(), r = fn();
    if (净) 记底(底.库);
    return r;
  };
const 现场 = () => ({ view: { ...view }, sel: new Set(selected), rec: curRec, 改: 没存的() });
function snapshotSession() {   // 现场存进会话, 切回来原样还原; 只记没存的改动, 没改过的切回来从库里读
  if (cur && cur.id && !ephView) sessions.set(cur.id, 现场());
}
// 块卸下(停用启用 AI、改本块代码)时: 切走的和画布上的现场(没存过的号记 null)记进本页会话, 重开时照切回来的规矩接着开;
// 跑着的跟块一起停了, 记成停了; 装不下就记一句, 重开时照实说。隔离窗里碰它会抛错, 那里也不会停用启用, 当没有
const 现场键 = 'workflow.现场', 页会话 = (() => { try { return sessionStorage; } catch (e) { return null; } })();
function 留现场() {
  const 开 = cur && !ephView ? [[cur.id || null, 现场()]] : [],
    文 = JSON.stringify({ 开: 开.length ? 开[0][0] : false, 会: [...sessions, ...开] }, (k, v) => v instanceof Set
      ? [...v] : v?.control && v.status === 'running' ? { ...v, status: 'cancelled', control: undefined,
        events: [...v.events, { type: 'workflow:cancelled', reason: '工作流块重启' }] } : v);
  try { 页会话?.setItem(现场键, 文); } catch (e) { 页会话.setItem(现场键, JSON.stringify({ 没记住: e.message })); }
}
async function 接现场() {   // 块装上时: 有记下的现场就接着开(不开窗、不提到最前)
  const 记 = 页会话 && JSON.parse(页会话.getItem(现场键));
  if (!记) return;
  页会话.removeItem(现场键);
  if (记.没记住) return toast('块重开前没存的改动太大, 本页会话放不下, 画布上和切走的都没记住(' + 记.没记住 + ')');
  for (const [id, s] of 记.会) sessions.set(id, Object.assign(s, { sel: new Set(s.sel) }));
  if (记.开 !== false) await openWorkflow(记.开, 1);
}
async function 另存我的(改) {   // 回另存的那份
  const { id, createdAt, ...c } = 改.cur, 名们 = new Set((await 存储.list()).map(w => w.name || '工作流'));
  return 存储.save(clone({ ...c, name: 起新名((c.name || '工作流') + '(我的改动)', 名们) }));
}
// 离开没存过的新工作流(换工作流、看即焚运行、导入): 画布上有节点就替用户存进列表, 空的不存。静 = 不提示, 回存下的名字
async function 留下没存的(静) {
  if (!cur || cur.id || ephView || !cur.nodes.length) return '';
  const w = await 存当前();
  if (!静) toast('已替你存为「' + w.name + '」');
  return w.name;
}
function 清运行() {   // 运行键回「▶ 运行」、日志条收起: 换了工作流, 有运行记录的再由回放还原
  setRunning(false);
  const log = studio && studio.querySelector('#wf-log');
  if (log) log.style.display = 'none';
}
// 左栏点一个工作流: 右边换成它的画布; 没有 id 就新建一个(新建都走这里, 好记底; 会话里有号为 null 的现场就接着它)。切走时没存的改动, 库里没动过
// 就接着用, 动过的另存一份。静 = 不开窗、不提到最前
async function openWorkflow(id, 静) {
  ensureStudio();
  await 留下没存的();
  snapshotSession();
  studio.querySelector('.wf-param')?.remove();   // 换了工作流, 面板跟着关
  ephView = null;
  const 库 = id ? await 存储.get(id) : null, 改 = sessions.get(id)?.改,
    另 = 改 && JSON.stringify(库) !== 改.底.库 ? await 另存我的(改) : null, 新 = 库 || 另, 新文 = JSON.stringify(新),
    sess = (库 || !id) && !另 ? sessions.get(id) : null;
  sessions.delete(id);   // 会话只放切走的
  cur = (sess?.改 ? 改.cur : 新)
    || { name: '新工作流 ' + new Date().toTimeString().slice(0, 8), nodes: [], edges: [] };   // 存了才有创建时间
  if (sess) { view = sess.view; selected = sess.sel; curRec = sess.rec; }
  else { view = { scale: 1, panX: 0, panY: 0 }; selected.clear(); curRec = null; }
  if (sess?.改) 底 = 改.底;
  else 记底(新文);
  const 这 = cur, 长过 = r => (r.events || []).some(e => e.type === 'graph:patch'),
    合 = async r => {   // 上次长出过节点: 合进画布, 不算这边改的
      mergePatchEvents(r);
      await renderCanvas();
    };
  activeWf = cur.id || null;
  renderTopbar();
  清运行();
  await renderCanvas();
  renderStudioList();
  if (!静) openStudio();
  if (另) toast('「' + 改.cur.name + '」' + (库 ? '在别处改过了, 打开的是库里的新版' : '在别处删了')
    + '; 你没存的改动另存成了「' + 另.name + '」');
  if (sess) {   // 切回来: 状态、输出、日志、连线、运行键都还原(从库里读的再合长出的节点); 素材被清了说一声
    if (curRec && !sess.改 && 长过(curRec) && cur === 这) await 合(curRec);
    if (curRec) { replayRunUI(curRec); 说清理过(curRec).catch(() => { }); }
  } else if (cur.id && !ephView) {           // 第一次打开: 回放存下来的最近一次运行
    const wid = cur.id;
    try {
      const rec = (await Runs.list()).find(r => r && r.workflowId === wid);
      if (rec && cur === 这 && !ephView) {
        curRec = rec;
        if (长过(rec)) await 合(rec);
        replayRunUI(rec);
      }
    } catch (e) { console.warn('[workflow] 回放上次运行失败(画布照常能改):', e); toast('上次运行回放失败: ' + e.message); }
  }
  refreshDrawerIfOpen();
}
async function 说清理过(rec) {   // 切回来回放的那次运行: 记录已不在、素材又被 🧹 清了的, 卡上看不到, 说一声
  const 号们 = 资产号(rec.events);
  if (!号们.length || 没存好.has(rec.id) || await Runs.get(rec.id)) return;
  for (const a of 号们) if (!await Assets.get(a)) return toast('素材已清理: 这次运行没有存着的记录, 🧹 清掉了它的素材');
}
async function openEphView(id, 留视角) {   // 看别处在跑的即焚运行: 只读副本, 和正在跑的那份分开; 留视角 = 跑着重画时不复位缩放
  ensureStudio();
  const rec = Eph.get(id);
  if (!rec) return refreshHome();
  if (!ephView) { await 留下没存的(); snapshotSession(); }   // 从工作流过来: 现场先存进会话, 切回来原样还原
  ephView = id;
  activeWf = null;
  cur = clone(rec.workflow);
  底 = null;   // 只读的, 没有存不存
  if (!留视角) view = { scale: 1, panX: 0, panY: 0 };
  renderTopbar(rec.name + (rec.status === 'running' ? ' · 运行中' : rec.status === 'error' ? ' · 出错' : ' · 完成'));
  mergePatchEvents(rec);
  await renderCanvas();
  replayRunUI(rec);
  renderStudioList();
  openStudio();
}
function renderTopbar(name) {
  if (!studio) return;
  studio.querySelector('#wf-tb-name').textContent = name || (cur && cur.name) || '工作流';
  studio.querySelector('#wf-tb-time').textContent = ephView ? '即焚 · 只读'
    : cur && cur.createdAt ? '创建于 ' + 时刻(cur.createdAt) : cur ? '未保存' : '← 选择或新建工作流';
  applyTransform();
}
function refreshHome() {   // 刷新左栏; 画布上没有工作流时把空画布的提示也画上
  if (!studio) return;
  renderStudioList();
  if (!cur && !ephView) { renderTopbar(); renderCanvas(); }
}
// 左栏名字截中间、保结尾: 放不下时前段只露放得下的字, 结尾前写「…」, 结尾那段总看得到, 悬停看全名。结尾从末两个字起(末尾是
// 「 数字」就整个带上), 和别的名字的结尾一样就往前多带一个字; 带到 6 个宽(汉字算 2)还分不开的、「…」加结尾都放不下的, 折行写全
function 名字尾(名们) {   // 名字 → 结尾那段, 要写全的给 null
  const 全 = [...new Set(名们)], 尾 = (s, k) => [...s].slice(-k).join('');
  const 宽 = s => [...s].reduce((w, c) => w + (c.codePointAt(0) > 255 ? 2 : 1), 0);
  return new Map(全.map(s => {
    let k = Math.max(2, [...(/ \d+$/.exec(s) || [''])[0]].length);
    while (k < [...s].length && 全.some(o => o !== s && 尾(o, k) === 尾(s, k))) k++;
    return [s, 宽(尾(s, k)) > 6 ? null : 尾(s, k)];
  }));
}
// 量字宽(px): 照 el 的字体用画布量; 量不出(假页面里没有字体)回 null
function 字宽(el) {
  const cs = getComputedStyle(el);
  const c = cs.fontSize && (字宽.c = 字宽.c || document.createElement('canvas').getContext('2d'));
  if (!c) return null;
  c.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
  return s => c.measureText(s).width;
}
// 前段露几个字: 量 = 字 → 宽(px), 可 = 名字区的宽。全名放得下回前段的字数(不截); 放不下的露前 k 个字(k 可以是 0),
// 后面写「…」再接结尾; 连「…」加结尾都放不下回 -1(折行写全)
function 露几字(头, 尾, 可, 量) {
  const 字 = [...头];
  if (量(头 + 尾) <= 可) return 字.length;
  const 余 = 可 - 量('…' + 尾);
  let k = 0;
  while (k < 字.length - 1 && 量(字.slice(0, k + 1).join('')) <= 余) k++;
  return 余 < 0 ? -1 : k;
}
// 照名字区现在的宽(量排好的宽, 窗开合动画缩放着也不算)排这一项: 前段只露放得下的字, 没露的字号 0(复制、读屏
// 还是全名), 「…」画在没露的字前面(从左边拖选也带上全名)。露几个字没变就不动它, 选中的字留着
function 排名字(nm) {
  const h = nm.querySelector('.nh'), 量 = h && nm.getClientRects().length && 字宽(nm);
  if (!量) return;   // 本来就写全的、正在改名(藏着)的、窗没开时的不排
  const 字 = [...h.textContent], k = 露几字(h.textContent, h.nextElementSibling.textContent,
    parseFloat(getComputedStyle(nm).width) - .1, 量), 露 = k < 0 ? 字.length : k;
  nm.classList.toggle('wrap', k < 0);
  if (字.slice(露).join('') === (h.querySelector('.nx')?.textContent || '')) return;
  h.textContent = 字.slice(0, 露).join('');
  if (露 === 字.length) return;
  const x = h.appendChild(document.createElement('span'));
  x.className = 'nx';
  x.textContent = 字.slice(露).join('');
}
// 名字区的宽变了(开跑、跑完时 ⚡ 和绿点互换, 改名框收起, ✕ 等第二下又复原, 窗没开时画的): 照新的宽重排那一项。左栏固定
// 150 px 宽、一直留着滚动条的位, 开着那项的框画在里面: 窗变宽变窄、出不出滚动条、换开着的那项, 宽都不变
const 名字RO = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(es => requestAnimationFrame(() => es.forEach(e => 排名字(e.target)))) : null;
const 灯 = 跑 => 跑 ? '<span class="wf-run-dot"></span>' : '<span style="color:var(--accent)">⚡</span>';
const 跑字 = '<span class="st" title="运行中">运行中</span>';   // 绿点的悬停字; 字号 0, 读屏照旧读得到
// 新的一行(照左栏所在的页面造): 存下的(⚡、⇩ ✕)、即焚的(◌、运行中)、一个都没有时的那句话。名字和样子由 改行 填
function 造行(list, 类, id) {
  const 壳 = list.ownerDocument.createElement('div'), i = esc(id);
  壳.innerHTML = 类 === 'wf' ? `<div class="wf-sb-item" data-wf="${i}">${灯(false)}<span class="nm"></span>`
    + `<span class="wf-sb-del" data-exp="${i}" title="导出 .workflow.json(含打包节点零件)">⇩</span>`
    + `<span class="wf-sb-del" data-del="${i}" data-two="再点删除" title="删除">✕</span></div>`
    : 类 === 'eph' ? `<div class="wf-sb-item running" data-eph="${i}">◌ <span class="nm"></span>${跑字}</div>`
    : '<div style="color:var(--text-dim);font-size:11px;padding:12px 8px;line-height:1.6">'
      + '还没有工作流。<br>点下方「+ 新工作流」开始。</div>';
  const el = 壳.firstChild;
  el.键 = 类 + ':' + id;
  el.样 = { 跑: 类 === 'eph' };   // 造好时画的: 存下的是 ⚡, 即焚的一直在跑
  el.querySelectorAll('.nm').forEach(nm => 名字RO?.observe(nm));
  return el;
}
// 改一行: 名字(连同 名字尾 算的结尾)、开着、在跑, 只改和上次不一样的那几处; 改名框、等第二下的 ✕、选中的字都不碰
function 改行(el, 名, 尾, 开, 跑) {
  const 旧 = el.样, nm = el.querySelector('.nm');
  el.样 = { 名, 尾, 开, 跑 };
  el.classList.toggle('active', 开);
  el.classList.toggle('running', 跑);
  if (旧.跑 !== 跑) {   // 只有存下的会变: ⚡ 换成绿点、加「运行中」, 跑完换回
    el.firstElementChild.outerHTML = 灯(跑);
    if (跑) nm.insertAdjacentHTML('afterend', 跑字);
    else el.querySelector('.st').remove();
  }
  if (旧.名 === 名 && 旧.尾 === 尾) return;
  el.title = 名;   // 悬停看全名
  nm.className = 尾 == null ? 'nm wrap' : 'nm';   // 结尾分不开的折行写全; 别的是前段 + 结尾, 由 排名字 照宽截
  nm.innerHTML = 尾 == null ? esc(名) : `<span class="nh">${esc(名.slice(0, 名.length - 尾.length))}</span>`
    + `<span class="nt">${esc(尾)}</span>`;
  排名字(nm);
}
// 刷新左栏(存了删了、开了别的、开跑跑完都走这里): 一个工作流一行, 按编号认行。新的插一行, 没了的去掉那一行, 别的只改
// 变了的那几处; 顺序变了只挪行(已在页面上的用 moveBefore 挪, 改名框的焦点不丢; 浏览器没有它就照常插)
async function renderStudioList() {
  const list = studio && studio.querySelector('#wf-ss-list');
  if (!list) return;
  const saved = await 存储.list(), 跑着 = Eph.list().filter(x => x.status === 'running');
  const 名 = w => w.name || '工作流', 尾们 = 名字尾([...saved.map(名), ...跑着.map(名)]);
  const 行们 = [...saved.map(w => ['wf', w.id, 名(w), w.id === activeWf, runningWf.has(w.id)]),
    ...跑着.map(r => ['eph', r.id, 名(r), r.id === ephView, true])];
  if (!saved.length && !cur) 行们.push(['空', '']);   // 画布上有没存的新工作流时不说「还没有」
  const 要 = new Set(行们.map(([类, id]) => 类 + ':' + id)), 在 = new Map();
  for (const el of [...list.children]) {   // 先去掉没了的: 剩下的挨着, 不会为了给它让位多挪别的行
    if (要.has(el.键)) 在.set(el.键, el);
    else { el.querySelectorAll('.nm').forEach(nm => 名字RO?.unobserve(nm)); el.remove(); }
  }
  let 前 = null;
  for (const [类, id, 名字, 开, 跑] of 行们) {
    const el = 在.get(类 + ':' + id) || 造行(list, 类, id), 该在 = 前 ? 前.nextElementSibling : list.firstElementChild;
    if (el !== 该在) el.isConnected && list.moveBefore ? list.moveBefore(el, 该在) : list.insertBefore(el, 该在);
    if (类 !== '空') 改行(el, 名字, 尾们.get(名字), 开, 跑);
    前 = el;
  }
}
// 左栏 ✕ 和 workflow.remove(别处)共用: 删定义和现场, 正开在画布上的清掉; 别处删的, 这边没存的改动另存一份
async function 删掉工作流(id, 别处) {
  const 开着 = cur && cur.id === id && !ephView, 改 = 别处 && (开着 ? 没存的() : sessions.get(id)?.改);
  await 存储.remove(id);
  sessions.delete(id);
  if (开着) { cur = curRec = 底 = null; 清运行(); }
  if (改) toast('「' + 改.cur.name + '」在别处删了; 你没存的改动另存成了「' + (await 另存我的(改)).name + '」');
  refreshHome();
}
// 左栏的鼠标, 工作室建好时接一次: 单击打开、双击改名、⇩ 导出、✕ 点两下删(第一下由 点两下 收走)。
// 鼠标按出来的单击只认从列表里按下的那一下, 在它的松手里分单击和拖选(松手落在列表外也收得到): 按下到松开横竖都没挪过
// 拖动门槛的是单击, 打开按下的那一行, 浏览器顺手选出的字收掉; 挪过了、又在这一项里选出了字的是拖选, 不打开, 好复制;
// 挪过了没选出字的打开松手处那一行。按下松手用 mousedown / mouseup: 它们带「这是第几下」(pointerdown / pointerup 没有,
// 总是 0), 第二下起不再打开。没有按下的单击(agent 的 frame.click、el.click(), 第几下是 0)打开它落在的那一行。
// 点正开着的那一项不重开(参数面板、运行回放都不动)。双击改的是这串按下第一下的那一行: 第一下打开时左栏多了、少了、
// 挪了行, 第二下落到别的行上也一样。按下的记录松手就清, 第一下的那一行双击用完就清, 新的一串(第几下是 1)起头时换掉。
// ⇩ ✕ 是键、改名框自己收鼠标, 按在它们上的那一下归它们自己: ⇩ ✕ 在 click 里做, ⇩ 第二下起不再导出。
// 按住一挪 ⇩ ✕ 藏起来, 松手又露。鼠标停着时 ⇩ ✕ 盖住名字右边约 32 px: 从结尾往左反着拖、从被盖住的「…」起拖都选不出字,
// 松手照样打开
const 拖动门槛 = 4;   // px, 和 Windows、Chrome 认拖动的门槛一样
function 接左栏(list) {
  const 页 = list.ownerDocument, 自己的 = t => t.closest('.wf-sb-del, .wf-rename');
  const 行于 = t => 自己的(t) ? null : t.closest('.wf-sb-item');   // 落在哪一行; 落在 ⇩ ✕、改名框上的不算
  let 按 = null, 首 = null;   // 按 = 正按着的这一下 {处, 行, 第几下}; 首 = 这串按下第一下按在哪一行
  const 开 = it => {
    const 开着 = it.dataset.wf ? cur && cur.id === it.dataset.wf && !ephView : ephView === it.dataset.eph;
    if (开着) return;   // 正开着的不重开
    if (it.dataset.wf) openWorkflow(it.dataset.wf);
    else openEphView(it.dataset.eph);
  };
  const 按下 = e => {   // 页面上每一下按下都换掉记录: 不是从列表里按下的记成没有
    const 是 = !e.button && list.contains(e.target) && !自己的(e.target);
    按 = 是 ? { 处: [e.clientX, e.clientY], 行: 行于(e.target), 第: e.detail } : null;
    if (e.detail < 2) 首 = 按 && 按.行;
    if (是) list.classList.remove('dragging');
  };
  const 松手 = e => {
    const 这下 = 按;
    按 = null;
    if (!这下 || 这下.第 > 1) return;   // 不是从列表里按下的; 双击的第二下起不再打开
    const 挪了 = Math.max(Math.abs(e.clientX - 这下.处[0]), Math.abs(e.clientY - 这下.处[1])) > 拖动门槛;
    const it = 挪了 ? 行于(e.target) : 这下.行;
    if (!it || !list.contains(it)) return;   // 按着时那一行被删了的、拖到列表外松手的不开
    const 选 = getSelection(), 选了 = !选.isCollapsed && 选.containsNode(it, true);
    if (选了 && 挪了) return;   // 拖选名字
    if (选了) 选.removeAllRanges();   // 单击不留选区
    开(it);
  };
  页.addEventListener('mousedown', 按下, true);   // 捕获阶段: 别处拦了冒泡也收得到, 按下和松手配得上对
  页.addEventListener('mouseup', 松手, true);
  ctx.cleanup(() => {
    页.removeEventListener('mousedown', 按下, true);
    页.removeEventListener('mouseup', 松手, true);
  });
  list.onmousemove = e => e.buttons & 1 && list.classList.add('dragging');
  list.onclick = e => {
    const 导 = e.target.closest('[data-exp]'), 删 = e.target.closest('[data-del]');
    if (导 || 删) {
      e.stopPropagation();
      const id = 导 ? 导.dataset.exp : 删.dataset.del;
      if (删) return runningWf.has(id) ? toast('它正在跑, 先 ■ 停止再删') : 删掉工作流(id);   // ✕ 点两下才到这里
      if (e.detail > 1) return;   // 双击 ⇩ 只导一次
      return exportWorkflow(id, cur && cur.id === id && !ephView ? cur : null);   // 正开着的导出画布上的样子
    }
    const it = !e.detail && 行于(e.target);   // 鼠标按出来的在松手时已经分过
    if (it) 开(it);
  };
  list.ondblclick = async e => {
    const it = e.detail ? 首 : 行于(e.target);   // 没有按下的(合成的)认它落在的那一行
    首 = null;
    if (!it || !list.contains(it) || !it.dataset.wf) return;   // 第一下那一行被删了的、即焚的那项不改名
    e.preventDefault();
    const id = it.dataset.wf, w = await 存储.get(id);
    if (w) inlineRename(it.querySelector('.nm'), w.name || '', v => v !== w.name && 改名工作流(id, v));
  };
}
// 左栏改名: 定义、会话(切走过的, 切回来、再保存都是新名字)、画布, 连同它的运行记录(内存和库里)和成果里的名字。
// 不算没存的改动: 底跟着换名字(别处动过的不跟)
async function 改名工作流(id, v) {
  const w = await 存储.get(id), 前 = JSON.stringify(w);
  if (!w) return;
  w.name = v;
  const 后 = JSON.stringify(await 存储.save(w)), s = sessions.get(id)?.改, 跟 = (x, b) => {
    x.name = v;
    if (!b) return;
    if (b.库 === 前) b.库 = 后;
    b.画 = JSON.stringify(Object.assign(JSON.parse(b.画), { name: v }));
  };
  if (s) 跟(s.cur, s.底);
  if (cur && cur.id === id) { 跟(cur, 底); renderTopbar(); }
  await Runs.改名(id, v, [...running.values(), curRec, ...[...sessions.values()].map(x => x.rec)]);
  refreshHome();
  refreshDrawerIfOpen();
}
// ═ 画布交互 · 跟着: 小工具, 检查图, 存储, 样式, 工作室外壳, 画节点与连线, 加节点与菜单, 参数面板, 结果查看, 单跑节点, 展开与收拢 ═
// 画布: 左键拖空白平移, 滚轮缩放, 右键拖框选, 拖节点, 输出口拖到输入口连线(拖时一条虚线跟手), 把 .workflow.json 拖进来导入
样式.push(`
.wf-canvas{position:absolute;inset:0;overflow:hidden;cursor:grab;
background:radial-gradient(circle at 1px 1px,var(--border) 1px,transparent 0) 0 0/22px 22px}
.wf-canvas.panning{cursor:grabbing}.wf-canvas-inner{position:absolute;top:0;left:0;transform-origin:0 0}
.wf-selrect{position:absolute;border:1px dashed var(--accent);background:var(--accent-soft);
pointer-events:none;z-index:5}`);
// 拖: 按下以后鼠标一动就调 动, 松手调 完 并收掉监听(平移、框选、拖节点、拖背景板、拖线、拖高文本框都用它)
function 拖(动, 完) {
  const 松 = e => {
    document.removeEventListener('mousemove', 动);
    document.removeEventListener('mouseup', 松);
    if (完) 完(e);
  };
  document.addEventListener('mousemove', 动);
  document.addEventListener('mouseup', 松);
}
// 屏比: 画布框屏上宽 / 排版宽。界面块给窗加了缩放(界面缩放 ≠ 100%)时, 鼠标的屏幕距离先除以它
const 屏比 = () => { const c = studio && studio.querySelector('#wf-canvas');
  return c && c.offsetWidth ? c.getBoundingClientRect().width / c.offsetWidth : 1; };
const 缩放 = k => { view.scale = Math.max(ZMIN, Math.min(ZMAX, view.scale * k)); applyTransform(); };
function 移(n, x, y) {   // 挪一个节点: 改数据, 也挪它的卡片
  n.x = x;
  n.y = y;
  const el = 卡(n.id);
  if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
}
function 露出(id) {   // 节点不在画面里就把画面挪过去
  const el = 卡(id), w = studio && studio.querySelector('.wf-canvas-wrap');
  if (!el || !w) return;
  const a = el.getBoundingClientRect(), b = w.getBoundingClientRect();
  if (a.top < b.top || a.bottom > b.bottom || a.left < b.left || a.right > b.right) focusNode(id);
}
function focusNode(id) {   // 运行时把画布平移到这个节点居中
  const wrap = studio && studio.querySelector('.wf-canvas-wrap'), el = 卡(id);
  if (!wrap || !el) return;
  view.panX = wrap.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2) * view.scale;
  view.panY = wrap.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2) * view.scale;
  applyTransform();
}
function highlightRunEdges(active) {   // 正在跑的节点连着的线加粗加亮
  if (studio) studio.querySelectorAll('.wf-edges path').forEach(p =>
    p.classList.toggle('on', active.has(p.dataset.from) || active.has(p.dataset.to)));
}
function bindCanvasInteractions() {
  const cv = studio.querySelector('#wf-canvas');
  cv.oncontextmenu = e => e.preventDefault();   // 右键留给框选
  cv.ondragover = e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); };
  cv.ondrop = e => {   // 把 .workflow.json 拖进画布 = 导入
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();   // 别再冒到界面块的拖放
    if (!/\.json$/i.test(f.name)) return toast('画布只收 .workflow.json 文件(媒体素材请拖进节点参数面板的媒体框)');
    importWorkflowFile(f);
  };
  cv.onwheel = e => { e.preventDefault(); 缩放(e.deltaY < 0 ? 1.1 : .9); };
  cv.onmousedown = e => {
    if (e.target.closest('.wf-node, .wf-port')) return;   // 节点和端口自己管
    if (e.button === 2) return startBoxSelect(e, cv);
    if (e.button !== 0) return;
    const z = 屏比(), sx = e.clientX / z - view.panX, sy = e.clientY / z - view.panY;   // 左键拖空白: 平移
    cv.classList.add('panning');
    拖(ev => { view.panX = ev.clientX / z - sx; view.panY = ev.clientY / z - sy; applyTransform(); },
      () => cv.classList.remove('panning'));
    clearSelection();
    closePicker();
  };
}
function startBoxSelect(e, cv) {   // 右键拖出一个框, 松手选中框里的节点, 就近弹出组操作菜单
  const z = 屏比(), r = cv.getBoundingClientRect(), x0 = (e.clientX - r.left) / z, y0 = (e.clientY - r.top) / z;
  const box = document.createElement('div');
  box.className = 'wf-selrect';
  cv.appendChild(box);
  拖(ev => {
    const x = (ev.clientX - r.left) / z, y = (ev.clientY - r.top) / z;
    Object.assign(box.style, { left: Math.min(x0, x) + 'px', top: Math.min(y0, y) + 'px',
      width: Math.abs(x - x0) + 'px', height: Math.abs(y - y0) + 'px' });
  }, ev => {
    const x = (ev.clientX - r.left) / z, y = (ev.clientY - r.top) / z, 画布 = (a, p) => (a - p) / view.scale;
    const l = 画布(Math.min(x0, x), view.panX), t = 画布(Math.min(y0, y), view.panY);
    const rr = 画布(Math.max(x0, x), view.panX), b = 画布(Math.max(y0, y), view.panY);
    clearSelection();
    for (const n of cur?.nodes || []) {
      const nx = n.x || 0, ny = n.y || 0;
      if (nx + 170 >= l && nx <= rr && ny + 40 >= t && ny <= b) selected.add(n.id);
    }
    box.remove();
    markSelected();
    if (selected.size && !ephView) showCtx(ev.clientX, ev.clientY, selectionMenu());
    // 有的系统松开右键才发右键菜单事件, 发给松手处(节点、窗外桌面): 这一下整页都挡掉, 只留组菜单
    const 挡 = e2 => { e2.preventDefault(); e2.stopPropagation(); };
    document.addEventListener('contextmenu', 挡, true);
    setTimeout(() => document.removeEventListener('contextmenu', 挡, true), 300);
  });
}
function clearSelection() { selected.clear(); markSelected(); }
function markSelected() {
  studio?.querySelectorAll('.wf-node').forEach(el =>
    el.classList.toggle('selected', selected.has(el.dataset.nodeId)));
}
function bindNodeDrag(div, n) {   // 拖标题栏: 选中了就整组一起拖
  div.querySelector('.wf-node-title').onmousedown = e => {
    if (e.target.closest('.wf-node-del')) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, 组 = selected.has(n.id), z = 屏比() * view.scale;
    const 起 = cur.nodes.filter(x => x.id === n.id || 组 && selected.has(x.id))
      .map(x => [x, x.x || 0, x.y || 0]);
    拖(ev => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      for (const [x, ox, oy] of 起) 移(x, ox + dx, oy + dy);
      if (renderCanvas._draw) renderCanvas._draw();
    });
  };
}
function bindPorts(div, n) {   // 输出口按下开始连线, 松在别的节点的输入口上就连上(一个输入口只留一条线)
  div.querySelectorAll('.wf-port').forEach(pe => {
    const dot = pe.querySelector('.dot'), dir = pe.dataset.dir, p = pe.dataset.port;
    dot.onmousedown = e => {
      e.stopPropagation();
      e.preventDefault();
      if (dir === 'out' && !ephView) { linkFrom = { node: n.id, port: p }; linkPreview(dot, e); }
    };
    dot.onmouseup = () => {   // 不拦冒泡: 再冒到 document, 由拖线的收尾收虚线
      if (dir === 'in' && linkFrom && linkFrom.node !== n.id && !ephView) {
        const from = cur.nodes.find(x => x.id === linkFrom.node), lp = linkFrom.port;
        const to = { node: n.id, port: p };
        cur.edges = (cur.edges || []).filter(ed => !(ed.to.node === n.id && ed.to.port === p));
        if (Engine.成环(cur.edges, linkFrom.node, n.id)) toast('这条线让工作流成了环, 跑不了');   // 线照样连上
        cur.edges.push(from && from.kind === 'condition' && (lp === 'true' || lp === 'false')
          ? { from: { node: linkFrom.node }, label: lp, to }   // 判断节点的出口写成 label, 引擎按它剪枝
          : { from: { node: linkFrom.node, port: lp }, to });
        renderCanvas();
      }
      linkFrom = null;
    };
  });
}
function linkPreview(dot, ev) {   // 按住输出口拖时一条浅色虚线跟手, 松手就散(连没连上由输入口的 mouseup 定)
  const inner = studio && studio.querySelector('.wf-canvas-inner'), svg = inner?.querySelector('.wf-edges');
  if (!svg) return;
  const ir = inner.getBoundingClientRect(), dr = dot.getBoundingClientRect();
  const path = document.createElementNS(SVG, 'path');
  const z = 屏比() * view.scale, 点 = (x, y) => ({ x: (x - ir.left) / z, y: (y - ir.top) / z });
  const 起 = 点(dr.left + dr.width / 2, dr.top + dr.height / 2), 跟 = e => 曲(path, 起, 点(e.clientX, e.clientY));
  path.classList.add('pre');
  svg.appendChild(path);
  拖(跟, () => { path.remove(); linkFrom = null; });
  跟(ev);
}
// 节点卡: 单击开参数面板, 双击开关「参与运行」或改名, 右键菜单, ▶ 单跑, ✕ 删, 点结果看大窗, 拖标题栏, 端口连线
function 接节点(div, n, m, nd) {
  div.addEventListener('mousedown', e => { div.__按 = [e.clientX, e.clientY]; }, true);
  div.onclick = e => {   // 单击等 220 毫秒, 和双击分开
    if (div.__ct) return;
    if (e.target.closest('.wf-port, .wf-node-del, .wf-node-solo, .wf-node-result, .wf-rename')) return;
    if (div.__按 && Math.hypot(e.clientX - div.__按[0], e.clientY - div.__按[1]) > 4) return;   // 拖过松手补发的 click
    div.__ct = setTimeout(() => {
      div.__ct = null;
      if ([nd.params, nd.inputs, nd.outputs].some(x => x && x.length)) openParamPanel(n, nd);
    }, 220);
  };
  if (!ephView) {   // 即焚只读视图: 不能删、不能改、不能拖
    div.querySelector('.wf-node-del').onclick = e => { e.stopPropagation(); deleteNodes(new Set([n.id])); };
    div.ondblclick = e => {   // 双击节点 = 开关「参与运行」; 双击标题 = 改名
      clearTimeout(div.__ct);
      div.__ct = null;
      if (e.target.closest('.wf-port, .wf-node-result, .wf-rename')) return;
      e.preventDefault();
      if (e.target.closest('.wf-node-title')) return startNodeRename(div, n, m.name);
      n.disabled = !n.disabled;
      renderCanvas();
    };
    div.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, 节点菜单(n, m));
    };
    div.querySelector('.wf-node-solo').onclick = e => { e.stopPropagation(); runSingleNode(n); };
    bindNodeDrag(div, n);
  }
  const res = div.querySelector('.wf-node-result');
  res.title = '点击查看完整结果';
  res.onclick = e => {
    e.stopPropagation();
    if (div.__out !== undefined) openResultInspector(n.title || m.name, div.__out);
  };
  bindPorts(div, n);
  // 跑后、回放后收起的端口: 鼠标移到哪张卡就放出那张卡的(拖线时目标卡的入口也出来)。
  // 鼠标在结果块上不放: 放出来卡会变高, 结果块会从鼠标底下挪走, 点不着
  div.onmouseover = e => {
    if (linkFrom || !e.target.closest('.wf-node-result'))
      div.querySelectorAll('.wf-port').forEach(p => { p.style.display = ''; });
  };
}
// 背景板的板头: ✕ 取消, ▣ 收拢回打包节点, 双击标题改名, 拖板头连板里的节点一起挪
function 接背景板(gd, g) {
  gd.querySelector('.gx').onclick = e => {
    e.stopPropagation();
    cur.groups = cur.groups.filter(x => x.id !== g.id);
    renderCanvas();
  };
  if (g.packId) gd.querySelector('.gpk').onclick = e => { e.stopPropagation(); collapsePackGroup(g); };
  gd.querySelector('.gt').ondblclick = e => {
    e.stopPropagation();
    inlineRename(e.target, g.title || '', v => { g.title = v; renderCanvas(); });
  };
  gd.querySelector('.wf-group-h').onmousedown = e => {
    if (e.target.closest('.gx, .gpk, .wf-rename')) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = g.x || 0, oy = g.y || 0, z = 屏比() * view.scale;
    const 中 = (x, k, 边) => (x[k] || 0) + (卡(x.id)?.[边] || (k === 'x' ? 172 : 112)) / 2;   // 卡片中心点在板里才算
    const 在板里 = (v, o, len) => v >= o && v <= o + len;
    const 里 = cur.nodes.filter(x => 在板里(中(x, 'x', 'offsetWidth'), ox, g.w)
      && 在板里(中(x, 'y', 'offsetHeight'), oy, g.h)).map(x => [x, x.x || 0, x.y || 0]);
    拖(ev => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      g.x = ox + dx;
      g.y = oy + dy;
      gd.style.left = g.x + 'px';
      gd.style.top = g.y + 'px';
      for (const [x, nx, ny] of 里) 移(x, nx + dx, ny + dy);
      if (renderCanvas._draw) renderCanvas._draw();
    });
  };
}
// ═ 画节点与连线 · 跟着: 小工具, 连线与端口, 节点应用, 判断循环数据, 运行跑道, AI 模态, AI 节点, 样式, 工作室外壳, 画布交互, 整理布局, 回放, 背景板 ═
// renderCanvas: 背景板、节点卡(端口、起点标记、单跑 ▶、✕、结果区)和连线; 节点卡上的单击、双击、右键、拖
样式.push(`
.wf-empty{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;
color:var(--text-muted);font-size:13px;pointer-events:none}
.wf-empty .icon{font-size:32px;display:block;margin-bottom:10px}
.wf-edges{position:absolute;top:0;left:0;width:6000px;height:4000px;overflow:visible;pointer-events:none}
.wf-edges path{fill:none;stroke:var(--accent);stroke-width:2;stroke-opacity:.5}
.wf-edges path:not(.pre){pointer-events:stroke;cursor:pointer}.wf-edges path:not(.pre):hover{stroke-width:4}
.wf-edges path.on{stroke-width:3;stroke-opacity:1}.wf-edges .pre{stroke-opacity:.35;stroke-dasharray:6 5}
.wf-edges.hit path:not(.pre){stroke-width:8}
.wf-node{position:absolute;width:170px;background:var(--bg-2);border:1px solid var(--border-strong);
border-radius:12px;font-size:12px;user-select:none;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.wf-node:hover{z-index:6}.wf-node.selected{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wf-node.run-active{z-index:5;border-color:var(--warn);box-shadow:0 0 0 2px var(--warn);
animation:wf-pulse 1.1s ease-in-out infinite}
@keyframes wf-pulse{0%,100%{box-shadow:0 0 0 2px var(--warn),0 0 6px var(--warn)}50%{
box-shadow:0 0 0 2px var(--warn),0 0 20px transparent}}
.wf-node.run-done{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.wf-node.run-error{border-color:var(--danger);box-shadow:0 0 0 1px var(--danger)}
.wf-node.mode-chat{border-left:3px solid #7aa2ff}.wf-node.mode-img{border-left:3px solid #b5ff00}
.wf-node.mode-video{border-left:3px solid #ff9500}.wf-node.mode-tts{border-left:3px solid #ff6ad5}
.wf-node.mode-asr{border-left:3px solid #00d4c0}.wf-node.mode-music{border-left:3px solid #9d4edd}
.wf-node.off{opacity:.42;filter:grayscale(.5)}
.wf-node-title{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);
cursor:move}.wf-node.entry .wf-node-title{box-shadow:inset 3px 0 0 var(--accent)}
.wf-node-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-node-entry-tag{font-size:9px;color:var(--accent);font-family:var(--mono);margin-left:6px}
.wf-mode-badge{font-size:11px;margin-right:1px}
.wf-node-del{color:var(--text-dim);cursor:pointer;font-size:13px}.wf-node-del:hover{color:var(--danger)}
.wf-node-solo{color:var(--text-dim);cursor:pointer;font-size:11px;margin-right:4px}
.wf-node-solo:hover{color:var(--accent)}
.wf-node-preview{padding:6px 10px;color:var(--text-muted);font-size:11px;
border-bottom:1px solid var(--border)}
.wf-node-ports{display:flex;justify-content:space-between;padding:6px 4px}
.ports-col{display:flex;flex-direction:column;gap:5px}
.wf-port{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--text-muted)}
.wf-port.out{flex-direction:row-reverse}
.wf-port .dot{width:9px;height:9px;border-radius:50%;background:var(--bg);border:1.5px solid var(--accent);
cursor:crosshair;flex-shrink:0}.wf-port .dot.filled,.wf-port .dot:hover{background:var(--accent)}
.no-port{color:var(--text-dim);font-size:10px;padding:0 4px}
.wf-group{position:absolute;border:1.5px dashed;border-radius:14px;z-index:0;pointer-events:none;
box-sizing:border-box}
.wf-group-h{pointer-events:auto;display:flex;align-items:center;gap:6px;padding:4px 10px;
border-radius:12px 12px 0 0;cursor:move;font-size:11px;color:var(--text);user-select:none}
.wf-group-h .gt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-group-h .gx,.wf-group-h .gpk{cursor:pointer;color:var(--text-dim)}.wf-group-h .gpk{font-size:12px}
.wf-group-h .gx:hover{color:var(--danger)}.wf-group-h .gpk:hover{color:var(--accent)}
.wf-rename{flex:1;min-width:0;background:var(--bg);border:1px solid var(--accent);color:var(--text);
border-radius:6px;padding:2px 6px;font-size:12.5px;font-family:inherit}`);
const SVG = 'http://www.w3.org/2000/svg';
const 卡 = id => studio && studio.querySelector(`.wf-node[data-node-id="${id}"]`);   // 画布上这个节点的卡片
const 曲 = (p, a, b) => {   // 线从 a 到 b: 横着出、横着进的三次曲线
  const m = (a.x + b.x) / 2;
  p.setAttribute('d', `M${a.x},${a.y} C${m},${a.y} ${m},${b.y} ${b.x},${b.y}`);
  return p;
};
// 就地改名(节点标题、背景板标题、列表项共用): 把字藏起来换成输入框, 回车或点别处存, Esc 不存
function inlineRename(labelEl, initVal, onSave) {
  if (!labelEl || labelEl.parentNode.querySelector('.wf-rename')) return;
  const inp = document.createElement('input');
  inp.className = 'wf-rename';
  inp.value = initVal || '';
  labelEl.style.display = 'none';
  labelEl.before(inp);
  inp.focus();
  inp.select();
  let fin = false;
  const done = save => {
    if (fin) return;
    fin = true;
    const v = inp.value.trim();
    inp.remove();
    labelEl.style.display = '';
    if (save && v) onSave(v);
  };
  inp.onkeydown = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); done(ev.key === 'Enter'); }
  };
  inp.onblur = () => done(true);
  inp.onmousedown = inp.onclick = ev => ev.stopPropagation();
}
function startNodeRename(div, n, fallbackName) {
  inlineRename(div.querySelector('.wf-node-name'), n.title || fallbackName || '', v => {
    n.title = v;
    const h = studio.querySelector('.wf-param[data-nid="' + n.id + '"] h4');   // 开着的面板标题跟着换
    if (h) h.firstChild.textContent = '⚙ ' + v;
    renderCanvas();
  });
}
function deleteNodes(ids) {   // 删节点连带它的线: Delete 键、节点 ✕、右键菜单、展开打包都用它
  if (!cur) return;
  cur.nodes = cur.nodes.filter(x => !ids.has(x.id));
  cur.edges = (cur.edges || []).filter(ed => !ids.has(ed.from.node) && !ids.has(ed.to.node));
  for (const id of [...ids]) selected.delete(id);
  const pn = studio && studio.querySelector('.wf-param');   // 面板开的是删掉的节点: 一起关
  if (pn && ids.has(pn.dataset.nid)) pn.remove();
  renderCanvas();
}
async function renderCanvas() {
  if (!studio) return;
  const cv = studio.querySelector('#wf-canvas');
  cv.innerHTML = '';
  if (!cur || !cur.nodes.length) {
    cv.innerHTML = '<div class="wf-empty"><span class="icon">🔀</span>' + (cur ? '顶栏「+ 加节点」添加 · 拖端口连线 · '
      + '右键框选=打包/背景版/禁用 · ▣节点右键=展开成背景板(板头▣收拢/✕还原) · 双击节点=禁用' : '左侧选择工作流, 或「+ 新工作流」新建')
      + '</div>';
    return;
  }
  if (_settleRO) _settleRO.disconnect();   // 重画就重新观察节点尺寸, 不留着已经摘掉的节点
  const inner = document.createElement('div'), svg = document.createElementNS(SVG, 'svg');
  inner.className = 'wf-canvas-inner';
  svg.setAttribute('class', 'wf-edges');
  cv.appendChild(inner).appendChild(svg);
  for (const g of cur.groups || []) 画背景板(inner, g);
  for (const n of cur.nodes) { const div = await 画节点(n); if (div) inner.appendChild(div); }
  const rec = ephView ? Eph.get(ephView) : curRec, active = rec && replayNodes(rec);   // 重画后照运行记录回放结果卡
  requestAnimationFrame(() => { drawEdges(inner, svg); if (active) highlightRunEdges(active); });
  applyTransform();
  renderCanvas._draw = () => drawEdges(inner, svg);
}
// 背景板只是画面上的分区, 引擎不管: 板身不吃鼠标, 只有板头能点
function 画背景板(inner, g) {
  const gc = GROUP_COLORS[g.c || 0], gd = document.createElement('div');
  gd.className = 'wf-group';
  gd.dataset.gid = g.id;
  gd.style.cssText = `left:${g.x || 0}px;top:${g.y || 0}px;width:${g.w || 200}px;height:${g.h || 120}px;`
    + `border-color:${gc}.5);background:${gc}.05)`;
  gd.innerHTML = `<div class="wf-group-h" style="background:${gc}.14)">`
    + `<span class="gt">${esc(g.title || '分区')}</span>`
    + (g.packId ? '<span class="gpk" title="收拢回 ▣ 打包节点(板内改动写回子工作流)">▣</span>' : '')
    + `<span class="gx" title="${g.packId ? '取消背景板(节点保留=彻底还原成普通子图)' : '取消背景版(节点保留)'}">✕</span></div>`;
  inner.appendChild(gd);
  if (!ephView) 接背景板(gd, g);
}
async function 画节点(n) {   // 一张节点卡; 小应用没了画一张占位卡(能 ✕、能右键删), 认不出的内建种类不画
  const isKind = n.kind && n.kind !== 'miniapp';
  let m, nd;
  if (isKind) {
    const kd = KIND_DEF[n.kind];
    if (!kd) return null;
    m = { icon: kd.icon, name: kd.name };
    nd = kd.nd;
  } else {
    m = await Apps.get(n.miniappId);   // 内建 AI 节点没有小应用记录, 照样画
    if (m && m.node) nd = mergeNodePorts(m.node, n.ports);
    else if (n.miniappId !== AI_NODE_ID) {   // 小应用没了: 删掉了, 或单独打开时没有小应用库
      const 有库 = colony.has('apps.get'), 因 = 有库 ? '小应用已删除' : '单独打开用不了';
      m = { icon: '⚠', name: 因, 因, 说: (有库 ? 因 : '单独打开时没有小应用库') + ', 这个节点跑不了' };
      nd = mergeNodePorts({}, n.ports);
    }
    else { m = { icon: '✨', name: 'AI 节点' }; nd = mergeNodePorts(AI_NODE_SCHEMA, n.ports); }
  }
  const ins = nd.inputs || [], outs = nd.outputs || [];
  const 名 = n.title || m.name, 全名 = m.因 && n.title ? 名 + '(' + m.因 + ')' : 名;   // 占位卡的原因写在卡身
  const mm = !isKind && n.miniappId === AI_NODE_ID ? AI_MODE_META[n.params?.mode] || AI_MODE_META.对话 : null;
  const needsSeed = !isKind && ins.length > 0 && !(cur.edges || []).some(e => e.to.node === n.id);   // 起点
  const 待输入 = needsSeed && !ins.some(p => n.seedInputs?.[p.name] != null);
  const 口 = (p, dir, 实) => `<div class="wf-port ${dir}" data-dir="${dir}" data-port="${esc(p.name)}">`
    + `<span class="dot${实 ? ' filled' : ''}"></span><span>${esc(p.label || p.name)}</span></div>`;
  const 列 = (list, 空) => '<div class="ports-col">' + (list.join('') || `<span class="no-port">${空}</span>`)
    + '</div>';
  const div = document.createElement('div');
  div.className = 'wf-node' + (selected.has(n.id) ? ' selected' : '') + (n.disabled ? ' off' : '')
    + (mm ? ' mode-' + mm[0] : '') + (needsSeed ? ' entry' : '');   // AI 节点的模态看左边色条和徽章
  div.dataset.nodeId = n.id;
  div.style.left = (n.x || 0) + 'px';
  div.style.top = (n.y || 0) + 'px';
  watchSettle(div);
  nudgeOverlaps();   // 第一次排也走避让: 有的 Chrome 尺寸观察第一次不报, 画完补一下
  div.innerHTML = `<div class="wf-node-title"><span class="wf-node-name" title="${esc(全名)}">`
    + (n.disabled ? '⏸ ' : '') + (mm ? `<span class="wf-mode-badge">${mm[1]}</span>` : esc(m.icon || '⬛'))
    + ' ' + esc(名)
    + (needsSeed ? `<span class="wf-node-entry-tag">▶起点${待输入 ? '·待输入' : ''}</span>` : '') + '</span>'
    + (ephView ? '' : '<span class="wf-node-solo" title="单独跑这个节点(输入取上次运行留下的上游输出)">▶</span>')
    + (ephView ? '' : '<span class="wf-node-del">✕</span>') + '</div>'   // 下面的说明行: 占位卡写跑不了的原因, 别的只在节点自己给了时才有
    + (m.说 ? `<div class="wf-node-preview" style="color:var(--warn)">⚠ ${m.说}</div>` : '')
    + (nd.preview?.content ? `<div class="wf-node-preview">${esc(nd.preview.content)}</div>` : '')
    + '<div class="wf-node-ports">' + 列(ins.map(p => 口(p, 'in')), '无输入')
    + 列(outs.map(p => 口(p, 'out', n.params?.grow && /^plan\d*$/.test(p.name))), '无输出')   // 自生长节点的规划口画成实心
    + '</div><div class="wf-node-result" style="display:none"></div>';
  接节点(div, n, m, nd);
  return div;
}
function drawEdges(inner, svg) {   // 量出每个端口圆点在画布上的位置, 照连线画曲线
  if (!cur) return;   // 画之前工作流被删了(agent 刚打开就 remove)
  const port = {}, npos = {};
  inner.querySelectorAll('.wf-node').forEach(el => {
    const id = el.dataset.nodeId;
    npos[id] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    el.querySelectorAll('.wf-port').forEach(p => {
      const dot = p.querySelector('.dot');
      let ox = dot.offsetWidth / 2, oy = dot.offsetHeight / 2;
      for (let e2 = dot; e2 && e2 !== el; e2 = e2.offsetParent) { ox += e2.offsetLeft; oy += e2.offsetTop; }
      port[id + ':' + p.dataset.dir + ':' + p.dataset.port] = { x: el.offsetLeft + ox, y: el.offsetTop + oy };
    });
  });
  const anchor = (id, dir, p) => {   // 找不到圆点(端口收起了)就挂在节点左右边的中点
    const np = npos[id];
    return port[id + ':' + dir + ':' + p] || np && { x: np.x + (dir === 'out' ? np.w : 0),
      y: np.y + np.h / 2 };
  };
  svg.innerHTML = '';
  for (const e of cur.edges || []) {
    const a = anchor(e.from.node, 'out', e.from.port || e.label);   // 判断节点的线(带 label)挂到 真/假 口
    const b = anchor(e.to.node, 'in', e.to.port);
    if (!a || !b) continue;
    const p = 曲(svg.appendChild(document.createElementNS(SVG, 'path')), a, b);
    p.dataset.from = e.from.node;
    p.dataset.to = e.to.node;
    if (!ephView) p.ondblclick = ev => {   // 双击线删线; 鼠标下叠着几条就不删, 免得删的不是看到的那条
      svg.classList.add('hit');   // 量的时候每条线都加粗, 被盖住的、紧挨着的也量得到
      const n = document.elementsFromPoint(ev.clientX, ev.clientY).filter(x => x.parentNode === svg).length;
      svg.classList.remove('hit');
      if (n > 1) return toast('这里叠着 ' + n + ' 条线, 先拖开节点再删');
      cur.edges = cur.edges.filter(x => x !== e);
      renderCanvas();
    };
  }
}
// ═ 加节点与菜单 · 跟着: 小工具, 节点应用, 判断循环数据, AI 节点, 打包成节点, 样式, 工作室外壳, 工作流列表, 画布交互, 画节点与连线, 单跑节点, 展开与收拢, 背景板 ═
// 「+ 加节点」弹层: 内建三种 + 当节点用的小应用, 自建的能改名(✎)、点两下删(✕); 右键菜单: 框选后的组操作、节点上的单个操作
样式.push(`
.wf-picker{position:absolute;z-index:14;background:var(--bg-2);border:1px solid var(--border-strong);
border-radius:10px;padding:6px;min-width:210px;max-height:340px;overflow:auto;
box-shadow:0 12px 40px rgba(0,0,0,.5)}
.wf-pk{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;
font-size:12px;color:var(--text)}.wf-pk:hover{background:var(--surface);color:var(--accent)}
.wf-pk .icon{font-size:14px}.wf-pk .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-pk-act{opacity:0;color:var(--text-dim);font-size:12px;padding:0 3px;flex-shrink:0}
.wf-pk:hover .wf-pk-act{opacity:1}.wf-pk-act:hover{color:var(--accent)}
.wf-pk-act[data-act=del]:hover{color:var(--danger)}.wf-pk-off{opacity:.45;cursor:default}`);
function closePicker() { studio?.querySelector('.wf-picker')?.remove(); }
function pickerRename(el, rec) {   // 只送 {name}: 送整条记录会带上 trust, 界面块拒收
  inlineRename(el.querySelector('.nm'), rec.name || '', async v => {
    try {
      await Apps.update(rec.id, { name: v });
      rec.name = v;
      el.querySelector('.nm').textContent = v;
      toast('已改名: ' + v);
    } catch (e) { toast('改名失败: ' + e.message); }
  });
}
async function pickerDelete(el, rec) {   // ✕ 点两下才到这里; 画布上有节点用它就重画, 卡当场换成占位卡, 它开着的面板关掉
  try {
    await Apps.remove(rec.id);
    el.remove();
    toast(rec.pack ? '已删除(内嵌子工作流保留, 侧栏可见)' : '已删除: ' + (rec.name || rec.id));
    const pn = studio?.querySelector('.wf-param'), 用它 = n => n.miniappId === rec.id;
    if (pn && cur?.nodes.some(n => n.id === pn.dataset.nid && 用它(n))) pn.remove();
    if (cur?.nodes.some(用它)) renderCanvas();
  } catch (e) { toast('删除失败: ' + e.message); }
}
async function openNodePicker(anchor) {
  if (ephView) return toast('即焚工作流只读');
  closePicker();
  ensureStudio();
  const wrap = studio.querySelector('.wf-canvas-wrap'), pk = document.createElement('div');
  const 能改 = m => m.id !== AI_NODE_ID && m.origin !== 'seed';   // AI 节点和种子记录不出 ✎ ✕
  let list = (await Apps.all()).filter(m => m.node);
  if (!list.some(m => m.id === AI_NODE_ID)) {   // AI 节点没有小应用记录时块里自己能跑, 照样列出
    list = [{ id: AI_NODE_ID, icon: '✨', name: 'AI 节点' }, ...list];
  }
  const 改删 = '<span class="wf-pk-act" data-act="ren" title="改名">✎</span>'
    + '<span class="wf-pk-act" data-act="del" data-two="再点删"'
    + ' title="删除; 用到它的工作流会跑不了这个节点">✕</span>';
  pk.className = 'wf-picker';
  pk.innerHTML = Object.entries(KIND_DEF).map(([k, d]) => `<div class="wf-pk" data-kind="${k}">`
    + `<span class="icon">${d.icon}</span><span>${d.name}</span></div>`).join('')
    + list.map(m => `<div class="wf-pk" data-mid="${esc(m.id)}">`
      + `<span class="icon">${esc(m.icon || '⬛')}</span><span class="nm">${esc(m.name)}</span>`
      + (能改(m) ? 改删 : '') + '</div>')
      .join('');
  wrap.appendChild(pk);
  const r = anchor.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), z = 屏比();
  pk.style.top = Math.max(6, (r.bottom - wr.top) / z + 6) + 'px';
  pk.style.left = Math.max(8, Math.min(wr.width / z - 220, (r.left - wr.left) / z - 70)) + 'px';
  pk.querySelectorAll('[data-mid]').forEach(el => el.onclick = e => {
    const act = e.target.closest('.wf-pk-act'), rec = list.find(m => m.id === el.dataset.mid);
    if (!act) { addNode(el.dataset.mid, null, null); return closePicker(); }
    e.stopPropagation();
    if (rec) (act.dataset.act === 'ren' ? pickerRename : pickerDelete)(el, rec);
  });
  pk.querySelectorAll('[data-kind]').forEach(el => el.onclick = () => {
    addKindNode(el.dataset.kind);
    closePicker();
  });
  dismissOnOutside(pk, closePicker, anchor);
}
function dismissOnOutside(el, close, anchor) {   // 点到浮层外面就关(加节点弹层、右键菜单); 下一拍才挂, 免得打开的这一下就关
  setTimeout(() => {
    const off = ev => {
      if (!el.isConnected) return document.removeEventListener('mousedown', off, true);   // 别处已关(Esc 等)
      if (el.contains(ev.target) || ev.target === anchor) return;
      close();
      document.removeEventListener('mousedown', off, true);
    };
    document.addEventListener('mousedown', off, true);   // 捕获阶段: 节点标题的 stopPropagation 挡不住
  }, 0);
}
function nextPos() {   // 新节点摆在画面左上, 三个一行往下排
  const i = cur.nodes.length;
  return { x: (70 - view.panX) / view.scale + (i % 3) * 200,
    y: (70 - view.panY) / view.scale + Math.floor(i / 3) * 140 };
}
async function addNode(mid, x, y) {
  if (!cur) await openWorkflow(null);   // 没开工作流就加: 和「+ 新工作流」一样开一个新的
  if (x == null) ({ x, y } = nextPos());
  const id = uid('n_');
  cur.nodes.push({ id, miniappId: mid, x, y, params: {} });
  renderCanvas().then(() => 露出(id));
}
function closeCtx() { studio?.querySelector('.wf-ctx')?.remove(); }
function showCtx(x, y, items) {   // 右键菜单, 和加节点弹层一个样子
  closeCtx();
  const wrap = studio.querySelector('.wf-canvas-wrap'), mnu = document.createElement('div');
  if (!wrap) return;
  mnu.className = 'wf-picker wf-ctx';
  mnu.innerHTML = items.map((it, i) => `<div class="wf-pk${it.灰 ? ' wf-pk-off' : ''}" data-i="${i}">`
    + `<span>${it.t}${it.灰 ? ' · ' + it.灰 : ''}</span></div>`).join('');
  wrap.appendChild(mnu);
  const wr = wrap.getBoundingClientRect(), z = 屏比();
  mnu.style.top = Math.max(6, Math.min((y - wr.top) / z, wr.height / z - items.length * 38 - 12)) + 'px';
  mnu.style.left = Math.max(6, Math.min((x - wr.left) / z, wr.width / z - 230)) + 'px';
  mnu.querySelectorAll('[data-i]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const it = items[+el.dataset.i];
    if (it.灰) return;
    closeCtx();
    it.fn();
  });
  dismissOnOutside(mnu, closeCtx);
}
function selectionMenu() {   // 框选以后
  const 开关 = () => {
    for (const x of cur.nodes) if (selected.has(x.id)) x.disabled = !x.disabled;
    renderCanvas();
  };
  return [{ t: '▣ 打包成节点' + (selected.size === 1 ? '(单节点=独立小 app)' : ''), fn: packSelection,
    灰: Pack.没库() },
    { t: '▢ 生成背景版', fn: makeGroup }, { t: '⏸ 禁用/启用所选', fn: 开关 },
    { t: '✕ 删除所选(连边)', fn: () => deleteNodes(selected) }];
}
function 节点菜单(n, m) {   // 节点上点右键
  return [{ t: '✎ 重命名', fn: () => { const d = 卡(n.id); if (d) startNodeRename(d, n, m.name); } },
    { t: n.disabled ? '▶ 启用(参与运行)' : '⏸ 禁用(不参与运行)', fn: () => { n.disabled = !n.disabled; renderCanvas(); } },
    { t: '▶ 单跑此节点', fn: () => runSingleNode(n) },
    ...m.pack ? [{ t: '◱ 展开成背景板(取消板=彻底还原)', fn: () => unpackNode(n) }] : [],
    { t: '✕ 删除节点(连边)', fn: () => deleteNodes(new Set([n.id])) }];
}
// ═ 整理布局 · 跟着: 工作室外壳, 工作流列表, 画节点与连线 ═
// 自动分层: 按连线的先后从左往右分列, 每列竖着排。自生长长出来的节点(_spawnedBy)不画线, 也算进先后, 一键就能理清
function computeLayout(nodes, edges) {
  const ids = new Set(nodes.map(n => n.id)), soft = [];
  for (const e of edges || []) {
    if (ids.has(e.from.node) && ids.has(e.to.node)) soft.push([e.from.node, e.to.node]);
  }
  for (const n of nodes) {
    if (n._spawnedBy && ids.has(n._spawnedBy) && n._spawnedBy !== n.id) soft.push([n._spawnedBy, n.id]);
  }
  const layer = new Map(nodes.map(n => [n.id, 0])), adj = new Map(nodes.map(n => [n.id, []]));
  const indeg = new Map(layer);
  for (const [f, t] of soft) { adj.get(f).push(t); indeg.set(t, indeg.get(t) + 1); }
  const q = nodes.filter(n => !indeg.get(n.id)).map(n => n.id), seen = new Set();
  while (q.length) {
    const id = q.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of adj.get(id)) {
      layer.set(t, Math.max(layer.get(t), layer.get(id) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (!indeg.get(t)) q.push(t);
    }
  }
  // 只定第几列、列里第几个: 竖向先给紧凑的初值, 真实间距由避让按量出来的高度往下推开
  const byLayer = {}, pos = {};
  for (const n of nodes) (byLayer[layer.get(n.id)] ||= []).push(n);
  Object.keys(byLayer).map(Number).sort((a, b) => a - b)
    .forEach(l => byLayer[l].forEach((n, i) => { pos[n.id] = { x: 80 + l * 250, y: 50 + i * 40 }; }));
  return pos;
}
function autoLayout(wf = cur) {   // 摆好位置; 是画布上这个就重画(回的是重画的 Promise)
  if (!wf || !wf.nodes || !wf.nodes.length) return;
  const pos = computeLayout(wf.nodes, wf.edges || []);
  for (const n of wf.nodes) if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; }
  if (wf === cur) return renderCanvas();
}
// 跑着和回放时收起没连线、也没填初始输入的端口, 给图、音、文字腾地方; 一编辑重画就全回来
function slimPorts(runWf) {
  if (!studio || !runWf || !runWf.nodes) return;
  const es = runWf.edges || [];
  for (const n of runWf.nodes) {
    卡(n.id)?.querySelectorAll('.wf-port').forEach(pe => {
      const pn = pe.dataset.port || '', used = pe.dataset.dir === 'in'
        ? es.some(e => e.to.node === n.id && (e.to.port || '') === pn) || n.seedInputs?.[pn] != null
        : es.some(e => e.from.node === n.id && (e.from.port ? e.from.port === pn : e.label === pn || !pn));
      pe.style.display = used ? '' : 'none';
    });
  }
}
// 避让: 照节点卡真实的高度, 把同一列(横坐标按 200 分桶)里压住的往下推, 生成的图、视频能整个露出来; 只往下推, 反复调也一样
let _ovT = null;
function resolveOverlaps() {
  if (!studio || !cur || !cur.nodes) return;
  const cols = {};
  let moved = false;
  for (const n of cur.nodes) {
    const el = 卡(n.id);
    if (el) (cols[Math.round((n.x || 0) / 200)] ||= []).push({ n, el });
  }
  for (const list of Object.values(cols)) {
    list.sort((a, b) => (a.n.y || 0) - (b.n.y || 0));
    for (let i = 1; i < list.length; i++) {
      const need = (list[i - 1].n.y || 0) + list[i - 1].el.offsetHeight + 26;
      if ((list[i].n.y || 0) < need) { list[i].n.y = need; list[i].el.style.top = need + 'px'; moved = true; }
    }
  }
  if (moved && renderCanvas._draw) renderCanvas._draw();
}
function nudgeOverlaps() { clearTimeout(_ovT); _ovT = setTimeout(() => 自动改(resolveOverlaps), 120); }
// 节点卡尺寸一变(图、视频加载完, 结果画上, 端口收起)就歇一下再避让; 改 style.top 不触发它, 不会来回打转
const _settleRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(nudgeOverlaps) : null;
function watchSettle(el) { if (_settleRO) _settleRO.observe(el); }
// ═ 参数面板 · 跟着: 小工具, 连线与端口, 节点应用, AI 模态, AI 节点, 节点模型, 样式, 工作室外壳, 画布交互, 画节点与连线, 结果查看 ═
// 点节点开的面板: 模态和厂商模型在最上, 再是起点节点的初始输入(媒体用媒体箱)、端口定制, 最后其余参数; 文本框下边拖高
样式.push(`
.wf-param{position:absolute;top:14px;left:14px;width:280px;max-height:80%;overflow:auto;
background:var(--bg-2);border:1px solid var(--border-strong);border-radius:12px;padding:14px;z-index:8}
.wf-param h4{font-size:13px;margin-bottom:10px;display:flex;align-items:center}
.wf-param .px{margin-left:auto;cursor:pointer;color:var(--text-dim)}
.wf-param label{display:block;font-size:11px;color:var(--text-muted);margin:8px 0 4px}
.wf-param input,.wf-param select,.wf-param textarea{width:100%;background:var(--bg);
border:1px solid var(--border);color:var(--text);border-radius:7px;padding:6px 8px;font-size:12px;
box-sizing:border-box}.wf-param textarea{resize:none;min-height:44px}
.wf-param .t{color:var(--accent);font-family:var(--mono);font-size:10px}
.wf-seed-h{font-size:11px;color:var(--accent);font-family:var(--mono);margin:14px 0 4px;padding-top:10px;
border-top:1px dashed var(--border)}
.wf-port-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);padding:2px 0}
.wf-port-row span{cursor:pointer;color:var(--text-dim)}.wf-port-row span:hover{color:var(--danger)}
.wf-port-add{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.wf-param-io{font-size:10.5px;color:var(--text-dim);margin-top:10px}
.wf-ta-grip{height:9px;margin:-2px 0 4px;cursor:ns-resize;display:flex;align-items:center;
justify-content:center}
.wf-ta-grip::after{content:"";width:34px;height:3px;border-radius:2px;background:var(--border)}
.wf-ta-grip:hover::after{background:var(--accent)}`);
// param.showIf = {某参数: [允许的值…]}: 只显示和现在的取值对得上的参数(音色只在语音合成时, 长宽比只在生图、生视频时…)
function paramVisible(p, n, nd) {
  return !p.showIf || Object.keys(p.showIf).every(k =>
    (p.showIf[k] || []).includes(n.params[k] ?? (nd.params || []).find(x => x.name === k)?.default));
}
async function reopenParams(n) {   // 端口增删、换模态后照最新的 n.ports 重开面板(面板不关); 内建 AI 节点没有小应用记录
  const m = await Apps.get(n.miniappId);
  if (m && m.node) return openParamPanel(n, mergeNodePorts(m.node, n.ports));
  if (n.miniappId === AI_NODE_ID) return openParamPanel(n, mergeNodePorts(AI_NODE_SCHEMA, n.ports));
}
function 参数控件(p, v) {   // 一个参数一个控件: 选模型、选音色、下拉、是否、多行、单行
  const lab = `<label>${esc(p.label || p.name)}</label>`, k = esc(p.name);
  if (p.control === 'model-select') {
    return lab + `<select data-modelsel="${k}" data-modefrom="${esc(p.modeFrom || '')}" `
      + `data-provparam="${esc(p.providerParam || 'provider')}"><option>加载中…</option></select>`
      + `<input data-modelinp="1" data-p="${k}" value="${esc(v)}" style="margin-top:4px">`
      + '<select data-modelpick style="margin-top:4px"></select>';
  }
  if (p.control === 'voice-select') return lab + `<select data-voicesel="${k}"><option>加载中…</option>`
    + '</select>';
  if (p.control === 'select' && p.options) {
    return lab + `<select data-p="${k}">` + p.options.map(o => `<option value="${esc(o)}"`
      + `${String(v) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>';
  }
  if (p.control === 'toggle' || p.type === 'boolean') {
    const on = v === true || v === 'true';
    return lab + `<select data-p="${k}"><option value="true"${on ? ' selected' : ''}>是</option>`
      + `<option value="false"${on ? '' : ' selected'}>否</option></select>`;
  }
  if (p.control === 'textarea' || p.type === 'json' || p.type === 'text') {
    const t = typeof v === 'object' ? JSON.stringify(v) : v;
    return lab + `<textarea data-p="${k}" rows="3">${esc(t)}</textarea>`;
  }
  return lab + `<input data-p="${k}" value="${esc(v)}">`;
}
function openParamPanel(n, nd) {
  studio.querySelector('.wf-param')?.remove();
  const panel = document.createElement('div'), ps = nd.params || [], isKind = n.kind && n.kind !== 'miniapp';
  const pv = p => p.topLevel ? n[p.name] : n.params[p.name];   // 内建三种的参数存在节点顶层(expr、over、op…)
  const vis = ps.filter(p => paramVisible(p, n, nd)), ms = ps.find(p => p.control === 'model-select');
  const 头 = new Set(ms ? [ms.modeFrom, ms.name, ms.providerParam || 'provider'].filter(Boolean) : []);
  const 控件们 = 在头 => vis.filter(p => 头.has(p.name) === 在头)
    .map(p => 参数控件(p, pv(p) ?? p.default ?? '')).join('');
  const head = 控件们(true), rest = 控件们(false);
  // 初始输入: 没有线连进来的输入口在这里直接填, 存 node.seedInputs; 几个起点各填各的, 点运行一起跑
  const conn = new Set((cur.edges || []).filter(e => e.to.node === n.id).map(e => e.to.port));
  const seedPorts = isKind ? [] : (nd.inputs || []).filter(p => !conn.has(p.name));
  const 首媒体 = seedPorts.find(p => /^media/i.test(p.name));   // 第一个媒体口出一个媒体箱, 别的 media* 口都归它管
  n.seedInputs = n.seedInputs || {};
  const 种子 = p => {
    if (/^media/i.test(p.name)) {
      return p === 首媒体 ? '<label>媒体 <span class="t">可多个</span></label><div data-mbox></div>' : '';
    }
    const v = n.seedInputs[p.name] ?? p.default ?? '', k = esc(p.name);
    const val = esc(typeof v === 'object' ? JSON.stringify(v) : v);
    return `<label>${esc(p.label || p.name)}${p.type ? ` <span class="t">${esc(p.type)}</span>` : ''}</label>`
      + (!p.type || ['text', 'json', 'string', 'any'].includes(p.type)
        ? `<textarea data-seed="${k}" rows="2">${val}</textarea>`
        : `<input data-seed="${k}" value="${val}">`);
  };
  const seeds = seedPorts.length ? '<div class="wf-seed-h">▶ 初始输入 (作为起点时喂入)</div>'
    + seedPorts.map(种子).join('') : '';
  const 口行 = (side, 字) => (n.ports?.[side === 'in' ? 'inputs' : 'outputs'] || []).map((p, i) =>
    `<div class="wf-port-row">${字} · ${esc(p.name)}<span data-delport="${side}:${i}">✕</span></div>`)
    .join('');
  const 加口 = [['in:text', '文本入'], ['in:media', '媒体入'], ['out:text', '文本出'], ['out:media', '媒体出']]
    .map(([k, t]) => `<button class="cl-btn" data-addport="${k}">+${t}</button>`).join('');
  const ports = ephView || isKind ? '' : '<div class="wf-seed-h">◧ 端口定制(加完回画布连线)</div>'
    + 口行('in', '入') + 口行('out', '出') + `<div class="wf-port-add">${加口}</div>`;
  const 名单 = list => (list || []).map(p => esc(p.name)).join(', ') || '—';
  panel.className = 'wf-param';
  panel.dataset.nid = n.id;
  panel.innerHTML = `<h4>⚙ ${esc(n.title || '节点参数')}<span class="px">✕</span></h4>` + head + seeds + ports
    + (rest || (head ? '' : '<div class="no-port">此节点无可调参数</div>'))
    + `<div class="wf-param-io">入: ${名单(nd.inputs)} · 出: ${名单(nd.outputs)}</div>`;
  panel.querySelector('.px').onclick = () => panel.remove();
  panel.querySelectorAll('[data-p]').forEach(el => el.onchange = () => {
    const k = el.dataset.p, p = ps.find(x => x.name === k) || {};
    let val = el.value;
    if (p.type === 'number') val = val.trim() === '' ? '' : Number(val);
    else if (p.type === 'boolean' || p.control === 'toggle') val = val === 'true';
    else if (p.type === 'json') { try { val = JSON.parse(val); } catch (e) { } }
    const 处 = p.topLevel ? n : n.params;   // 清空 = 删掉, 回到默认值(数字框不存成 0)
    if (val === '' && (p.topLevel || p.type === 'number')) delete 处[k]; else 处[k] = val;
    const 管模型 = ps.some(x => x.control === 'model-select' && x.modeFrom === k);
    if (管模型) {   // 换了模态, 旧模型、旧音色几乎必错: 清掉; 画布上的色条和徽章跟着变
      delete n.params.model;
      delete n.params.voice;
      syncNodeModeUI(n);
    }
    const 厂商 = ps.some(x => x.providerParam === k);   // 手填厂商框也像下拉一样重开
    if (管模型 || 厂商 || ps.some(x => x.showIf && x.showIf[k])) setTimeout(() => reopenParams(n), 0);   // 专属参数整个换
  });
  fillModelSelect(panel, n, nd);
  fillVoiceSelect(panel, n, nd);
  panel.querySelectorAll('[data-addport]').forEach(b => b.onclick = () => {   // 加口、删口以后重画画布、原地重开面板
    const [side, type] = b.dataset.addport.split(':'), 文 = type === 'text';
    const key = side === 'in' ? 'inputs' : 'outputs';
    const base = 文 ? (side === 'in' ? 'task' : 'text') : 'media', names = (nd[key] || []).map(p => p.name);
    let i = 2;
    while (names.includes(base + i)) i++;
    n.ports = n.ports || {};
    (n.ports[key] ||= []).push({ name: base + i, type: 文 ? 'text' : 'any', label: (文 ? '文本' : '媒体') + i });
    renderCanvas();
    reopenParams(n);
  });
  panel.querySelectorAll('[data-delport]').forEach(b => b.onclick = () => {   // 删口时连线和初始输入一起清
    const [side, i] = b.dataset.delport.split(':'), 出 = side === 'out';
    const arr = n.ports?.[出 ? 'outputs' : 'inputs'] || [], p = arr[+i];
    if (!p) return;
    arr.splice(+i, 1);
    cur.edges = (cur.edges || []).filter(ed => {
      const 端 = 出 ? ed.from : ed.to;
      return !(端.node === n.id && 端.port === p.name);
    });
    if (n.seedInputs && !/^media\d*$/i.test(p.name)) delete n.seedInputs[p.name];   // media* 归媒体箱管
    renderCanvas();
    reopenParams(n);
  });
  panel.querySelectorAll('[data-seed]').forEach(el => el.onchange = () => {
    const k = el.dataset.seed, p = seedPorts.find(x => x.name === k) || {};
    let val = el.value;
    if (p.type === 'number') val = Number(val);
    else if (p.type === 'json') { try { val = JSON.parse(val); } catch (e) { } }
    if (val === '' || val == null) delete n.seedInputs[k]; else n.seedInputs[k] = val;
    renderCanvas();
  });
  panel.querySelectorAll('textarea').forEach(ta => {   // 文本框下边一整条横杆拖高: 原生的角抓手和滚动条打架, 也只有一个角能拖
    const grip = document.createElement('div');
    grip.className = 'wf-ta-grip';
    grip.title = '拖动调高';
    ta.after(grip);
    grip.onmousedown = e => {
      e.preventDefault();
      const sy = e.clientY, sh = ta.offsetHeight, z = 屏比();
      拖(ev => { ta.style.height = Math.max(44, Math.min(480, sh + (ev.clientY - sy) / z)) + 'px'; });
    };
  });
  const mbox = panel.querySelector('[data-mbox]');
  if (mbox) {   // 媒体箱里的值按 media、media2、media3… 依次存进初始输入(引擎按名字顺序收)
    const keys = () => Object.keys(n.seedInputs).filter(k => /^media\d*$/i.test(k))
      .sort((a, b) => (+a.slice(5) || 1) - (+b.slice(5) || 1));   // 按号排: media10 在 media9 后面
    媒体箱(mbox, () => keys().map(k => n.seedInputs[k]), vs => {
      for (const k of keys()) delete n.seedInputs[k];
      vs.forEach((v, i) => { n.seedInputs['media' + (i ? i + 1 : '')] = v; });
      renderCanvas();
    }, toast);
  }
  if (ephView) panel.querySelectorAll('input, textarea, select, button, [data-mbox]')   // 即焚只读视图只看不改
    .forEach(e => { e.disabled = e.inert = true; });
  studio.querySelector('.wf-canvas-wrap').appendChild(panel);
  const pr = panel.getBoundingClientRect(), nr = 卡(n.id)?.getBoundingClientRect();
  if (nr && nr.left < pr.right + 8 && nr.right > pr.left && nr.top < pr.bottom && nr.bottom > pr.top) {
    view.panX += (pr.right + 16 - nr.left) / 屏比();   // 面板挡住了这个节点: 画面往右挪到面板旁边
    applyTransform();
  }
}
// 媒体箱: 拖入或粘贴多份图、音、视频(也收粘贴的 data 网址、资产引用、网址), ✕ 单删。取() 回一份现在的值,
// 存(新的值们) 由调用方存, 错(话) 报读不了的文件。只用 媒体(), 不碰块里别的东西:
// 运行器把 String(媒体箱)、String(媒体) 和 媒体箱.样式 送进隔离窗, 和这里用同一份
function 媒体箱(箱, 取, 存, 错) {
  箱.className = 'wf-mbox';
  箱.tabIndex = 0;
  const 画 = () => {
    const vs = 取();
    箱.innerHTML = vs.length ? '' : '<div class="wf-mbox-hint">拖入或粘贴 图·音·视频<br>也可粘贴 data 网址、资产引用或网址</div>';
    vs.forEach((v, i) => {
      const c = document.createElement('div'), s = v && typeof v === 'object' ? JSON.stringify(v)
        : String(v || ''), t = (/^data:(\w+)/.exec(s) || [])[1];
      c.className = 'wf-mchip';
      c.innerHTML = '<span class="mx">✕</span>';
      c.prepend(t === 'image' || t === 'video' ? 媒体(t, s) : t === 'audio' ? '🎵'
        : s.includes('__wfasset') ? '📦资产' : '🔗' + s.slice(0, 18));
      c.querySelector('.mx').onclick = e => {
        e.stopPropagation();
        const a = 取();
        a.splice(i, 1);
        存(a);
        画();
      };
      箱.appendChild(c);
    });
  };
  let 排 = Promise.resolve();   // 加东西排一条队: 后一次拖放、粘贴等前一次加完再加, 箱里的先后 = 松手的先后
  const 加 = p => {   // p: 一份值, 或读文件的 Promise(回一组值)
    排 = 排.then(() => p).then(vs => {
      if (!(vs = [].concat(vs).filter(Boolean)).length) return;
      存([...取(), ...vs]);
      画();
    }).catch(e => console.warn('[workflow] 媒体箱', e));
  };
  const 读 = fl => 加(Promise.all([...fl].map(f => new Promise(好 => {   // 一次的全读完再按拖进来的先后一起加
    const rd = new FileReader();
    rd.onload = () => 好(rd.result);
    rd.onerror = () => { 错 && 错('读取文件失败: ' + f.name); 好(''); };
    rd.readAsDataURL(f);
  }))));
  箱.ondragover = e => { e.preventDefault(); 箱.classList.add('over'); };
  箱.ondragleave = () => 箱.classList.remove('over');
  箱.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();   // 别再冒到界面块的拖放
    箱.classList.remove('over');
    if (e.dataTransfer.files.length) 读(e.dataTransfer.files);
  };
  箱.onpaste = e => {
    e.preventDefault();
    const cf = e.clipboardData.files;
    let t = e.clipboardData.getData('text').trim();
    if (/^\{.*"__wfasset"/.test(t)) try { t = JSON.parse(t); } catch (x) { }   // 资产引用存成对象, 跑时才认得
    if (cf.length) 读(cf); else 加(t);
  };
  箱.onclick = () => 箱.focus();   // 聚焦了才能 Ctrl+V
  画();
}
媒体箱.样式 = `
.wf-mbox{min-height:64px;background:var(--bg);border:1px dashed var(--border);border-radius:8px;padding:6px;
display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start;cursor:pointer}
.wf-mbox.over,.wf-mbox:focus{border-color:var(--accent);outline:none}
.wf-mbox-hint{color:var(--text-dim);font-size:11px;align-self:center;margin:auto;text-align:center;
line-height:1.5}
.wf-mchip{position:relative;width:56px;height:56px;border-radius:7px;overflow:hidden;
background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;
justify-content:center;font-size:10px;color:var(--text-muted);text-align:center;padding:2px;
box-sizing:border-box}.wf-mchip img,.wf-mchip video{width:100%;height:100%;object-fit:cover}
.wf-mchip .mx{position:absolute;top:1px;right:1px;background:rgba(0,0,0,.65);border-radius:50%;width:15px;
height:15px;line-height:15px;text-align:center;cursor:pointer;color:#eee;font-size:10px}
.wf-mchip .mx:hover{color:var(--danger)}`;
样式.push(媒体箱.样式);
// ═ 结果查看 · 跟着: 小工具, 资产与成果, 样式, 工作室外壳 ═
// 节点结果: 卡片上画一小块(先挑媒体, 其次第一段文字), 点开是检视大窗, 每个输出一栏; 回放、成果抽屉也用这一套
样式.push(`
.wf-node-result{padding:6px 8px;border-top:1px dashed var(--border);font-size:10px;color:var(--text-muted);
max-height:360px;overflow:hidden;cursor:pointer}.wf-node-result:hover{background:var(--surface)}
.wf-node-result img,.wf-node-result video{width:100%;max-height:320px;border-radius:6px;display:block;
background:var(--bg)}.wf-node-result img{object-fit:contain}.wf-node-result audio{width:100%;height:30px}
.wf-node-result .txt{font-family:var(--mono);white-space:pre-wrap;word-break:break-word;display:-webkit-box;
-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}
.wf-node-result .sm,.wf-node-result pre{font-family:var(--mono);white-space:nowrap;overflow:hidden;
text-overflow:ellipsis;margin:0}
.wf-result-modal{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;
justify-content:center;z-index:12}
.wf-result-modal .box{background:var(--bg-2);border:1px solid var(--border-strong);border-radius:14px;
padding:18px;width:540px;max-width:92%;max-height:84%;overflow:auto}
.wf-result-modal h4{font-size:14px;margin:0 0 12px;display:flex;align-items:center;font-style:italic;
font-family:var(--serif)}
.wf-result-modal .px{margin-left:auto;cursor:pointer;color:var(--text-dim);font-style:normal}
.wf-result-modal .px:hover{color:var(--text)}.wf-result-modal .ro{margin-bottom:14px}
.wf-result-modal .rk{font-size:11px;color:var(--accent);font-family:var(--mono);margin-bottom:5px}
.wf-result-modal img,.wf-result-modal video{max-width:100%;border-radius:8px;display:block;
background:var(--bg)}.wf-result-modal audio{width:100%}
.wf-result-modal pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;
font-family:var(--mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;
max-height:300px;overflow:auto;margin:0}`);
// 媒体(类, 地址, 全): 音频带控件; 视频在大窗里带控件、卡片上静音; file 画成文件格; 别的当图(懒加载)。
// 不碰块里别的(只用 文件格), 运行器也能 String(媒体) 送进去
function 媒体(kind, src, 全) {
  if (kind === 'file') return 文件格(src, 全);
  const e = document.createElement(kind === 'audio' || kind === 'video' ? kind : 'img');
  e.src = src;
  if (kind === 'audio' || 全 && kind === 'video') e.controls = true;
  else if (kind === 'video') e.muted = true;
  else e.loading = 'lazy';
  return e;
}
// 文件格(data 网址, 全): 图音视频以外的文件, 写类型、大小(1 KB = 1024 B); 文本类(纯文本、JSON、CSV、Markdown、代码,
// HTML 当源码)露开头几行, 大窗里全文(JSON 排好缩进)、能复制; 大窗里都能下载, PDF 这些不预览。只用浏览器自带的
function 文件格(src, 全) {
  const s = String(src || ''), 前 = s.slice(0, s.indexOf(',') + 1);
  const mt = (/^data:([^;,]*)/.exec(s) || [])[1] || '';
  let 字节 = new Uint8Array();
  try {
    字节 = /;base64,$/.test(前) ? Uint8Array.from(atob(s.slice(前.length)), c => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(s.slice(前.length)));
  } catch (e) { }
  const n = 字节.length, 文本 = /^text\/|json|csv|markdown|xml|javascript|ecmascript|yaml|x-sh|python/.test(mt);
  const 大小 = n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
    : (n / 1048576).toFixed(1) + ' MB';
  const box = document.createElement('div'), 头 = document.createElement('div'), 子 = mt.split('/')[1] || '';
  box.className = 'wf-file' + (全 ? ' full' : '');
  头.className = 'fh';
  头.textContent = '📄 ' + (mt || '文件') + ' · ' + 大小;
  box.append(头);
  let t = 文本 ? new TextDecoder().decode(字节) : '';
  if (全 && /json/.test(mt)) try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (e) { }
  if (文本) box.append(Object.assign(document.createElement('pre'),
    { textContent: 全 ? t : t.split('\n').slice(0, 8).join('\n') }));
  if (!全) return box;
  const 尾 = { plain: 'txt', markdown: 'md', javascript: 'js' }[子] || 子.replace(/^x-|\W.*/g, '') || 'bin';
  const a = Object.assign(document.createElement('a'), { href: s, textContent: '⬇ 下载', download: '文件.' + 尾 });
  头.append(' ', a);
  if (文本) {
    const b = Object.assign(document.createElement('button'), { textContent: '复制' });
    b.onclick = () => (navigator.clipboard?.writeText(t) || Promise.reject())
      .then(() => { b.textContent = '已复制'; }, () => { b.textContent = '复制不了(浏览器不让)'; });
    头.append(' ', b);
  }
  return box;
}
文件格.样式 = `
.wf-file{width:100%;height:100%;box-sizing:border-box;padding:7px;display:flex;flex-direction:column;gap:5px;
text-align:left;font:10px var(--mono,monospace);color:var(--text-muted,#aaa);overflow:hidden}
.wf-file .fh{color:var(--accent,#7ad);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.wf-file pre{margin:0;flex:1;min-height:0;overflow:hidden;white-space:pre-wrap;word-break:break-all;
line-height:1.4}
.wf-file.full pre{max-height:60vh;overflow:auto;background:var(--bg,#111);padding:8px;border-radius:6px}
.wf-file a,.wf-file button{color:var(--accent,#7ad);font:inherit;cursor:pointer;background:none;
border:1px solid currentColor;border-radius:5px;padding:1px 6px;text-decoration:none}`;
样式.push(文件格.样式);
// 看值(el, 值, 全, 取资产): 按值画 图/音/视频/资产引用/文字/JSON, 画好替换 el 里的东西。全 = 检视大窗, 否则卡片上的缩略。
// 取资产(id) 回资产的 data 网址。只用 detectMedia 和 媒体(都不碰块里别的), 运行器把三个 String() 送进隔离窗用同一份
async function 看值(el, v, 全, 取资产) {
  const m = detectMedia(v);
  let n;
  if (m) {
    let { src, kind } = m;
    if (kind === 'asset') {
      try { src = await 取资产(m.assetId); } catch (e) { }
      const mt = m.mimeType || (/^data:([^;]+)/.exec(src || '') || [])[1] || '';
      kind = /^audio/.test(mt) ? 'audio' : /^video/.test(mt) ? 'video'
        : !mt || /^image/.test(mt) ? 'image' : 'file';   // 图音视频以外的画成文件格
    }
    if (src) n = 媒体(kind, src, 全);
    else { n = document.createElement('span'); n.className = 'sm'; n.textContent = '资产已丢失或被清理'; }
  } else {
    const 字 = typeof v === 'string' && v.trim();
    n = document.createElement(字 && !全 ? 'div' : 'pre');
    if (!全) n.className = 字 ? 'txt' : 'sm';
    n.textContent = 字 ? v : v == null ? '(空)' : JSON.stringify(v, null, 全 ? 2 : 0);
  }
  el.replaceChildren(n);
}
// 输出是对象就照用, 不是就包成 {result}
const asOut = o => o && typeof o === 'object' && !Array.isArray(o) ? o : { result: o };
async function renderNodeResult(el, outputs) {   // 卡片上: 先挑媒体, 其次第一段非空文字, 都没有就整个
  el.style.display = 'block';
  el.innerHTML = '';
  el.title = '点击查看完整结果';
  const out = asOut(outputs), vs = Object.values(out);
  let pick = vs.find(v => detectMedia(v));
  if (pick === undefined) pick = vs.find(v => typeof v === 'string' && v.trim());
  if (pick === undefined) pick = vs.length === 1 ? vs[0] : out;
  await 看值(el, pick, false, Assets.get);
}
function openResultInspector(title, outputs) {
  const wrap = studio && studio.querySelector('.wf-canvas-wrap');
  if (!wrap) return;
  wrap.querySelector('.wf-result-modal')?.remove();
  const modal = document.createElement('div'), out = asOut(outputs), keys = Object.keys(out);
  modal.className = 'wf-result-modal';
  modal.innerHTML = `<div class="box"><h4>${esc(title || '节点结果')}<span class="px">✕</span></h4>`
    + `<div class="rbody">${keys.length ? '' : '<pre>(无输出)</pre>'}</div></div>`;
  wrap.appendChild(modal);
  modal.querySelector('.px').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  for (const k of keys) {
    const row = document.createElement('div'), c = document.createElement('div');
    row.className = 'ro';
    row.innerHTML = `<div class="rk">${esc(k)}</div>`;
    row.appendChild(c);
    modal.querySelector('.rbody').appendChild(row);
    看值(c, out[k], true, Assets.get);
  }
}
// ═ 跑起来看 · 跟着: 小工具, 运行跑道, 样式, 工作室外壳, 工作流列表, 画布交互, 画节点与连线, 整理布局, 结果查看, 成果抽屉 ═
// ▶ 运行 / ■ 停止; 跑的时候逐个节点上色、填结果, 日志条计数; 长出来的节点合进画布并重新分层; 别处发起的运行也画上来
样式.push(`
#wf-run.on{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
.wf-node-dur{margin-left:6px;font-size:9px;color:var(--accent);font-family:var(--mono);font-weight:400}
.wf-node-result .wf-err{color:var(--danger);font-family:var(--mono);font-size:10px;white-space:pre-wrap;
word-break:break-word;line-height:1.4}
.wf-log{position:absolute;bottom:14px;left:14px;max-width:46%;background:var(--bg-2);
border:1px solid var(--border);border-radius:10px;font-family:var(--mono);font-size:10.5px;z-index:6;
display:none}
.wf-log-h{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;color:var(--text-muted);
user-select:none;white-space:nowrap}.wf-log-h:hover{color:var(--text)}.wf-log-h .cnt{color:var(--accent)}
.wf-log-h .err{color:var(--danger)}
.wf-log .log-body{max-height:26vh;overflow:auto;padding:0 12px 8px;min-width:280px}
.wf-log.folded .log-body{display:none}.wf-log .log-line{color:var(--text-muted);padding:1px 0}
.wf-log .log-line.success{color:var(--accent)}.wf-log .log-line.error{color:var(--danger)}`);
// 节点点运行就跑: 初始输入早填在起点节点里(node.seedInputs), 几个起点一起跑; 跑着再点 = 停止(长节点、烧钱的扩图随时能断)
async function runCurrent() {
  if (!cur || !cur.nodes.length) return toast('先添加节点');
  if (ephView) return toast('历史运行只读, 切回工作流再跑');
  const 外 = curRec?.status === 'running' && curRec.workflowId === cur.id;   // 别处发起、正画在画布上的那次
  if (!runningWf.has(cur.id || cur) && !外) return execViz({});
  if (curRec && curRec.control && curRec.control.abort) curRec.control.abort('用户停止');
  else toast('该工作流正在运行中, 等它跑完');
}
function logShell(log) {   // 日志条: 常显一行(几条、有没有报错), 点它展开; 每次开跑或回放都先收起
  if (!log.querySelector('.log-body')) {
    log.innerHTML = '<div class="wf-log-h">📜 日志 <span class="cnt">0</span><span class="err"></span>'
      + '<span class="tg">▸</span></div><div class="log-body"></div>';
  }
  const h = log.querySelector('.wf-log-h'), tg = h.querySelector('.tg');
  log.classList.add('folded');
  tg.textContent = '▸';
  h.onclick = () => { tg.textContent = log.classList.toggle('folded') ? '▸' : '▾'; };
  return log.querySelector('.log-body');
}
function logCount(log, n, isErr) {
  log.querySelector('.wf-log-h .cnt').textContent = n;
  if (isErr || !n) log.querySelector('.wf-log-h .err').textContent = isErr ? ' ⚠有报错' : '';
}
function logFor(e) {   // 一个运行事件 → 一行日志(实时和回放同一个写法); 不用记的回 null
  const t = e.type;
  if (t === 'node:start') {   // 带 id 和节点自己起的名字, 几个同类节点分得清
    const 名 = e.name && e.name !== e.nodeId ? '「' + e.name + '」' : '';
    return { t: '▶ ' + e.nodeId + 名 + (e.title ? ' · ' + e.title : '') + ' …' };
  }
  if (t === 'node:done') {   // 自生长被拒的原因也写上
    const 拒 = e.outputs?.grewError;
    return { t: '✓ ' + e.nodeId + ' (' + e.duration + 'ms)' + (e.picked ? ' · 模型: ' + e.picked : '')
      + (拒 ? ' · 没长成: ' + 拒 : ''), c: 拒 ? 'error' : 'success' };
  }
  if (t === 'node:error') return { t: '✗ ' + e.nodeId + ' [' + (e.code || '') + ']: ' + e.error, c: 'error' };
  if (t === 'graph:patch') return { t: '+ ' + (e.addNodes || []).length + ' 节点(动态扩图)' };
  if (t === 'workflow:cancelled') return { t: '■ 已停止' + (e.reason ? ': ' + e.reason : ''), c: 'error' };
  if (t === 'workflow:done') {
    return { t: '✓ 完成 · ' + JSON.stringify(e.outputs || {}).slice(0, 120), c: 'success' };
  }
  if (t === 'workflow:error') return { t: '✗ ' + (e.errors || []).join('; '), c: 'error' };
  return null;
}
function setRunning(on, ms, count) {   // 跑着时运行键变成红的「■ 停止 几个节点 几秒」
  const b = studio && studio.querySelector('#wf-run');
  if (!b) return;
  b.classList.toggle('on', !!on);
  b.textContent = !on ? '▶ 运行'
    : '■ 停止' + (count ? ' ' + count + '节点' : '') + (ms != null ? ' ' + Math.round(ms / 1000) + 's' : '…');
  b.title = on ? '点击停止本次运行' : '';
}
function setDur(el, ms) {   // 节点标题上的耗时
  const tt = el && ms != null && el.querySelector('.wf-node-title');
  if (!tt || tt.querySelector('.wf-node-dur')) return;
  const ds = document.createElement('span');
  ds.className = 'wf-node-dur';
  ds.textContent = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
  tt.insertBefore(ds, tt.querySelector('.wf-node-del'));
}
// 节点跑完、出错时卡片上的样子: 实时、单跑、回放都用这两个
function applyNodeDoneUI(el, ev) {
  if (!el) return;
  el.classList.remove('run-active');
  el.classList.add('run-done');
  el.__out = ev.outputs;
  const r = el.querySelector('.wf-node-result');
  if (r) renderNodeResult(r, ev.outputs);
  setDur(el, ev.duration);
}
function applyNodeErrorUI(el, msg) {
  if (!el) return;
  el.classList.remove('run-active');
  el.classList.add('run-error');
  const r = el.querySelector('.wf-node-result');
  if (r) { r.style.display = 'block'; r.innerHTML = '<div class="wf-err">✗ ' + esc(msg || '出错') + '</div>'; }
}
const 错话 = e => (e.code ? e.code + ': ' : '') + (e.error || '出错');   // 节点出错事件 → 卡片上那句
// 长出来的节点合进图: 去重, 记下谁长的(_spawnedBy, 分层时当软边), 没给位置的摆在源节点右边 240 处往下错开; 分不分层由调用方定
function patchIntoGraph(wf, e) {
  const src = wf.nodes.find(n => n.id === e.sourceNodeId), old = wf.edges || [];
  let i = 0;
  for (const an of e.addNodes || []) {
    if (wf.nodes.find(n => n.id === an.id)) continue;
    const node = { id: an.id, miniappId: an.miniappId, kind: an.kind, title: an.title,
      params: an.params || {}, _spawnedBy: e.sourceNodeId || null };
    if (an.ports) node.ports = an.ports;
    if (an.seedInputs) node.seedInputs = an.seedInputs;
    if (an.x != null) { node.x = an.x; node.y = an.y; }
    else if (src && src.x != null) { node.x = src.x + 240; node.y = (src.y || 0) + i * 120; }
    wf.nodes.push(node);
    i++;
  }
  const 有 = ed => old.find(x => x.from.node === ed.from.node && x.to.node === ed.to.node
    && x.to.port === ed.to.port);
  wf.edges = old.concat((e.addEdges || []).filter(ed => !有(ed)));
}
// 一次运行的画法: 画布 ▶ 和「别处发起、跑的是画布上这个」共用。markSidebar: 画布 ▶ 的运行不在即焚列表里, 要自己标「运行中」
function createRunViz(runWf, markSidebar) {
  const vis = () => cur === runWf && !ephView;   // 正看着这个工作流才画, 数据照常记
  const log = studio.querySelector('#wf-log'), logBody = logShell(log), active = new Set();
  const t0 = Date.now(), rk = runWf.id || runWf, nodeEl = id => vis() ? 卡(id) : null;
  const addLog = (t, c) => {
    if (!vis()) return;
    const d = document.createElement('div');
    d.className = 'log-line' + (c ? ' ' + c : '');
    d.textContent = t;
    logBody.appendChild(d);
    logBody.scrollTop = logBody.scrollHeight;
    logCount(log, logBody.children.length, c === 'error');
  };
  let lastFocus = 0;
  log.style.display = 'block';
  logBody.innerHTML = '';
  logCount(log, 0);
  studio.querySelectorAll('.wf-node').forEach(el => {   // 上次的颜色、耗时、结果都清掉: 这次没跑到的不挂旧结果
    el.classList.remove('run-active', 'run-done', 'run-error');
    el.querySelector('.wf-node-dur')?.remove();
    const r = el.querySelector('.wf-node-result');
    if (r) { r.style.display = 'none'; r.innerHTML = ''; }
    delete el.__out;
  });
  slimPorts(runWf);   // 跑着时收起没用到的端口, 生成的东西不被空端口挤没
  setRunning(true);
  const tick = setInterval(() => { if (vis()) setRunning(true, Date.now() - t0, active.size); }, 500);
  if (markSidebar) { runningWf.set(rk, (runningWf.get(rk) || 0) + 1); refreshHome(); }   // 计数: 同时跑几次也不会提前消失
  return {
    onStart: rec => {   // 现场 = 这次运行(切走存进会话, 切回回放); 抽屉先开着的, 当场换成「正在跑」那句
      curRec = rec;
      if (vis()) refreshDrawerIfOpen();
    },
    onEvent: e => {
      const t = e.type, el = e.nodeId && nodeEl(e.nodeId);
      if (t === 'node:start') {
        active.add(e.nodeId);
        if (el) {
          el.classList.add('run-active');
          const r = el.querySelector('.wf-node-result');
          if (r) { r.style.display = 'block'; r.innerHTML = '<span class="sm">● 运行中…</span>'; }
        }
        if (vis() && Date.now() - lastFocus > 500) { lastFocus = Date.now(); focusNode(e.nodeId); }
      } else if (t === 'node:done') { active.delete(e.nodeId); applyNodeDoneUI(el, e); }
      else if (t === 'node:error') { active.delete(e.nodeId); applyNodeErrorUI(el, 错话(e)); }
      else if (t === 'graph:patch') {
        自动改(() => (patchIntoGraph(runWf, e), autoLayout(runWf)));   // 一长出来就分层, 不叠在一起(不是画布上这个就只改坐标)
        if (vis()) {
          renderCanvas();
          requestAnimationFrame(() => { highlightRunEdges(active); slimPorts(runWf); });
        }
      } else if (t === 'workflow:cancelled' || t === 'workflow:error') {   // 停了或出错结束: 还亮着的收掉
        active.clear();
        const [错, 长] = 截字((e.errors || []).join('; '), 80);   // 太长截掉的说一声: 全文在日志里
        if (t === 'workflow:error' && vis()) toast('没跑成: ' + 错 + (长 ? '…(全文看日志)' : ''));
        if (vis()) studio.querySelectorAll('.wf-node.run-active').forEach(x => {
          x.classList.remove('run-active');
          const r = x.querySelector('.wf-node-result');
          const 话 = t === 'workflow:error' ? '■ 没跑完(别的节点出错)' : '■ 已停止';
          if (r) { r.style.display = 'block'; r.innerHTML = '<span class="sm">' + 话 + '</span>'; }
        });
      }
      if (vis() && /^node:(start|done|error)$/.test(t)) highlightRunEdges(active);
      const lf = logFor(e);
      if (lf) addLog(lf.t, lf.c);
    },
    finish: () => {
      clearInterval(tick);
      if (vis()) { setRunning(false); highlightRunEdges(new Set()); }
      if (markSidebar) {   // 跑着时首存过的, 登记已换成正式编号
        const k = runningWf.has(rk) ? rk : runWf.id || rk, c = (runningWf.get(k) || 1) - 1;
        if (c > 0) runningWf.set(k, c); else runningWf.delete(k);
        refreshHome();
      }
      if (vis()) refreshDrawerIfOpen();
    }
  };
}
// 上次长出来的节点(父节点还在图里的)连同它们的线去掉, 这次重新长; 回去掉了几个
function 去掉长出的(wf) {
  const ids = new Set(wf.nodes.map(n => n.id));
  const 去 = new Set(wf.nodes.filter(n => n._spawnedBy && ids.has(n._spawnedBy)).map(n => n.id));
  if (!去.size) return 0;
  wf.nodes = wf.nodes.filter(n => !去.has(n.id));
  wf.edges = (wf.edges || []).filter(e => !去.has(e.from.node) && !去.has(e.to.node));
  return 去.size;
}
async function execViz(initial) {   // 画布 ▶: 跑和记都走 Eph.run 这一条路, 这里只管画
  const runWf = cur;   // 记住这次跑的是哪个: 切走以后 cur 会变
  if (自动改(() => 去掉长出的(runWf))) await renderCanvas();
  const viz = createRunViz(runWf, true);
  try {
    await Eph.run({ ...runWf, initialInputs: initial },
      { source: 'editor', onStart: viz.onStart, onEvent: viz.onEvent });
  } finally { viz.finish(); }
}
// agent、小应用这些别处发起的运行: 跑的正是画布上开着的这个工作流, 就用同一套画上来(画布 ▶ 和单跑自己会画)
function bindLiveRunViz() {
  const live = new Map();   // 运行 id → 画它的那一套
  let 重画 = null;
  事件.听('run', ({ phase, rec, ev }) => {
    if (rec.source === 'editor' || rec.source === 'single') return;
    if (ephView === rec.id && phase !== 'start') {   // 正看着这次即焚运行: 歇 150 毫秒照记录重画, 缩放平移不动
      clearTimeout(重画);
      重画 = setTimeout(() => { if (ephView === rec.id) openEphView(rec.id, true); }, 150);
    }
    if (phase === 'start') {
      if (!cur || rec.workflowId !== cur.id || live.has(rec.id)) return;
      const viz = createRunViz(cur, false);
      viz.onStart(rec);
      live.set(rec.id, viz);
    } else if (phase === 'event') live.get(rec.id)?.onEvent(ev);
    else if (phase === 'done' && live.has(rec.id)) { live.get(rec.id).finish(); live.delete(rec.id); }
    else if (phase === 'done') refreshDrawerIfOpen();   // 别的工作流在别处跑完: 开着的抽屉也刷新(范围选全部时看得到)
  });
}
// ═ 单跑节点 · 跟着: 小工具, 连线与端口, 运行跑道, 工作室外壳, 工作流列表, 画节点与连线, 整理布局, 跑起来看 ═
// 单独跑一个节点: 输入拿上次运行留下的上游输出, 结果填回卡片、记进现场, 可以顺着链一个个查, 调好了再整个跑。
// 也走正式跑道(Eph.run, 不留历史、不收成果): 单跑自生长节点照样能长, 长出的子图实时合上画布
async function runSingleNode(n) {
  if (!cur) return;
  if (runningWf.has(cur.id || cur)) return toast('工作流正在运行中, 先停止再单跑');
  const lastOut = {}, incoming = (cur.edges || []).filter(e => e.to.node === n.id), el = 卡(n.id);
  for (const e of curRec?.events || []) if (e.type === 'node:done') lastOut[e.nodeId] = e.outputs;
  const missing = [...new Set(incoming.filter(e => lastOut[e.from.node] == null).map(e => e.from.node))];
  const inputs = foldEdgeInputs({ ...n.seedInputs }, incoming, id => lastOut[id], null,
    原值口(n, await portsOf(n), id => cur.nodes.find(x => x.id === id)?.kind));
  const 缺 = missing.map(id => cur.nodes.find(x => x.id === id)?.title || id).join('、');
  const r = el?.querySelector('.wf-node-result');
  if (el) {
    el.classList.remove('run-done', 'run-error');
    el.classList.add('run-active');
    el.querySelector('.wf-node-dur')?.remove();
  }
  if (r) {
    r.style.display = 'block';
    r.innerHTML = '<span class="sm">● 单跑中…'
      + (missing.length ? ' (上游 ' + esc(缺) + ' 无现成输出, 对应输入缺省)' : '') + '</span>';
  }
  curRec = curRec || { id: uid('solo_'), workflowId: cur.id || null, source: 'single-node', name: cur.name,
    workflow: cur, status: 'done', events: [], outputs: null, error: null, startedAt: Date.now(),
    finishedAt: null };
  const single = { name: '单跑·' + (n.title || n.id), edges: [],
    nodes: [{ ...n, disabled: false, seedInputs: inputs }],   // 停用的也照跑: 是人点名要跑它
    runConfig: cur.runConfig };
  const res = await Eph.run(single, {
    source: 'single', noHistory: true, noOutcome: true,
    onEvent: ev => {   // 每次现找卡片: 长节点会重画画布, 早先拿到的卡片已经摘掉了
      if (ev.type === 'node:done') {
        applyNodeDoneUI(卡(ev.nodeId), ev);
        curRec.events.push(ev);
        if (ev.picked?.startsWith('⚠')) toast(ev.picked);   // 换了厂商: 说一声换成谁
      }
      else if (ev.type === 'node:error') applyNodeErrorUI(卡(ev.nodeId), 错话(ev));
      else if (ev.type === 'workflow:error') applyNodeErrorUI(卡(n.id), (ev.errors || []).join('; '));
      else if (ev.type === 'graph:patch') {
        curRec.events.push(ev);
        自动改(() => (patchIntoGraph(cur, ev), autoLayout(cur)));
        renderCanvas();
      }
    }
  });
  const 完 = 卡(n.id), 卡r = missing.length && 完?.classList.contains('run-done')
    && 完.querySelector('.wf-node-result');
  if (卡r) 卡r.insertAdjacentHTML('afterbegin', '<div class="sm">⚠ 上游 ' + esc(缺) + ' 还没有输出, 这次按空输入跑的</div>');
  if (res && res.id) return Eph.remove(res.id);   // 用完就清
  if (!res || !res.error) return;
  el?.classList.remove('run-active');
  toast('单跑失败: ' + (res.error || []).join('; '));
}
// ═ 回放 · 跟着: 小工具, 工作室外壳, 工作流列表, 画布交互, 画节点与连线, 整理布局, 结果查看, 跑起来看 ═
// 打开或切回工作流时, 照运行记录把节点颜色、输出、耗时、日志、长出来的节点、运行键都还原
function mergePatchEvents(rec) {   // 记录里长出过节点: 合进画布并重新分层
  自动改(() => {
    for (const e of rec.events) if (e.type === 'graph:patch') patchIntoGraph(cur, e);
    if (rec.events.some(e => e.type === 'graph:patch')) autoLayout(cur);
  });
}
function replayHighlight(rec) {   // 每个节点按它最后一个事件上色; 回还在跑的那些(连线高亮和运行键要用)
  const last = {}, active = new Set();   // 运行结束了就没有在跑的: 停用的、被判断剪掉的最后一个事件停在排队
  const 在跑 = t => rec.status === 'running' && (t === 'node:start' || t === 'node:queued');
  for (const e of rec.events) if (e.nodeId) last[e.nodeId] = e.type;
  for (const id of Object.keys(last)) if (在跑(last[id])) active.add(id);
  studio.querySelectorAll('.wf-node').forEach(el => {
    const t = last[el.dataset.nodeId];
    el.classList.toggle('run-done', t === 'node:done');
    el.classList.toggle('run-error', t === 'node:error');
    el.classList.toggle('run-active', 在跑(t));
  });
  return active;
}
// 每个节点最后一次跑完的输出、出错的原话填回卡片; 开了跑没跑完的写在跑 / 已停止 / 没跑完(颜色归 replayHighlight 定)
function replayNodeOutputs(rec) {
  if (!rec || !studio) return;
  const last = {}, 话 = { running: '● 运行中…', cancelled: '■ 已停止' }[rec.status] || '■ 没跑完(别的节点出错)';
  for (const e of rec.events || []) if (/^node:(start|done|error)$/.test(e.type)) last[e.nodeId] = e;
  for (const [nid, ev] of Object.entries(last)) {
    const el = 卡(nid), r = el?.querySelector('.wf-node-result');
    if (!el) continue;
    if (ev.type === 'node:error') { applyNodeErrorUI(el, 错话(ev)); continue; }
    if (ev.type === 'node:start') {
      if (r) { r.style.display = 'block'; r.innerHTML = '<span class="sm">' + 话 + '</span>'; }
      continue;
    }
    el.__out = ev.outputs;
    if (r) renderNodeResult(r, ev.outputs);
    setDur(el, ev.duration);
  }
}
function replayNodes(rec) {   // 节点卡: 颜色、输出、出错原话、耗时; 回还在跑的。画布重画后也调(不动日志、运行键、端口)
  const active = replayHighlight(rec);
  replayNodeOutputs(rec);
  return active;
}
function replayRunUI(rec) {
  if (!rec || !studio) return;
  const active = replayNodes(rec), log = studio.querySelector('#wf-log');
  slimPorts({ ...cur, edges: cur?.edges || rec.workflow?.edges || [] });   // 回放时也收起没用到的端口
  let h = '', n = 0, err = false;
  for (const e of rec.events || []) {
    const lf = logFor(e);
    if (!lf) continue;
    h += `<div class="log-line${lf.c ? ' ' + lf.c : ''}">${esc(lf.t)}</div>`;
    n++;
    if (lf.c === 'error') err = true;
  }
  const body = logShell(log);
  body.innerHTML = h;
  log.style.display = h ? 'block' : 'none';
  body.scrollTop = body.scrollHeight;
  logCount(log, n, err);
  highlightRunEdges(active);
  if (rec.status !== 'running') return setRunning(false);
  setRunning(true, rec.startedAt ? Date.now() - rec.startedAt : null, active.size);
}
// ═ 成果抽屉 · 跟着: 小工具, 运行记录, 资产与成果, 样式, 工作室外壳, 工作流列表, 结果查看 ═
// 画布右边的抽屉: 平时只露一个小把手, 点开是历次最终产出的网格(本工作流/全部、按类型筛); 选几件点两下删、单件下载、
// ⤓ 把远程网址取回来永久保存(借次元口袋的 data.get)、运行后自动保存、🧹 点两下清掉没人用的素材。最宽占画布四成
样式.push(`
.wf-outdrawer{position:absolute;top:0;right:0;height:100%;width:40%;display:flex;justify-content:flex-end;
align-items:flex-start;z-index:7;pointer-events:none}
.wf-od-tab{pointer-events:auto;margin-top:14px;background:var(--bg-2);border:1px solid var(--border);
border-right:none;border-radius:9px 0 0 9px;padding:8px 5px;cursor:pointer;font-size:14px;opacity:.4;
transition:opacity .15s}.wf-od-tab:hover,.wf-outdrawer.open .wf-od-tab{opacity:1}
.wf-od-body{pointer-events:auto;width:0;overflow:hidden;height:100%;background:var(--bg-2);
border-left:1px solid var(--border-strong);transition:width .18s ease;box-sizing:border-box;display:flex;
flex-direction:column}.wf-outdrawer.open .wf-od-body{width:340px;box-shadow:-8px 0 24px rgba(0,0,0,.32)}
.wf-od-h{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--accent);font-family:var(--mono);
padding:9px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
.wf-od-h>span:first-child{margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.wf-od-fix,.wf-od-selbtn{background:var(--surface);border:1px solid var(--border);color:var(--text-muted);
border-radius:6px;padding:3px 6px;font-size:10px;cursor:pointer;font-family:var(--mono)}
.wf-od-selbtn{padding:3px 8px;font-size:11px;flex-shrink:0}
.wf-od-fix:hover,.wf-od-selbtn:hover,.wf-outdrawer.selmode .wf-od-selbtn{color:var(--accent);
border-color:var(--accent)}
.wf-od-auto{display:flex;align-items:center;gap:3px;font-size:10px;color:var(--text-muted);cursor:pointer}
.wf-od-auto input{margin:0;cursor:pointer}.wf-od-x{cursor:pointer;color:var(--text-dim);font-size:13px}
.wf-od-x:hover{color:var(--text)}
.wf-od-bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);
flex-shrink:0}
.wf-od-bar select{flex:1;min-width:0;background:var(--bg);border:1px solid var(--border);color:var(--text);
border-radius:6px;padding:3px 5px;font-size:11px}
.wf-od-grid{padding:10px;overflow:auto;flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;
grid-auto-rows:150px;gap:8px;align-content:start}
.wf-od-cell{border-radius:8px;overflow:hidden;cursor:pointer;background:var(--bg);
border:1px solid var(--border);display:flex;align-items:center;justify-content:center;position:relative}
.wf-od-cell:hover{border-color:var(--accent)}.wf-od-cell.fixed{border-color:var(--wf-line)}
.wf-od-cell.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wf-od-cell img,.wf-od-cell video{width:100%;height:100%;object-fit:contain;display:block}
.wf-od-cell audio{width:100%}
.wf-od-dl{position:absolute;top:4px;right:4px;background:rgba(0,0,0,.55);border-radius:6px;padding:1px 5px;
font-size:12px;color:#eee;opacity:0;transition:opacity .12s}.wf-od-cell:hover .wf-od-dl{opacity:1}
.wf-od-dl:hover{color:var(--accent)}
.wf-od-ck{display:none;position:absolute;top:4px;left:4px;width:16px;height:16px;border-radius:50%;
border:2px solid #fff;background:rgba(0,0,0,.45);box-shadow:0 0 3px rgba(0,0,0,.6)}
.wf-outdrawer.selmode .wf-od-ck{display:block}
.wf-od-cell.sel .wf-od-ck{background:var(--accent);border-color:var(--accent)}
.wf-outdrawer.selmode .wf-od-dl{display:none}
.wf-od-meta{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.72));
color:#f0f0f0;font-size:9px;line-height:1.25;padding:9px 5px 3px;white-space:nowrap;overflow:hidden;
text-overflow:ellipsis;pointer-events:none}
.wf-od-selbar{display:none;align-items:center;gap:8px;padding:7px 10px;border-top:1px solid var(--border);
font-size:11px;color:var(--text-muted);flex-shrink:0}.wf-outdrawer.selmode .wf-od-selbar{display:flex}
.wf-od-selbar .sp{flex:1}.wf-od-del{color:var(--danger);cursor:pointer}
.wf-od-del:hover{text-decoration:underline}.wf-od-selall,.wf-od-selcancel{cursor:pointer}
.wf-od-selall:hover,.wf-od-selcancel:hover{color:var(--text)}
.wf-od-empty{color:var(--text-dim);font-size:11px;padding:16px 12px;line-height:1.6;grid-column:1/-1}`);
const odState = { scope: 'this', type: '', sel: false, selKeys: new Set() };   // 看哪些(本工作流/全部、类型)、在不在选、选了哪些
let odFlat = [];   // 现在网格里的成果, 按 data-i 的序号取
// 成果的类型: 图音视频以外的(文本、PDF 这些大文件)算「文件」; 老记录里记成 image 的按 mimeType 认回来
const 成果类 = v => v.mimeType && !/^(image|audio|video)\//.test(v.mimeType) ? 'file' : v.type || 'image';
function wireDrawer() {
  const d = document.createElement('div'), q = s => d.querySelector(s);
  d.className = 'wf-outdrawer';
  d.id = 'wf-outdrawer';
  d.innerHTML = `<div class="wf-od-tab" title="工作流成果">🖼</div><div class="wf-od-body">
<div class="wf-od-h"><span>工作流成果</span>
<button class="wf-od-fix" title="把远程链接的成果取回来永久保存(远程签名链接会过期)">⤓永久保存</button>
<button class="wf-od-fix wf-od-gc" data-two="再点清理" title="清掉没人用的素材: 运行记录、成果、工作流和别的块都没提到的资产(不可恢复)">🧹</button>
<label class="wf-od-auto" title="运行后自动把远程成果永久保存"><input type="checkbox" class="wf-od-autochk">自动</label>
<span class="wf-od-x">✕</span></div><div class="wf-od-bar"><select class="wf-od-scope">
<option value="this">本工作流</option><option value="all">全部工作流</option></select><select class="wf-od-type">
<option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option>
<option value="audio">音频</option>
<option value="file">文件</option></select><button class="wf-od-selbtn" title="进入选择模式, 批量删除">选择</button></div>
<div class="wf-od-grid"></div><div class="wf-od-selbar"><span class="wf-od-selall">全选</span>
<span class="sp"></span><span class="wf-od-selcount">已选 0</span><span class="wf-od-del">删除</span>
<span class="wf-od-selcancel">取消</span></div></div>`;
  studio.querySelector('.wf-canvas-wrap').appendChild(d);
  const 选 = on => {
    odState.sel = on;
    d.classList.toggle('selmode', on);
    if (!on) odState.selKeys.clear();
    loadOutDrawer();
  };
  q('.wf-od-tab').onclick = () => { if (d.classList.toggle('open')) loadOutDrawer(); };
  q('.wf-od-x').onclick = () => d.classList.remove('open');
  q('.wf-od-fix').onclick = archiveWorkflowAssets;
  q('.wf-od-gc').onclick = async () => {   // 点两下才到这里
    const r = await gcAssets();
    toast(r.n ? '已清掉 ' + r.n + ' 份没人用的素材, 腾出 ' + (r.b / 1024).toFixed(1) + ' KB' : '没有没人用的素材');
  };
  q('.wf-od-autochk').onchange = e => {
    ctx.kv.set('settings:workflow.archiveAssets', e.target.checked).catch(() => { });
    toast(e.target.checked ? '已开启: 运行后自动永久保存成果' : '已关闭自动保存');
  };
  for (const k of ['scope', 'type']) {
    const s = q('.wf-od-' + k);
    s.value = odState[k];
    s.onchange = () => { odState[k] = s.value; loadOutDrawer(); };
  }
  q('.wf-od-selbtn').onclick = () => 选(!odState.sel);
  q('.wf-od-selall').onclick = selectAllOutputs;
  q('.wf-od-del').onclick = deleteSelectedOutputs;
  q('.wf-od-selcancel').onclick = () => 选(false);
}
function refreshDrawerIfOpen() { if (studio?.querySelector('#wf-outdrawer.open')) loadOutDrawer(); }
function updateSelbar() {   // 选了几件; 选了才要点两下删
  const c = studio?.querySelector('.wf-od-selcount'), n = odState.selKeys.size;
  if (!c) return;
  const del = studio.querySelector('.wf-od-del');
  c.textContent = '已选 ' + n;
  if (n) del.dataset.two = `再点删除 ${n} 件(不可恢复)`; else delete del.dataset.two;
  if (del.原 != null && del.textContent !== del.dataset.two) { clearTimeout(del.两); 复原(del); }
}
function selectAllOutputs() {   // 全都选了就全不选
  const all = odFlat.length && odFlat.every(it => odState.selKeys.has(it._key));
  if (all) odState.selKeys.clear(); else odFlat.forEach(it => odState.selKeys.add(it._key));
  studio?.querySelectorAll('#wf-outdrawer .wf-od-cell').forEach(el => {
    const it = odFlat[+el.dataset.i];
    el.classList.toggle('sel', !!it && odState.selKeys.has(it._key));
  });
  updateSelbar();
}
async function deleteSelectedOutputs() {   // 连本地缓存的资产一起删(别的成果还用着的资产不删)
  const keys = [...odState.selKeys];
  if (!keys.length) return toast('还没选中任何成果');
  const n = await delOutputs(keys);
  odState.selKeys.clear();
  toast('已删除 ' + n + ' 件成果');
  loadOutDrawer();
}
// 本工作流一件成果都没有时说的话: 照画布上这次运行实说(单跑不算跑过); 没跑过才叫人跑一次。没存的成果存时才改挂过来
function 空着说() {
  const 看 = cur && !ephView, r = 看 && curRec?.source !== 'single-node' ? curRec : null, 没存 = 看 && !cur.id;
  if (!r) return 没存 ? '跑一次、保存后, 成果会出现在这里。' : '这个工作流还没有成果。<br>跑一次, 最终产出会出现在这里。';
  if (r.status === 'running') return 没存 ? '正在跑。跑完保存后, 成果会归到这个工作流。' : '正在跑, 跑完的成果会出现在这里。';
  if (r.status !== 'done') return '这次没跑完, 没出成果。';
  if (!Runs.collect(r.outputs).length) return '这次只跑出了文字或数据, 不进抽屉(这里只收图、音频、视频和大文件)。';
  return 没存 ? '保存后, 这次跑出的成果会归到这个工作流。' : '这次跑出的成果已不在这里(可能删掉了)。';
}
async function loadOutDrawer() {
  const grid = ctx.kv && studio?.querySelector('#wf-outdrawer .wf-od-grid'), st = odState, wid = cur?.id;
  if (!grid) return;
  const chk = studio.querySelector('.wf-od-autochk');
  try { chk.checked = await Assets.archiveOn(); } catch (e) { }
  let items = (await ctx.kv.list('wfout:').catch(() => [])).map(r => ({ _key: r.key, ...r.value }))
    .filter(v => v && (v.src || v.url || v.__wfasset));
  if (st.scope === 'this') items = items.filter(v => v.workflowId === wid);
  if (st.type) items = items.filter(v => 成果类(v) === st.type);
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  odFlat = items;
  for (const k of st.selKeys) if (!items.some(it => it._key === k)) st.selKeys.delete(k);
  if (!items.length) {
    grid.innerHTML = '<div class="wf-od-empty">' + (st.type ? '没有这一类的成果。' : st.scope !== 'this'
      ? '还没有任何工作流成果。' : 空着说()) + '</div>';
    return updateSelbar();
  }
  for (const it of items) {   // 永久保存过的用资产里的那份
    it._disp = (it.__wfasset && await Assets.get(it.__wfasset).catch(() => null)) || it.src || it.url || '';
  }
  grid.innerHTML = items.map((it, i) => {   // 两列正方格, 格子底下常显来源(工作流名 · 时间)
    const 存 = it.__wfasset ? (it._disp ? ' · 已保存' : ' · 资产已丢失(可能在次元口袋里删了)')
      : /^data:/.test(it.src || '') ? ' · 已在本机' : ' · 远程链接(可能过期)';
    const 来源 = ' · ' + 时刻(it.createdAt);
    return `<div class="wf-od-cell${it.__wfasset ? ' fixed' : ''}${st.selKeys.has(it._key) ? ' sel' : ''}"`
      + ` data-i="${i}" title="${esc((it.workflowName || '') + 来源 + 存)}"><span class="wf-od-ck"></span>`
      + `<span class="wf-od-dl" data-dl="${i}" title="下载到本机">⬇</span>`
      + `<span class="wf-od-meta">${esc((it.workflowName || '工作流') + 来源)}</span></div>`;
  }).join('');
  grid.querySelectorAll('.wf-od-cell').forEach(el => {
    const it = odFlat[+el.dataset.i];
    el.prepend(媒体(成果类(it), it._disp, false));
    el.onclick = () => {   // 选择模式下点 = 勾上/去掉, 平时点 = 看大图
      if (!odState.sel) {
        const 看 = 成果类(it) === 'file' && it.__wfasset   // 文件给资产引用: 大窗画成文件格
          ? { __wfasset: it.__wfasset, mimeType: it.mimeType } : it._disp;
        if (it._disp) openResultInspector(it.workflowName || '工作流成果', { [it.name || 'output']: 看 });
        else toast('这件成果的资产已丢失或被清理');
        return;
      }
      if (odState.selKeys.has(it._key)) odState.selKeys.delete(it._key); else odState.selKeys.add(it._key);
      el.classList.toggle('sel');
      updateSelbar();
    };
  });
  grid.querySelectorAll('.wf-od-dl').forEach(el => el.onclick = e => {
    e.stopPropagation();
    下载成果(+el.dataset.dl);
  });
  updateSelbar();
}
// 远程网址取不回来的原因: 有次元口袋(data.get)多半是对方没开跨域; 没有(单独打开、口袋禁用)就是没处去取
const 取不回 = () => {
  const 码 = (/^HTTP (\d+)/.exec(Assets.错 || '') || [])[1];
  return !colony.has('data.get') ? '没有次元口袋(data.get)代取远程文件'
    : 码 ? '对方回 ' + 码 + '(链接可能已过期)' : '多为跨域 CORS 限制(图片站未开放跨域读取)';
};
const 扩展名 = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'text/plain': 'txt',
  'text/markdown': 'md', 'application/pdf': 'pdf', 'application/json': 'json', 'text/csv': 'csv' };
async function 下载成果(i) {   // data 网址直接下; 远程的先永久保存再下, 取不回就在新页打开
  const it = odFlat[i];
  if (!it) return;
  let src = it._disp;
  if (!src && !(it.src || it.url)) return toast('这件成果的资产已丢失或被清理, 下不了');
  if (!/^data:/.test(src || '')) {
    const a = await Assets.archive(it.src || it.url, it.mimeType);
    if (!a) {
      window.open(it.src || it.url, '_blank');
      return toast('取不回: ' + 取不回() + '。已在新页打开, 可右键另存(远程链接可能过期)');
    }
    const clean = { ...it, __wfasset: a.__wfasset };
    delete clean._key;
    delete clean._disp;
    try { await ctx.kv.set(it._key, clean); } catch (err) { console.warn('[workflow] 成果保存落盘失败:', err); }
    it.__wfasset = a.__wfasset;
    src = await Assets.get(a.__wfasset).catch(() => it.src || it.url);
    refreshDrawerIfOpen();
  }
  try {
    const mime = (/^data:([^;,]+)/.exec(src) || [])[1] || it.mimeType || 'application/octet-stream';
    const ext = 扩展名[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
    const bin = atob(String(src).split(',')[1]);
    const u = URL.createObjectURL(new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))], { type: mime }));
    const a2 = document.createElement('a');
    a2.href = u;
    a2.download = ((it.workflowName || '成果') + '-' + (i + 1) + '.' + ext).replace(/[\\/:*?"<>|]/g, '_');
    a2.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  } catch (err) { toast('下载失败: ' + err.message); }
}
async function archiveWorkflowAssets() {   // ⤓ 永久保存: 这个工作流成果里的远程网址取回来存成资产
  if (!ctx.kv) return;
  const wid = cur && cur.id, rows = await ctx.kv.list('wfout:').catch(() => []);
  const todo = rows.filter(r => r.value && !r.value.__wfasset && /^https?:\/\//.test(r.value.src || '')
    && (odState.scope === 'all' || r.value.workflowId === wid));   // 按抽屉选的范围; 没存过的工作流没有成果
  if (!todo.length) return toast('没有需要保存的远程成果(或都已永久保存)');
  toast('保存中… ' + todo.length + ' 项');
  let ok = 0;
  for (const r of todo) {
    const a = await Assets.archive(r.value.src, r.value.mimeType);
    if (a) { try { await ctx.kv.set(r.key, { ...r.value, __wfasset: a.__wfasset }); ok++; } catch (e) { } }
  }
  toast(ok ? '已永久保存 ' + ok + '/' + todo.length + ' 项' : '保存失败: ' + 取不回() + ' — 可点单项 ⬇ 在新页打开另存');
  refreshDrawerIfOpen();
}
// ═ 展开与收拢 · 跟着: 小工具, 节点应用, 存储, 打包成节点, 工作室外壳, 画节点与连线, 背景板 ═
// ▣ 节点原地展开成背景板(记着 packId 和 idmap), 板头 ▣ 收拢回节点(改动写回子工作流), ✕ 取消板 = 留成普通节点。
// 子工作流和 ▣ 小应用都不删(别处可能还在用)
const 换边 = (e, map) => Object.assign({ from: { node: map[e.from.node], port: e.from.port },
  to: { node: map[e.to.node], port: e.to.port } }, e.label ? { label: e.label } : {});
async function unpackNode(n) {
  const m = await Apps.get(n.miniappId), pack = m && m.pack;
  if (!pack) return toast('这不是打包节点');
  const sub = await 存储.get(pack.workflowId);
  if (!sub) return toast('子工作流已不在: ' + pack.workflowId);
  const ren = {}, taken = new Set(cur.nodes.map(x => x.id));
  for (const sn of sub.nodes) {   // 和画布上撞 id 的改名
    let nid = sn.id, i = 2;
    while (taken.has(nid)) nid = sn.id + '_' + (i++);
    taken.add(ren[sn.id] = nid);
  }
  const minX = Math.min(...sub.nodes.map(s => s.x || 0)), minY = Math.min(...sub.nodes.map(s => s.y || 0));
  const placed = sub.nodes.map(sn => Object.assign(clone(sn), { id: ren[sn.id],
    x: (n.x || 0) + (sn.x || 0) - minX, y: (n.y || 0) + (sn.y || 0) - minY }));
  const es = cur.edges = cur.edges || [];
  cur.nodes.push(...placed);
  for (const se of sub.edges || []) es.push(换边(se, ren));
  for (const e of es) {   // 接在包上的线改接回里面那个节点
    const mm = e.to.node === n.id && (pack.inputs || []).find(x => x.port === e.to.port);
    if (mm && ren[mm.node]) e.to = { node: ren[mm.node], port: mm.toPort || undefined };
    const om = e.from.node === n.id && (sub.outputs || []).find(o => o.name === e.from.port);
    if (om && ren[om.from.node]) e.from = { node: ren[om.from.node], port: om.from.port };
  }
  cur.groups = cur.groups || [];
  cur.groups.push(Object.assign({ id: uid('grp_'), title: '▣ ' + (n.title || m.name || '打包'),
    c: cur.groups.length % GROUP_COLORS.length, packId: n.miniappId,
    idmap: Object.fromEntries(Object.entries(ren).map(([s, c]) => [c, s])) }, 框住(placed)));   // 画布 id → 子图 id
  deleteNodes(new Set([n.id]));
  toast('已展开成背景板: 板头 ▣ 收拢回节点(改动写回), ✕ 取消板=彻底还原');
}
// 收拢: 板里现在的样子写回子工作流, 跨板的线照打包时的端口接回 ▣ 节点; 多了打包时没有的跨板线就照实拒绝并指路
async function collapsePackGroup(g) {
  const m = await Apps.get(g.packId), pack = m && m.pack;
  if (!pack) return toast('▣ 节点定义已不在, 无法收拢(点 ✕ 保留为普通节点)');
  const sub = await 存储.get(pack.workflowId);
  if (!sub) return toast('子工作流已不在: ' + pack.workflowId);
  const idmap = g.idmap || {};
  const ids = new Set(Object.keys(idmap).filter(id => cur.nodes.some(x => x.id === id)));
  if (!ids.size) return toast('板内已无打包成员, 点 ✕ 取消背景板即可');
  const es = cur.edges || [], fix = [], same = (a, b) => String(a || '') === String(b || '');
  for (const e of es) {
    const ti = ids.has(e.to.node);
    if (ids.has(e.from.node) === ti) continue;
    const hit = ti ? (pack.inputs || []).find(x => x.node === idmap[e.to.node] && same(x.toPort, e.to.port))
      : (sub.outputs || []).find(o => o.from && o.from.node === idmap[e.from.node]
        && same(o.from.port, e.from.port));
    if (!hit) return toast('收拢失败: ' + (ti ? '外部→板内' : '板内→外部') + '出现了打包时没有的连线'
      + ' — 重新框选打包, 或点 ✕ 保持展开');
    fix.push(ti ? [e, 'to', hit.port] : [e, 'from', hit.name]);
  }
  const inner = cur.nodes.filter(x => ids.has(x.id));
  const bx = Math.min(...inner.map(x => x.x || 0)), by = Math.min(...inner.map(x => x.y || 0));
  sub.nodes = inner.map(x => {
    const c = Object.assign(clone(x), { id: idmap[x.id], x: (x.x || 0) - bx, y: (x.y || 0) - by });
    delete c._spawnedBy;
    return c;
  });
  sub.edges = es.filter(e => ids.has(e.from.node) && ids.has(e.to.node)).map(e => 换边(e, idmap));
  await 存储.save(sub);
  cur.groups = (cur.groups || []).filter(x => x.id !== g.id);
  换成包(ids, { id: uid('pack_'), miniappId: g.packId, x: (g.x || 0) + 30, y: (g.y || 0) + 46,
    params: {}, title: m.name }, fix);
  toast('已收拢回 ▣ 节点(板内改动已写回子工作流)');
}
// ═ 背景板 · 跟着: 小工具, 工作室外壳, 画节点与连线 ═
// 背景板只是画布上的分区(引擎不管): 框选生成, 拖板头连里面的节点一起移, 双击标题改名, ✕ 取消。存在 wf.groups
const GROUP_COLORS = ['rgba(181,255,0,', 'rgba(0,184,255,', 'rgba(255,149,0,', 'rgba(157,78,221,'];
const 框住 = ns => {   // 圈住这些节点的板: 左上让出板头, 右下贴着卡片真实的大小(量不到按 172×112)
  const xs = ns.map(n => n.x || 0), ys = ns.map(n => n.y || 0);
  const 右 = ns.map(n => (n.x || 0) + (卡(n.id)?.offsetWidth || 172));
  const 下 = ns.map(n => (n.y || 0) + (卡(n.id)?.offsetHeight || 112));
  const x = Math.min(...xs) - 30, y = Math.min(...ys) - 46;
  return { x, y, w: Math.max(...右) + 20 - x, h: Math.max(...下) + 16 - y };
};
function makeGroup() {
  const ns = cur.nodes.filter(n => selected.has(n.id));
  if (!ns.length) return toast('先框选节点');
  cur.groups = cur.groups || [];
  cur.groups.push(Object.assign({ id: uid('grp_'), title: '分区 ' + (cur.groups.length + 1),
    c: cur.groups.length % GROUP_COLORS.length }, 框住(ns)));
  selected.clear(); renderCanvas();
}
// ═ 对外能力 · 跟着: 小工具, 节点应用, 检查图, 运行记录, 资产与成果, 存储, 运行跑道, 动态扩图, AI 模态, 节点模型, 节点目录, 打包成节点, 运行器, 工作室外壳, 工作流列表 ═
// workflow.* 能力: 做法、说明、参数形状写在一处(不带 ? 的必填, Stem 代为校验), 怎么用写在技能段。
// 隔离窗里的节点和小应用也能调, meta.context 带着调用方的 workflowId、nodeId、深度
const 登 = (name, fn, desc, schema, common) => ctx.provide('workflow.' + name, fn, { desc, schema, common });
const WF = { name: 'string?',
  nodes: '[{id, kind?, miniappId?, params?, ports?, seedInputs?, title?, onError?, x?, y?}]',
  edges: '[{from:{node,port?}, to:{node,port?}, label?}]?', initialInputs: 'object?', runConfig: 'object?' };
const 要图 = (w, 名) => {   // nodes 不是数组: 说清形状, 不存不跑(Stem 只查有没有、不查类型)
  if (!Array.isArray(w?.nodes)) throw new Error('workflow.' + 名 + ' 要 nodes 是数组: ' + WF.nodes);
};
const 即焚跑 = async (a, meta) => {   // 图里嵌套的调用(节点里调的)不许后台跑
  要图(a, 'runEphemeral');
  const c = meta?.context || {}, bg = (a.detach || a.detached) && !c._wfDepth, name = a.name || '(未命名)';
  a = Object.assign({}, a);
  delete a.detach;
  delete a.detached;
  if (!bg) return Eph.run(a, { depth: (c._wfDepth || 0) + 1, chain: c._wfChain || [] });
  const rid = uid('eph_');
  bgRun(name, Eph.run(a, { depth: 1, chain: [], id: rid }), rid, meta);
  return { ok: true, detached: true, name, runId: rid, hint: BG_HINT };
};
const 取包 = async (a, meta) => {   // 打包节点的记录: appId 不给就认调用它的那个 ▣ 应用
  const id = a.appId || meta?.context?.miniappId, app = await Apps.get(id);
  return app?.pack?.workflowId ? { app } : { ok: false, error: '不是打包节点: ' + id };
};
登('catalog', () => 门面.catalog(), '搭工作流前先看: 可用节点(AI 节点七模态、节点应用、打包节点)、内建 kind、各模态现在会用的模型',
  {}, true);
登('debugRun', async (a, meta) => {
  要图(a.workflow, 'debugRun 的 workflow');
  const wf = Object.assign({}, a.workflow, { initialInputs: a.inputs || a.workflow.initialInputs || {} });
  if (a.detach) {
    const rid = uid('eph_');
    bgRun(wf.name || '(未命名)', Eph.run(wf, { source: 'debug', id: rid }), rid, meta);
    return { ok: true, detached: true, name: wf.name || '', runId: rid, hint: BG_HINT + '; 别原地等' };
  }
  const r = await Eph.run(wf, { source: 'debug', noHistory: true });
  if (!r.id) return { status: 'error', events: [], outputs: null, errors: r.error || ['运行没启动'] };
  const events = Eph.get(r.id)?.events.slice() || [], n = t => events.filter(e => e.type === t).length;
  const spawned = events.reduce((s, e) => s + (e.type === 'graph:patch' ? (e.addNodes || []).length : 0), 0);
  Eph.remove(r.id);
  const summary = [r.status === 'done' ? '✓ 完成' : '✗ ' + r.status, n('node:done') + ' 节点跑完',
    spawned && '自生长 ' + spawned + ' 节点', n('node:error') && n('node:error') + ' 节点报错',
    '成果 ' + Object.keys(r.outputs || {}).length + ' 项'];
  return { status: r.status, summary: summary.filter(Boolean).join(' · '), events, outputs: r.outputs,
    errors: r.error };
}, '试跑一个工作流(不进历史): 回 {status, summary, events, outputs, errors}; detach:1 后台跑',
  { workflow: 'object(同 runEphemeral)', inputs: 'object?', detach: 'boolean?' }, true);
登('runEphemeral', 即焚跑, '即焚跑一个工作流(进历史和成果): 回 {id, status, outputs, error}; detach:1 后台跑, 立刻回 runId',
  Object.assign({ detach: 'boolean?' }, WF));
登('patchGraph', (a, meta) => Eph.patchGraph(Object.assign({ workflowId: meta?.context?.workflowId,
  sourceNodeId: meta?.context?.nodeId }, a)), '给在跑的工作流加节点和边: 回 {ok, patchId, added}; patchId 幂等',
  { workflowId: 'string?', addNodes: 'array?', addEdges: 'array?', patchId: 'string?', reason: 'string?' });
登('cancelRun', a => Eph.cancelRun(a.id), '停止一次运行(立刻焚掉在途节点)', { id: 'string' });
登('save', async a => {
  要图(a, 'save');
  const w = clone(a);
  try { await AI.pin(w.nodes); } catch (e) { }
  const v = await Engine.validate(w), s = await 存储.save(w);
  return { id: s.id, name: s.name, ok: v.ok, warnings: v.errors };
}, '存一个工作流(有 id 就覆盖): 回 {id, name, ok, warnings}; 不拦草稿, 空着的媒体 AI 节点存时定型模型',
  Object.assign({ id: 'string?' }, WF));
登('list', async () => (await 存储.list()).map(w => ({ id: w.id, name: w.name, nodeCount: w.nodes.length,
  updatedAt: w.updatedAt })), '列存着的工作流', {});
登('get', async a => {
  const w = await 存储.get(a.id);
  if (!w) throw new Error('没有这个工作流: ' + a.id);
  return w;
}, '读一个工作流的完整定义', { id: 'string' });
登('remove', async a => {
  await 删掉工作流(a.id, 1);   // 正开在画布上的同左栏 ✕ 一样清掉
  return { ok: true };
}, '删一个工作流定义(人没存的改动另存一份)', { id: 'string' });
登('open', async a => {   // 库里没了、会话里还有没存的改动的照样开(开时另存)
  if (a.id && !(await 存储.get(a.id)) && !sessions.get(a.id)?.改) throw new Error('没有这个工作流: ' + a.id);
  await Studio.open(a.id);
  return { ok: true, id: a.id };
}, '在工作室画布上打开一个工作流(库里那份; 人没存的改动若库里又改过, 另存成「名字(我的改动)」)',
  { id: 'string?' });
登('listRuns', async a => {
  const mem = Eph.list(), seen = new Set(mem.map(r => r.id));
  if (!a.history) return mem;
  const 落盘 = (await Runs.list()).filter(r => !seen.has(r.id));
  return mem.concat(落盘.map(r => Object.assign(摘要(r), { persisted: true })));
}, '运行列表: 默认内存里的, history:true 带上落盘历史', { history: 'boolean?' });
登('getRun', async a => {
  const r = Eph.get(a.id);
  return r ? Object.assign(Runs.compact(r), r.status === 'running' && { elapsed: Date.now() - r.startedAt })
    : Runs.get(a.id);
}, '一次运行的记录(状态、事件、输出; 还在跑的带 elapsed: 跑了几毫秒)', { id: 'string' });
登('getEvents', async a => Eph.get(a.id)?.events || (await Runs.get(a.id))?.events || null, '一次运行的事件流',
  { id: 'string' });
登('removeRun', async a => { Eph.remove(a.id); await Runs.remove(a.id); 事件.发('runs'); return { ok: true }; },
  '删一条运行记录和它的成果(资产本体留着, 别处可能还引用; 没人用的在成果抽屉 🧹 清)', { id: 'string' });
登('packAsNode', async a => {
  const def = a.workflowId ? await 存储.get(a.workflowId) : a.workflow || null;
  if (!def?.nodes?.length) return { ok: false,
    error: a.workflowId ? '没有这个工作流: ' + a.workflowId : '要 workflowId 或 workflow:{nodes,edges}' };
  const r = await Pack.selection({ nodes: def.nodes, edges: def.edges || [],
    ids: new Set(def.nodes.map(n => n.id)), name: a.name || (def.name ? '包·' + def.name : '') });
  if (!r || r.error) return { ok: false, error: r?.error || '打包失败' };
  return { ok: true, appId: r.app.id, name: r.app.name, subWorkflowId: r.sub.id,
    node: { inputs: r.inPorts, outputs: r.outPorts },
    hint: '已进节点目录: 工作流里写 miniappId:"' + r.app.id + '" 就能当节点; 改子工作流「' + r.sub.name + '」就是改它' };
}, '把一个工作流打包成节点(▣ 小应用, 进节点目录, 桌面打开是运行器)', { workflowId: 'string?', workflow: 'object?', name: 'string?' });
登('runPack', async (a, meta) => {
  const { app, ...没有 } = await 取包(a, meta);
  if (!app) return 没有;
  const def = await Pack.defFor(app.pack, a.inputs || {}, a.ov || null);
  if (a.detach || a.detached) def.detach = 1;
  return 即焚跑(def, meta);
}, '跑一个打包节点(运行器用)', { appId: 'string?', inputs: 'object?', ov: 'object?', detach: 'boolean?' });
登('runnerHtml', async (a, meta) => {
  const { app, error } = await 取包(a, meta);
  if (!app) return { error };
  return { body: Pack.runnerBody(app.name), script: Pack.runnerScript(app.pack, await Pack.uiFor(app)) };
}, '打包节点的运行器界面(▣ 应用的壳开窗时取)', { appId: 'string?' });
登('assetGet', async a => ({ data: await Assets.get(a.id) }), '按资产引用取原件: 回 {data}', { id: 'string' });
// 给节点(隔离窗)的窄口子: 只取 http(s) 媒体网址, 只回图/音/视频的 data 网址; 经次元口袋的 data.get, 用户配的转发照用
登('fetchMedia', async a => {
  if (!/^https?:\/\//.test(a.url || '')) throw new Error('只收 http(s) 网址');
  const r = await ctx.call('data.get', { key: a.url, path: '' });
  if (!/^data:(image|audio|video)\//.test(r?.dataUrl || ''))
    throw new Error('不是媒体或取不到(' + (r?.mimeType || '空') + ')');
  return { data: r.dataUrl, mimeType: r.mimeType };
}, '取一个远程图/音/视频网址成 data 网址(走次元口袋的转发, 绕跨域; 节点应用可调): 回 {data, mimeType}', { url: 'string' });
登('assetSave', a => Assets.save(a.data, a.mimeType, a.name), '存一份 data 网址成资产: 回 {__wfasset, mimeType}',
  { data: 'string', mimeType: 'string?', name: 'string?' });
// ═ 自报 ═
// 把 AI 节点(七模态)、小应用节点、判断/循环/数据串成图, 并行跑、能自生长、能打包成节点; 画布上搭, agent 用 workflow.* 搭
// 数据 {"prefix": "workflow:", "label": "工作流定义", "kind": "data", "edit": "workflow.save"}
// 数据 {"prefix": "wfout:", "label": "工作流成果(最终输出里的图/音/视频)", "kind": "data"}
// 数据 {"prefix": "wfasset:", "label": "节点间传的大媒体(成果会引用它; 删运行时留着, 没人用的在成果抽屉 🧹 清)", "kind": "data"}
// 数据 {"prefix": "wfrun:", "label": "运行历史(只留最近 runKeep 条, 默认 50)", "kind": "cache"}
// 数据 {"prefix": "settings:workflow.", "label": "历史保留量 runKeep、成果自动固化 archiveAssets", "kind": "config"}
// 现在 workflow.list
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【横屏大图】生图要 16:9: grok 类不认 size, 给 ai.image {ratio:'16:9', resolution:'2k'}(AI 配置里本地家已写好改法)
// 【质检门的坑】判断节点的 expr 写在节点顶层(不在 params); 对话节点出 JSON 时把要比的分数起成自定义口(如 min),
//   从这个口连到判断, expr 写 Number(input.value) >= 8.5。运行记录会截断大值(STR_MAX 4000), 要节点的整份输出就 debugRun 直接拿 outputs。
//   一整套例子: 「短剧流水线 · 写稿到配音」(编剧 → 核对∥审稿 → 改稿 → 终审 → 判断 → 配音质检, 不过线再改一轮), 用法见扩展库技能 mini-drama。
// 【搭工作流】搭、改、跑工作流前: 先 workflow.catalog 看节点 id、端口、内建 kind 的参数、各模态现在用哪个模型, 别凭记忆猜。
//   要 AI 能力一律用内置 wfnode-ai(模态是 params.mode), 别自建带大模型的节点; 只有纯数据/纯逻辑的小工具才值得造节点应用。
//   先想清几个节点、怎么连、哪里分叉汇合; 需求模糊就带草图(节点列表+连线一句话)先问用户。
//   常用形: 直线链 / 拆流(对话出 JSON → 拆端口 → N 路并行) / 质检门(产出→打分→condition 分流) / 自生长(grow)
//   / 打包复用(workflow.packAsNode, 别手搓包装应用)。
//   形状照 runEphemeral 的参数; 另有: 节点的 onError(fail|skip|continue)、disabled、timeoutMs, 整个图的 outputs、
//   runConfig{nodeConcurrency, maxNodes, maxDepth, timeoutMs}。每个节点起 title(≤10 字): 画布显示它, 多终端输出按它分键。
//   输入优先级: initialInputs(只给入口) < seedInputs < 入边 < params; 多条入边等上游全跑完再合并。
//   无端口边把上游输出整包合并(JSON 文本自动解析, 非对象收进 value), 带 port 精确对接。
//   终端节点(没有出边)的输出汇成整个工作流的 outputs(多终端按 title 分键, 撞名退回 id); 也可写 outputs:[{name, from}]。
//   判断: 引用的字段全缺会报错并点名实收的键; 输出 {result} 加透传整包; 出边只管放行或剪枝, 必须带 label:"true"/"false";
//   上游连的是单个口时值在 input.value, 这时判断往下游文本这类单个口传原值(代码模态照旧收整包)。
//   素材从源头另拉带端口的边直连下游, 别从判断的透传包里捞。循环: 循环体可以是节点应用或打包节点, 输出 {results, count}。
//   数据: get 回整条记录; update 不给 patchKey 就合并 inputs.patch 或整包, JSON 串自动变结构。
//   先 workflow.debugRun 验图再 save(先看 summary); 单测一个节点 = debugRun 只含它的图。报错按 code 分因:
//   NODE_INVOKE_NOT_EXPOSED(节点没 expose) / NODE_EXEC_TIMEOUT / NODE_INPUT_ERROR(输入形状) /
//   AI_PROVIDER_ERROR(AI 配置或 key) / NODE_RUNTIME_ERROR。
//   要用户看着跑: 先 workflow.open {id} 再 runEphemeral(画布自己上色、滚日志)。
//   把小应用变节点: 记录加顶层 node={inputs, outputs, params, timeoutMs?}(apps.update {id, patch:{node}}),
//   页面里 colony.expose("node:invoke", async ({inputs, params, context}) => ({outputs:{…}}))。最小骨架: 一个 html,
//   只放一段脚本 colony.expose("node:invoke", async ({inputs}) => ({outputs:{result:String(inputs.text || "")}}))。
//   节点里给在跑的图加下游: colony.workflow.patchGraph({addNodes, addEdges})(自动带 workflowId、sourceNodeId,
//   受 maxNodes、maxDepth 限)。
//   预计超 30 秒加 detach:1(和 nodes 同级)立刻回执, 跑完结果会发回对话; 别原地等, 要进度用 workflow.getRun。
// 【AI 节点】工作流要对话/生图/生视频/语音/音乐/代码/自生长时: 生成类不填 model 就照 AI 配置选: 选模型里给这一类选的那家 >
//   默认厂商 > 第一家选了这一类的; 对话不填就是 AI 配置的默认对话模型; 配置不齐会在发请求前报指路错, 照错办。存时空着的生成类节点会被定型。
//   media 口认: data 网址、资产引用 {__wfasset}、http 网址、库里的键(如 "media:<id>", 值带 dataUrl/data 才算)。
//   mode:代码 = 图内确定性算子: params.code 写函数体(收 input=全部输入, return 对象=键名即输出端口; 可 await; 5s;
//   无网络)。提取/计算/拼装用它, 别烧对话节点。
//   生成模型不会「提取」: 从上游 JSON 挑字段用 extras.pick(如 {"pick":["style","shots.0.prompt"]}) 或代码节点。
//   一节点分多路: 对话提示词要求只出 JSON, 节点 ports.outputs 声明同名口 → 自动拆到端口(text 恒为原文)。
//   接线只认已声明的端口: 自定义键要单独接, 先在 ports.outputs 声明; 不想声明就用无端口边整包合并。
//   加输入口: ports.inputs:[{name:"task2", type:"text"}]; 同名的 task*、media* 输入按名序拼接。
//   grow=true 自生长(maxSpawn 封顶), 长出的对话节点跟父节点用同一家; 图形状可预知就自己搭。
//   生视频: media=首帧, media2=尾帧(默认发 last_image, 字段名不同的厂商在 AI 配置填「尾帧字段」);
//   输入口 duration(秒, 1~15)优先于 extras, 让编剧按剧情给每镜秒数。
//   多镜头衔接用「关键帧接力」: N+1 张关键帧, 镜头 i 从帧 i 到帧 i+1。两张大 PNG 会撑爆网关请求体, 节点已自动压成 JPEG;
//   节点应用(隔离窗)取远程媒体用 workflow.fetchMedia {url}(走次元口袋转发), 不能直接调 data.get。
//   生图 prompt 保持精炼(有厂商限 512 字)。
// ═ 装配 · 跟着: 小工具, 运行跑道, 工作室外壳 ═
事件.听('colony:apps', () => Studio.changed('apps'));
事件.听('ai:providers', () => Studio.changed('providers'));
事件.听('runs', () => Studio.changed('runs'));
事件.听('defs', () => Studio.changed('defs'));
ctx.cleanup(() => running.forEach(r => {   // 块重启: 在跑的都停掉
  if (r.status === 'running') try { r.control.abort?.('工作流块重启'); } catch (e) { }
}));
Studio.boot();
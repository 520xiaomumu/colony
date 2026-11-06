'use strict';
// ↦ 借 stem 的 跑块
// ↦ 借 stem 的 键值库
// ═ 工具 ═
// 几样小工具: 转义、指纹、段内编号、从模型的回话里取 JSON 和逐行讲解、「几分钟前」、逐行对比
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const 纹 = s => { // 只判变没变: djb2 + 长度; 段头里导出时系统写的「· 借用者: …」不算改动
  s = String(s ?? '').replace(/^(\/\/ ═ [^\n]*?) · 借用者: [^═\n]*═/, '$1 ═');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16) + s.length.toString(16);
};
const 行纹 = l => 纹(String(l).trim().replace(/\s+/g, ' '));   // 一行的指纹: 挪位置、改缩进不算变
const 虚 = l => /^\s*([{}()[\];,]*|(<\/?\w+>\s*)+|\/\/|\/\*|\*\/)\s*$/.test(l);   // 空行、只有括号或标签的行
// 逐行要讲的行: 除了空行和括号, 纯注释、网页固定的头尾(<html>、<meta>、'use strict')也不讲
const 注行 = l => !虚(l)
  && !/^\s*(\/\/|\/\*|\*|<!--|<!doctype|<\/?(html|head|body|meta)\b|['"]use strict)/i.test(l);
const 编号 = (ls, 起, 要 = l => !虚(l)) => ls.map((l, i) => (起 + i) + (要(l, 起 + i) ? '| ' : '· ') + l).join('\n');
const 取JSON = t => { // 模型爱包 ```json、夹着话: 取第一个 { 到最后一个 }
  t = String(t || '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1) || '回的不是 JSON');
};
const 取讲 = t => { // 逐行的回话: 「图 标 | 起-止 | 话」是讲, 「n| 话」是注; 一条都认不出再按 JSON 取
  const 讲 = [], 注 = [];
  String(t || '').split('\n').forEach(l => {
    const n = l.match(/^\s*[-*]?\s*第?\s*(\d+)\s*行?\s*[|｜:：]\s*(.+)/),
      m = l.match(/^\s*(?:(\S+)\s+)?(.+?)\s*[|｜]\s*(\d+)\s*(?:[-–~]\s*(\d+))?\s*[|｜]\s*(.+)/);
    if (n) 注.push({ 行: +n[1], 话: n[2].trim() });
    else if (m) 讲.push({ 图: m[1] || '💡', 标: m[2], 起: +m[3], 止: +(m[4] || m[3]), 话: m[5].trim() });
  });
  if (讲.length || 注.length) return { 讲, 注 };
  const j = 取JSON(t), 注们 = j.注 || [];
  return { 讲: j.讲 || [], 注: Array.isArray(注们) ? 注们 : Object.entries(注们).map(([k, 话]) => ({ 行: +k, 话 })) };
};
const 时 = t => {
  const s = (Date.now() - t) / 1000 | 0;
  return s < 60 ? '刚才' : s < 3600 ? (s / 60 | 0) + ' 分钟前' : s < 86400 ? (s / 3600 | 0) + ' 小时前'
    : (s / 86400 | 0) + ' 天前';
};
const 行 = s => String(s ?? '').split('\n');
const lineDiff = (A, B) => { // 先剥掉两头一样的行, 中间按最长公共子序列对齐: 插一行不会让后面全算成改了
  let s = 0, ea = A.length, eb = B.length, i = 0, j = 0;
  while (s < ea && s < eb && A[s] === B[s]) s++;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) ea--, eb--;
  const n = ea - s, m = eb - s, same = a => ({ t: ' ', a }), out = A.slice(0, s).map(same);
  if (n * m > 4e6) throw new Error(`两份差得太多(${n} 行对 ${m} 行), 请一段一段比`);
  const T = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--)
    T[x][y] = A[s + x] === B[s + y] ? T[x + 1][y + 1] + 1 : Math.max(T[x + 1][y], T[x][y + 1]);
  while (i < n || j < m) {
    if (i < n && j < m && A[s + i] === B[s + j]) out.push(same(A[s + i++])), j++;
    else if (i < n && (j === m || T[i + 1][j] >= T[i][j + 1])) out.push({ t: '-', a: A[s + i++] });
    else out.push({ t: '+', a: B[s + j++] });
  }
  return out.concat(A.slice(ea).map(same));
};
const 字节 = s => new TextEncoder().encode(s || '').length;
const diffView = (before, after, context) => { // 给 context 就只留改动前后几行, 没变的折成一行
  const rows = lineDiff(before ? before.split('\n') : [], after ? after.split('\n') : []),
    stats = { added: 0, removed: 0 }, o = { stats, bytes: 字节(after) - 字节(before) }, long = [], hunks = [];
  let n = 0, skip = 0;
  rows.forEach(r => { // 只报新加的行里超过 110 字的(第几行按改后算), 老的长行不算
    if (r.t === '-') return stats.removed++;
    n++;
    if (r.t === '+' && ++stats.added && r.a.length > 110) long.push({ line: n, chars: r.a.length });
  });
  if (long.length) o.long = long;
  if (context === undefined) return Object.assign(o, { hunks: rows });
  if (!(context >= 0)) throw new Error('context 要是不小于 0 的数');
  const near = i => rows.slice(Math.max(0, i - context), i + context + 1).some(r => r.t !== ' ');
  rows.concat(null).forEach((r, i) => {
    if (r && !near(i)) return skip++;
    if (skip) hunks.push({ t: '…', a: `略 ${skip} 行没变的` });
    skip = 0;
    if (r) hunks.push(r);
  });
  return Object.assign(o, { hunks });
};
const 听 = (t, f, c) => { // 页面上挂一个监听, 本块卸载时自动摘掉
  document.addEventListener(t, f, c);
  ctx.cleanup(() => document.removeEventListener(t, f, c));
};
const 会话 = (k, v) => { // 本页会话里存一样东西(本块改了会重启, 靠它接着): 不给 v 是读, 读不到回 {}
  try {
    return v ? sessionStorage.setItem(k, JSON.stringify(v)) : JSON.parse(sessionStorage.getItem(k)) || {};
  } catch (e) { return {}; }
};
const 先问 = (b, 话) => { // 点两下才做: 第一下变红字说清后果, 3 秒复原; 回 true = 这是第二下
  if (b.classList.contains('c-sure')) return true;
  const 原 = b.textContent;
  b.classList.add('c-sure');
  if (话) b.textContent = 话;
  setTimeout(() => (b.classList.remove('c-sure'), b.textContent = 原), 3000);
};
// ═ 存储 · 跟着: 工具 ═
// code:* 键唯一的读写口: 每个键在内存里放一份, 各处只改内存, 300 ms 合成一次写; 同一个键排队写, 几段并行讲也不会互相丢
const 存储 = (() => {
  const 份 = new Map(), 脏 = new Set(), 队 = new Map();
  let 钟 = 0;
  const 刷 = () => {
    clearTimeout(钟);
    钟 = 0;
    脏.forEach(k => {
      const v = 份.get(k);
      队.set(k, (队.get(k) || Promise.resolve()).then(() => v == null ? ctx.kv.del(k) : ctx.kv.set(k, v))
        .catch(e => console.warn('[代码解读] 存不上 ' + k, e)));
    });
    脏.clear();
    return Promise.all(队.values());
  };
  return {
    async 读(k) {   // 没有这个键是 undefined; 读库出错照实抛给调用处
      if (!份.has(k)) 份.set(k, await ctx.kv.get(k));
      return 份.get(k);
    },
    改(k, v) {
      份.set(k, v);
      脏.add(k);
      钟 = 钟 || setTimeout(刷, 300);
      return v;
    },
    刷,
  };
})();
// ═ 目标 · 跟着: 工具, 存储 ═
// 四种目标一个写法: stem、块 id、miniapp:<应用 id>、paste:<号>。块 id 自己带冒号, 所以先查是不是块, 再按前缀认。
// 一段 = {名, 起, 止, 文, 借?, 跟着, 头注, 剪, 改过, 出厂文?}: 起、止 是它头尾两行的全局行号, 段里第 k 行(段头算 0)就是全局 起+k
const 目标 = {
  块: [],   // stem.blocks 最近一份
  async 列() { // 单独打开的文件没有 Stem: 只有粘贴的代码; 没有界面块就没有桌面应用
    const bs = colony.单独 ? null : await ctx.call('stem.blocks', {}),
      as = colony.has('apps.list') ? await ctx.call('apps.list', {}) : [];
    目标.块 = (bs || []).filter(b => !b.broken);
    return (bs ? [{ id: 'stem', 组: '内核', 名: 'Stem' }] : [])
      .concat(目标.块.map(b => ({ id: b.id, 组: '块', 名: b.name, 图: b.icon, 用: (b.about || {}).desc,
        停: !b.running, 错: b.enabled && b.error,
        改: b.segs.filter(s => s.use !== 'factory').length })))   // 有改版但没在用的不算
      .concat(as.map(a => ({ id: 'miniapp:' + a.id, 组: '桌面应用', 名: a.name, 图: a.icon })))
      .concat((await ctx.kv.list('code:ver:paste:')).filter(e => e.value && e.value.码 != null)
        .map(e => ({ id: e.key.slice(9), 组: '粘贴的代码', 名: e.value.名 })));
  },
  类: id => 目标.块.some(b => b.id === id) ? '块' : /^miniapp:/.test(id) ? '应用' : /^paste:/.test(id) ? '粘贴' : '块',
  切(code) { // 认法同 Stem 的 mark(检查里两边比), 段头前面几行算「(前言)」; 剪 = 段里的 ✂ 标记 [行号, 名, 是不是收尾]
    const ls = 行(code), 认 = /^\s*\/\/\s*(?:═\s*(.+?)\s*═|↦\s*借\s+(\S+)\s+的\s+(.+?)(?:\s*·.*)?)\s*$/,
      圈 = /^\s*\/\/\s*✂\s*(.+?)(\s+完)?(?:\s*·.*)?\s*$/,
      起们 = ls.map((l, n) => 认.test(l) ? n : -1).filter(n => n >= 0), i = 起们[0] ?? ls.length,
      剪 = (a, b) => ls.slice(a, b).map((l, k) => (l = 圈.exec(l)) && [a + k + 1, l[1], !!l[2]])
        .filter(Boolean);
    return (i ? [{ 名: '(前言)', 起: 1, 止: i, 文: ls.slice(0, i).join('\n'), 无头: 1, 跟着: [], 头注: '',
      剪: 剪(0, i) }] : [])
      .concat(起们.map((a, x) => {
        const h = 认.exec(ls[a]), 止 = 起们[x + 1] ?? ls.length, f = (h[1] || '').split(/\s*·\s*/),
          跟 = /^跟着\s*[:：]\s*(.*)$/.exec(f.find(y => /^跟着/.test(y)) || '');
        let 注 = '', k = a + 1;   // 一句话: 段头下面连着的几行注释, 最多 120 字; 开头的 ✂ 范围标记跳过
        while (k < 止 && 圈.test(ls[k])) k++;
        while (k < 止 && /^\s*\/\/\s*[^\s✂↦]/.test(ls[k]) && 注.length < 120) {
          注 += ls[k++].replace(/^\s*\/\/\s*/, '');
        }
        return { 名: h[1] ? f[0] : h[3], 起: a + 1, 止, 文: ls.slice(a, 止).join('\n'),
          跟着: 跟 ? 跟[1].split(/\s*[,，]\s*/).filter(Boolean) : [], 借: h[2] ? h[2] + '/' + h[3] : null,
          头注: 注.length > 120 ? 注.slice(0, 120) + '…' : 注, 剪: 剪(a, 止) };
      }));
  },
  async 读(id) {
    const 类 = 目标.类(id), o = { id, 类 };
    if (类 === '块') {
      const b = await ctx.call('stem.block', { id, full: true }), 厂 = {}, 借 = {};
      b.segs.forEach(s => 借[s.name] = s.borrowers);
      (await 目标.切(b.factory)).forEach(s => 厂[s.名] = s.文);
      Object.assign(o, { 名: b.name, 用: (b.about || {}).desc, 文: b.code, rev: b.revision, 要: b.need,
        段: (await 目标.切(b.code)).map(s => Object.assign(s, { 出厂文: 厂[s.名], 借用者: 借[s.名] || [],
          改过: !(s.名 in 厂) ? '新' : 纹(厂[s.名]) !== 纹(s.文) ? '改' : '' })) });
      o.删了 = Object.keys(厂).filter(n => !o.段.some(s => s.名 === n));
      o.出厂段 = 厂;
    } else { // 应用和粘贴的代码: 带 Colony 段头就按段切, 不然整份算一段「(全文)」
      const a = await (类 === '应用' ? ctx.call('apps.get', { id: id.slice(8) }) : 存储.读('code:ver:' + id));
      if (!a || (a.code ?? a.码) == null) throw new Error('没有这个目标: ' + id);
      const 文 = a.code ?? a.码, 段 = await 目标.切(文);
      Object.assign(o, { 名: a.name || a.名, 图: a.icon, 文, rev: 纹(文), 段: 段.some(s => !s.无头) ? 段
        : [Object.assign(段[0], { 名: '(全文)' })] });
    }
    o.行数 = 行(o.文).length;
    o.圈 = !colony.单独 && 目标.圈(o, o.要, await ctx.call('stem.blocks', {}));   // 块名现读
    return o;
  },
  // ✂ 单独时不带 · 号: 范围表
  圈(o, 要 = {}, bs = []) { // 范围按行排开: 标[n] 谁的头尾, 线[n] 圈着它的(标记行算它自己), 记[名] {头, 行, 处, 要};
    // 要: Stem 算的谁要它(stem.block 的 need), 换成块名
    const 标 = {}, 线 = [], 记 = {}, 开 = [];
    o.段.forEach(s => s.剪.forEach(([n, m, e]) => { 标[n] = [m, e]; }));
    for (let n = 1; n <= o.行数; n++) {
      const [m, e] = 标[n] || [], k = e ? 开.findLastIndex(y => y[0] === m) : -1,
        x = m && (记[m] ||= { 头: n, 行: 0, 处: [], 要: (要[m] || []).map(id => id === 'stem' ? 'Stem'
          : bs.find(b => b.id === id)?.name || id) });
      if (m && !e) 开.push([m, n]);
      线[n] = 开.length && 开.map(y => y[0]);
      if (!m) 开.forEach(y => 记[y[0]].行++);
      if (k >= 0) x.处.push([开.splice(k, 1)[0][1], n]);
    }
    return { 标, 线, 记 };
  },
  源(借) { // 借的那段在源头也是借来的就往上找(同导出, 最多 9 层) → [块, 名]
    let [, b, n] = /^(.*)\/(.*)$/.exec(借);
    for (let k = 9, m; k-- && (m = 目标.块.find(x => x.id === b)?.segs.find(s => s.name === n)?.map);) {
      ({ block: b, name: n } = m);
    }
    return [b, n];
  },
  摆(o, h, 源) { // h: stem.molt 回的 {html, 号} 或错 → {借的段名: {头, 行}}; 同一源头的几行导出时剪成一份放第一行
    const 盒 = {}, 组 = {}, 出 = !h.message && 目标.切(RegExp('data-id="' + o.id
      + '">\\n.*?\\*CODE\\*/\\n([\\s\\S]*?)\\n</scr').exec(h.html)[1]);
    o.段.forEach(s => {
      if (!s.借) return;
      const [id, 名] = 目标.源(s.借), x = 盒[s.名] = {}, 干 = id === 'stem';
      if (h.message || 组[id]) return x.头 = h.message ? '✗ ' + h.message : '↑ 和「' + 组[id] + '」并成一份';
      组[id] = s.名;
      x.行 = 目标.对(源[id], h.号[干 ? 'stem' : o.id + '/' + s.名], !干 && 名, id.replace('petri:', ''));
      const 留 = x.行.filter(r => r[0]), 带 = /· 带了: (.+?) ·/.exec(行(出.find(y => y.名 === s.名).文)[0]);
      x.头 = '单独导出时' + (干 ? '带上 Stem 剪出来' : '这里换成 ' + id + ' ') + '的 ' + 留.length + ' 行('
        + (字节(留.map(r => r[1]).join('\n')) / 1024).toFixed(1) + ' KB)'
        + (带 ? ' · 按需多要了: ' + 带[1].split(', ').join('、') : '');
    });
    return 盒;
  },
  对(src, 留, 主, 号) { // 留: Stem 剪进来的是源头第几行。碰到的段从头列到尾(借的那段不列段头), 别的段的段头写成
    // // ─ 名 ─; 跳过的并成一行, 正好是几个整的范围就说范围名
    const 段 = 目标.切(src), 键 = 行(src), 头 = {}, 出 = [];
    Object.entries(目标.圈({ 段, 行数: 键.length }).记).forEach(([m, x]) => x.处.forEach(([h, t]) => {
      头[h - 1] = [t - 1, m];
    }));
    段.forEach(s => {
      let j = s.起 - (s.名 === 主 && !s.无头 ? 0 : 1);
      if (主 && !s.无头) 键[s.起 - 1] = '// ─ ' + s.名 + ' ─';
      if (s.名 !== 主 && !留.some(n => n >= s.起 - 1 && n < s.止)) return;
      for (let i = j; i <= s.止; i++) if (i === s.止 || 留.includes(i)) {
        const 名 = [];
        let p = j;
        for (; 头[p]?.[0] < i; p = 头[p][0] + 1) 名.push('「' + 头[p][1] + '」');
        if (i > j) 出.push(['', '⋯ ' + (p >= i ? '范围' + 名.join('') + '没要 · ' : '剪掉 ') + (i - j) + ' 行']);
        if (i < s.止) 出.push([号 + ':' + (i + 1), 键[i]]);
        j = i + 1;
      }
    });
    return 出;
  },
  // ✂ 单独时不带 完
};
// ═ 样式 ═
// 类名带 c-, 颜色取界面块的设计变量并带默认值(默认值只在块根写一次, 下面用短名), 没有界面块也能看。宽窄看这块自己多宽(容器查询), 窗和裸页都能用。
// c-in 是 1ms 的动画: root 每被搬去显示一次就重播一次, 外壳靠它知道露出来了、回到原来那一行
const 样式 = `@keyframes c-in{from{opacity:.99}to{opacity:1}}@keyframes c-fl{from{background:color-mix(in srgb,
var(--A) 40%,#0000)}}.c-fl{animation:c-fl 1.4s ease-out}
[data-block-id="petri:code"]{container-type:inline-size;height:100%;animation:c-in 1ms;--B:var(--border,
#333);--A:var(--accent,#b5ff00);--G:var(--bg-2,#131313);--M:var(--text-muted,#888);--F:var(--mono,
monospace);--S:var(--sans,sans-serif);--T:var(--text,#eee);--D:var(--bg,#0a0a0a);--U:var(--surface,#222);
--V:var(--surface,#1c1c1c);--N:var(--text-muted,#aaa);--O:var(--text-muted,#999)}
.c{display:grid;grid-template-columns:clamp(150px,17%,200px) 1fr;height:100%;min-height:520px;
max-height:100vh;font:13px var(--S);color:var(--T);background:var(--G)}.c-solo{height:100vh}
/* 单独打开: 铺满整页 */.c button,.c select{font:inherit;color:inherit;background:var(--U);cursor:pointer;
border:1px solid var(--B);border-radius:6px;padding:3px 8px;white-space:nowrap}.c-side{overflow:auto;
border-right:1px solid var(--B)}.c-side select{display:none}.c-side .c-find{display:block;
box-sizing:border-box;width:calc(100% - 16px);margin:8px 8px 0}.c-g,.c-t small,.c-top p,.c-h small,
.c-mm>p{color:var(--M);font-size:11px}.c-g{padding:10px 10px 2px}.c-t{display:flex;gap:6px;padding:4px 10px;
cursor:pointer;white-space:nowrap;border-left:2px solid #0000}.c-t b{flex:1;font-weight:400}
.c-t.off{opacity:.45}.c-t:hover{background:var(--surface-hover,#222)}.c-t.on{border-left-color:var(--A);
background:var(--V)}.c-main{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative}
.c-top,.c-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--B)}
.c-bar{padding:5px 12px}.c-bar>span{flex:1}.c-top h2{margin:0;font-size:18px;font-weight:500}
.c-top{flex-wrap:wrap}.c-top>div:first-child{flex:1 1 0;min-width:150px}/* 名字那格先让,
 还挤就整个键换行 */.c-tabs{display:flex;gap:4px;overflow-x:auto;padding:4px 12px;border-bottom:1px solid var(--B)}
.c-tabs:empty{display:none}.c .c-tabs button{padding:1px 8px;font-size:11px;border-left:3px solid var(--c)}
.c-top p{margin:0}.c-pills{display:flex;gap:2px;margin:0 auto;padding:3px;border:1px solid var(--B);
border-radius:999px;background:var(--D)}.c-pills button{border:0;border-radius:999px;padding:5px 14px;
font-weight:500;background:none;color:var(--M)}.c-pills button:hover{color:var(--T)}
.c-pills .on{background:var(--A);color:#111}.c-tr button{padding:6px 12px;border-radius:8px}.c-bar .on,
.c .c-tabs .on,.c-pop .on{background:var(--accent-soft,#2a3a00);color:var(--A);border-color:var(--A)}
.c-say{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;max-width:80%;
padding:6px 14px;border:1px solid var(--B);border-radius:8px;font-size:12px;background:var(--G);
box-shadow:0 6px 24px #0008;pointer-events:none;transition:opacity 1s}.c-say:empty{display:none}
.c-say.ok{color:var(--A)}.c-say.err{color:#f66}.c-say.fade{opacity:0}.c-view{flex:1;overflow:auto;
min-height:0;position:relative}.c-code,.c-dl,.c-lv .c-l{font:12.5px/1.65 var(--F)}.c-code,
.c-lv{padding-bottom:40vh}.c-l>code{font:inherit;white-space:pre}.c-wrap .c-l>code,
.c-dl code{white-space:pre-wrap;overflow-wrap:anywhere;padding-left:2ch;text-indent:-2ch}.c-l{display:flex;
border-left:3px solid var(--c,#0000)}.c-l.x>code{opacity:.4}.c-l>i{flex:0 0 4.5em;text-align:right;
padding-right:10px;color:var(--text-dim,#555);font-size:11px;font-style:normal;user-select:none;
position:relative}.c-l.add>i{box-shadow:inset -3px 0 #3c3}.c-l:hover{background:#ffffff0a}
.c-l.del>i:after{content:"";position:absolute;right:0;top:-6px;border:6px solid #0000;
border-right-color:#f55}.c-h{position:sticky;top:0;z-index:1;align-items:center;cursor:pointer;
background:linear-gradient(var(--V) 0 0),var(--G);box-shadow:0 -1px var(--B);padding-right:10px}.c-t b,
.c-h>code,.c-h small,.c-mm>p{overflow:hidden;text-overflow:ellipsis}.c-h>code:before{content:"▾ ";
color:var(--M)}.c-fold>.c-h>code:before{content:"▸ "}.c-h small{flex:1;margin:0 8px;font-family:var(--S);
white-space:nowrap}.c-h em{font:11px var(--S);color:var(--A)}.c-h button{font-size:11px;padding:0 6px;
margin-right:4px}.c-fold>.c-l:not(.c-h){display:none}.c-mmw{display:grid;grid-template-columns:minmax(0,
1fr) 5px var(--dw,min(360px,38%));height:100%}.c-mm{position:relative;min-width:0;overflow:hidden;
background:var(--D)}.c-mm>span{position:absolute;right:10px;top:6px}.c-mm>p{position:absolute;left:10px;
bottom:8px;margin:0;padding:3px 10px;max-width:calc(100% - 20px);white-space:nowrap;
border:1px solid var(--B);border-radius:999px;background:var(--G);pointer-events:none}.c-mm svg{width:100%;
height:100%;display:block;cursor:grab;touch-action:none;user-select:none}.c-mm .e path{fill:none;
stroke-opacity:.55;stroke-width:1.3}.c-mm .n{cursor:pointer}.c-mm .n rect{fill:color-mix(in srgb,
var(--k) 10%,#0000);stroke:var(--k);stroke-opacity:.6}.c-mm text{fill:var(--T);font:12px var(--S)}
.c-mm .根 rect{fill:var(--k)}.c-mm .st{fill:var(--k)}.c-mm .old{fill:#ffb020}.c-mm .n .len{fill:var(--k);
stroke:none;opacity:.7}.c-mm .n:hover rect{stroke-opacity:1}.c-mm .根>.名{fill:#111;font-weight:600}
.c-mm .类 rect{fill:color-mix(in srgb,var(--k) 22%,#0000)}.c-mm .类>text{font-weight:600}
.c-mm .讲 rect{fill:#ffffff0a;stroke:none}.c-mm .借 rect{fill:none;stroke-dasharray:4 3}
.c-mm .旧 rect{stroke:#ffb020;stroke-dasharray:4 3}.c-mm .选 rect{stroke-width:2;stroke-opacity:1}
.c-mm .讲.选 rect{stroke:var(--k)}.c-mm .注{fill:var(--M);font-size:11px}.c-mm .pm circle{fill:var(--G);
stroke:var(--k)}.c-mm .dot,.c-mm .busy{fill:var(--A)}.c-mm .pm text{fill:var(--k);text-anchor:middle;
font-size:10px}.c-mm .bad{fill:#f55}.c-dh{cursor:col-resize;background:var(--B)}.c-dt{overflow:auto;
padding:12px 16px 64px}.c-dt .c-g{padding:0;margin:0 0 4px}.c button:hover{border-color:var(--A)}.c-acts,
.c-op{display:flex;flex-wrap:wrap;gap:6px}.c-sum{border-left:3px solid var(--A);padding:6px 10px;
margin:8px 0;line-height:1.6;background:color-mix(in srgb,var(--A) 10%,#0000);border-radius:0 6px 6px 0}
.c-li,.c-sub{margin:2px 0;color:var(--N)}.c-li{padding:4px 6px;border-radius:6px;cursor:pointer}
.c-li:hover{background:var(--surface-hover,#222)}.c-li b,.c-sub b{color:var(--T);font-weight:500}
.c-li b{margin-right:4px}.c-tr{display:flex;gap:6px}.c-sure{color:#f66!important;
border-color:#f66!important}.c-pop{position:absolute;z-index:5;width:320px;padding:10px 12px;
border:1px solid var(--B);border-radius:10px;background:var(--G);box-shadow:0 10px 30px #000a}
.c-pop label{display:block;font-weight:600;margin-top:6px}.c-pop select{width:100%;margin:4px 0}
.c-pop p{margin:2px 0;font-size:11px;color:var(--M)}.c-pop div{display:flex;flex-wrap:wrap;gap:4px;
align-items:center}
.c-pop div select{flex:1;min-width:0}.c-pop [data-f="加"]{display:none}/* 借来的选模型: 讲解只用文本模型,
 不摆「加一类」 */.c-pop pre{white-space:pre-wrap;font:11px/1.5 var(--F);max-height:200px;overflow:auto}
.c-selbar{width:auto;display:flex;gap:6px;padding:6px}/* 逐行: 每行三格 行号 | 代码 | 注(注栏宽 --cw 能拖); 还没注的段(c-nn)代码占满;
 顶上一条吸顶(c-lh), 每段一条段头(c-sh) */.c-lv .c-l{display:grid;grid-template-columns:4.5em minmax(0,1fr) var(--cw,
minmax(240px,38%))}.c-lv .c-nn>.c-l{grid-template-columns:4.5em minmax(0,1fr)}.c-row{padding-bottom:14px}
.c-l>p{margin:0;padding:0 12px;border-left:1px solid var(--B);font:12px/1.72 var(--S);
color:color-mix(in srgb,var(--T) 80%,#0000);user-select:none}.c-row+.c-row{border-top:1px solid var(--B)}
.c-lv{background:var(--D)}.c-lh{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:minmax(0,
1fr) var(--cw,minmax(240px,38%));font-size:11px;line-height:24px;color:var(--M);background:var(--G);
border-bottom:1px solid var(--B)}.c-lh span{padding-left:14px;overflow:hidden;white-space:nowrap;
text-overflow:ellipsis}.c-lh b{font-weight:400;padding-left:12px;border-left:3px solid var(--B);
cursor:col-resize}.c-lh b:hover{border-color:var(--A)}.c-sh{padding:10px 14px 8px;
border-left:3px solid var(--c,#0000);background:var(--G);user-select:none}.c-sh .c-g{padding:0;margin:0}
.c-sh .c-acts{margin-top:6px;align-items:center}.c-sh h3 small{margin-left:6px;font-size:12px;
font-weight:400;color:var(--O)}.c-sh a{padding:0 4px;font-size:11px;color:var(--O);cursor:pointer}
.c-sh a:hover{color:var(--A)}.c-dt .c-sh{padding:0;border:0;background:none}
.c-row>.c-pt{margin:4px 12px 4px 4.5em;padding:4px 10px;user-select:none;background:color-mix(in srgb,
var(--c,#b5ff00) 14%,#0000)}.c-dl{margin-top:8px;padding:4px 0;border:1px solid var(--B);border-radius:8px;
background:var(--D)}.c-dl .c-l{display:grid;grid-template-columns:3.5em minmax(0,1fr)}
.c-dl .c-l>p{grid-column:2;border:0;padding:0 8px 4px 0;font-size:11.5px}.c-sh h3,.c-dt h3{margin:2px 0 6px;
font-size:15px;font-weight:600}.c-dt h3{font-size:17px}.c-mo{float:right;font-size:10px;opacity:.7}
.c-h4{margin:12px 0 4px;font-size:12px;color:var(--O)}.c-l.c-sep{font-weight:600;
background:color-mix(in srgb,var(--c) 12%,#0000)}.c-l.hl,.c-pt.hl,.c-sub.hl{background:var(--accent-soft,
#2a3a00)}.c-pt{display:flex;gap:8px;margin:6px 0;padding:8px 10px;border-radius:8px;background:var(--V);
border-left:3px solid var(--c,var(--A))}.c-pt>b{flex:0 0 18px;height:18px;border-radius:50%;
text-align:center;font:600 11px/18px var(--S);background:var(--c,var(--A));color:#111}.c-pt p{margin:0;
line-height:1.6}.c-pt a,.c-sub{cursor:pointer}.c-pt a{color:var(--A);white-space:nowrap;
display:inline-block;padding:0 8px;border:1px solid var(--B);border-radius:999px;font:11px var(--F)}
.c-pt small{opacity:.6}.c-sub{padding:3px 6px;border-radius:4px;font-size:12px}.c-sub small{opacity:.6}
.c-pt.旧,.c-sub.旧{opacity:.55}.c-old{margin:6px 0;padding:6px 10px;border-radius:6px;background:#ffb02022;
color:#ffb020;font-size:12px}@keyframes c-pu{to{opacity:.35}}.c-busy,.c-run,
.c-mm .busy{animation:c-pu .8s infinite alternate}.c-busy,.c-run{color:var(--A)}.c-err{color:#f66;
font-size:12px}.c-g button{padding:0 6px;font-size:11px;margin-left:4px}.c-solo [data-ask],
.c-solo [data-q]{display:none}/* 单独打开: 没有 agent */.c-li code{font:12px var(--F);white-space:pre-wrap;
overflow-wrap:anywhere}.c-t button{display:none;padding:0 5px;font-size:10px}.c-t:hover button,
.c-t button.c-sure{display:inline}.c-paste{display:flex;flex-direction:column;box-sizing:border-box;
max-width:860px;height:100%;margin:0 auto;padding:16px 20px}/* 框占满剩下的高,
 开始读那排总在窗里 */.c-paste h1{font-size:24px;font-weight:600;margin:0 0 6px}.c-paste em{color:var(--A)}
.c-paste>p{color:var(--M);margin:0 0 12px}.c-paste textarea{flex:1;width:100%;min-height:120px;
box-sizing:border-box;padding:14px;border-radius:14px;border:1px solid var(--B);
background:var(--surface,#1a1a1a);color:inherit;font:13px/1.6 var(--F);resize:vertical}
.c-paste textarea:focus,.c-paste textarea.on{outline:0;
border-color:var(--A)}.c-paste .c-acts{margin-top:10px}.c-op{position:sticky;top:var(--ht,0);z-index:2;
padding:6px 0;background:var(--G)}/* 吸顶 */.c input{padding:4px 8px;border-radius:6px;
border:1px solid var(--B);color:inherit;background:var(--U)}.c-acts input,.c-op input{flex:1;
min-width:160px}.c .c-pop input{width:100%;box-sizing:border-box;margin:4px 0}.c .c-pri{background:var(--A);
color:#111;font-weight:600;border-color:var(--A)}.c-ed{display:block;width:100%;box-sizing:border-box;
padding:8px 10px;border-radius:8px;resize:vertical;border:1px solid var(--A);background:var(--D);
color:inherit;font:12.5px/1.65 var(--F)}.c-opd,.c-hg{font:12px/1.6 var(--F)}.c-d{white-space:pre-wrap;
padding:0 8px}.c-d.a{background:#3c33}.c-d.r{background:#f553;text-decoration:line-through}
.c-d.s{color:var(--M)}.c-hist,.c-try{position:absolute;z-index:6;box-sizing:border-box;background:var(--G)}
.c-hist{inset:0 0 0 auto;width:min(560px,100%);overflow:auto;padding:10px 14px 40px;
border-left:1px solid var(--B);box-shadow:-12px 0 30px #0008}.c-hh{display:flex;
justify-content:space-between;align-items:center}.c-hr{margin:0;padding:6px 8px;border-radius:6px;
cursor:pointer}.c-hr:hover{background:var(--U)}.c-hr.on{background:color-mix(in srgb,var(--A) 16%,#0000)}
.c-hd{margin-top:10px}.c-hd h4{margin:12px 0 4px}.c-hg{position:relative;margin:6px 0;padding:30px 0 4px;
overflow:hidden;border:1px solid var(--B);border-radius:8px}.c-hg>button{position:absolute;top:4px;
right:6px;font:11px var(--S)}.c .c-lk{border:0;padding:0;background:none;color:var(--A)}
.c-try{inset:auto 0 0;height:45%;display:flex;flex-direction:column;padding:6px 14px 10px;
border-top:1px solid var(--B);box-shadow:0 -12px 30px #0008}.c-try .c-g{margin:0 0 6px}.c-try>div{flex:1;
min-height:0;border:1px solid var(--B);border-radius:8px;overflow:hidden}.c-b>code:before{content:none}
.c-tag{font:10px var(--F);padding:0 5px;border:1px solid var(--B);border-radius:4px;
background:#ffffff12;color:var(--T)}.c-ar{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--D)}.c-arb{display:flex;flex-wrap:wrap;
align-items:center;gap:6px 12px;padding:7px 12px;border-bottom:1px solid var(--B);font-size:12px;color:var(--M)}
.c-arb nav{color:var(--T);font-size:13px}.c-arb nav a{color:var(--A);cursor:pointer}.c-arb>span:not(.c-acts){flex:1;
min-width:160px}.c-arb .c-acts{margin-left:auto}.c-arb .c-old{margin:0;padding:2px 8px}.c-arm{position:relative;
flex:1 1 auto;min-height:300px;overflow:hidden}.c-arm svg{width:100%;height:100%;display:block;cursor:grab;
touch-action:none;user-select:none}.c-arm>p{position:absolute;left:10px;bottom:6px;margin:0;font-size:11px;
color:var(--M);pointer-events:none}.c-arm .n{cursor:pointer}.c-arm .n,.c-arm .e{transition:opacity .15s}
.c-arm .dim{opacity:.15}.c-arm .sel rect.b{stroke-width:2.8}.c-arm .pm{cursor:zoom-in}.c-ari:empty{display:none}
.c-ari{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:7px 12px;border-top:1px solid var(--B);
font-size:12px;color:var(--N)}.c-ari b{color:var(--c);font-size:13px}.c-ari a{display:inline-block;margin:0 6px 2px 0;
padding:1px 8px;border:1px solid var(--B);border-radius:999px;cursor:pointer;color:var(--T)}.c-ari a:hover{
border-color:var(--A)}.c-ari small{color:var(--M)}.c-arx{flex:0 1 auto;max-height:40%;overflow:auto;
padding:2px 12px 12px;border-top:1px solid var(--B)}.c-arc{display:grid;grid-template-columns:repeat(auto-fill,
minmax(210px,1fr));gap:10px;margin:10px 0}.c-arc>div{padding:10px 12px;border:1px solid var(--B);border-radius:10px;
background:var(--G)}.c-arc h4{margin:0 0 6px;font-size:13px}.c-arc h4:before{content:"";display:inline-block;
width:8px;height:8px;margin-right:6px;border-radius:50%;background:var(--c)}.c-arc ul{margin:0;padding-left:16px;
color:var(--N);font-size:12px;line-height:1.6}.c-arl{display:flex;flex-wrap:wrap;gap:4px 14px;padding-top:8px;
font-size:11px;color:var(--M)}.c-arl i{display:inline-block;width:11px;height:9px;margin-right:5px;
border:1px solid var(--c);border-radius:2px;background:color-mix(in srgb,var(--c) 20%,#0000)}`
  + `@container (max-width:760px){.c-mmw{grid-template-columns:1fr;
/* 窄: 注换到代码下面一行 */grid-template-rows:minmax(320px,62%) auto}.c-dh,.c-lh b{display:none}.c-lh{display:block}
.c-lv .c-l{grid-template-columns:3.5em minmax(0,1fr)}.c-lv .c-l>p{grid-column:2;border:0;
padding:0 8px 4px 0;font-size:11.5px}.c-row>.c-pt{margin-left:3.5em}.c{grid-template-columns:1fr;
grid-template-rows:auto 1fr}.c-side{border:0}.c-ls>:not(select){display:none}.c-side select{display:block;
width:calc(100% - 16px);margin:8px}}`;
// ✂ 单独时不带 · 号: 范围样式
// 只在 Colony 里有的: 借来的一行下面的浅底, ✂ 牌子和范围细线, 顶上的范围那行(装配加上; 离线页不带)
const 圈样 = `.c-bx{margin-left:3em;border-left:2px solid var(--A);background:#ffffff08}
.c-bx>summary{padding:0 10px;font:11px/2 var(--S);color:var(--M);cursor:pointer}
.c-bx a,.c-rg a{margin:0 6px;color:var(--k,var(--A));cursor:pointer}.c-gap>code{color:var(--M)}
.c-l>i{box-shadow:var(--r)}.c-l[style*="--k"]>code{color:var(--k);
background:color-mix(in srgb,var(--k) 16%,#0000);border-radius:4px;padding:0 6px;text-indent:0;
justify-self:start}.c-rg{padding:2px 12px;border-bottom:1px solid var(--B);overflow-x:auto;
white-space:nowrap;font-size:11px;color:var(--M)}.c-rg:empty{display:none}`;
// ✂ 单独时不带 完
// ═ 外壳 · 跟着: 工具, 目标, 存储, 样式 ═
// 左栏(找词 + 目标清单) + 顶栏(名字、统计、几种视图、解析和模型) + 总览条(总述或进度) + 标签行 + 状态行 + 视图区。
// 开(目标, at, 视图): 读目标和解读、画视图、翻到 at。第一次打开没解析过的目标: 小的(问模型不超过 3 次)自动解析,
// 大的等人点「解析」(点两下, 先说要问几次); 单独打开的文件从不自动解析。
// 源码改过、解读对不上时总览条先问「同步更新 / 先不」(同步 段)。
// 看到哪记在会话的 code.view: 本块被改了会重启, 靠它回到原来的目标、视图和那一行
const 外壳 = {
  视图: {},   // 视图名 → {名, 画(el, 目标), 更?(el, 目标) 解读变了只重画卡片, 点?(e), 到?(n, 闪), 位?()}; 装配段填
  now: null,
  看: '导图',
  号: 0,
  $: s => ctx.root.querySelector(s),
  记: 会话('code.view'),
  露: () => ctx.root.parentNode && ctx.root.parentNode.id !== 'colony-root' || !colony.has('ui.host'),
  装() {
    ctx.root.innerHTML = '<div class="c' + (colony.单独 ? ' c-solo' : '') + '"><div class="c-side">'
      + (colony.单独 ? '' : '<input class="c-find" placeholder="🔍 找词(回车)" title="在 Stem、块和桌面应用的代码里找">')
      + '<div class="c-ls"></div>'
      + '</div><div class="c-main"><div class="c-top"></div><div class="c-bar"></div>'
      + '<div class="c-tabs"></div><div class="c-rg"></div><div class="c-say"></div>'
      + '<div class="c-view"></div></div></div>';
    ctx.root.onclick = e => {
      const t = e.target.closest('[data-rm],[data-id],[data-v],[data-wrap],[data-do],[data-roles],'
        + '[data-paste],[data-hit],[data-to]');
      if (!t || !ctx.root.contains(t)) return 外壳.视图[外壳.看].点 && 外壳.视图[外壳.看].点(e);   // 往上找别越过本块
      const x = t.dataset;
      if (x.rm) 外壳.删(x.rm, t);
      else if (x.hit) 外壳.开(x.hit, x.at, '源码').catch(外壳.错);
      else if (x.id) 外壳.开(x.id).catch(外壳.错);
      else if (x.to) 外壳.到(+x.to);
      else if ('paste' in x) 粘贴.页();
      else if (x.v) 外壳.开(null, 外壳.位(), x.v).catch(外壳.错);
      else if ('wrap' in x) 外壳.折行(外壳.记.折 === false);
      else if ('roles' in x) 外壳.卡(t, 角色.卡).catch(外壳.错);
      else 外壳.做(x.do, t);
    };
    ctx.root.onchange = e => e.target.closest('.c-ls') && (e.target.value ? 外壳.开(e.target.value).catch(外壳.错)
      : 粘贴.页());
    ctx.root.onkeydown = e => e.key === 'Enter' && !e.isComposing && e.target.matches('.c-find')
      && 搜代码.页(e.target.value.trim());   // 输入法选词的回车不算
    外壳.键 = e => { // Esc 只关最上面那层(小卡、改动记录、试跑抽屉), 拦住不让窗跟着关; 本块被别的窗盖住时不管
      const p = e.key === 'Escape' && ['.c-pop', '.c-hist', '.c-try'].map(外壳.$).find(Boolean),
        r = p && p.getBoundingClientRect(), 顶上 = r && document.elementFromPoint(r.x + r.width / 2, r.y + 10);
      if (!p || !ctx.root.contains(顶上)) return;
      e.stopPropagation();
      p.classList.contains('c-try') ? 试跑.收() : 外壳.收卡(p);
    };
    听('keydown', 外壳.键, true);
    let 停 = 0;
    外壳.$('.c-view').onscroll = () => { clearTimeout(停); 停 = setTimeout(外壳.存, 300); };
  },
  async 列() { // 每项右边灰字: ✗ 出错或有段没解析成 / ✓ 解析过; ●3 = 改过 3 段。回列出来的那些目标
    const ts = await 目标.列(), 组 = {}, 当 = 外壳.页中 ? '' : (外壳.now || {}).id;   // 看着整页时哪项都不亮
    for (const t of ts) {
      const a = await 解析.读(t.id);
      t.解 = a.at ? (Object.values(a.段).some(x => x.错) ? '✗' : '✓') : '';
      (组[t.组] = 组[t.组] || []).push(t);
    }
    组['粘贴的代码'] = 组['粘贴的代码'] || [];
    外壳.$('.c-ls').innerHTML = '<select>' + ts.map(t => '<option value="' + esc(t.id) + '"'
      + (t.id === 当 ? ' selected' : '') + '>' + esc(t.组 + ' · ' + t.名) + '</option>').join('')
      + '<option value=""' + (当 ? '' : ' selected') + '>＋ 贴一份代码</option></select>'
      + Object.entries(组).map(([g, xs]) => '<div class="c-g">' + g + (g === '粘贴的代码'
        ? ' <button data-paste title="粘贴或拖进一份代码">＋</button>' : '') + '</div>' + xs.map(t => '<div class="c-t'
        + (t.停 ? ' off' : '') + (t.id === 当 ? ' on' : '') + '" data-id="' + esc(t.id) + '" title="'
        + esc(t.错 || [t.用, t.id].filter(Boolean).join('\n')) + '"><b>' + esc((t.图 ? t.图 + ' ' : '') + t.名)
        + '</b><small>'
        + (t.错 ? '✗' : (t.改 ? '●' + t.改 + ' ' : '') + t.解) + '</small>' + (t.组 === '粘贴的代码'
          ? '<button data-rm="' + esc(t.id) + '" title="删掉(点两下)">✕</button>' : '') + '</div>').join(''))
      .join('') + (colony.单独 ? '<p class="c-g">单独打开时只读贴进来的代码; Stem、块和桌面应用要在 Colony 里读</p>' : '');
    return ts;
  },
  删(id, 钮) { // 点两下才删
    if (!先问(钮)) return;
    粘贴.删(id);
    存储.刷().then(() => 外壳.now && 外壳.now.id === id ? (外壳.now = null, 外壳.记.目标 = '', 外壳.开()) : 外壳.列())
      .catch(外壳.错);
  },
  async 开(id, at, 看) {
    const 号 = ++外壳.号, 旧 = 外壳.now, 记 = !id && ((旧 || {}).id || 外壳.记.目标),   // 记着的那项不在清单里(删了): 回默认的
      要 = id || 记 && (await 目标.列()).some(t => t.id === 记) && 记 || (colony.单独 ? '' : 'stem'),
      o = 要 && await 地图.读(要), 有模 = o && await 角色.有();   // 换 外壳.now 之前等完: 换了就一口气画完, 露了看到的 now 总是画好的
    if (号 !== 外壳.号) return '';   // 连着点了两个, 只画后一个
    if (!o) return 粘贴.页();
    const 页 = 外壳.页中;
    外壳.now = o;
    外壳.页中 = 0;
    外壳.列().catch(外壳.错);
    const 话 = n => '已打开 ' + o.名 + ' · ' + 外壳.看 + (n ? ' · 第 ' + n + ' 行' : '');
    if (旧 && 旧.id === o.id && 旧.rev === o.rev && at == null && !看 && !页) return 话();
    if (!旧 || 旧.id !== o.id) { // 换了目标, 上一个的话和改动记录不留
      外壳.$('.c-say').textContent = '';
      if (外壳.$('.c-hist')) 外壳.$('.c-hist').remove();
      试跑.收();
    }
    手术台.中 = '';   // 重画了, 编辑框也没了
    看 = 看 || !旧 && 外壳.记.视图;   // 刚重启: 回到原来的视图
    if (看 in 外壳.视图) 外壳.看 = 看;
    外壳.有模 = 有模;
    外壳.顶();
    外壳.$('.c-view').classList.toggle('c-wrap', 外壳.记.折 !== false);   // 默认折行
    外壳.视图[外壳.看].画(外壳.$('.c-view'), o);
    外壳.签();
    const n = 外壳.行号(at);
    外壳.到(n || 外壳.记.目标 === o.id && 外壳.记.行 || 1, !!n);
    外壳.存();
    if (!o.ana.at && !解析.跑[o.id] && 外壳.露() && 外壳.有模 && !colony.单独 && 外壳.次(o) <= 3) 外壳.做('解析');
    return 话(n);
  },
  页(头, 条, 内容) { // 粘贴页、找词结果这种整页: 换掉顶栏、总览条和视图区; 点左栏任一项回来
    外壳.页中 = 1;
    试跑.收();
    外壳.$('.c-top').innerHTML = 头;
    外壳.$('.c-bar').innerHTML = 条;
    外壳.$('.c-tabs').innerHTML = 外壳.$('.c-rg').innerHTML = 外壳.$('.c-say').textContent = '';
    外壳.$('.c-view').innerHTML = 内容;
    外壳.列().catch(外壳.错);
    return 外壳.$('.c-view');
  },
  坏: o => o.段.filter(s => s.解.旧 || s.解.错 || o.ana.停 && !s.借 && !s.解.分 && s.止 - s.起 > 100)
    .map(s => s.名),   // 过时的、没解析成的、停下时没细分的大段: 「重读」只问这几段
  缺(a) { // 停在半路还差什么
    const n = Object.values(a.段).filter(x => x.错).length;
    return [n ? n + ' 段没解析' : '', (a.类 || []).length ? '' : '分大类和总述'].filter(Boolean).join('、') || '大段的细分';
  },
  次(o, 只) { // 解析一遍约问模型几次(分章、细分、分组); 只: 只读这几段
    const 文 = 只 ? o.段.filter(s => 只.includes(s.名)).map(s => s.文).join('\n') : o.文;
    return (只 && !只.length ? 0 : Math.ceil(文.length / 36000) + Math.ceil(行(文).length / 400)) + 1;
  },
  顶() { // 顶栏 + 总览条: 解析的进度、过时几段、没成的原因, 第一个键随情况变
    const o = 外壳.now, a = o.ana, 跑 = 解析.跑[o.id], 坏 = 外壳.坏(o), 没 = 外壳.没讲(o),
      错 = (o.段.find(s => s.解.错) || { 解: {} }).解.错 || a.分组错, 解 = a.at ? '重新解析' : '解析',
      接 = 外壳.有模 === 2 ? '' : 外壳.有模 ? ' · 模型还没测通(也能讲) <button data-roles>⚙ 测一下</button>'
        : ' · 讲解要先接一家模型 <button data-roles>⚙ 接模型</button>';   // 没有测通的模型就一直在
    外壳.$('.c-top').innerHTML = '<div><h2>' + esc(o.名) + '</h2><p>' + esc(o.id) + 地图.头(o, 1)
      + (o.版 && o.版.版.length > 1   // 改过一次才出「改动记录」
        ? ' · <button class="c-lk" data-do="记录">🕘 第 ' + o.版.版.at(-1).v + ' 版</button>' : '')
      + '</p></div><div class="c-pills">'
      + Object.keys(外壳.视图)
        .map(k => '<button data-v="' + k + '"' + (k === 外壳.看 ? ' class="on"' : '') + '>' + 外壳.视图[k].名
          + '</button>').join('') + '</div><span class="c-tr">' + (跑 ? '' : 坏.length || a.停
        ? '<button data-do="重读">⚠ ' + (坏.length ? '重读 ' + 坏.length + ' 段' : '接着解析') + '</button>'
        : '<button data-do="' + 解 + '">' + 解 + '</button>')
      + '<button data-roles>⚙ 模型</button><button data-do="导出">导出</button></span>';
    外壳.$('.c-bar').innerHTML = (跑 ? '<span class="c-run">⏳ ' + esc(跑.话)
      + ' <button data-do="停">停</button></span>'
      : a.停 ? '<span class="c-err">⏸ 解析停在半路, 还差: ' + esc(外壳.缺(a)) + 接 + '</span>'
      : 错 ? '<span class="c-err">✗ ' + (坏.length || '') + ' 段没解析成: '
        + esc(错.replace(/, 或用 ai\.configure/, '')) + 接 + '</span>'
      : 外壳.有模 && (外壳.同 = 同步.要(o)) ? 同步.条(o, 外壳.同)
      : '<span>💡 ' + esc(a.总述 || (a.at ? '解析过了, 模型没写总述' : '还没解析, 下面是段头目录(不花钱)'
        + (外壳.有模 ? ' · 解析要问模型约 ' + 外壳.次(o) + ' 次' : ''))) + 接 + '</span>')
      + (外壳.看 !== '源码' && a.at && 外壳.有模 && !跑 && 没.length ? '<button data-do="全讲">全部讲解 (剩 ' + 没.length
        + ' 段 · 问 ' + 外壳.讲次(o, 没) + ' 次)</button>' : '') + (外壳.图(外壳.看) ? '' : '<button data-wrap'
        + (外壳.记.折 !== false ? ' class="on"' : '') + '>↩ 折行</button>')   // 导图没有代码行
      + (!colony.单独 && 手术台.键(o) || '');
  },
  做(事, 钮) { // 钮: 人点的键, 花钱多的要点两下; 不给(开始读、第一次打开的小目标)就直接做
    const o = 外壳.now, 次 = /解析/.test(事) ? 外壳.次(o) : 事 === '重读' ? 外壳.次(o, 外壳.坏(o))
      : 事 === '全讲' ? 外壳.讲次(o) : 0;
    if (钮 && (事 === '重新解析' || 次 > 3) && !先问(钮, '再点一次: 要问模型约 ' + 次 + ' 次')) return;
    if (事 === '停') return 解析.跑[o.id] && (解析.跑[o.id].停 = 1, 外壳.说('停下了: 正在问的这几次问完就不再问'));
    if (事 === '全讲') return 外壳.全讲(o);
    if (事 === '导出') return 外壳.卡(钮, 导出.卡);
    if (事 === '记录') return 手术台.记录().catch(外壳.错);
    if (事 === '剪') return 手术台.开关();
    if (事 === '同步') return 同步.做(o, 钮);   // 源码改过, 只更新对不上的那几处
    if (事 === '先不') return 同步.先不(o);
    const 只 = 事 === '重读' ? 外壳.坏(o) : undefined;   // 没段头的重新解析: 从整份重新切
    (事 === '重新解析' && o.段.some(s => s.切) ? 目标.读(o.id) : Promise.resolve(o)).then(x => 解析.架构(x, 只))
      .then(async () => { // 每章的错都接住了, 这里照存下的实数说; 小目标接着一口气讲完
        const a = await 解析.读(o.id), n = Object.values(a.段).filter(x => x.错).length;
        外壳.说(a.停 ? '⏸ 已停下, 还差: ' + 外壳.缺(a) : n ? '✗ ' + n + ' 段没解析成, 原因在上面那条' : '✓ 解析好了',
          n || a.停);
        if (!n && !a.停 && 外壳.次(o) <= 3 && (外壳.now || {}).id === o.id) await 外壳.全讲(await 地图.读(o.id));
      }).catch(外壳.错);
    setTimeout(外壳.顶);
  },
  没讲: o => 解析.段们(o).filter(s => 解析.要(s, o.ana.段[s.名])),   // 还要讲的: 没讲、缺注、要点对不上、上次出错
  讲次: (o, ss = 外壳.没讲(o)) => ss.reduce((n, s) => n + 解析.计(s, o.ana.段[s.名]).次, 0),   // 真要问模型几次(按片数)
  async 全讲(o) { // 三段一起讲(每段里几片也一起问, 真正同时发几个归 AI 块的并发闸); 总览条写「讲解 k/n 段」, 「停」照样能用
    const 要 = 外壳.没讲(o), n = 要.length, 跑 = 解析.跑[o.id] = { 话: '讲解 0/' + n + ' 段', 停: 0 };
    let 完 = 0;
    const 工 = async () => {
      for (let s; !跑.停 && (外壳.now || {}).id === o.id && (s = 要.shift());) {
        await 解析.讲(o, s.名);
        跑.话 = '讲解 ' + ++完 + '/' + n + ' 段';
        外壳.顶();
      }
    };
    try {
      外壳.顶();
      await Promise.all([工(), 工(), 工()]);
    } finally {
      delete 解析.跑[o.id];
      外壳.顶();
    }
  },
  async 卡(钮, 填) { // 小卡(模型、导出): 盖在按钮下面, 再点一下、点外面或按 Esc 关
    const 有 = 外壳.$('.c-pop:not(.c-selbar)');
    if (有) return 外壳.收卡(有);
    const el = 外壳.贴(钮.getBoundingClientRect(), '', 1);
    await 填(el);
    el.addEventListener('click', e => e.stopPropagation());
    const 关 = e => !el.contains(e.target) && e.target !== 钮
      && (外壳.收卡(el), document.removeEventListener('pointerdown', 关));
    document.addEventListener('pointerdown', 关);
  },
  贴(r, 类, 右) { // 小卡、小条贴在 r 下面, 不出本块: 右 = 右边对齐 r(320 宽的小卡)
    const c = 外壳.$('.c'), b = c.getBoundingClientRect(), el = c.appendChild(document.createElement('div'));
    el.className = 'c-pop' + 类;
    el.style.cssText = 'top:' + (r.bottom - b.top + 6) + 'px;left:'
      + Math.max(8, 右 ? Math.min(r.right - b.left - 320, b.width - 330) : r.left - b.left) + 'px';
    return el;
  },
  收卡: p => (p.摘 && p.摘(), p.remove()),
  拖(h, 动) { // 拖一条边改宽窄: 按下抓住指针, 动(m) 按指针设宽度, 松开记下
    h.onpointerdown = e => (h.setPointerCapture(e.pointerId), h.onpointermove = 动);
    h.onpointerup = () => (h.onpointermove = null, 外壳.存());
  },
  async 刷模() { // AI 配置变了(比如在小卡里测通了一家): 重新看有没有模型
    外壳.有模 = await 角色.有();
    if (外壳.now && !外壳.页中) 外壳.顶();
  },
  更(id) { // 解读变了: 只重读解读、重画顶栏和卡片, 不动代码和滚动位置
    clearTimeout(外壳.更钟);
    外壳.更钟 = setTimeout(async () => {
      const o = 外壳.now;
      if (!o || o.id !== id || 手术台.中 || 外壳.页中) return;   // 改着的时候、看着整页的时候不重画
      const a = await 解析.读(id);
      if (!a.切 !== !o.ana.切) return 外壳.开(id, 外壳.位(), 外壳.看);   // 没段头的刚切好: 段都变了, 整个重画
      o.ana = a;
      o.段.forEach(s => s.解 = 对齐.看(s, a.段[s.名]));
      外壳.顶();
      const v = 外壳.视图[外壳.看];
      (v.更 || v.画)(外壳.$('.c-view'), o);
      外壳.签();
    }, 150);
  },
  async 刷() { // 别处改了代码: 目标真变了才重画; 目标没了(别处删了)就不读、不重画; 等着读的时候有人翻了页, 就让开
    const 号 = 外壳.号, id = 外壳.now.id, o = (await 外壳.列()).some(t => t.id === id) && await 目标.读(id);
    if (!o || 手术台.中 || 外壳.页中) return;
    if (号 === 外壳.号 && (o.rev !== 外壳.now.rev || !colony.单独 && 范围.范(o) !== 范围.范(外壳.now))) await 外壳.开(o.id);
  },
  行号(at) { // at: 全局行号 / '段名' / '段名:段内行' / ✂ 范围名 → 全局行号; 认不出回 0
    const o = 外壳.now;
    if (at == null || at === '' || !o) return 0;
    if (+at > 0) return Math.min(+at, o.行数);
    const m = String(at).match(/^(.*?)(?::(\d+))?$/), s = o.段.find(x => x.名 === m[1]);
    if (s) return Math.min(s.起 + (+m[2] || 0), s.止);
    return 行(o.文).findIndex(l => l.includes('✂ ' + at)) + 1;
  },
  到(n, 闪) {
    if (外壳.视图[外壳.看].到) return 外壳.视图[外壳.看].到(n, 闪);
    const el = 外壳.$('.c-view .c-l[data-n="' + n + '"]');
    if (!el) return;
    const v = 外壳.$('.c-view'), s = el.closest('.c-fold'),
      头 = !闪 && el.parentNode.querySelector(':scope>.c-l') === el && el.parentNode;   // 翻到段的第一行: 段头条一起露出来
    if (s) s.classList.remove('c-fold');
    v.scrollTop += (头 || el).getBoundingClientRect().top - v.getBoundingClientRect().top
      - (闪 ? v.clientHeight / 3 : 30);
    if (闪) 外壳.闪(el);
  },
  闪: el => (el.classList.remove('c-fl'), void el.offsetWidth, el.classList.add('c-fl')),
  去: 借 => 外壳.开(借.slice(0, 借.lastIndexOf('/')), 借.slice(借.lastIndexOf('/') + 1)).catch(外壳.错),
  跳: n => 外壳.看 === '逐行' && !外壳.页中 ? 外壳.到(n, 1)   // 去看那几行: 已在逐行就原地滚过去
    : 外壳.开(null, n, '逐行').catch(外壳.错),
  图: k => k === '导图' || k === '架构图',   // 这两种视图没有代码行: 不要标签、范围和折行
  签() { // 逐行和源码顶上那排标签, 下面一行列这块的范围(导图、架构图不要)
    外壳.$('.c-tabs').innerHTML = 外壳.图(外壳.看) ? '' : 逐行.签(外壳.now);
    外壳.$('.c-rg').innerHTML = 外壳.图(外壳.看) || colony.单独 ? '' : 范围.范(外壳.now);
    外壳.亮(外壳.位());
  },
  亮(n) { // 看到第 n 行: 标签亮它那一类, 逐行顶上那条写到了哪
    外壳.$('.c-tabs').querySelectorAll('[data-to]').forEach(b => b.classList.toggle('on', +b.dataset.to <= n
      && n <= +b.dataset.b));
    const p = 外壳.$('.c-lh span');
    if (p) p.textContent = 逐行.哪(外壳.now, n);
  },
  位() { // 视图区顶上那一行的行号(导图: 选中的那个节点)
    if (外壳.视图[外壳.看].位) return 外壳.视图[外壳.看].位();
    const v = 外壳.$('.c-view'), r = v.getBoundingClientRect(), xs = v.querySelectorAll('.c-l[data-n]');
    for (const x of xs) if (x.getBoundingClientRect().bottom > r.top + 40) return +x.dataset.n;
    return 1;
  },
  存() { // 滚停了: 记下看到哪, 标签跟着亮
    if (!外壳.now || 外壳.页中) return;
    const n = 外壳.位();
    外壳.亮(n);
    Object.assign(外壳.记, { 目标: 外壳.now.id, 视图: 外壳.看, 行: n });
    会话('code.view', 外壳.记);
  },
  折行(on) {
    外壳.记.折 = on;
    外壳.$('.c-view').classList.toggle('c-wrap', on);
    const b = 外壳.$('[data-wrap]');
    if (b) b.classList.toggle('on', on);
    外壳.存();
  },
  说(话, 错) {
    const el = 外壳.$('.c-say');
    el.textContent = 话;
    el.className = 'c-say ' + (错 ? 'err' : 'ok');
    clearTimeout(外壳.淡);
    外壳.淡 = setTimeout(() => el.classList.add('fade'), 5000);
  },
  错: e => 外壳.说('✗ ' + (e && e.message || e), 1),
};
// ═ 逐行 · 跟着: 工具, 目标, 外壳, 手术台 ═
// 代码行的画法(导出页照样用): 全局行号 + 大类色的左边线 + 代码, 空行和只有括号的行变淡。
// 源码视图: 这些行一次画完(浏览器的 Ctrl+F 能直接找), 每段一条吸顶的段头行, 点段头行把这段折起来。
// 逐行视图: 每段上面一条段头, 每行一排「行号 | 代码 | 这一行在做什么」, 要点是插在代码里的横条; 代码行和要点互相亮。
// 两种视图里借来的一行下面摆开单独导出时剪进来的代码; ✂ 标记是带色的牌子, 范围里的行号右边一条细线
const 逐行 = {
  行: (l, n, 类, 注, 样) => '<div class="c-l' + (类 || '') + (虚(l) ? ' x' : '') + (样 ? '" style="' + 样 : '')
    + (+n ? '" data-n="' + n : '') + '"><i>' + n + '</i><code>' + esc(l) + '</code>'
    + (注 ? '<p>' + esc(注) + '</p>' : '') + '</div>',   // 「ai:212」这样的源头行号不给 data-n
  头: s => '<div class="c-l c-h' + (s.借 ? ' c-b' : '') + '" data-n="' + s.起 + '"><i>' + s.起 + '</i><code>'
    + esc(行(s.文)[0]) + '</code>' + (s.借 ? ''   // 借来的: 「去看」在下面那块顶上
      : '<small>'
      + (s.止 - s.起 + 1) + ' 行' + ((s.解 && s.解.述 || s.头注) ? ' · ' + esc(s.解 && s.解.述 || s.头注) : '')
      + '</small>'
      + (s.改过 ? '<em data-hist title="看改动记录">● ' + (s.改过 === '新' ? '新加的' : '改过') + '</em>' : '')
      + '<button data-edit title="改这段">✎</button>') + '</div>' + (s.借 && !colony.单独 && 展开.盒(s) || ''),
  色(o, s) { // 这段所在大类的颜色; 没分组时不上色
    const i = ((o.ana || {}).类 || []).findIndex(c => c.段.includes(s.名));
    return i < 0 ? '#0000' : 导图.色[i % 7];
  },
  数: s => [Object.keys((s.解 || {}).注 || {}).length, (s.解 || {}).该 || 0],   // [已讲几行, 要讲几行]
  签(o) { // 顶上那排标签: 分了大类按大类(带讲完几段), 没分按段; 讲完 ✓、有过时 ⚠、在讲 ◌; 点了跳过去, 滚到哪亮哪个
    const 找 = n => o.段.find(s => s.名 === n), 类 = (o.ana || {}).类 || [],
      xs = 类.length ? 类.map((c, i) => [c.名, c.段.map(找).filter(Boolean), 导图.色[i % 7]])
        : o.段.filter(s => !s.借 && s.名 !== '(前言)').map(s => [s.名, [s], 逐行.色(o, s)]);
    return xs.length < 2 ? '' : xs.filter(x => x[1].length).map(([名, ss, c]) => {
      const 要 = ss.filter(s => !s.借), 数 = 逐行.数,
        完 = 要.filter(s => 数(s)[0] >= 数(s)[1] && ((s.解.讲 || []).length || !数(s)[1])).length,   // 全是注释的段不用讲
        记 = 要.some(s => 解析.讲中[o.id + '/' + s.名]) ? ' ◌' : 要.some(s => s.解.旧 || (s.解.讲 || []).some(t => t.旧))
          ? ' ⚠' : 要.length && 完 === 要.length ? ' ✓' : '';
      return '<button data-to="' + ss[0].起 + '" data-b="' + ss[ss.length - 1].止 + '" style="--c:' + c
        + '" title="' + esc(ss.map(s => s.名).join('、')) + '">' + esc(名)
        + (类.length && 要.length ? ' ' + 完 + '/' + 要.length : '') + 记 + '</button>';
    }).join('');
  },
  段: (o, s) => '<section data-s="' + esc(s.名) + '" style="--c:' + 逐行.色(o, s) + '">'
    + 行(s.文).map((l, k) => k || s.无头 ? 逐行.行(l, s.起 + k, '', '', o.圈 && 范围.线(o, s.起 + k)) : 逐行.头(s)).join('')
    + '</section>',
  async 标(el, s) { // 和出厂比: 新加的行一道绿条; 删掉的行在下一行的行号上一个红尖, 鼠标放上去看删了什么
    const d = diffView(s.出厂文, s.文);
    let n = s.起, 删 = [];
    d.hunks.forEach(r => {
      if (r.t === '-') return 删.push(r.a);
      const x = el.querySelector('.c-l[data-n="' + n++ + '"]');
      if (x && r.t === '+') x.classList.add('add');
      if (x && 删.length) x.classList.add('del'), x.title = '这里删了:\n' + 删.join('\n');
      删 = [];
    });
  },
  条(o, s, 卡) { // 段头条: 大类 · 签 · 行范围 · 已讲几行, 名和一句话, 几个键、分成几块、讲到哪; 卡: 导图右栏那张, 多「进逐行」
    const v = s.解 || {}, 类 = ((o.ana || {}).类 || []).find(c => c.段.includes(s.名)),
      [k, n] = 逐行.数(s), 讲过 = (v.讲 || []).length, 模 = v.讲模 || v.模,
      忙 = 解析.讲中[o.id + '/' + s.名],
      述 = esc(v.述 || s.头注 || '这段没写注释, 解析后由模型补一句');
    return '<div class="c-sh"><p class="c-g">' + (类 ? esc(类.名) + ' · ' : '') + (v.签 ? '<code class="c-tag">'
      + esc(v.签) + '</code> ' : '') + '行 ' + s.起 + '–' + s.止 + (n ? ' · 已讲 ' + k + '/' + n + ' 行' : '')
      + (模 ? '<span class="c-mo">' + esc(模) + '</span>' : '') + '</p><h3>' + esc(s.名)
      + (卡 ? '</h3><div class="c-sum">' + 述 + '</div>' : ' <small>' + 述 + '</small></h3>')
      + (v.旧 ? '<div class="c-old">这段改过了, 有些讲解是改之前的 <button data-re>重读</button></div>' : '')
      + '<div class="c-acts">' + (卡 ? '<button data-src="' + s.起 + '">📖 进逐行</button>' : '')
      + '<button data-edit>✎ 改这段</button><button data-ask>💬 发给 agent</button>'
      + (o.版 && o.版.版.some(x => s.名 in x.计) ? '<button data-hist>🕘 改动记录</button>' : '')
      + (卡 ? '' : (v.分 || []).map(x => '<a data-src="' + (s.起 + x.起) + '">▸ ' + esc(x.名) + '</a>').join(''))
      + (忙 ? '<span class="c-busy">◌ 正在讲…</span>' : v.讲错 ? '<span class="c-err">✗ ' + esc(v.讲错)
        + '</span><button data-explain>重试这段</button>' : 讲过 && k >= n || !n ? ''
        : !外壳.有模 ? '<span class="c-g">还没讲</span>'
        : (讲过 || 卡 ? '' : '<span class="c-g">停一会儿就讲</span>') + '<button data-explain>'
          + (讲过 ? '补上 ' + (n - k) + ' 行' : '现在讲') + '</button>')   // 没接模型: 顶上有「接模型」
      + '</div></div>';
  },
  点: (s, t, i, 链) => '<div class="c-pt' + (t.旧 ? ' 旧' : '') + '" data-a="' + (s.起 + t.起) + '" data-b="'
    + (s.起 + t.止) + '"><b>' + (i + 1) + '</b><p><strong>' + esc(t.图 + ' ' + t.标) + '</strong> — ' + esc(t.话)
    + ' <small>行 ' + (s.起 + t.起) + '–' + (s.起 + t.止) + '</small>'
    + (链 ? ' <a data-src="' + (s.起 + t.起) + '">→ 看这几行</a>' : '') + '</p></div>',
  排(o, s) { // 逐行视图的一段(导出页照样用): 段头条, 每行一排三格, 要点横条插在它第一行前面; 还没注的段代码占满
    const v = s.解 || {}, 注 = v.注 || {}, 讲 = v.讲 || [], 单 = s.借 || s.名 === '(前言)';
    return '<section class="c-row' + (单 ? ' c-1' : '') + (Object.keys(注).length ? '' : ' c-nn') + '" data-s="'
      + esc(s.名) + '" style="--c:' + 逐行.色(o, s) + '">' + (s.借 ? 逐行.头(s) : (单 ? '' : 逐行.条(o, s))
      + 行(s.文).map((l, k) => 讲.map((t, i) => t.起 === k ? 逐行.点(s, t, i) : '').join('')
        + 逐行.行(l, s.起 + k, k || s.无头 ? '' : ' c-sep', 注[k], o.圈 && 范围.线(o, s.起 + k))).join(''))
      + '</section>';
  },
  卡(o, s) { // 导图右栏点了一段: 段头条 + 分成几块 + 全部讲解; 外面要包一层带 data-s 的
    const v = s.解 || {}, 分 = (xs, d) => (xs || []).map(x => '<p class="c-sub' + (x.旧 ? ' 旧' : '')
      + '" data-src="' + (s.起 + x.起) + '" style="margin-left:' + d * 14 + 'px">▸ <b>' + esc(x.名)
      + '</b> <small>' + (s.起 + x.起) + '–' + (s.起 + x.止) + '</small> ' + esc(x.述 || '') + '</p>'
      + 分(x.分, d + 1)).join('');
    if (s.借) return '<p class="c-g">↦ 借来的一行, 原文在 ' + (colony.单独 ? esc(s.借) : '<button data-go="' + esc(s.借)
      + '">' + esc(s.借) + '</button>') + '</p>';   // 没有 Stem(单独打开、离线页)去不了源头, 只留字
    return 逐行.条(o, s, 1) + (v.分 ? '<p class="c-h4">🧩 分成几块</p>' + 分(v.分, 0) : '') + ((v.讲 || []).length
      ? '<p class="c-h4">💡 通俗讲解</p>' + v.讲.map((t, i) => 逐行.点(s, t, i, 1)).join('') : '');
  },
  块(o, s, n) { // 导图上点了细分或要点: 只出这一块, 下面是这几行代码, 每行跟着它的注(最多 30 行)
    const a = n.起 - s.起, 注 = (s.解 || {}).注 || {}, ls = 行(s.文).slice(a, Math.min(n.止 - s.起, a + 29) + 1),
      钮 = t => '<button data-src="' + n.起 + '">' + t + '</button>';
    return '<div class="c-sh"><p class="c-g">' + esc(s.名) + ' › 行 ' + n.起 + '–' + n.止 + '</p><h3>' + esc(n.名)
      + '</h3>' + (n.注 ? '<div class="c-sum">' + esc(n.注) + '</div>' : '') + '<div class="c-acts">'
      + 钮('📖 看这几行') + '</div></div><div class="c-dl">'
      + ls.map((l, i) => 逐行.行(l, n.起 + i, '', 注[a + i])).join('') + '</div>'
      + (n.止 - n.起 >= 30 ? '<p class="c-g">只列了前 30 行 ' + 钮('进逐行看全部') + '</p>' : '');
  },
  哪(o, n) { // 第 n 行在哪: 大类 › 段 › 细分 · 管它的要点(逐行视图顶上那条)
    const s = o.段.find(x => x.起 <= n && n <= x.止), v = s && s.解 || {}, k = s ? n - s.起 : 0,
      类 = s && ((o.ana || {}).类 || []).find(c => c.段.includes(s.名)), 路 = [类 && 类.名, s && s.名],
      t = (v.讲 || []).find(x => x.起 <= k && k <= x.止);
    for (let xs = v.分, x; xs && (x = xs.find(y => y.起 <= k && k <= y.止)); xs = x.分) 路.push(x.名);
    return 路.filter(Boolean).join(' › ') + (t ? ' · ' + t.图 + ' ' + t.标 : '');
  },
  亮(el) { // 互相亮(导出页也用): 鼠标在代码行上, 管它的要点条亮; 在要点条上, 它那几行亮
    el.onmouseover = e => {
      el.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
      const t = e.target.closest('.c-row>.c-l,.c-row>.c-pt'), 是行 = t && t.matches('.c-l');
      if (!t) return;
      const a = +(是行 ? t.dataset.n : t.dataset.a), b = 是行 ? a : +t.dataset.b;
      t.classList.add('hl');
      t.parentNode.querySelectorAll(是行 ? ':scope>.c-pt' : ':scope>.c-l').forEach(x => (是行
        ? +x.dataset.a <= a && a <= +x.dataset.b : +x.dataset.n >= a && +x.dataset.n <= b)
        && x.classList.add('hl'));
    };
  },
  卡点(e, o) { // 卡片和段头行上的键, 各视图共用; 认出来了回 true
    const b = e.target.closest('[data-src],[data-ask],[data-go],[data-explain],[data-re],[data-edit],'
      + '[data-hist]'),
      w = b && b.closest('[data-s]');
    if (!b) return;
    const s = w && o.段.find(x => x.名 === w.dataset.s), x = b.dataset;
    if (x.src) 外壳.跳(+x.src);
    else if (x.go) 外壳.去(x.go);
    else if (!s) return;
    else if ('ask' in x) 详情.问({ 段: s.名, 起: s.起, 止: s.止, 注: (s.解 || {}).述 || s.头注 });
    else if ('explain' in x) 解析.讲(o, s.名);
    else if ('edit' in x) 手术台.开(s.名).catch(外壳.错);
    else if ('hist' in x) 手术台.记录(s.名).catch(外壳.错);
    else 解析.架构(o, [s.名]).catch(外壳.错);
    return true;
  },
  选(el, o) { // 画完代码行后: 改过的段标出增删, 借来的摆开; 选中几行代码, 选区旁冒出小条: 问 agent / 复制 / 圈成范围
    o.段.filter(s => s.改过).forEach(s => 逐行.标(el, s).catch(外壳.错));
    if (!colony.单独) 展开.展(el, o).catch(外壳.错);
    el.onmouseup = () => setTimeout(() => {
      const 旧 = 外壳.$('.c-selbar'), sel = getSelection(), t = sel.toString();
      if (旧) 旧.remove();
      if (!t.trim() || !el.contains(sel.anchorNode)) return;
      const ns = [...el.querySelectorAll('.c-l[data-n]')].filter(l => sel.containsNode(l, true))
        .map(l => +l.dataset.n);
      if (!ns.length) return;
      const a = ns[0], b = ns[ns.length - 1], s = o.段.find(x => x.起 <= a && a <= x.止),
        名 = o.id + '/' + (s ? s.名 : '') + ' 第 ' + a + '–' + b + ' 行',
        bar = 外壳.贴(sel.getRangeAt(0).getBoundingClientRect(), ' c-selbar');
      bar.innerHTML = '<button data-q>💬 问 agent · 第 ' + a + '–' + b + ' 行</button><button>📋 复制</button>'
        + (!colony.单独 && 手术台.能剪(o) ? '<button data-k>✂ 圈成范围</button>' : '');
      bar.onclick = e => {
        if ('k' in e.target.dataset) return 手术台.表(bar, o, a, b);
        const 问 = 'q' in e.target.dataset;
        (问 ? ctx.call('agent.attach', { name: 名, text: t }) : navigator.clipboard.writeText(t))
          .then(() => 外壳.说(问 ? '已放到 agent 输入框上方: ' + 名 : '复制好了'),
            () => 外壳.说(问 ? 'agent 不在, 没人接' : '复制不了', 1));
        bar.remove();
      };
    });
  },
  源码: {
    名: '📄 源码',
    画(el, o) {
      el.innerHTML = '<div class="c-code">' + o.段.map(s => 逐行.段(o, s)).join('') + (o.删了 && o.删了.length
        ? '<p class="c-g">出厂有、现在删了的段: ' + esc(o.删了.join('、')) + '</p>' : '') + '</div>';
      逐行.选(el, o);
    },
    点(e) {
      const h = e.target.closest('.c-h');
      if (e.target.dataset.cut) return 手术台.拆(e.target).catch(外壳.错);
      if (逐行.卡点(e, 外壳.now)) return;
      if (h && !h.classList.contains('c-b') && !getSelection().toString()) {
        h.parentNode.classList.toggle('c-fold');
      }
    },
  },
  视图: {
    名: '📖 逐行',
    画(el, o) { // 顶上吸着一条: 现在看到哪, 右边「这一行在做什么」能左右拖(宽度记住)
      const hs = 逐行.hs = {};
      el.innerHTML = '<div class="c-lv"' + (外壳.记.宽 ? ' style="--cw:' + 外壳.记.宽 + 'px"' : '')
        + '><div class="c-lh"><span></span><b title="左右拖, 调注这一栏的宽窄">这一行在做什么</b></div>'
        + o.段.map(s => { const h = 逐行.排(o, s); hs[s.名] = 纹(h); return h; }).join('') + '</div>';
      const lv = el.firstChild;
      外壳.拖(lv.querySelector('.c-lh b'), m => { // 注栏占 20% 到 60%
        const r = lv.getBoundingClientRect();
        lv.style.setProperty('--cw', (外壳.记.宽 = Math.round(Math.max(r.width * .2,
          Math.min(r.width * .6, r.right - m.clientX)))) + 'px');
      });
      逐行.选(el, o);
      逐行.看着(el, o);
      逐行.亮(el);
    },
    更(el, o) { // 解读变了: 只换内容变了的那几段, 眼前那一行留在原处
      const n = 外壳.位(), 顶 = () => (el.querySelector('.c-l[data-n="' + n + '"]') || el)
        .getBoundingClientRect().top, y = 顶();
      el.querySelectorAll('.c-lv>section').forEach(w => {
        const s = o.段.find(x => x.名 === w.dataset.s), h = s && 逐行.排(o, s),
          t = document.createElement('template');
        if (!s || 逐行.hs[s.名] === 纹(h)) return;
        逐行.hs[s.名] = 纹(h);
        t.innerHTML = h;
        const x = t.content.firstChild;
        w.replaceWith(x);
        if (逐行.观 && !x.classList.contains('c-1')) 逐行.观.observe(x);
        if (s.改过) 逐行.标(x, s).catch(外壳.错);
      });
      el.scrollTop += 顶() - y;
    },
    点: e => 逐行.卡点(e, 外壳.now),
  },
  看着(el, o) { // 一段露出来停够 0.6 秒才去补(没讲、缺注、要点对不上), 快速滚过不花钱; 讲过一遍的同样代码不自己再问
    if (逐行.观) 逐行.观.disconnect();
    if (!外壳.有模 || typeof IntersectionObserver === 'undefined') return;
    const 钟 = new Map();
    逐行.观 = new IntersectionObserver(es => es.forEach(e => {
      const s = o.段.find(x => x.名 === e.target.dataset.s), x = s && o.ana.段[s.名];
      clearTimeout(钟.get(e.target));
      if (e.isIntersecting && s && !(x && x.讲错) && 解析.要(s, x)) {
        钟.set(e.target, setTimeout(() => 外壳.now === o && 外壳.看 === '逐行' && 解析.讲(o, s.名), 600));
      }
    }), { root: el });
    el.querySelectorAll('.c-row:not(.c-1)').forEach(c => 逐行.观.observe(c));
  },
};
// ✂ 单独时不带 · 号: 就地展开
// 只在 Colony 里用(离线页不带): 借来的一行下面摆开单独导出时剪进来的代码; ✂ 标记是带色的牌子, 范围里的行一条细线
const 展开 = {
  盒: s => '<details class="c-bx" open data-bx="' + esc(s.名) + '"><summary><span>⋯</span><a data-go="'
    + esc(s.借) + '">去看</a></summary></details>',
  存: {},
  async 展(el, o) { // 填借来的一行下面那块: stem.molt 单独导出真剪的那份(按这块和源头全文缓存), 导不出照抄门禁的话
    const bx = el.querySelectorAll('[data-bx]'), 源 = {}, c = 展开.存[o.id];
    if (o.类 !== '块' || o.id === 'stem' || !bx.length) return;
    for (const s of o.段) if (s.借) 源[目标.源(s.借)[0]] = '';
    for (const id in 源) 源[id] = (await ctx.call('stem.block', { id, full: true })).code;
    const 键 = 纹(o.文 + Object.values(源).join('\u0001')), d = c?.键 === 键 ? c.盒 : (展开.存[o.id] = { 键,
      盒: 目标.摆(o, await ctx.call('stem.molt', { ids: [o.id], stem: false, 号: true }).catch(e => e), 源) }).盒;
    bx.forEach(x => {
      const v = d[x.dataset.bx];
      x.querySelector('span').textContent = v.头;
      x.insertAdjacentHTML('beforeend', (v.行 || []).map(([n, l]) => 逐行.行(l, n, n ? '' : ' c-gap')).join(''));
    });
  },
}, 范围 = {
  彩: n => 'hsl(' + parseInt(纹(n), 16) % 360 + ' 65% 62%)',   // 一个范围名一个颜色
  线(o, n) { // 第 n 行的样: 标记行 --k 是它的颜色, 圈着它的一条挨一条(--r)
    const k = o.圈.标[n], r = o.圈.线[n];
    return (k ? '--k:' + 范围.彩(k[0]) + ';' : '')
      + (r ? '--r:' + r.map((x, i) => 'inset -' + 2 * (i + 1) + 'px 0 ' + 范围.彩(x)).join() : '');
  },
  范: o => Object.entries(o.圈.记).map(([m, x]) => '✂<a data-to="' + x.头 + '" style="--k:' + 范围.彩(m)
    + '">' + esc(m) + '</a>' + x.行 + ' 行' + (x.要.length ? ' · 被 ' + esc(x.要.join('、')) + ' 要' : '')
    + (手术台.能剪(o) ? '<button data-cut="' + esc(m) + '">拆</button>' : '')).join(' | '),
};
// ✂ 单独时不带 完
// ═ 地图 · 跟着: 工具, 目标, 解析, 对齐, 版本 ═
// 读(id): 目标 + 它的解读(每段现算对不对得上)。数据(): 导图和详情用的那份, 没解析时一句话取段头下的注释。
// 文(): code.map 回的三层文字(省字, 不是 JSON), 每层末行写下一步; 目标那层顶上先列业务架构图的节点;
// make 就先让模型把缺的补上(解析、业务架构图、这段的讲解)
const 地图 = {
  async 读(id) {
    const o = await 目标.读(id), a = await 解析.读(o.id);
    解析.套(o, a);
    o.ana = a;
    o.段.forEach(s => s.解 = 对齐.看(s, a.段[s.名]));
    o.版 = await 版本.对(o).catch(e => console.warn('[代码解读] 改动记录没记上', e));   // 别处改了也在这里记上一版
    return o;
  },
  数据: o => ({ 名: o.名, 总述: o.ana.总述, 类: (o.ana.类 || []).length ? o.ana.类 : undefined,
    段: o.段.filter(s => s.名 !== '(前言)').map(s => { const v = s.解 || {}; return { 名: s.名, 起: s.起,
      止: s.止, 注: v.述 || s.头注 || (s.借 ? '↦ 借 ' + s.借 : ''), 借: s.借, 改: s.改过, 跟着: s.跟着,
      借用者: s.借用者 || [], 签: v.签, 分: v.分, 讲: v.讲, 旧: v.旧, 错: v.错 || v.讲错, 忙: 解析.讲中[o.id + '/' + s.名],
      已: Object.keys(v.注 || {}).length, 该: v.该 || 0 }; }) }),
  头(o, 顶) { // 名 · 几行 · 几段 · 改过几段 · 解读几段 · 过时几段; 顶: 顶栏那份, 不带名字和过时(顶栏有「重读」键)
    const 段 = o.段.filter(s => s.名 !== '(前言)' && !(s.无头 && !s.切)), 要 = 段.filter(s => !s.借),
      改 = 段.filter(s => s.改过).length, 旧 = 顶 ? 0 : 段.filter(s => s.解.旧).length;
    return (顶 ? '' : o.id + ' ' + o.名) + ' · ' + o.行数.toLocaleString() + ' 行'
      + (段.length ? ' · ' + 段.length + ' 段' : '') + (改 ? ' · 改过 ' + 改 + ' 段' : '')
      + (o.ana.at ? ' · 解读 ' + 要.filter(s => s.解.述).length + '/' + 要.length : '') + (旧 ? ' · 过时 ' + 旧 : '');
  },
  行: s => s.名 + ' 行 ' + s.起 + '-' + s.止 + ' (' + (s.止 - s.起 + 1) + ' 行): ' + (s.借 ? '' : s.注)
    + (s.签 ? ' [' + s.签 + ']' : '') + (s.改 ? ' [●' + (s.改 === '新' ? '新加的' : '改过') + ']' : '')
    + (s.旧 ? ' [⚠过时]' : '') + (s.借 ? ' [↦ 借 ' + s.借 + ']' : '')
    + (s.已 ? ' [已讲 ' + s.已 + '/' + s.该 + ' 行]' : ''),
  分: (s, xs, d) => (xs || []).map(x => '  '.repeat(d) + '· ' + x.名 + ' 段内 ' + x.起 + '-' + x.止
    + (x.述 ? ': ' + x.述 : '') + '\n' + 地图.分(s, x.分, d + 1)).join(''),
  async 文(a) {
    if (!a.id) {
      const ls = [];
      for (const t of await 目标.列()) {
        const o = await 地图.读(t.id).catch(() => null);
        ls.push(o ? 地图.头(o) : t.id + ' ' + t.名 + ' · 读不出');
      }
      return ls.join('\n') + '\n下一步: code.map {id} 看一个目标的段';
    }
    let o = await 地图.读(a.id);
    if (a.make && !o.ana.at) await 解析.架构(o), o = await 地图.读(a.id);
    if (a.make && (x => x && 解析.计(x, o.ana.段[x.名]).次)(o.段.find(s => s.名 === a.segment))) {   // 没讲或缺注
      await 解析.讲(o, a.segment);
      o = await 地图.读(a.id);
    }
    if (a.make && o.ana.at && !o.ana.图 && !a.segment) await 画图师.画(o), o = await 地图.读(a.id);
    const d = 地图.数据(o), 头 = 地图.头(o) + (d.总述 ? '\n' + d.总述 : '');
    if (!a.segment) {
      const 列 = ss => ss.map(s => 地图.行(s) + '\n' + 地图.分(s, s.分, 2)).join('');
      return 头 + '\n' + 画图师.文(o) + (d.类 ? d.类.map(c => '【' + c.名 + '】\n' + 列(c.段.map(n => d.段.find(s => s.名 === n))
        .filter(Boolean))).join('') : 列(d.段)) + (o.ana.at ? '' : '(还没解析: 一句话取自段头注释; make:true 会先跑架构师)\n')
        + '下一步: code.map {id, segment} 看一段; 改之前用 stem.block {id, segment} 读原文(地图只用来导航, 不能当证据)';
    }
    const s = d.段.find(x => x.名 === a.segment), 原 = o.段.find(x => x.名 === a.segment);
    if (!s) throw new Error('没有这段: ' + a.segment + '; 有 ' + d.段.map(x => x.名).join('、'));
    const 注 = (原.解 || {}).注 || {};
    return 头 + '\n' + 地图.行(s) + (s.跟着.length ? '\n跟着: ' + s.跟着.join(', ') : '')
      + (s.借用者.length ? '\n借用者: ' + s.借用者.join(', ') : '')
      + (s.分 ? '\n细分:\n' + 地图.分(s, s.分, 1) : '')
      + (s.讲 ? '\n讲解:\n' + s.讲.map(t => '  ' + t.图 + ' ' + t.标 + ' — ' + t.话 + ' [段内 ' + t.起 + '-' + t.止
        + ']').join('\n') : '')
      + (Object.keys(注).length ? '\n逐行注(段内行: 话):\n' + Object.keys(注).map(k => '  ' + k + ': ' + 注[k])
        .join('\n') : '')
      + '\n下一步: ' + (s.讲 ? '' : 'code.map {id, segment, make: true} 让模型讲这段; ') + (o.类 === '块'
        ? 'stem.block {id: \'' + o.id + '\', segment: \'' + s.名 + '\'} 读原文' : 'apps.get 读原文');
  },
};
// ═ 导图 · 跟着: 工具 ═
// 横向的树: 根 → 大类 → 段 → 细分 → 要点。树() 和 画() 是纯函数, 画() 回 SVG 字符串, 导出页照样用;
// 控() 管滚轮缩放、拖动、折叠、单击双击, 监听只挂在这张 svg 上, 重画不会越积越多
const 导图 = {
  色: ['#b5ff00', '#5ec8ff', '#ff9f43', '#c78bff', '#ff6b9a', '#3ddc97', '#ffd93d'],
  截(t, 最宽) { // 按字估宽, 汉字算 1em(12px); 超了截断加 …
    let o = '';
    for (const c of String(t)) if (导图.长(o + c) > 最宽) return o + '…'; else o += c;
    return o;
  },
  长: t => [...String(t)].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 12 : 7), 18),
  树(d) { // d: {名, 总述?, 类?:[{名, 段:[段名]}], 段:[{名, 起, 止, 注, 借?, 改?, 旧?, 忙?, 错?, 分?, 讲?}]}
    const 挂 = (n, x) => { // 要点挂在管得着它第一行的最深那一块下面
      const k = n.子.find(c => c.种 === '分' && c.起 <= x.起 && x.起 <= c.止);
      k ? 挂(k, x) : n.子.push(x);
    };
    const 分 = (x, s, 键, 色) => ({ 种: '分', 名: x.名, 注: x.述, 键, 段: s.名, 起: s.起 + x.起, 止: s.起 + x.止, 色,
      旧: x.旧, 子: (x.分 || []).map((y, i) => 分(y, s, 键 + '/' + i, 色)) });
    const 段 = (s, 色) => {
      const n = Object.assign({}, s, { 种: '段', 键: '段:' + s.名, 段: s.名, 色 });
      n.子 = (s.分 || []).map((x, i) => 分(x, s, n.键 + '/' + i, 色));
      (s.讲 || []).forEach((x, i) => 挂(n, { 种: '讲', 名: x.图 + ' ' + x.标, 注: x.话, 键: n.键 + '#' + i, 段: s.名,
        起: s.起 + x.起, 止: s.起 + x.止, 色, 子: [] }));
      return n;
    };
    const 子 = d.类 ? d.类.map((c, i) => ({ 种: '类', 名: c.名, 键: '类:' + c.名, 色: i % 7,
      子: c.段.map(n => d.段.find(s => s.名 === n)).filter(Boolean).map(s => 段(s, i % 7)) }))
      : d.段.map(s => 段(s, 0));
    const 表 = {}, 压 = (n, 父) => { // 只有一个孩子的一串压成「A › B」; 压好的记进 表, 收起的子树也记上父节点
      while (n.种 !== '根' && n.子.length === 1 && n.子[0].种 !== '讲') {
        Object.assign(n, n.子[0], { 名: n.名 + ' › ' + n.子[0].名 });
      }
      表[n.键] = n;
      n.父 = 父;
      n.子.forEach(c => 压(c, n));
      return n;
    };
    return [压({ 种: '根', 名: d.名, 键: '根', 注: d.总述, 子, 最多: Math.max(1, ...d.段.map(s => s.止 - s.起 + 1)) }), 表];
  },
  画(t, 收, 选, 限 = 1e4) { // → {svg, 宽, 高}; 收: 收起来的节点键(Set), 选: 选中的键, 限: 图最宽多少, 尾巴按它截
    const vs = [], 列 = [], xs = [0], C = i => 导图.色[i || 0];
    let y = 0;
    const 走 = (n, 深, 父) => { // 段框里右边一个记号: ✗ 出错 / ◌ 在讲 / ⚠ 过时 / ✓ 讲过
      n.记 = n.种 !== '段' ? '' : n.错 ? '✗' : n.忙 ? '◌' : n.旧 ? '⚠' : (n.讲 || []).length ? '✓' : '';
      Object.assign(n, { 深, 父, w: Math.min(240, 导图.长(n.名) + (n.记 ? 14 : 0)),
        开: n.子.length > 0 && !收.has(n.键) });
      列[深] = Math.max(列[深] || 0, n.w + (n.子.length ? 34 : 10));
      vs.push(n);
      if (n.开) n.子.forEach(k => 走(k, 深 + 1, n));
    };
    const 排 = n => {
      n.x = xs[n.深];
      if (!n.开) return n.y = y += 30;
      n.子.forEach(排);
      n.y = (n.子[0].y + n.子[n.子.length - 1].y) / 2;
    };
    走(t, 0, null);
    列.forEach((w, i) => xs[i + 1] = xs[i] + w + 36);
    排(t);
    let 宽 = xs[列.length];
    vs.forEach(n => { // 收着的段和细分后面写「N 行 · 一句话」(大类写几段), 按剩下的宽度截; 全文在悬停和右栏
      const x = n.w + (n.子.length ? 20 : 10), 话 = n.开 ? '' : n.种 === '类' ? n.子.length + ' 段'
        : !/段|分/.test(n.种) ? '' : n.借 ? n.注 : n.止 - n.起 + 1 + ' 行' + (n.注 ? ' · ' + n.注 : '');
      n.尾 = 话 && 导图.截(话, Math.max(60, Math.min(280, 限 - n.x - x)));
      宽 = Math.max(宽, n.x + x + (n.尾 ? 导图.长(n.尾) : 0));
    });
    const 线 = vs.filter(n => n.父).map(n => {
      const p = n.父, x1 = p.x + p.w + 16, m = (x1 + n.x) / 2;
      return '<path d="M' + x1 + ',' + p.y + 'C' + m + ',' + p.y + ' ' + m + ',' + n.y + ' ' + n.x + ',' + n.y
        + '" stroke="' + C(n.色) + '"/>';
    }).join('');
    const 字 = (x, t, 类) => '<text class="' + (类 || '') + '" x="' + x + '" y="4">' + t + '</text>',
      圈 = (类, x, r) => '<circle class="' + 类 + '" cx="' + x + '" cy="' + (r > 5 ? 0 : -10)
        + '" r="' + r + '"/>';
    const 点 = vs.map(n => '<g class="n ' + n.种 + (n.旧 ? ' 旧' : '') + (n.借 ? ' 借' : '')
      + (n.键 === 选 ? ' 选' : '') + '" data-k="' + esc(n.键) + '" transform="translate(' + n.x + ',' + n.y
      + ')" style="--k:' + C(n.色) + '">'
      + '<rect y="-11" width="' + n.w + '" height="22" rx="' + (n.种 === '讲' ? 11 : 6) + '"/>'
      + 字(9, esc(导图.截(n.名, n.记 ? 226 : 240)), '名') + (n.改 ? 圈('dot', n.w, 3.5) : '')
      + (n.记 ? 字(n.w - 15, n.记, 'st ' + { '✗': 'bad', '◌': 'busy', '⚠': 'old', '✓': '' }[n.记]) : '')
      + (n.种 === '段' ? '<rect class="len" y="9" height="2" width="'   // 底下一条线, 长短按行数开根号: 一眼看出哪段大
        + Math.max(3, n.w * Math.sqrt((n.止 - n.起 + 1) / t.最多)).toFixed(1) + '"/>' : '')
      + (n.子.length ? '<g class="pm">' + 圈('', n.w + 8, 7)
        + '<text x="' + (n.w + 8) + '" y="3.5">' + (n.开 ? '−' : '+') + '</text></g>' : '')
      + (n.尾 ? 字(n.w + (n.子.length ? 20 : 10), esc(n.尾), '注') : '')
      + '<title>' + esc(n.名 + (n.注 ? '\n' + n.注 : '')) + '</title></g>').join('');
    return { svg: '<g class="e">' + 线 + '</g>' + 点, 宽, 高: y + 30 };
  },
  放: (svg, v) => svg.firstChild.setAttribute('transform',
    'translate(' + v.px + ',' + v.py + ') scale(' + v.s + ')'),
  画进(svg, v, t, 收, 选, 满) { // 画好放进这张 svg; 满: 再铺满, 根在左边, 上下居中
    const r = svg.getBoundingClientRect(), W = r.width || 800, H = r.height || 500,
      g = 导图.画(t, 收, 选, (W - 40) / .8);
    svg.firstChild.innerHTML = g.svg;
    if (!满) return;
    v.s = Math.max(.8, Math.min(1.5, (W - 40) / g.宽, (H - 40) / g.高));   // 最小 0.8 倍: 放不下由 够() 先收一层, 不缩字
    Object.assign(v, { px: 20, py: Math.max(20, (H - g.高 * v.s) / 2), 手: 0 });   // 太高就从顶上看起
    导图.放(svg, v);
  },
  收: (表, 收, 要) => Object.values(表).forEach(n => n.子.length && n.种 !== '根' && 要(n) && 收.add(n.键)),
  够(t, 表, 收, 容) { // 默认看到段这一层(细分和要点收着); 0.8 倍还放不下就把大类也收起, 不缩字; 导出页也用
    const 行 = n => !n.子.length || 收.has(n.键) ? 1 : n.子.reduce((s, c) => s + 行(c), 0);
    收.clear();
    [['段', '分'], ['类', '段', '分']].some(k => (导图.收(表, 收, n => k.includes(n.种)), 行(t) <= 容));
  },
  控(svg, v, on) { // v = {s, px, py} 会被改写; on = {点(键), 双(键), 折(键)}
    let 按 = null, 动 = 0;
    svg.onwheel = e => { // 以指针为中心缩放; 人动过就不再自动铺满
      e.preventDefault();
      v.手 = 1;
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top,
        s = Math.max(.2, Math.min(3, v.s * (e.deltaY < 0 ? 1.12 : .89)));
      Object.assign(v, { px: mx - (mx - v.px) * s / v.s, py: my - (my - v.py) * s / v.s, s });
      导图.放(svg, v);
    };
    svg.onpointerdown = e => { 按 = [e.clientX, e.clientY, v.px, v.py]; 动 = 0; };
    svg.onpointermove = e => { // 挪过 3px 才算拖, 这时才抓住指针(一按就抓, 点击会落到 svg 上认不出节点)
      if (!按) return;
      const dx = e.clientX - 按[0], dy = e.clientY - 按[1];
      if (!动 && Math.abs(dx) + Math.abs(dy) > 3) 动 = v.手 = 1, svg.setPointerCapture(e.pointerId);
      if (动) v.px = 按[2] + dx, v.py = 按[3] + dy, 导图.放(svg, v);
    };
    svg.onpointerup = () => 按 = null;
    svg.onclick = e => {
      const n = e.target.closest('.n');
      if (!动 && n) (e.target.closest('.pm') ? on.折 : on.点)(n.dataset.k);
    };
    svg.ondblclick = e => {
      const n = e.target.closest('.n');
      if (n && !e.target.closest('.pm')) on.双(n.dataset.k);
    };
  },
};
// ═ 布图 · 跟着: 工具 ═
// 架构图的排版, 纯函数(导出页照样用): 节点 {id, 行, 列, w, h} → 坐标; 连线走直角, 只走行列之间的空道, 所以不会穿过方块。
// 位置: 列宽取这一列最宽的, 空道宽按要过的标签留; 行列先压紧(空着的行列去掉)。没给行列的(粗图、点进去那层)用 分层() 排。
// 走线: 每条线从方块边的口出来, 先到旁边那条空道, 在空道网上找 长度 + 拐弯 + 交叉 最省的路; 同一边几条线把口错开,
// 同一条空道上几条线分车道, 同起点或同终点的并成一束。量(): 数交叉, 画图师拿它让模型调位置
const 布图 = {
  字宽: (t, px) => [...String(t || '')].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? px : px * .6), 0),
  分层(ns, es) { // 没有行列的图: A 用 B 就 A 在左、B 在右; 先去掉能绕过去的线(A→B→C 时 A→C 不画), 层里按邻居的位置排
    const 出 = {}, 入 = {};
    ns.forEach(n => (出[n.id] = [], 入[n.id] = []));
    es.forEach(e => 出[e.从] && 入[e.到] && e.从 !== e.到 && (出[e.从].push(e.到), 入[e.到].push(e.从)));
    const 层 = {}, 走 = new Set(), 深 = id => { // 最长路; 成环的那条回头线不算
      if (层[id] != null) return 层[id];
      if (走.has(id)) return 0;
      走.add(id);
      层[id] = Math.max(0, ...入[id].map(p => 走.has(p) && 层[p] == null ? 0 : 深(p) + 1));
      走.delete(id);
      return 层[id];
    };
    ns.forEach(n => 深(n.id));
    const 列 = [];
    ns.forEach(n => (列[层[n.id]] = 列[层[n.id]] || []).push(n));
    const 序 = {};
    列.forEach(c => c.forEach((n, j) => 序[n.id] = j));
    for (let k = 0; k < 6; k++) { // 来回扫几遍: 往右扫按左边连着的平均位置排, 往左扫按右边的
      const 向 = k % 2 ? 列.slice().reverse() : 列;
      向.forEach(c => {
        c.forEach((n, j) => {
          const 邻 = (k % 2 ? 出[n.id] : 入[n.id]).map(x => 序[x]);
          n.权 = 邻.length ? 邻.reduce((s, x) => s + x, 0) / 邻.length : 序[n.id];
        });
        c.sort((p, q) => p.权 - q.权).forEach((n, j) => 序[n.id] = j);
      });
    }
    列.forEach((c, i) => c.forEach((n, j) => (n.列 = i, n.行 = j + Math.max(0, (Math.max(...列.map(x => x.length))
      - c.length) / 2 | 0))));   // 短的列上下居中
  },
  减(ns, es) { // 传递约简: 去掉能经别的路走到的线; 只在没写话的线上做(写了话的是模型特意说的)
    const 出 = {};
    es.forEach(e => (出[e.从] = 出[e.从] || []).push(e.到));
    const 能到 = (a, b, 跳) => { // 不走 a→b 这条直线, 从 a 能不能到 b
      const 见 = new Set([a]), 队 = (出[a] || []).filter(x => !(x === b && 跳)).slice();
      while (队.length) {
        const x = 队.shift();
        if (x === b) return true;
        if (见.has(x)) continue;
        见.add(x);
        队.push(...(出[x] || []));
      }
      return false;
    };
    return es.filter(e => e.话 || e.主 || !能到(e.从, e.到, 1));
  },
  排(g) { // → 位 {id: {x, y, w, h, 行, 列}}, 道 {横: [y], 竖: [x]}, 宽, 高; 行列先压紧
    const ns = g.节点, 压 = k => { const vs = [...new Set(ns.map(n => n[k]))].sort((a, b) => a - b);
      ns.forEach(n => n[k] = vs.indexOf(n[k])); return vs.length; };
    const R = 压('行'), C = 压('列'), 列宽 = Array(C).fill(0), 行高 = Array(R).fill(0), 列缝 = Array(C + 1).fill(56),
      行缝 = Array(R + 1).fill(56), 位 = {};
    ns.forEach(n => (列宽[n.列] = Math.max(列宽[n.列], n.w), 行高[n.行] = Math.max(行高[n.行], n.h)));
    const 量 = t => 布图.字宽(t, 10.5) + 22;
    g.线.forEach(e => { // 同一行左右相邻的两个方块: 中间留够标签的宽; 上下的线标签横着放在行缝里, 行缝也按标签留高
      const a = ns.find(n => n.id === e.从), b = ns.find(n => n.id === e.到);
      if (!a || !b || !e.话) return;
      if (a.行 === b.行 && Math.abs(a.列 - b.列) === 1) {
        const i = Math.max(a.列, b.列);
        列缝[i] = Math.max(列缝[i], 量(e.话) + 28);
      } else if (a.行 !== b.行) {
        const i = Math.max(a.行, b.行);
        行缝[i] = Math.max(行缝[i], 70);
      }
    });
    列缝[0] = 行缝[0] = 40;   // 外圈的道窄一点, 绕路时才用
    列缝[C] = 行缝[R] = 40;
    const xs = [], ys = [];
    列宽.reduce((x, w, i) => (xs[i] = x + 列缝[i], xs[i] + w), 20);
    行高.reduce((y, h, i) => (ys[i] = y + 行缝[i], ys[i] + h), 20);
    ns.forEach(n => 位[n.id] = { x: xs[n.列] + (列宽[n.列] - n.w) / 2, y: ys[n.行] + (行高[n.行] - n.h) / 2, w: n.w, h: n.h,
      行: n.行, 列: n.列 });
    const 竖 = xs.map((x, i) => x - 列缝[i] / 2).concat(xs[C - 1] + 列宽[C - 1] + 列缝[C] / 2),
      横 = ys.map((y, i) => y - 行缝[i] / 2).concat(ys[R - 1] + 行高[R - 1] + 行缝[R] / 2);
    return { 位, 道: { 横, 竖 }, 宽: 竖[C] + 20, 高: 横[R] + 20 };
  },
  边(a, b) { // 这条线从 a 哪边出、进 b 哪边: 同一行左右对着; 不同行上下对着
    if (a.行 === b.行) return a.列 < b.列 ? ['右', '左'] : ['左', '右'];
    return a.行 < b.行 ? ['下', '上'] : ['上', '下'];
  },
  口(布, g) { // 每条线两头的口: 同一边几条线按另一头的位置排开, 只有一条就在正中
    const 位 = 布.位, 边上 = {};
    g.线.forEach((e, i) => {
      const a = 位[e.从], b = 位[e.到], [p, q] = 布图.边(a, b);
      e.边 = [p, q];
      (边上[e.从 + p] = 边上[e.从 + p] || []).push([i, 0, b]);
      (边上[e.到 + q] = 边上[e.到 + q] || []).push([i, 1, a]);
    });
    const 口 = g.线.map(() => []);
    Object.entries(边上).forEach(([k, xs]) => {
      const id = k.slice(0, -1), s = k.slice(-1), n = 位[id], 横 = s === '上' || s === '下',
        中 = c => 横 ? c.x + c.w / 2 : c.y + c.h / 2, 长 = 横 ? n.w : n.h, 步 = Math.min(18, (长 - 24) / Math.max(1, xs.length - 1));
      xs.sort((p, q) => 中(p[2]) - 中(q[2])).forEach(([i, 端], j) => {
        const d = (j - (xs.length - 1) / 2) * 步;
        口[i][端] = 横 ? [n.x + n.w / 2 + d, s === '上' ? n.y : n.y + n.h] : [s === '左' ? n.x : n.x + n.w, n.y + n.h / 2 + d];
      });
    });
    const 都 = 口.flatMap((xs, i) => xs.map((P, 端) => ({ P, i, 端, s: g.线[i].边[端] })));
    都.forEach(a => 都.forEach(b => { // 上下(左右)相邻两个方块对着的两个口在一条线上、又不是同一条线: 各往两边让 10px, 免得看着连成一条
      const 竖 = a.s === '下' && b.s === '上', 横 = a.s === '右' && b.s === '左';
      if (a.i === b.i || !(竖 || 横)) return;
      const k = 竖 ? 0 : 1;
      const 隔 = b.P[1 - k] - a.P[1 - k];   // b 在 a 下面(右边)、中间只隔一条道: 是两个方块对着的面, 不是同一个方块的两面
      if (Math.abs(a.P[k] - b.P[k]) < 6 && 隔 > 0 && 隔 < 90) a.P[k] -= 10, b.P[k] += 10;
    }));
    return 口;
  },
  走(g, 布) { // 每条线 → 折线点; 主线先走, 再按远近; 已走的线记着, 后走的避开交叉和抢道
    const 口 = 布图.口(布, g), { 横, 竖 } = 布.道, 已 = [], 位 = 布.位,
      穿 = (p, q) => Object.values(位).some(r => { // 这段直线穿不穿方块(两头所在的方块不算)
        const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]), y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
        return x2 > r.x + 1 && x1 < r.x + r.w - 1 && y2 > r.y + 1 && y1 < r.y + r.h - 1;
      });
    const 序 = g.线.map((e, i) => i).sort((i, j) => (g.线[j].主 ? 1 : 0) - (g.线[i].主 ? 1 : 0)
      || 布图.距(口[i]) - 布图.距(口[j]));
    const 路 = [];
    序.forEach(i => {
      const e = g.线[i], [S, T] = 口[i], [p, q] = e.边, 束 = x => x.从 === e.从 || x.到 === e.到;
      if ((S[0] === T[0] || S[1] === T[1]) && !穿(S, T)) return (路[i] = [S, T], 已.push({ e, 点: 路[i] }));   // 正对着又没挡: 一条直线
      const 进 = (P, s) => s === '上' || s === '下' ? [P[0], 横.reduce((b, y) => (s === '下' ? y > P[1] : y < P[1])
        && (b == null || Math.abs(y - P[1]) < Math.abs(b - P[1])) ? y : b, null)]
        : [竖.reduce((b, x) => (s === '右' ? x > P[0] : x < P[0]) && (b == null || Math.abs(x - P[0]) < Math.abs(b - P[0]))
          ? x : b, null), P[1]];
      const A = 进(S, p), B = 进(T, q);
      路[i] = [S].concat(布图.找(A, B, p, q, 横, 竖, 已.filter(x => !束(x.e)).map(x => x.点)), [T]);
      已.push({ e, 点: 路[i] });
    });
    return 布图.道上(路.map(布图.简), g, 布);
  },
  距: ([S, T]) => Math.abs(S[0] - T[0]) + Math.abs(S[1] - T[1]),
  简(ps) { // 去掉重复点和共线的中间点
    const o = [];
    ps.forEach(p => {
      if (o.length && o[o.length - 1][0] === p[0] && o[o.length - 1][1] === p[1]) return;
      const a = o[o.length - 2], b = o[o.length - 1];
      if (a && (a[0] === b[0] && b[0] === p[0] || a[1] === b[1] && b[1] === p[1])) o[o.length - 1] = p; else o.push(p);
    });
    return o;
  },
  找(A, B, p, q, 横, 竖, 别) { // 空道网上的最短路(Dijkstra): 点 = 横道和竖道的交点 + 两头进道的点; 代价 = 长度 + 拐弯 + 交叉 + 抢道
    const 点 = [], 号 = {}, 加 = (x, y) => { const k = x + ',' + y; return 号[k] ?? (号[k] = 点.push([x, y]) - 1); };
    竖.forEach(x => 横.forEach(y => 加(x, y)));
    const a = 加(A[0], A[1]), b = 加(B[0], B[1]);
    const 线上 = (k, v) => 点.map((P, i) => [P, i]).filter(([P]) => P[k] === v).sort((m, n) => m[0][1 - k] - n[0][1 - k]);
    const 邻 = 点.map(() => []);
    横.forEach(y => { const xs = 线上(1, y); xs.slice(1).forEach(([, j], t) =>   // 只沿空道走: 别的横竖线会穿方块
      (邻[xs[t][1]].push([j, 'h']), 邻[j].push([xs[t][1], 'h']))); });
    竖.forEach(x => { const xs = 线上(0, x); xs.slice(1).forEach(([, j], t) =>
      (邻[xs[t][1]].push([j, 'v']), 邻[j].push([xs[t][1], 'v']))); });
    const 段们 = 别.flatMap(ps => ps.slice(1).map((P, t) => [ps[t], P])),
      价 = (P, Q) => 段们.reduce((c, [m, n]) => { // 横竖相交算交叉; 同一条道上叠着算抢道
        const 横的 = P[1] === Q[1], 它横 = m[1] === n[1];
        if (横的 !== 它横) {
          const [h1, h2, v1, v2] = 横的 ? [P, Q, m, n] : [m, n, P, Q], x = v1[0], y = h1[1];
          return c + (x > Math.min(h1[0], h2[0]) && x < Math.max(h1[0], h2[0]) && y > Math.min(v1[1], v2[1])
            && y < Math.max(v1[1], v2[1]) ? 80 : 0);
        }
        const k = 横的 ? 0 : 1;
        if ((横的 ? P[1] !== m[1] : P[0] !== m[0])) return c;
        const 叠 = Math.min(Math.max(P[k], Q[k]), Math.max(m[k], n[k])) - Math.max(Math.min(P[k], Q[k]), Math.min(m[k], n[k]));
        return c + (叠 > 0 ? 叠 * .6 + 10 : 0);
      }, 0);
    const 起向 = p === '上' || p === '下' ? 'v' : 'h', 终向 = q === '上' || q === '下' ? 'v' : 'h',
      最 = {}, 从 = {}, 队 = [[0, a, 起向]];
    最[a + 起向] = 0;
    while (队.length) {
      队.sort((m, n) => m[0] - n[0]);
      const [d, i, 向] = 队.shift();
      if (d > 最[i + 向]) continue;
      if (i === b) break;
      邻[i].forEach(([j, 走向]) => {
        const nd = d + Math.abs(点[i][0] - 点[j][0]) + Math.abs(点[i][1] - 点[j][1]) + (走向 !== 向 ? 30 : 0) + 价(点[i], 点[j]);
        if (nd < (最[j + 走向] ?? Infinity)) (最[j + 走向] = nd, 从[j + 走向] = i + 向, 队.push([nd, j, 走向]));
      });
    }
    const 终 = ['h', 'v'].map(v => [(最[b + v] ?? Infinity) + (v !== 终向 ? 30 : 0), b + v]).sort((m, n) => m[0] - n[0])[0];
    if (终[0] === Infinity) return [A, B];   // 网断了(不会): 直接连
    const 路 = [];
    for (let k = 终[1]; k != null; k = 从[k]) 路.unshift(点[parseInt(k)]);
    return 路;
  },
  道上(路, g, 布) { // 同一条空道上的几段分车道(错开 7px); 同起点或同终点的并一束, 不错开。两头贴着方块的那段不动
    const { 横, 竖 } = 布.道, 段 = {};
    路.forEach((ps, i) => ps.slice(1).forEach((P, t) => {
      if (t === 0 || t === ps.length - 2) return;
      const Q = ps[t], h = P[1] === Q[1], k = h ? 'h' + P[1] : 'v' + P[0];
      if (!(h ? 横 : 竖).includes(h ? P[1] : P[0])) return;
      (段[k] = 段[k] || []).push({ i, t, a: Math.min(P[h ? 0 : 1], Q[h ? 0 : 1]), b: Math.max(P[h ? 0 : 1], Q[h ? 0 : 1]), h });
    }));
    const 移 = 路.map(ps => ps.map(P => P.slice()));
    Object.values(段).forEach(xs => {
      const 道 = [];
      xs.sort((m, n) => m.a - n.a).forEach(s => { // 贪心上色: 跟已在这条车道上的段重叠又不同束, 就换下一条
        const e = g.线[s.i], 撞 = d => d.some(o => o.b > s.a + 1 && o.a < s.b - 1 && g.线[o.i].从 !== e.从 && g.线[o.i].到 !== e.到);
        let k = 0;
        while (道[k] && 撞(道[k])) k++;
        (道[k] = 道[k] || []).push(s);
        s.k = k;
      });
      xs.forEach(s => {
        const d = (s.k - (道.length - 1) / 2) * 7, ps = 移[s.i];
        ps[s.t][s.h ? 1 : 0] += d;
        ps[s.t + 1][s.h ? 1 : 0] += d;
      });
    });
    return 移;
  },
  签(g, 路, 布) { // 标签放在线最长的那段中间, 撞了方块或别的标签就换一段、挪一挪; 回 [{x, y, w}](中心点)
    const 框 = Object.values(布.位).map(r => [r.x - 4, r.y - 4, r.x + r.w + 4, r.y + r.h + 4]), 用 = [],
      撞 = b => 框.concat(用).some(r => b[2] > r[0] && b[0] < r[2] && b[3] > r[1] && b[1] < r[3]);
    return g.线.map((e, i) => {
      if (!e.话) return null;
      const w = 布图.字宽(e.话, 10.5) + 10, ps = 路[i], 段 = ps.slice(1).map((P, t) => [ps[t], P])
        .sort((m, n) => 布图.距(n) - 布图.距(m));
      for (const [P, Q] of 段) for (const f of [.5, .3, .7, .15, .85]) {
        const x = P[0] + (Q[0] - P[0]) * f, y = P[1] + (Q[1] - P[1]) * f, b = [x - w / 2, y - 8, x + w / 2, y + 8];
        if (!撞(b)) return (用.push(b), { x, y, w });
      }
      const [P, Q] = 段[0];
      return { x: (P[0] + Q[0]) / 2, y: (P[1] + Q[1]) / 2, w };
    });
  },
  量(g, 路) { // 交叉: 两条不同束的线横竖相交几处, 回 [[线 i, 线 j]]
    const 对 = [];
    路.forEach((a, i) => 路.forEach((b, j) => {
      if (j <= i) return;
      const e = g.线[i], f = g.线[j];
      if (e.从 === f.从 || e.到 === f.到 || e.从 === f.到 && e.到 === f.从) return;
      const 交 = a.slice(1).some((P, s) => b.slice(1).some((Q, t) => {
        const [p1, p2, q1, q2] = [a[s], P, b[t], Q], h1 = p1[1] === p2[1], h2 = q1[1] === q2[1];
        if (h1 === h2) return false;
        const [H1, H2, V1, V2] = h1 ? [p1, p2, q1, q2] : [q1, q2, p1, p2];
        return V1[0] > Math.min(H1[0], H2[0]) + .5 && V1[0] < Math.max(H1[0], H2[0]) - .5
          && H1[1] > Math.min(V1[1], V2[1]) + .5 && H1[1] < Math.max(V1[1], V2[1]) - .5;
      }));
      if (交) 对.push([i, j]);
    }));
    return 对;
  },
  全(g) { // 排 + 走 + 标签 + 量, 一口气: 回 {布, 路, 签, 交}
    const 布 = 布图.排(g), 路 = 布图.走(g, 布);
    return { 布, 路, 签: 布图.签(g, 路, 布), 交: 布图.量(g, 路) };
  },
};
// ═ 画架构图 · 跟着: 工具, 布图 ═
// 图 → SVG 字符串, 纯函数(导出页、存图照样用)。颜色直接写在元素上不靠样式表, 存成 SVG / PNG 也一样。
// 图 = {节点: [{id, 名, 述, 型, 行, 列, 段, 借?, 灰?, 行数?}], 线: [{从, 到, 话?, 主?, 虚?}], 标题?, 一句?, 卡?}
// 节点 class="n" data-k=id(导图.控 认它), 能点进去的右上角一个 ⊕(class="pm"); 线 data-f / data-t 给高亮用
const 架构图 = {
  型: [['界面', '#38bdf8', '你看得见、点得到的'], ['核心', '#34d399', '核心部件'], ['枢纽', '#fb923c', '总调度'],
    ['数据', '#a78bfa', '存东西的地方'], ['安全', '#fb7185', '安全隔离'], ['外部', '#94a3b8', '这份代码之外']],
  色: t => (架构图.型.find(x => x[0] === t) || 架构图.型[1])[1],
  尺: n => n.灰 ? [132, 44] : n.段 && n.段.length || n.借 ? [176, 64] : [150, 56],   // 业务节点 / 段 / 外面的邻居
  折(t, 宽, 行数) { // 按字宽折成几行, 多的截掉加 …
    const out = [];
    let 行 = '';
    for (const c of String(t || '')) {
      if (布图.字宽(行 + c, 10.5) > 宽) {
        if (out.push(行) === 行数) return (out[行数 - 1] = out[行数 - 1].slice(0, -1) + '…', out);
        行 = '';
      }
      行 += c;
    }
    if (行) out.push(行);
    return out.slice(0, 行数);
  },
  画(g, r) { // r = 布图.全(g); 回 {svg(不带外壳), 宽, 高}
    const { 布, 路, 签 } = r, 位 = 布.位, C = 架构图.色, 号 = {};
    g.节点.forEach(n => 号[n.id] = n);
    const 箭 = ['#7c8796', '#b5ff00', '#6b7280'].map((c, i) => '<marker id="ar' + i + '" markerWidth="9" markerHeight="7" refX="8"'
      + ' refY="3.5" orient="auto"><path d="M0,0L9,3.5L0,7z" fill="' + c + '"/></marker>').join('');
    const 线 = g.线.map((e, i) => { const 灰 = 号[e.从].灰 || 号[e.到].灰, c = e.主 ? 1 : 灰 ? 2 : 0;
      return '<path class="e" data-f="' + esc(e.从) + '" data-t="' + esc(e.到) + '" d="M' + 路[i].map(p => p[0].toFixed(1) + ','
        + p[1].toFixed(1)).join('L') + '" fill="none" stroke="' + ['#7c8796', '#b5ff00', '#6b7280'][c] + '" stroke-width="'
        + (e.主 ? 2.2 : 1.4) + '"' + (e.虚 || 灰 ? ' stroke-dasharray="5 4"' : '') + ' marker-end="url(#ar' + c + ')"/>'; }).join('');
    const 字 = g.线.map((e, i) => { const s = 签[i]; return s ? '<g class="e" data-f="' + esc(e.从) + '" data-t="' + esc(e.到)
      + '"><rect x="' + (s.x - s.w / 2).toFixed(1) + '" y="' + (s.y - 8).toFixed(1) + '" width="' + s.w.toFixed(1)
      + '" height="16" rx="4" fill="#0a0a0a" fill-opacity=".9"/><text x="' + s.x.toFixed(1) + '" y="' + (s.y + 3.8).toFixed(1)
      + '" text-anchor="middle" font-size="10.5" fill="' + (e.主 ? '#d9f99d' : '#aab4c0') + '">' + esc(e.话) + '</text></g>' : ''; })
      .join('');
    const 点 = g.节点.map(n => {
      const p = 位[n.id], c = n.灰 ? '#6b7280' : C(n.型), 进 = n.段 && n.段.length && !n.借 && !n.灰 && n.可进 !== 0,
        说 = n.借 ? '借自 ' + n.借.split('/')[0] : n.述, 行们 = n.灰 ? [] : 架构图.折(说, p.w - 20, p.h > 60 ? 2 : 1),
        顶 = p.h / 2 - (行们.length ? 行们.length * 6.5 : 0) + 4;
      return '<g class="n" data-k="' + esc(n.id) + '" transform="translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')">'
        + '<rect class="b" width="' + p.w + '" height="' + p.h + '" rx="8" fill="' + c + '" fill-opacity="' + (n.灰 ? .06 : .12)
        + '" stroke="' + c + '" stroke-width="1.4"' + (n.灰 || n.借 ? ' stroke-dasharray="5 3"' : '') + '/>'
        + '<text x="' + p.w / 2 + '" y="' + 顶.toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="600" fill="'
        + (n.灰 ? '#9ca3af' : '#f1f5f9') + '">' + esc(架构图.折(n.名, p.w - (进 ? 34 : 16), 1)[0] || '') + '</text>'
        + 行们.map((t, j) => '<text x="' + p.w / 2 + '" y="' + (顶 + 16 + j * 13).toFixed(1) + '" text-anchor="middle"'
          + ' font-size="10.5" fill="#a3acb9">' + esc(t) + '</text>').join('')
        + (n.行数 ? '<text x="' + (p.w - 6) + '" y="' + (p.h - 5) + '" text-anchor="end" font-size="9" fill="' + c + '">'
          + n.行数 + ' 行</text>' : '')
        + (进 ? '<g class="pm"><circle cx="' + (p.w - 12) + '" cy="12" r="8" fill="#0a0a0a" stroke="' + c + '"/><text x="'
          + (p.w - 12) + '" y="15.5" text-anchor="middle" font-size="11" fill="' + c + '">' + n.段.length + '</text></g>' : '')
        + '<title>' + esc(n.名 + (n.述 ? '\n' + n.述 : '') + (进 ? '\n管 ' + n.段.length + ' 段: ' + n.段.join('、')
          + '\n点右上角的数字或双击: 看里面' : '')) + '</title></g>';
    }).join('');
    return { svg: '<defs>' + 箭 + '</defs><rect class="bg" x="0" y="0" width="' + 布.宽 + '" height="' + 布.高
      + '" fill="#0a0a0a"/>' + 线 + 点 + 字, 宽: 布.宽, 高: 布.高 };
  },
  例: g => 架构图.型.filter(([t]) => g.节点.some(n => !n.灰 && n.型 === t)),   // 图里用到的颜色
  卡: g => (g.卡 || []).length ? '<div class="c-arc">' + g.卡.map((k, i) => '<div><h4 style="--c:'
    + ['#38bdf8', '#34d399', '#a78bfa', '#fb923c', '#fb7185'][i % 5] + '">' + esc(k.题) + '</h4><ul>'
    + (k.条 || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>').join('') + '</div>' : '',
  整(g, r) { // 存图用的完整 SVG: 上面标题和一句话, 下面图例; 字体写死, 离开 Colony 也一样
    const x = 架构图.画(g, r), 头 = g.标题 ? 54 : 0, 例 = 架构图.例(g), W = Math.max(x.宽, 480), H = 头 + x.高 + 34;
    let lx = 20;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H
      + '" font-family="-apple-system,PingFang SC,Microsoft YaHei,sans-serif"><rect width="100%" height="100%" fill="#0a0a0a"/>'
      + (g.标题 ? '<text x="20" y="28" font-size="18" font-weight="600" fill="#f1f5f9">' + esc(g.标题) + '</text><text x="20"'
        + ' y="46" font-size="11.5" fill="#94a3b8">' + esc(g.一句 || '') + '</text>' : '')
      + '<g transform="translate(0,' + 头 + ')">' + x.svg + '</g>'
      + 例.map(([t, c, 话]) => { const s = '<rect x="' + lx + '" y="' + (H - 22) + '" width="12" height="10" rx="2" fill="' + c
        + '" fill-opacity=".2" stroke="' + c + '"/><text x="' + (lx + 17) + '" y="' + (H - 13) + '" font-size="10.5" fill="#a3acb9">'
        + esc(t + ' · ' + 话) + '</text>'; lx += 36 + 布图.字宽(t + ' · ' + 话, 10.5); return s; }).join('') + '</svg>';
  },
};
// ═ 详情 · 跟着: 工具, 外壳, 地图, 导图, 逐行 ═
// 导图视图: 左边导图, 右边详情栏(宽度能拖)。打开先看到段这一层; 单击段看它的段头和全部讲解, 点到还没讲的段顺手去讲;
// 单击细分或要点只看那几行代码和各自的注;
// 双击跳到那几行, 借来的段点了去源头
const 详情 = {
  态: null,
  视图: {
    名: '🗺 导图',
    画(el, o) {
      详情.建(o, new Set(), '根');
      const 态 = 详情.态;
      el.innerHTML = '<div class="c-mmw"><div class="c-mm"><p>滚轮缩放 · 拖动平移 · 点段看讲解 · 点 ⊕ 展开细分和要点 · 双击看那几行</p>'
        + '<span><button data-fit>⤢ 铺满</button> <button data-all></button></span><svg><g></g></svg></div>'
        + '<i class="c-dh"></i><div class="c-dt"></div></div>';
      详情.够();
      const svg = el.querySelector('svg'), h = el.querySelector('.c-dh'), w = h.parentNode;
      导图.控(svg, 态.v, { 点: 详情.点, 双: k => 外壳.跳(详情.态.表[k].起),
        折: k => { // 收起展开后这个节点留在原处, 鼠标原地还能再点
          const 态 = 详情.态, n = 态.表[k], x = n.x, y = n.y;
          态.收.has(k) ? 态.收.delete(k) : 态.收.add(k);
          态.折过 = 1;
          详情.重画();
          Object.assign(态.v, { px: 态.v.px - (n.x - x) * 态.v.s, py: 态.v.py - (n.y - y) * 态.v.s });
          导图.放(svg, 态.v);
        } });
      if (详情.观) 详情.观.disconnect();   // 窗大小变了(最大化、还原、停靠栏压过来): 人没动过就重新铺满
      详情.观 = new ResizeObserver(() => { // 没手动收放过就按新高度重新收
        const 态 = 详情.态;
        if (态.v.手 || !svg.isConnected) return;
        if (!态.折过) 详情.够();
        详情.重画(1);
      });
      详情.观.observe(svg);
      详情.重画(1);
      详情.卡('根');
      外壳.拖(h, m => w.style.setProperty('--dw',
        Math.max(240, w.getBoundingClientRect().right - m.clientX) + 'px'));
    },
    更(el, o) { // 解读变了: 树重建, 收起的、选中的、缩放位置都留着; 刚分好组时树全变了, 按默认收一次、铺满一次
      const 态 = 详情.态, 没分 = !态.d.类, 旧 = 态.表;
      详情.建(o, 态.收, 态.选, 态.v);
      Object.values(详情.态.表).forEach(n => n.子.length && /段|分/.test(n.种) && !(旧[n.键] || { 子: [] }).子.length
        && 态.收.add(n.键));   // 新长出要点的先收着: 讲完了总览还是段这一层
      const 刚分 = 没分 && 详情.态.d.类;
      if (刚分) 详情.够();
      详情.重画(刚分 || !态.v.手 ? 1 : 0);   // 叶子长出来树变高了: 人没动过就重新铺满
      详情.卡(详情.态.选);
    },
    点(e) {
      const 态 = 详情.态, o = 外壳.now, b = e.target.closest('[data-fit],[data-all],[data-k]');
      // 图上的点由导图自己管; 往上找别越过本块
      if (!态 || e.target.closest('.c-mm svg') || 逐行.卡点(e, o) || !b || !ctx.root.contains(b)) return;
      const x = b.dataset;
      if ('all' in x) b.textContent = 态.收.size ? (态.收.clear(), '全收') : (导图.收(态.表, 态.收, () => 1), '全展开');
      if ('fit' in x || 'all' in x) 详情.重画(1);
      else 详情.点(x.k);
    },
    位: () => (详情.态.表[详情.态.选] || {}).起 || 1,
    到(n) { // 翻到第 n 行: 只选中管这一行的段(借来的不跟过去, 也不去讲)
      const s = Object.values(详情.态.表).find(x => x.种 === '段' && !x.借 && x.起 <= n && n <= x.止);
      if (s) 详情.点(s.键, 1);
    },
  },
  建(o, 收, 选, v) {
    const d = 地图.数据(o), [t, 表] = 导图.树(d);
    详情.态 = { d, t, 表, 收, 选: 表[选] ? 选 : '根', v: v || {} };
  },
  够() { // 按图区高度自动收: 每行 30px, 按 0.8 倍算
    const 态 = 详情.态, b = 外壳.$('[data-all]');
    导图.够(态.t, 态.表, 态.收, (外壳.$('.c-mm').clientHeight - 40) / 24);
    if (b) b.textContent = 态.收.size ? '全展开' : '全收';
  },
  重画(满) {
    const 态 = 详情.态;
    导图.画进(外壳.$('.c-mm svg'), 态.v, 态.t, 态.收, 态.选, 满);
  },
  点(k, 只选) {
    const 态 = 详情.态, n = 态.表[k], o = 外壳.now;
    if (n.借 && n.种 === '段' && !只选 && !colony.单独) return 外壳.去(n.借);   // 没有 Stem(单独打开、离线页)去不了源头: 出卡片
    let 藏 = 0;   // 祖先有收起的才重画: 点在图上的节点一重画就换了元素, 第二下认不出是双击
    for (let p = n.父; p; p = p.父) 藏 += 态.收.delete(p.键);
    态.选 = k;
    if (藏) 详情.重画();
    else 外壳.$('.c-mm svg').querySelectorAll('.n').forEach(g => g.classList.toggle('选', g.dataset.k === k));
    详情.卡(k);
    const s = n.段 && o.段.find(x => x.名 === n.段);
    if (s && !只选 && !s.解.讲 && !s.解.讲错 && !s.借 && 外壳.有模) 解析.讲(o, s.名);
    const dt = 外壳.$('.c-dt');   // 窄屏时卡片在图下面: 不在眼前就滚进来
    if (dt.getBoundingClientRect().top > 外壳.$('.c-view').getBoundingClientRect().bottom - 80) {
      dt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    外壳.存();
  },
  卡(k) {
    const 态 = 详情.态, n = 态.表[k] || 态.t, o = 外壳.now, 灰 = t => '<p class="c-g">' + t + '</p>',
      dt = 外壳.$('.c-dt'),
      列 = xs => xs.map(c => '<p class="c-li" data-k="' + esc(c.键) + '"><b>' + esc(c.名) + '</b>'
        + esc(c.注 || c.子.map(x => x.名).join('、')) + '</p>').join(''), s = n.段 && o.段.find(x => x.名 === n.段);
    if (s) { // 段: 段头和全部讲解; 细分、要点: 只出那几行
      return dt.innerHTML = '<div data-s="' + esc(s.名) + '">' + (n.种 === '段' ? 逐行.卡(o, s) : 逐行.块(o, s, n))
        + '</div>';
    }
    const 根 = n.种 === '根', 卡 = 根 && o.类 === '块' && o.id !== 'stem' && colony.has('ui.card');
    dt.innerHTML = 灰(esc(o.名) + (n.父 ? ' › ' + esc(n.名) : '')) + '<h3>' + esc(n.名) + '</h3>'
      + (根 && o.用 ? '<p class="c-use">' + esc(o.用) + '</p>' : '')
      + (n.注 ? '<div class="c-sum">' + esc(n.注) + '</div>' : '')
      + (根 ? 灰(o.行数.toLocaleString() + ' 行 · ' + 态.d.段.length + ' 段 · 讲过 '
        + 态.d.段.filter(x => (x.讲 || []).length).length + ' 段' + (态.d.类 ? '' : ' · 还没解析, 一句话取自段头下的注释'))
        : '')
      + (卡 ? '<details class="c-ab"><summary>它的说明: 技能、能力、占的数据</summary><div></div></details>' : '')
      + 列(n.子);
    const d = 卡 && dt.querySelector('.c-ab'), 技 = o.段.find(x => x.名 === '技能');
    if (d) d.ontoggle = () => d.open && !d.lastChild.firstChild && ctx.call('ui.card', { id: o.id,
      el: d.lastChild, 点技能: i => 技 && 外壳.跳(技.起 + i) }).catch(外壳.错);   // 点技能 = 翻到技能段那一行的源码
  },
  问(n) { // 发给 agent: 在它输入框上方放一张卡片, 人补一句再发
    const o = 外壳.now, 名 = o.id + '/' + n.段 + ' 第 ' + n.起 + '–' + n.止 + ' 行';
    ctx.call('agent.attach', { name: 名, text: 名 + (n.注 ? '\n' + n.注 : '') + '\n看原文前先 code.map {id: \'' + o.id
      + '\', segment: \'' + n.段 + '\'}' })
      .then(() => 外壳.说('已放到 agent 输入框上方: ' + 名), () => 外壳.说('agent 不在, 没人接', 1));
  },
};
// ═ 架构视图 · 跟着: 工具, 外壳, 导图, 布图, 画架构图, 画图师, 解析 ═
// 「架构图」视图: 顶上一条(面包屑、说明、按钮), 中间能缩放拖动的图, 选中节点时下面一条说它管哪几段, 再下面说明卡片和图例。
// 没画过业务图先给粗图和「画架构图」键(点了才问模型); 单击节点高亮它的上下游, 点右上角的数字或双击点进去看它管的段,
// 双击段去源码, 双击灰色的邻居换到那个节点; 面包屑「全貌」回来。导出页里没有画和存的键
const 架构视图 = {
  态: null,   // {id, 进: 点进去的节点 id 或 '', 选, v: 缩放位置, g: 现在画的图, r: 布图结果}
  视图: {
    名: '🧩 架构图',
    画(el, o) {
      const 旧 = 架构视图.态;
      架构视图.态 = { id: o.id, 进: 旧 && 旧.id === o.id ? 旧.进 : '', 选: '', v: {} };
      el.innerHTML = '<div class="c-ar"><div class="c-arb"></div><div class="c-arm"><svg><g></g></svg>'
        + '<p>滚轮缩放 · 拖动平移 · 单击看上下游 · 点右上角数字或双击看里面</p></div><div class="c-ari"></div>'
        + '<div class="c-arx"></div></div>';
      const svg = el.querySelector('svg');
      导图.控(svg, 架构视图.态.v, { 点: 架构视图.点, 双: 架构视图.双, 折: 架构视图.钻 });
      svg.onmouseover = e => { const n = e.target.closest('.n'); 架构视图.亮(n ? n.dataset.k : 架构视图.态.选); };
      svg.onmouseleave = () => 架构视图.亮(架构视图.态.选);
      if (typeof ResizeObserver !== 'undefined') {
        if (架构视图.观) 架构视图.观.disconnect();
        架构视图.观 = new ResizeObserver(() => !架构视图.态.v.手 && svg.isConnected && 架构视图.铺());
        架构视图.观.observe(svg);
      }
      架构视图.重画(1);
    },
    更(el, o) { // 解读变了(画好了、讲解多了): 留着点进去的那层和选中的, 人没动过就重新铺满
      if (!el.querySelector('.c-ar')) return 架构视图.视图.画(el, o);
      架构视图.重画(!架构视图.态.v.手);
    },
    点(e) {
      const b = e.target.closest('[data-ar],[data-sg]');
      if (!b || !ctx.root.contains(b) || e.target.closest('.c-arm svg')) return;
      const k = b.dataset.ar, o = 外壳.now;
      if (b.dataset.sg) return 架构视图.去(+b.dataset.sg);
      if (k === '全貌') return 架构视图.钻('');
      if (k === '钻') return 架构视图.钻(架构视图.态.选);
      if (k === '铺满') return (架构视图.态.v.手 = 0, 架构视图.铺());
      if (k === '画' || k === '重画') {
        if (k === '重画' && !先问(b, '再点一次: 重画要问模型 1–3 次')) return;
        return 画图师.画(o).catch(外壳.错);
      }
      if (k === '解析') return 外壳.做('解析', b);
      if (k === 'svg' || k === 'png') return 架构视图.存(k).catch(外壳.错);
    },
    位: () => { const 态 = 架构视图.态, n = 态 && 态.g && 态.g.节点.find(x => x.id === 态.选);
      return n && (n.起 || 架构视图.起(n)) || 1; },
    到(n, 闪) { // 从别的视图带着行号过来: 选中管这一行的节点
      const 态 = 架构视图.态, o = 外壳.now, s = 闪 && o.段.find(x => x.起 <= n && n <= x.止);
      const k = s && 态.g && 态.g.节点.find(x => x.名 === s.名 && x.起 || (x.段 || []).includes(s.名));
      if (k) 架构视图.点(k.id);
    },
  },
  起(n) { // 节点管的第一段的起始行
    const s = 外壳.now.段.find(x => (n.段 || []).includes(x.名));
    return s && s.起;
  },
  图(o) { // 现在该画哪张: 业务图(画过的) 或 粗图; 点进去了就是那个节点里面
    const 态 = 架构视图.态, 顶 = 画图师.图(o) || 画图师.粗(o), N = 态.进 && 顶.节点.find(n => n.id === 态.进);
    if (!N) 态.进 = '';
    return { 顶, g: N ? 画图师.内(o, 顶, N.id) : 顶 };
  },
  重画(满) {
    const 态 = 架构视图.态, o = 外壳.now, el = 外壳.$('.c-ar');
    if (!el || !o) return;
    const { 顶, g } = 架构视图.图(o);
    态.g = g;
    态.r = 布图.全(g);
    const x = 架构图.画(g, 态.r);
    el.querySelector('svg').firstChild.innerHTML = x.svg;
    态.宽 = x.宽;
    态.高 = x.高;
    if (!g.节点.some(n => n.id === 态.选)) 态.选 = '';
    架构视图.条(顶, g);
    el.querySelector('.c-arx').innerHTML = (g === 顶 ? 架构图.卡(顶) : '') + '<div class="c-arl">' + 架构图.例(g)
      .map(([t, c, 话]) => '<span><i style="--c:' + c + '"></i>' + t + ' · ' + 话 + '</span>').join('')
      + (g.层 === '里面' ? '<span><i style="--c:#6b7280"></i>灰色 · 跟它有来往的别的节点</span>' : '') + '</div>';
    if (满) 架构视图.铺(); else 导图.放(el.querySelector('svg'), 态.v);
    架构视图.亮(态.选);
    架构视图.信();
  },
  条(顶, g) { // 顶上一条: 面包屑 + 现在是什么图 + 按钮
    const o = 外壳.now, a = o.ana, 跑 = 画图师.跑[o.id], 离 = 外壳.离线, 解了 = !!a.at,
      有段 = 画图师.段们(o).length > 1 || 画图师.有跟(o), 钮 = (k, t, 类) => '<button data-ar="' + k + '"' + (类 ? ' class="'
        + 类 + '"' : '') + '>' + t + '</button>';
    const 话 = 跑 ? '<span class="c-run">⏳ ' + esc(跑.话) + '</span>'
      : g !== 顶 ? '<span>' + esc(g.父.述 || '') + ' · 灰色的是跟它有来往的别的节点, 双击换过去</span>'
      : 顶.层 === '业务' ? (顶.过时 ? '<span class="c-old">⚠ 画图之后代码改过, 图可能过时</span>' : '<span>' + esc(顶.一句 || '')
        + '</span>')
      : '<span>' + (顶.层 === '粗类' ? '粗图: 一个大类一个方块, 线照段头的「跟着」' : 有段
        ? '粗图: 一段一个方块, 线照段头的「跟着」' : '这份代码没有段头, 还没切开') + (离 ? '' : 解了
        ? ' · 画业务架构图要问画图师 1–3 次' : ' · 先解析, 解析完能画业务架构图') + '</span>';
    外壳.$('.c-arb').innerHTML = '<nav>' + (g === 顶 ? '<b>' + esc(顶.标题 || '全貌') + '</b>' : '<a data-ar="全貌">'
      + esc(顶.标题 || '全貌') + '</a> › <b>' + esc(g.父.名) + '</b>') + '</nav>' + 话
      + (a.图错 && !跑 ? '<span class="c-err">✗ 上次没画成: ' + esc(a.图错) + '</span>' : '')
      + '<span class="c-acts">'
      + (离 || 跑 ? '' : !解了 ? (外壳.有模 ? 钮('解析', '解析') : '') : !外壳.有模 ? '' : 顶.层 === '业务'
        ? 钮('重画', 顶.过时 ? '⚠ 重画' : '↻ 重画') : 钮('画', '✨ 画架构图', 'c-pri'))
      + 钮('铺满', '⤢ 铺满') + (离 ? '' : 钮('svg', '存 SVG') + 钮('png', '存 PNG')) + '</span>';
  },
  铺() { // 整张图放进眼前: 最大 1.4 倍, 太大就缩, 上下左右居中
    const 态 = 架构视图.态, svg = 外壳.$('.c-arm svg');
    if (!svg || !态.宽) return;
    const r = svg.getBoundingClientRect(), W = r.width || 900, H = r.height || 520,
      s = Math.max(.25, Math.min(1.4, (W - 24) / 态.宽, (H - 24) / 态.高));
    Object.assign(态.v, { s, px: (W - 态.宽 * s) / 2, py: Math.max(8, (H - 态.高 * s) / 2) });
    导图.放(svg, 态.v);
  },
  亮(k) { // k 和跟它直接相连的亮, 别的变淡; 不给 k 全亮
    const svg = 外壳.$('.c-arm svg');
    if (!svg) return;
    const 邻 = new Set([k]);
    if (k) svg.querySelectorAll('path.e').forEach(p => (p.dataset.f === k || p.dataset.t === k)
      && (邻.add(p.dataset.f), 邻.add(p.dataset.t)));
    svg.querySelectorAll('.n').forEach(n => (n.classList.toggle('dim', !!k && !邻.has(n.dataset.k)),
      n.classList.toggle('sel', n.dataset.k === 架构视图.态.选)));
    svg.querySelectorAll('.e').forEach(p => p.classList.toggle('dim', !!k && p.dataset.f !== k && p.dataset.t !== k));
  },
  点(k) {
    架构视图.态.选 = 架构视图.态.选 === k ? '' : k;
    架构视图.亮(架构视图.态.选);
    架构视图.信();
  },
  信() { // 选中节点下面那一条: 名字、一句话、管哪几段(点段去源码)、借来的去源头
    const 态 = 架构视图.态, o = 外壳.now, n = 态.g && 态.g.节点.find(x => x.id === 态.选), el = 外壳.$('.c-ari');
    if (!el) return;
    if (!n) return el.innerHTML = '';
    const 段 = (n.段 || []).map(x => o.段.find(s => s.名 === x)).filter(Boolean), 进 = 段.length && !n.借 && !n.灰;
    el.innerHTML = '<b style="--c:' + (n.灰 ? '#6b7280' : 架构图.色(n.型)) + '">' + esc(n.名) + '</b>'
      + (n.述 ? '<span>' + esc(n.述) + '</span>' : '')
      + (n.借 ? '<span>借自 ' + esc(n.借) + '</span>' : '')
      + (段.length ? '<span>' + 段.map(s => '<a data-sg="' + s.起 + '" title="去源码看这段">' + esc(s.名) + ' <small>'
        + (s.止 - s.起 + 1) + ' 行</small></a>').join('') + '</span>' : n.起 ? '<span><a data-sg="' + n.起 + '">去源码 ›</a></span>' : '')
      + (进 && 态.g.层 !== '里面' && 态.g.层 !== '粗段' ? '<button data-ar="钻">看里面 ›</button>' : '')
      + (n.灰 ? '<button data-ar="钻">换到这个节点 ›</button>' : '');
  },
  钻(k) { // 点进去(k = 节点 id) 或回全貌(k = ''); 灰色的邻居 = 换到那个节点
    const 态 = 架构视图.态;
    if (k) {
      const n = 态.g.节点.find(x => x.id === k);
      if (!n) return;
      if (n.灰) k = n.回;
      else if (!(n.段 || []).length || n.借 || 态.g.层 === '里面' || 态.g.层 === '粗段') return;
    }
    态.进 = k;
    态.选 = '';
    态.v.手 = 0;
    架构视图.重画(1);
  },
  双(k) { // 双击: 能点进去的点进去; 段去源码; 借来的去源头
    const n = 架构视图.态.g.节点.find(x => x.id === k);
    if (!n) return;
    if (n.灰 || (n.段 || []).length && !n.借 && 架构视图.态.g.层 !== '里面') return 架构视图.钻(k);
    if (n.借 && !colony.单独 && !外壳.离线) return 外壳.去(n.借);
    if (n.起) 架构视图.去(n.起);
  },
  去: n => 外壳.离线 ? 外壳.跳(n) : 外壳.开(null, n, '源码').catch(外壳.错),
  async 存(型) { // 存成图片: SVG 原样; PNG 画到两倍大的画布上
    const 态 = 架构视图.态, g = 态.g, o = 外壳.now, 里 = g.父, 名 = '架构图 · ' + o.名 + (里 ? ' › ' + 里.名 : '');
    const svg = 架构图.整(Object.assign({}, g, { 标题: 里 ? (g.标题 || o.名) + ' › ' + 里.名 : g.标题 || o.名,
      一句: 里 ? 里.述 : g.一句 }), 态.r);
    if (型 === 'svg') return 导出.下(名 + '.svg', svg, 'image/svg+xml');
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((ok, 坏) => (img.onload = ok, img.onerror = () => 坏(new Error('图片没画出来')), img.src = url));
    const c = document.createElement('canvas');
    c.width = img.width * 2;
    c.height = img.height * 2;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const b = await new Promise(ok => c.toBlob(ok, 'image/png'));
    导出.下(名 + '.png', b, 'image/png');
  },
};
// ═ 提示词 ═
// 四段系统提示词, 模型小卡里原样显示; 要改就改这里。逐行回文字行(比 JSON 省字), 取讲() 认, 认不出再按 JSON
const 提示词 = {
  架构师: `你是代码架构师, 给不懂代码的人画一张这份代码的地图。
代码每行前有行号: 「n| 」是有内容的行, 「n· 」是空行或只有括号的行。几段之间用「== 段名 ==」隔开, 每段的行号从段头(第 0 行)数起。
对每一段给:
- 述: 20-40 字大白话, 说这段替谁解决什么、为什么要有它, 不复述代码;
- 签: 一个英文大写词, 如 INIT、UI、DATA、NET、UTIL;
- 分: 只有超过 60 行的段才分, 分成 3-7 块, 每块 {名: 2-8 个字, 述: 一句话, 起, 止}, 用段内行号, 盖满整段、不重叠。
段名原样用, 不许改名、漏段、编段。只让你「分这一块」时, 只回那一块的 分。
只回 JSON: {"段":{"段名":{"述":"","签":"","分":[{"名":"","述":"","起":1,"止":20}]}}}`,
  分组: `你是代码架构师。给你一份代码各段的「段名 — 一句话」, 按功能分成 3-7 个大类, 保持原来的先后, 每段只进一类。
- 类名: 2-6 个字的大白话(如「开窗和布局」「存数据」), 不要「工具函数」这类空词;
- 总述: 不超过 40 字, 讲清这份代码是什么、给谁用。
只回 JSON: {"总述":"","类":[{"名":"","段":["段名"]}]}`,
  逐行: `你是代码翻译官, 把一段代码一行一行讲给不懂代码的高中生听。
代码每行前有行号: 「n| 」的行要讲; 「n· 」是空行、括号、注释, 或只给你看上下文的行, 不用讲。
先写讲: 3-5 条, 像讲一个流程, 每条一行「图 标 | 起-止 | 话」: 图是 1 个 emoji, 标 2-6 个字, 话 30-60 字, 用生活里的东西打比方。
再写注: 每个「n| 」行都写一行「n| 话」, 一个不漏; 话 10-30 字大白话, 说这一行在做什么、为什么要它, 不照着代码念;
代码里的名字(变量、函数、键)照原样写。只让你补几行时, 只写注。
只回这两种行, 不要 JSON, 不要别的话。例:
🧺 先备好料 | 5-8 | 像做饭前先把菜洗好切好, 后面几步拿来就用。
5| 准备一个空的清单 xs, 后面往里放东西`,
  画图师: `你是架构图画师, 给不懂代码的人画一张这份代码的「业务架构图」: 看图就知道它怎么把事办成, 而不是代码怎么分文件。
给你: 代码的总述、每段的一句话和它用到哪些段、借来的段(真实代码在别处, 已经是外部节点, id 写好了)。
要你给:
- 标题: 不超过 20 字, 如「全能 agent: 你说一句话, 它怎么把事办成」; 一句: 不超过 50 字, 说怎么读这张图;
- 节点: 8-16 个业务部件(段少就少几个), 每个 {id: n1 起编, 名: 2-8 字大白话, 述: 不超过 24 字, 型, 行, 列, 段: [段名]}。
  型 只能是: 界面(人看得见、点得到的) / 核心(干活的部件) / 枢纽(总调度、各处都经过它) / 数据(存东西) / 安全(隔离、权限) / 外部(代码之外的人和东西)。
  每一段必须恰好归进一个非外部的节点, 不漏、不重、不编段名; 外部节点(如「你」「模型厂商」)段写 []。借来的节点照给的 id 原样列出、型写外部。
- 位置: 行 和 列 是从 0 起的整数格子, 一格只放一个。主线(人提需求 → … → 办成)放第 1 行从左到右; 它每次都要带上的规矩、配置放第 0 行;
  它用到的工具、存储放第 2 行及以下, 尽量放在用它的那个节点正下方。线要少交叉: 连得多的放近, 不相连的别夹在中间。
- 线: {从, 到, 话: 不超过 8 字的动作(如「请模型想下一步」), 主: 主线写 true, 虚: 只是读写存储或偶尔才发生写 true}。方向 = 谁找谁办事。
- 卡: 3-5 张说明卡片 {题: 不超过 10 字, 条: 3-4 条, 每条不超过 30 字}, 如「一句话看懂」「办一件事的流程」「为什么这样设计」;
  只写给你的材料里有的事, 不编功能、不编数字。
只回 JSON: {"标题":"","一句":"","节点":[{"id":"n1","名":"","述":"","型":"核心","行":1,"列":0,"段":["段名"]}],
"线":[{"从":"n1","到":"n2","话":"","主":true}],"卡":[{"题":"","条":[""]}]}
材料里写了「要段线」时, 再加 "段线": [["段A","段B","话"]]: 段 A 调用或依赖段 B 的重要关系, 话不超过 8 字, 可以跨节点。
只让你「调位置」时, 只回 {"位":{"n1":[行,列]}}, 节点和线都不动。`,
};
// ↦ 借 petri:ai 的 厂商配置
// ═ 对齐 · 跟着: 工具 ═
// 解读按段名存、行号只存段内的, 读的时候现算对不对得上, 不用去听谁改了代码:
// 段的指纹对不上就是过时(旧的照样显示); 细分和要点按首行指纹在新段文里就近找回, 挪过去再核一遍内容; 逐行注按那一行的指纹挂
const 对齐 = {
  修(xs, a, b) { // 模型给的一串块: 夹进 [a, b] → 按起排 → 截掉重叠 → 缝隙并进前一块 → 丢空块, 正好盖满; 不到两块就不算分
    if (!Array.isArray(xs)) return;
    const out = [];
    xs.filter(x => x && x.名).map(x => Object.assign({}, x, { 起: Math.max(a, Math.min(b, x.起 | 0)),
      止: Math.max(a, Math.min(b, x.止 | 0)) })).sort((p, q) => p.起 - q.起).forEach(x => {
      const p = out[out.length - 1];
      if (p && x.起 <= p.止) x.起 = p.止 + 1;
      if (x.起 > x.止) return;
      if (p && x.起 > p.止 + 1) p.止 = x.起 - 1;
      out.push(x);
    });
    if (out.length < 2) return;
    out[0].起 = a;
    out[out.length - 1].止 = b;
    return out;
  },
  记(xs, ls) { // 存之前给每块记上首行指纹和内容指纹(细分递归)
    (xs || []).forEach(x => {
      Object.assign(x, { 首: 行纹(ls[x.起] || ''), 纹: 纹(ls.slice(x.起, x.止 + 1).join('\n')) });
      对齐.记(x.分, ls);
    });
    return xs;
  },
  挪(xs, ls, 盖) { // 段改过了: 每块按首行指纹找最近的那一行挪过去, 内容对不上的标过时; 找不到的丢掉(盖满时由前一块补上)
    if (!xs) return;
    const hs = ls.map(行纹), 找 = (h, 近) => hs.reduce((好, g, i) => g === h
      && (好 < 0 || Math.abs(i - 近) < Math.abs(好 - 近)) ? i : 好, -1);   // 每行指纹先算好, 要点每次都挪
    const ys = xs.map(x => {
      const i = 找(x.首, x.起);
      if (i < 0) return null;
      const y = Object.assign({}, x, { 起: i, 止: Math.min(ls.length - 1, x.止 + i - x.起),
        分: 对齐.挪(x.分, ls, 1) });
      y.旧 = 纹(ls.slice(y.起, y.止 + 1).join('\n')) !== x.纹;
      return y;
    }).filter(Boolean);
    return 盖 ? ys.length && 对齐.修(ys, xs[0].起, ls.length - 1) : ys;
  },
  看(s, x) { // 一段 + 它存的解读 → 画的时候用的那份; 注: 段内行号 → 话, 该: 要讲的行有几行
    const ls = 行(s.文), 注 = {};
    let 该 = 0;
    ls.forEach((l, i) => 注行(l) && (该++, x && x.注 && x.注[行纹(l)] && (注[i] = x.注[行纹(l)])));
    if (!x) return { 注, 该 };
    const 旧 = !!x.纹 && x.纹 !== 纹(s.文);   // 要点每次都按首行指纹对位: 重读后段指纹换了, 要点也不会指错行
    return { 述: x.述, 签: x.签, 模: x.模, 错: x.错, 讲模: x.讲模, 讲错: x.讲错, 旧, 注, 该, 分: 旧 ? 对齐.挪(x.分, ls, 1) : x.分,
      讲: 对齐.挪(x.讲, ls) };
  },
};
// ↦ 借 petri:ai 的 选模型
// ═ 角色 · 跟着: 工具, 存储, 提示词, 厂商配置, 选模型 ═
// 三个角色各选各的模型, 存 code:roles: 架构师(分段、一句话、分组、细分)、逐行(逐行注 + 给小白讲)、画图师(业务架构图);
// 没选就跟 AI 块的默认, 画图师没选就跟架构师。
// 小卡: 有测通的模型时每个角色一个下拉, 选了马上存; 还没有时就在卡里填网址和 Key(借 AI 配置块的小表), 不用跳去别的窗。
// 调模型走哪条只看 路: 调得到 ai.chat(AI 配置块在跑)就走能力; 不然走剪进来的「厂商配置」带着的模型调用(单独打开、
// AI 配置块停着); 都没有就要 AI 配置块。厂商记录、测通的模型两条路都读借来的「厂商配置」, 卡画出来一样
const 角色 = {
  读: async () => (await 存储.读('code:roles')) || {},
  选: (r, 名) => r[名] || 名 === '画图师' && r.架构师,   // 这个角色选的模型; 画图师没单独选就用架构师的
  路: () => colony.has('ai.chat') ? '能力' : typeof 模型调用 !== 'undefined' ? '自带' : '',
  async 模() { // 测通的文本模型, 和 ai.models 列的一样
    if (!角色.路()) return [];
    const did = await 厂商配置.默认id();
    return (await 厂商配置.列表()).filter(p => (p.passed || {}).chat).flatMap(p => 厂商配置.文本(p)
      .map(model => ({ provider: p.name, model, default: p.id === did && model === p.model })));
  },
  async 名(名) { // 这个角色现在用哪个模型: 卡片角上的小字
    const x = 角色.选(await 角色.读(), 名) || (await 角色.模()).find(m => m.default);
    return x ? x.provider + ' · ' + x.model : '默认模型';
  },
  async 有() { // 2 = 有测通的文本模型; 1 = 选了文本模型还没测通(ai.chat 照样能用, 只是没验过); 0 = 还没有
    const ps = 角色.路() ? await 厂商配置.列表() : [];
    return ps.some(p => (p.passed || {}).chat) ? 2 : ps.some(p => p.model) ? 1 : 0;
  },
  async 问(req) {
    const 路 = 角色.路();
    if (路 === '能力') return ctx.call('ai.chat', req);
    if (!路) throw new Error('讲解要「AI 配置」块, 现在没开');
    if (!(await 厂商配置.列表()).length) throw new Error('还没接模型: 点「⚙ 模型」填网址和 Key');
    return 模型调用.chat(await 厂商配置.选(req), req);
  },
  async 卡(el) {
    const ms = await 角色.模(), r = await 角色.读(),
      词 = t => '<details><summary>看提示词</summary><pre>' + esc(t) + '</pre></details>';
    if (!角色.路()) return el.innerHTML = '<p>讲解要「AI 配置」块, 现在没装。源码和段头导图照常能用</p>';
    if (!ms.length) {
      el.innerHTML = '<label>接一家模型</label><p>填网址和 Key, 点 📥 拉模型清单, 选一个文本模型, 点 ⚡ 测通就能讲解</p>'
        + '<section></section>' + 词(提示词.架构师 + '\n\n' + 提示词.分组 + '\n\n' + 提示词.逐行 + '\n\n' + 提示词.画图师);
      el.摘 = 选模型.挂(el.querySelector('section'), { 类: [], 厂商: true });   // 卡关掉时摘
      return;
    }
    const 是 = (名, m) => r[名] && r[名].provider === m.provider && r[名].model === m.model;
    const 行 = (名, 说, 提) => '<label>' + 名 + '</label><select data-role="' + 名 + '">'
      + '<option value="">' + (名 === '画图师' ? '跟架构师一样' : '跟随默认') + '</option>'
      + ms.map((m, i) => '<option value="' + i + '"' + (是(名, m) ? ' selected' : '') + '>'
        + esc(m.provider + ' · ' + m.model) + '</option>').join('') + '</select><p>' + 说 + '</p>' + 词(提);
    el.innerHTML = 行('架构师', '分段、每段一句话、按功能分组、大段再细分', 提示词.架构师 + '\n\n' + 提示词.分组)
      + 行('逐行', '逐行解读 + 给小白讲', 提示词.逐行)
      + 行('画图师', '把各段归成业务节点、连线、排位置、写说明卡片', 提示词.画图师);
    el.onchange = e => {
      const 名 = e.target.dataset.role, m = ms[e.target.value];
      if (!名) return;
      if (m) r[名] = { provider: m.provider, model: m.model }; else delete r[名];
      存储.改('code:roles', Object.assign({}, r));
    };
  },
};
// ═ 解析 · 跟着: 工具, 存储, 提示词, 角色, 对齐, 版本 ═
// 调模型写解读, 存 code:ana:<目标>: 架构师(每段一句话、签、细分; 超过 100 行的块派小架构师再分, 最多 3 层) → 分组(大类 + 总述)。
// 没段头的代码(应用、粘贴)整份当一段交给同一个架构师去切, 切出的第一层升成段。
// 逐行讲解按需、缺什么补什么(每个要讲的行都要有一句注), 同一段同时只跑一个。
// 一段失败只落在那一段上; 不另做超时, 并发交给 AI 块的并发闸; 变了就调 解析.变(id) 让界面重画
const 解析 = {
  跑: {},   // 目标 id → {话: 进度, 停}
  讲中: {},
  变: () => { },
  空: {},   // 还没存过的目标: 同一个 id 给同一份, 几段同时讲也不会各存各的、互相盖掉
  读: async id => (await 存储.读('code:ana:' + id)) || (解析.空[id] = 解析.空[id] || { v: 1, 段: {} }),
  存: (id, a) => (a.at = Date.now(), 存储.改('code:ana:' + id, a)),
  段们: o => o.段.filter(s => !s.借 && s.名 !== '(前言)'),
  async 问(名, 话, 系统 = 提示词[名], 取 = 取JSON) { // 取: 怎么从回话里取东西, 逐行用 取讲
    const 选 = 角色.选(await 角色.读(), 名), 模 = await 角色.名(名), 发 = 补 => 角色.问(Object.assign({
      messages: [{ role: 'system', content: 系统 }, { role: 'user', content: 话 + (补 || '') }],
      temperature: 0.2 }, 选));
    const r = await 发().catch(async e => { // 被限流就照它说的等一次, 别的错照实往上报
      if (!/限流|429/.test(e.message)) throw e;
      await new Promise(f => setTimeout(f, e.等 || 20000));
      return 发();
    });
    try {
      return Object.assign(取(r.content), { 模 });
    } catch (e) {
      return Object.assign(取((await 发('\n\n上次回的认不出(' + e.message + '), 这次严格照格式回。')).content), { 模 });
    }
  },
  套(o, a) { // 没段头的目标换成切出来的段: 按首行指纹找回位置, 代码改过也盖满; 段内第 k 行 = 全局第 起+k 行
    if (!a.切 || !(o.段.length === 1 && o.段[0].无头)) return;
    const ls = 行(o.文);
    o.段 = (对齐.挪(a.切, ls, 1) || a.切).map(c => ({ 名: c.名, 起: c.起 + 1, 止: c.止 + 1,
      文: ls.slice(c.起, c.止 + 1).join('\n'), 无头: 1, 跟着: [], 头注: '', 切: 1 }));
    o.段.forEach(s => s.解 = 对齐.看(s, a.段[s.名]));   // 正看着的目标刚切好就能画, 不用等重读
  },
  async 架构(o, 只) { // 只: 只重读这几段(过时的); 不给 = 全部
    const id = o.id, 跑 = 解析.跑[id] = { 话: '架构师', 停: 0 }, a = await 解析.读(id), 报 = t => (跑.话 = t, 解析.变(id));
    const 全 = o.段.length === 1 && o.段[0].无头, 章 = [];
    let 半 = 0;   // 点了停、真有一步没做: 顶上说还差什么, 「接着解析」补上
    if (o.类 !== '块') await 版本.建(o);   // 应用第一次解析: 这时的样子记成第 0 版
    解析.段们(o).filter(s => !只 || 只.includes(s.名)).forEach(s => { // 装章: 每章不超过 36 KB; 没段头的大文件按 800 行切章
      const ls = 行(s.文), 步 = 全 && s.文.length > 48000 ? 800 : ls.length;
      for (let i = 0; i < ls.length; i += 步) {
        const 片 = { s, a: i, b: Math.min(ls.length, i + 步) - 1 }, c = 章[章.length - 1];
        if (c && !全 && c.字 + s.文.length <= 36000) c.片.push(片), c.字 += s.文.length;
        else 章.push({ 片: [片], 字: s.文.length });
      }
    });
    const 新切 = [];   // 没段头的: 这次切出的分法先放这里, 齐了才换上, 没切开就留着原来的
    try {
      let 完 = 0;
      报('架构师 0/' + 章.length + ' 章');
      await Promise.all(章.map(async c => {
        let r = {};
        try {
          if (跑.停) throw new Error('点了停, 这段没解析');
          r = await 解析.问('架构师', '代码: ' + o.名 + '(' + id + ')\n全部段名: ' + 解析.段们(o).map(s => s.名)
            .join('、') + (全 ? '\n这份代码没有段头, 整份当一段「(全文)」, 把它分成 3-12 块' : '') + '\n\n' + c.片.map(p => '== '
            + p.s.名 + ' ==\n' + 编号(行(p.s.文).slice(p.a, p.b + 1), p.a)).join('\n\n'));
        } catch (e) { r.错 = e.message; }
        c.片.forEach(p => {
          const 回 = r.段 || {}, ls = 行(p.s.文),
            x = 回[p.s.名] || (全 ? Object.values(回).find(v => v && v.分) : null);   // 整份时段名对不上也认
          if (全) return 新切.push(...(x && x.分 || [])), Object.assign(a, { 切模: r.模, 切错: r.错 });
          a.段[p.s.名] = Object.assign(a.段[p.s.名] || {}, x ? { 述: x.述, 签: x.签, 模: r.模, 错: '',
            分: 对齐.记(对齐.修(x.分, 1, ls.length - 1), ls) } : { 错: r.错 || '模型没回这段' }, { 纹: 纹(p.s.文) });
        });
        报('架构师 ' + ++完 + '/' + 章.length + ' 章');
      }));
      if (全) { // 新分法齐了才换上; 这次没切开就留着上次的, 导图不会被冲成一段「(全文)」
        if (新切.length) a.切 = 新切;
        else if ((a.切 || []).length) a.切错 = '';
        解析.升(o, a);
      }
      let 块 = [], 总 = 0;
      const 走 = (s, ls, xs, 深) => (xs || []).forEach(x => x.止 - x.起 >= 100 && 深 < 3 && !x.分
        ? (块.push({ s, x, ls, 深 }), 总++) : 走(s, ls, x.分, 深 + 1));
      解析.段们(o).filter(s => !只 || 只.includes(s.名) || 全).forEach(s => { // 超过 100 行又没分的段, 整段交给小架构师
        const ls = 行(s.文), x = a.段[s.名] || {};
        if (x.分) 走(s, ls, x.分, 1);
        else if (ls.length > 101 && !x.错) {
          块.push({ s, ls, 深: 1, 段: 1, x: { 名: s.名, 起: s.无头 ? 0 : 1, 止: ls.length - 1 } });
          总++;
        }
      });
      for (完 = 0; 块.length && !跑.停;) { // 小架构师: 一批并行问, 分出来还大的进下一批
        const 这批 = 块;
        块 = [];
        报('细分 ' + 完 + '/' + 总);
        await Promise.all(这批.map(async ({ s, x, ls, 深, 段 }) => {
          const r = await 解析.问('架构师', '代码: ' + o.名 + '\n只分这一块: 段「' + s.名 + '」里的「' + x.名
            + '」(段内第 ' + x.起 + '–' + x.止 + ' 行)\n\n== ' + s.名 + ' ==\n' + 编号(ls.slice(x.起, x.止 + 1), x.起))
            .catch(() => ({}));
          const 分 = 对齐.记(对齐.修(r.分 || ((r.段 || {})[s.名] || {}).分, x.起, x.止), ls);
          if (段) a.段[s.名].分 = 分; else x.分 = 分;
          走(s, ls, 分, 深 + 1);
          报('细分 ' + ++完 + '/' + 总);
        }));
      }
      Object.keys(a.段).forEach(n => !o.段.some(s => s.名 === n) && delete a.段[n]);   // 消失的段删掉
      if (跑.停) 半 = 1;   // 停在分组之前: 分组和没做完的细分都没做; 分组时才点的停, 分组照样做完
      else if (解析.段们(o).some(s => (a.段[s.名] || {}).述)) await 解析.分组(o, a, 报);   // 一段都没成就不分组
    } finally {
      if (半) a.停 = 1; else delete a.停;
      解析.存(id, a);
      delete 解析.跑[id];
      解析.变(id);
    }
  },
  升(o, a) { // 没段头: 切出的第一层升成段, 重名的加号
    const ls = 行(o.文), 名 = {};
    a.切 = 对齐.记(对齐.修(a.切, 0, ls.length - 1) || [{ 名: '(全文)', 起: 0, 止: ls.length - 1 }], ls);
    a.切.forEach(c => {
      c.名 = 名[c.名] ? c.名 + ' ' + ++名[c.名] : (名[c.名] = 1, c.名);
      a.段[c.名] = Object.assign(a.段[c.名] || {}, { 述: c.述, 纹: c.纹, 模: a.切模, 错: a.切错 });   // 讲解和注留着
    });
    解析.套(o, a);
  },
  async 分组(o, a, 报) {
    报('分组');
    const 名 = 解析.段们(o).map(s => s.名).filter(n => a.段[n]), 借 = o.段.filter(s => s.借).map(s => s.名);
    const 单 = 名.map(n => n + ' — ' + (a.段[n].述 || '')).join('\n');
    const r = await 解析.问('架构师', '代码: ' + o.名 + '\n' + 单, 提示词.分组).catch(e => ({ 错: e.message }));
    const 用 = new Set(), 类 = (r.类 || []).map(c => ({ 名: String(c.名 || '其他'), 段: (c.段 || [])
      .filter(n => 名.includes(n) && !用.has(n) && 用.add(n)) })).filter(c => c.段.length);
    const 漏 = 名.filter(n => !用.has(n));   // 模型漏掉的归「其他」, 编出来的段名丢掉
    if (漏.length) 类.push({ 名: '其他', 段: 漏 });
    if (借.length) 类.push({ 名: '借来的', 段: 借 });
    Object.assign(a, { 总述: r.总述 || a.总述, 类, 分组错: r.错 });
  },
  片(s, 分) { // 一段怎么切开问(段内行号 [起, 止]): 小段一片; 大段按最底层的细分, 太长再按 120 行; 没有要讲的行的片不问
    const ls = 行(s.文), 片 = [], 叶 = xs => xs.forEach(y => y.分 ? 叶(y.分) : 片.push([y.起, y.止]));
    ls.length <= 150 || !分 ? 片.push([s.无头 ? 0 : 1, ls.length - 1]) : 叶(分);
    for (let i = 0; i < 片.length; i++) {
      if (片[i][1] - 片[i][0] >= 150) 片.splice(i + 1, 0, [片[i][0] + 120, 片[i][1]]), 片[i][1] = 片[i][0] + 119;
    }
    return 片.filter(([p, q]) => ls.slice(p, q + 1).some(注行));
  },
  计(s, x) { // 这段还差什么: 整 = 没有讲解的片(整片问), 缺 = 没注的行, 补 = 不在整片里的缺; 次 = 要问模型几次
    const v = 对齐.看(s, x), 在 = (i, [p, q]) => i >= p && i <= q,
      整 = 解析.片(s, v.分).filter(c => !(v.讲 || []).some(t => 在(t.起, c))),
      缺 = 行(s.文).map((l, i) => 注行(l) && !v.注[i] ? i : -1).filter(i => i >= 0),
      补 = 缺.filter(i => !整.some(c => 在(i, c)));
    return { 整, 缺, 补, 次: 整.length + Math.ceil(补.length / 80) };
  },
  要: (s, x) => !s.借 && !!(x && x.讲错 || 解析.计(s, x).次 && !(x && x.讲纹 === 纹(s.文))),   // 同样的代码讲过一遍就不自己再问
  讲(o, 名) { // 缺什么补什么: 没讲解的片整片问(已有注的行标「·」当上下文); 只缺注就只发缺的行加前后两行; 回来再数, 还缺补问一次
    const k = o.id + '/' + 名;
    return 解析.讲中[k] = 解析.讲中[k] || (async () => {
      const s = o.段.find(x => x.名 === 名), a = await 解析.读(o.id), ls = 行(s.文), x = a.段[名] = a.段[名] || {},
        类 = (a.类 || []).find(c => c.段.includes(名)), 在 = new Set(ls.map(行纹)), 错 = [];
      const 头 = '整份: ' + o.名 + (a.总述 ? ' — ' + a.总述 : '') + '\n位置: ' + [o.名, 类 && 类.名, 名].filter(Boolean)
        .join(' › ') + '\n这段: ' + (x.述 || s.头注 || '') + (s.跟着.length ? '\n它跟着: ' + s.跟着.join('、') : '');
      x.注 = x.注 || {};
      Object.keys(x.注).forEach(h => 在.has(h) || delete x.注[h]);   // 代码里已经没有的行, 注也不留
      const 问 = async (要, 片) => { // 要: 这次要注的行(标「|」); 片 [p, q]: 整片问、连讲解一起, 不给就只补注
        const 标 = new Set(要), ns = [];
        (片 ? [片] : 要.map(i => [i - 2, i + 2])).forEach(([p, q]) => {
          for (let j = Math.max(0, p); j <= Math.min(ls.length - 1, q); j++) ns.push(j);
        });
        const 列 = [...new Set(ns)].sort((p, q) => p - q)   // 隔开的几处之间写「…」
          .map((j, t, xs) => (t && j > xs[t - 1] + 1 ? '…\n' : '') + j + (标.has(j) ? '| ' : '· ') + ls[j])
          .join('\n');
        const r = await 解析.问('逐行', 头 + '\n\n' + (片 ? '' : '只补标「|」这几行的注, 不用写讲:\n') + 列, undefined, 取讲);
        r.注.forEach(t => 标.has(+t.行) && t.话 && (x.注[行纹(ls[+t.行])] = String(t.话)));
        if (片) { // 这片的讲解换成新的, 别的片的要点留着(已按首行指纹对好位)
          const 夹 = n => Math.max(片[0], Math.min(片[1], n | 0)),
            新 = r.讲.slice(0, 5).map(t => Object.assign({}, t, { 起: 夹(t.起), 止: Math.max(夹(t.起), 夹(t.止)) }));
          x.讲 = (对齐.看(s, x).讲 || []).filter(t => t.起 < 片[0] || t.起 > 片[1]).concat(对齐.记(新, ls))
            .sort((p, q) => p.起 - q.起);
        }
        x.讲模 = r.模;
        解析.存(o.id, a);
        解析.变(o.id);
      };
      解析.变(o.id);
      try {
        for (let 轮 = 0; 轮 < 2 && !错.length; 轮++) { // 第二轮: 回来再数一遍, 还缺的补问一次, 仍缺就算了
          const c = 解析.计(s, x), 补 = 轮 ? c.缺 : c.补, 份 = 轮 ? [] : c.整.map(p => 问(c.缺.filter(i => i >= p[0]
            && i <= p[1]), p));
          for (let i = 0; i < 补.length; i += 80) 份.push(问(补.slice(i, i + 80)));
          (await Promise.allSettled(份)).forEach(r => r.reason && 错.push(r.reason.message || r.reason + ''));
        }
        if (!错.length) x.讲纹 = 纹(s.文);
      } finally {
        x.讲错 = 错[0] || '';
        解析.存(o.id, a);
        delete 解析.讲中[k];
        解析.变(o.id);
      }
    })();
  },
};
// ═ 画图师 · 跟着: 工具, 存储, 提示词, 解析, 布图, 画架构图 ═
// 三种图, 都回同一个形状(画架构图 段说的 图), 交给 布图 排、架构图 画:
// 业务图 = 画图师(模型)把各段归成业务节点、连线、排行列、写卡片, 存在解读的 图 里(code:ana:<目标>);
// 粗图 = 不问模型: 解析过就一个大类一个方块, 没解析就一段一个, 线照段头的「跟着」;
// 里面 = 点开一个节点: 它管的段, 加上跟它们有来往的别的节点(灰色)。段和段的来往: 有「跟着」用「跟着」, 没有就用画图师顺带给的段线。
// 画(): 问一次; 有段没归进节点就带着漏的段名再问一次; 画出来有交叉就带着交叉的线让它调一次位置, 留交叉少的那份。最多问三次
const 画图师 = {
  跑: {},   // 目标 id → {话}
  段们: o => o.段.filter(s => !s.借 && s.名 !== '(前言)'),
  借们: o => o.段.filter(s => s.借),
  有跟: o => o.段.some(s => (s.跟着 || []).length),
  关系(o) { // 段和段的来往 [{从, 到, 话}]: 从 用 到
    const 有 = new Set(o.段.map(s => s.名));
    if (画图师.有跟(o)) {
      return o.段.flatMap(s => (s.跟着 || []).filter(n => 有.has(n) && n !== s.名).map(n => ({ 从: s.名, 到: n, 话: '' })));
    }
    return ((o.ana.图 || {}).段线 || []).filter(x => 有.has(x[0]) && 有.has(x[1]) && x[0] !== x[1])
      .map(x => ({ 从: x[0], 到: x[1], 话: String(x[2] || '').slice(0, 12) }));
  },
  纹们: o => Object.fromEntries(画图师.段们(o).map(s => [s.名, 纹(s.文)])),
  过时(o) { // 画图之后段多了、少了或改过: 图照样画, 顶上提醒重画
    const g = o.ana.图, 现 = 画图师.纹们(o);
    if (!g || !g.纹) return false;
    return Object.keys(现).length !== Object.keys(g.纹).length || Object.keys(现).some(k => g.纹[k] !== 现[k]);
  },
  定(g) { // 拷一份, 给每个节点定尺寸; 两个节点抢一格就把后来的往右挪; 去掉指向不存在节点的线和重复的线
    const ns = g.节点.map(n => Object.assign({}, n)), 有 = new Set(ns.map(n => n.id)), 占 = new Set(), 线 = [], 见 = new Set();
    ns.forEach(n => {
      [n.w, n.h] = 架构图.尺(n);
      n.行 = Math.round(+n.行) || 0;
      n.列 = Math.round(+n.列) || 0;
      while (占.has(n.行 + ',' + n.列)) n.列++;
      占.add(n.行 + ',' + n.列);
    });
    (g.线 || []).forEach(e => 有.has(e.从) && 有.has(e.到) && e.从 !== e.到 && !见.has(e.从 + '>' + e.到)
      && (见.add(e.从 + '>' + e.到), 线.push(Object.assign({}, e))));
    return Object.assign({}, g, { 节点: ns, 线 });
  },
  图(o) { // 存着的业务图, 按现在的代码修一修: 删掉的段拿掉, 新加的段归进「新加的段」
    const g = o.ana.图;
    if (!g || !(g.节点 || []).length) return null;
    const 有 = new Set(o.段.map(s => s.名));
    const ns = g.节点.map(n => Object.assign({}, n, { 段: (n.段 || []).filter(x => 有.has(x)) }))
      .filter(n => n.型 === '外部' || n.段.length);
    const 新 = 画图师.段们(o).map(s => s.名).filter(x => !ns.some(n => n.段.includes(x)));
    if (新.length) ns.push({ id: '新', 名: '新加的段', 述: '画图之后才有的, 点「重画」归类', 型: '核心',
      行: Math.max(...ns.map(n => n.行)) + 1, 列: 0, 段: 新 });
    return Object.assign(画图师.定(Object.assign({}, g, { 节点: ns })), { 层: '业务', 过时: 画图师.过时(o) });
  },
  粗(o) { // 不问模型的图: 解析过按大类, 没解析一段一个
    const 类 = (o.ana.类 || []).filter(c => c.段.length), 关 = 画图师.关系(o), 段 = n => o.段.find(s => s.名 === n);
    let ns, 归 = {};
    if (类.length) {
      ns = 类.map((c, i) => {
        c.段.forEach(n => 归[n] = '类' + i);
        return { id: '类' + i, 名: c.名, 述: c.段.length + ' 段: ' + c.段.join('、'), 型: c.名 === '借来的' ? '外部' : '核心',
          段: c.段.slice() };
      });
    } else {
      ns = o.段.filter(s => s.名 !== '(前言)').map((s, i) => (归[s.名] = 's' + i, { id: 's' + i, 名: s.名,
        述: (s.解 || {}).述 || s.头注 || '', 型: s.借 ? '外部' : '核心', 起: s.起, 行数: s.止 - s.起 + 1, 借: s.借 }));
    }
    const es = [], 见 = new Set();
    关.forEach(r => { const a = 归[r.从], b = 归[r.到];
      if (a && b && a !== b && !见.has(a + '>' + b)) 见.add(a + '>' + b), es.push({ 从: a, 到: b }); });
    const g = { 节点: ns, 线: 布图.减(ns, es), 层: 类.length ? '粗类' : '粗段' };
    布图.分层(g.节点, g.线);
    return 画图师.定(g);
  },
  内(o, G, id) { // 点开 G 里的节点 id: 它管的段 + 跟这些段有来往的别的节点(灰色, 双击过去)
    const N = G.节点.find(n => n.id === id), 里 = new Set(N.段), 归 = {}, 号 = {};
    G.节点.forEach(n => n.id !== id && (n.段 || []).forEach(x => 归[x] = n));
    const ns = N.段.map((x, i) => { const s = o.段.find(y => y.名 === x) || { 名: x };
      号[x] = 's' + i;
      return { id: 's' + i, 名: x, 述: (s.解 || {}).述 || s.头注 || '', 型: N.型 === '外部' ? '外部' : N.型, 起: s.起,
        行数: s.止 && s.止 - s.起 + 1, 借: s.借 }; });
    const 灰 = M => ('x:' + M.id) in 号 ? 号['x:' + M.id] : (ns.push({ id: 'x:' + M.id, 名: M.名, 型: M.型, 灰: 1, 回: M.id }),
      号['x:' + M.id] = 'x:' + M.id);
    const es = [], 见 = new Set(), 加 = (a, b, 话) => a !== b && !见.has(a + '>' + b) && (见.add(a + '>' + b), es.push({ 从: a,
      到: b, 话 }));
    画图师.关系(o).forEach(r => {
      const a = 里.has(r.从), b = 里.has(r.到);
      if (a && b) 加(号[r.从], 号[r.到], r.话);
      else if (a && 归[r.到]) 加(号[r.从], 灰(归[r.到]), r.话);
      else if (b && 归[r.从]) 加(灰(归[r.从]), 号[r.到], r.话);
    });
    const g = { 节点: ns, 线: 布图.减(ns, es), 层: '里面', 父: N };
    布图.分层(g.节点, g.线);
    return 画图师.定(g);
  },
  料(o, 要段线) { // 发给画图师的材料
    const a = o.ana, 用 = s => 画图师.有跟(o) && (s.跟着 || []).length ? ' · 用到: ' + s.跟着.join('、') : '';
    return '代码: ' + o.名 + '(' + o.id + ') · ' + o.行数 + ' 行' + (a.总述 ? '\n总述: ' + a.总述 : '')
      + ((a.类 || []).length ? '\n大类: ' + a.类.map(c => c.名 + '(' + c.段.join('、') + ')').join('; ') : '')
      + '\n\n段(段名 [行数] — 一句话):\n' + 画图师.段们(o).map(s => '- ' + s.名 + ' [' + (s.止 - s.起 + 1) + ' 行] — '
        + ((s.解 || {}).述 || s.头注 || '') + 用(s)).join('\n')
      + (画图师.借们(o).length ? '\n\n借来的(已是外部节点, 照 id 原样列出, 段写它自己):\n' + 画图师.借们(o).map((s, i) => '- 借'
        + (i + 1) + ': ' + s.名 + '(借自 ' + s.借.split('/')[0] + ')').join('\n') : '')
      + (要段线 ? '\n\n要段线: 这份代码没写段和段之间的依赖, 另给「段线」' : '');
  },
  收(o, r) { // 模型的回话 → 图; 记下漏掉的段。编出来的段名丢掉, 重复的只算第一次, 借来的照 id 补齐
    const 名们 = 画图师.段们(o).map(s => s.名), 借 = 画图师.借们(o), 用 = new Set(), ids = new Set();
    const ns = (Array.isArray(r.节点) ? r.节点 : []).filter(n => n && n.名).map((n, i) => {
      let id = String(n.id || 'n' + (i + 1));
      while (ids.has(id)) id += '_';
      ids.add(id);
      const k = /^借(\d+)$/.exec(id), b = k && 借[k[1] - 1],
        段 = b ? [b.名] : (Array.isArray(n.段) ? n.段 : []).filter(x => 名们.includes(x) && !用.has(x) && 用.add(x)),
        型 = b ? '外部' : 架构图.型.some(t => t[0] === n.型) ? n.型 === '外部' && 段.length ? '核心' : n.型 : '核心';
      return { id, 名: String(b ? b.名 : n.名).slice(0, 16), 述: String(n.述 || '').slice(0, 40), 型, 行: n.行, 列: n.列, 段,
        借: b ? b.借 : undefined };
    });
    借.forEach((b, i) => !ns.some(n => n.借 === b.借 && n.名 === b.名) && ns.push({ id: '借' + (i + 1), 名: b.名, 述: '',
      型: '外部', 行: 3, 列: i, 段: [b.名], 借: b.借 }));
    const 有 = new Set(ns.map(n => n.id)), 段名 = new Set(o.段.map(s => s.名)), 串 = (x, n) => String(x || '').slice(0, n);
    return { 标题: 串(r.标题, 30), 一句: 串(r.一句, 80), 节点: ns,
      线: (Array.isArray(r.线) ? r.线 : []).filter(e => e && 有.has(e.从) && 有.has(e.到))
        .map(e => ({ 从: e.从, 到: e.到, 话: 串(e.话, 12), 主: !!e.主, 虚: !!e.虚 })),
      卡: (Array.isArray(r.卡) ? r.卡 : []).filter(k => k && k.题).slice(0, 5).map(k => ({ 题: 串(k.题, 16),
        条: (Array.isArray(k.条) ? k.条 : []).slice(0, 5).map(t => 串(t, 60)) })),
      段线: Array.isArray(r.段线) ? r.段线.filter(x => Array.isArray(x) && 段名.has(x[0]) && 段名.has(x[1])) : undefined,
      漏: 名们.filter(x => !用.has(x)) };
  },
  async 画(o) { // 问画图师, 存进解读的 图; 进度写在 跑, 解读变了就让界面重画
    const id = o.id;
    if (画图师.跑[id]) return;
    const 跑 = 画图师.跑[id] = { 话: '画图师在归纳业务节点' }, a = await 解析.读(id), 报 = t => (跑.话 = t, 解析.变(id)),
      要 = !画图师.有跟(o), 料 = 画图师.料(o, 要);
    报(跑.话);
    try {
      let r = await 解析.问('画图师', 料), g = 画图师.收(o, r), 问了 = 1;
      if (g.漏.length) { // 漏了段: 带着漏的段名再问一次, 留漏得少的
        报('有 ' + g.漏.length + ' 段没归进节点, 让画图师补上');
        const g2 = 画图师.收(o, await 解析.问('画图师', 料 + '\n\n上次这些段没归进任何节点: ' + g.漏.join('、')
          + '。每一段都要恰好归进一个非外部节点, 整张图重新完整地回。').catch(() => ({})));
        问了++;
        if (g2.节点.length && g2.漏.length < g.漏.length) g = g2;
      }
      if (g.漏.length) g.节点.push({ id: '其他', 名: '其他', 述: '画图师没归类的段', 型: '核心',
        行: Math.max(0, ...g.节点.map(n => +n.行 || 0)) + 1, 列: 0, 段: g.漏 });
      if (!g.节点.some(n => n.段.length && !n.借)) throw new Error('画图师没回出节点');
      let 定 = 画图师.定(g), 量 = 布图.全(定);
      if (量.交.length) { // 有交叉: 让它只调行列, 再量一遍, 留交叉少的
        报('有 ' + 量.交.length + ' 处连线交叉, 让画图师调位置');
        const 名 = i => { const e = 定.线[i]; return e.从 + '→' + e.到 + (e.话 ? '(' + e.话 + ')' : ''); };
        const r3 = await 解析.问('画图师', '调位置。你上次排的格子:\n' + 定.节点.map(n => n.id + ' ' + n.名 + ' 行' + n.行
          + ' 列' + n.列).join('\n') + '\n线: ' + 定.线.map((e, i) => 名(i)).join('; ') + '\n画出来这些线交叉了:\n'
          + 量.交.map(([i, j]) => 名(i) + ' 和 ' + 名(j)).join('\n') + '\n只调行列让交叉变少, 主线还在一行。只回 {"位":{"n1":[行,列]}}')
          .catch(() => ({}));
        问了++;
        const 位 = r3.位 || {}, 新 = Object.assign({}, 定, { 节点: 定.节点.map(n => Array.isArray(位[n.id])
          ? Object.assign({}, n, { 行: 位[n.id][0], 列: 位[n.id][1] }) : n) }), 定2 = 画图师.定(新), 量2 = 布图.全(定2);
        if (量2.交.length < 量.交.length) 定 = 定2, 量 = 量2;
      }
      a.图 = { 标题: g.标题 || o.名, 一句: g.一句, 卡: g.卡, 段线: 要 ? g.段线 || [] : undefined, 纹: 画图师.纹们(o),
        节点: 定.节点.map(({ w, h, ...n }) => n), 线: 定.线, 交: 量.交.length, 模: r.模, 问了, at: Date.now() };
      a.图错 = '';
    } catch (e) {
      a.图错 = e.message || String(e);
    } finally {
      delete 画图师.跑[id];
      解析.存(id, a);
      解析.变(id);
    }
  },
  文(o) { // code.map 顶上那一节: 业务节点、管哪几段、怎么连
    const g = 画图师.图(o);
    if (!g) return o.ana.at ? '(还没画业务架构图; make: true 会让画图师画)\n' : '';
    const 名 = {};
    g.节点.forEach(n => 名[n.id] = n.名);
    return '【业务架构图】' + (g.标题 || '') + (g.过时 ? ' (代码改过, 图可能过时)' : '') + '\n'
      + g.节点.map(n => '· ' + n.名 + '(' + n.型 + ')' + (n.述 ? ': ' + n.述 : '') + (n.借 ? ' [借自 ' + n.借 + ']'
        : n.段.length ? ' [段: ' + n.段.join('、') + ']' : '')).join('\n') + '\n线: '
      + g.线.map(e => 名[e.从] + ' → ' + 名[e.到] + (e.话 ? '(' + e.话 + ')' : '')).join('; ') + '\n';
  },
};
// ═ 同步 · 跟着: 工具, 存储, 对齐, 解析, 画图师, 布图, 画架构图, 地图, 外壳 ═
// 源码改过之后, 让已有的解读跟上: 只动对不上的那几处, 不整份重来。三样各管各的:
// 导图 = 一句话和细分对不上(段指纹变了)、新加的段、上次没成的段 → 架构师只重读这几段(再分一次组);
// 逐行 = 讲过的段代码变了 → 内容对不上的要点丢掉、那几片重讲; 行注按行指纹挂, 没改的行留着, 只补改过的行;
// 架构图 = 画过的图段多了、少了或改过 → 删掉的段拿掉, 新段和改过的段问画图师一次归进哪个节点, 不重画整张。
// 计(o) 只数不问模型, 不花一次调用; 顶栏那条先问人「同步更新 / 先不」, 点了才花调用; 「先不」记住这一版代码, 代码再变才再问
const 同步 = {
  略: 会话('code.sync'),   // 目标 id → 点「先不」时的代码指纹
  印: o => 纹(o.段.map(s => s.名 + ':' + 纹(s.文)).join('|')),
  讲过: x => !!x && !!(x.讲纹 || (x.讲 || []).length),
  图差(o) { // 画图之后的变化: 新 / 删 / 改 的段名; 没画过或没变回 null
    const g = o.ana.图;
    if (!g || !g.纹 || !(g.节点 || []).length || !画图师.过时(o)) return null;
    const 现 = 画图师.纹们(o), 名 = Object.keys(现), 旧 = Object.keys(g.纹);
    return { 新: 名.filter(n => !(n in g.纹)), 删: 旧.filter(n => !(n in 现)), 改: 名.filter(n => n in g.纹 && g.纹[n] !== 现[n]) };
  },
  计(o) { // 要同步什么、约问几次; 没解析过回 null
    const a = o.ana;
    if (!a || !a.at) return null;
    const 段们 = 解析.段们(o), 导 = 段们.filter(s => !a.段[s.名] || s.解.旧 || s.解.错).map(s => s.名),
      讲 = 段们.filter(s => 同步.讲过(a.段[s.名]) && a.段[s.名].讲纹 !== 纹(s.文)).map(s => s.名),
      图 = 同步.图差(o);
    const 讲次 = 讲.reduce((n, 名) => { // 按「丢掉对不上的要点」之后算
      const s = o.段.find(x => x.名 === 名), x = a.段[名], v = 对齐.看(s, x);
      return n + 解析.计(s, Object.assign({}, x, { 讲: (v.讲 || []).filter(t => !t.旧) })).次;
    }, 0), 图次 = 图 && (图.新.length || 图.改.length) ? 1 : 0;
    return { 导, 讲, 图, 次: (导.length ? 外壳.次(o, 导) : 0) + 讲次 + 图次,
      有: !!(导.length || 讲.length || 图) };
  },
  要(o) { const c = 同步.计(o); return c && c.有 && 同步.略[o.id] !== 同步.印(o) ? c : null; },
  话(c) {
    return [c.导.length ? '导图 ' + c.导.length + ' 段' : '', c.讲.length ? '逐行 ' + c.讲.length + ' 段' : '',
      c.图 ? '架构图 ' + (c.图.新.length + c.图.改.length + c.图.删.length) + ' 段' : ''].filter(Boolean).join('、');
  },
  条(o, c) { // 顶栏那条: 问人要不要同步
    return '<span class="c-run">🔄 源码改过了, 已有的解读可以跟上: ' + esc(同步.话(c)) + ' · 约问模型 ' + c.次
      + ' 次</span><button data-do="同步">同步更新</button><button data-do="先不">先不</button>';
  },
  文(o, c) { // code.sync 不带 run 时回的说明
    if (!c) return '「' + o.名 + '」还没解析过, 没有可同步的解读';
    if (!c.有) return '「' + o.名 + '」的解读和代码对得上, 不用同步';
    return '「' + o.名 + '」源码改过, 要同步: ' + 同步.话(c) + ' · 约问模型 ' + c.次 + ' 次'
      + (c.导.length ? '\n导图(重读一句话和细分): ' + c.导.join('、') : '')
      + (c.讲.length ? '\n逐行(重讲改过的片, 补改过的行注): ' + c.讲.join('、') : '')
      + (c.图 ? '\n架构图: ' + [['新', c.图.新], ['改', c.图.改], ['删', c.图.删]].filter(x => x[1].length)
        .map(x => x[0] + ' ' + x[1].join('、')).join('; ') : '')
      + '\n先问过人, 再 code.sync {id, run: true}';
  },
  先不(o) {
    同步.略[o.id] = 同步.印(o);
    会话('code.sync', 同步.略);
    外壳.顶();
  },
  async 做(o, 钮) { // 顶栏「同步更新」: 问得多先点两下
    const c = 同步.计(o);
    if (!c || !c.有) return 外壳.顶();
    if (钮 && c.次 > 3 && !先问(钮, '再点一次: 要问模型约 ' + c.次 + ' 次')) return;
    try {
      外壳.说('✓ 同步好了: ' + await 同步.跑(o));
    } catch (e) { 外壳.错(e); }
  },
  async 跑(o) { // 导图 → 逐行 → 架构图, 一步一步来; 回一句做了什么
    const id = o.id, c = 同步.计(o), 说 = [];
    if (!c || !c.有) return '本来就对得上';
    if (解析.跑[id]) throw new Error('这份代码正在解析或讲解, 等它完了再同步');
    if (c.导.length) {
      await 解析.架构(o, c.导);
      o = await 地图.读(id);
      const n = c.导.filter(x => (o.ana.段[x] || {}).错).length;
      说.push('导图 ' + (c.导.length - n) + ' 段' + (n ? '(' + n + ' 段没成)' : ''));
    }
    if (c.讲.length) {
      const a = await 解析.读(id), 跑 = 解析.跑[id] = { 话: '同步逐行 0/' + c.讲.length + ' 段', 停: 0 }, 要 = c.讲.slice();
      let 完 = 0, 错 = 0;
      try {
        c.讲.forEach(n => { // 内容对不上的要点丢掉, 那几片就会整片重讲
          const s = o.段.find(x => x.名 === n), x = a.段[n];
          if (s && x) x.讲 = (对齐.看(s, x).讲 || []).filter(t => !t.旧).map(({ 旧, ...t }) => t);
        });
        解析.存(id, a);
        解析.变(id);
        const 工 = async () => {
          for (let n; !跑.停 && (n = 要.shift());) {
            await 解析.讲(o, n).catch(() => 错++);
            if ((a.段[n] || {}).讲错) 错++;
            跑.话 = '同步逐行 ' + ++完 + '/' + c.讲.length + ' 段';
            解析.变(id);
          }
        };
        await Promise.all([工(), 工(), 工()]);
      } finally {
        delete 解析.跑[id];
        解析.变(id);
      }
      说.push('逐行 ' + (完 - 错) + ' 段' + (错 ? '(' + 错 + ' 段没讲成)' : ''));
      o = await 地图.读(id);
    }
    const d = 同步.图差(o);
    if (d) {
      解析.跑[id] = { 话: '同步架构图', 停: 0 };
      解析.变(id);
      try {
        await 同步.图(o, d);
        const 错 = (await 解析.读(id)).图错;
        说.push(错 ? '架构图没成: ' + 错 : '架构图 ' + (d.新.length + d.改.length + d.删.length) + ' 段');
      } finally {
        delete 解析.跑[id];
        解析.变(id);
      }
    }
    delete 同步.略[id];
    会话('code.sync', 同步.略);
    return 说.join('、') || '没有要动的';
  },
  async 图(o, d) { // 在原图上小改: 删掉的段拿掉; 新段和改过的段问一次画图师归到哪(可开新节点); 再排一次版
    const a = await 解析.读(o.id), g = a.图, 问 = d.新.concat(d.改), 段 = n => o.段.find(s => s.名 === n) || {};
    let ns = g.节点.map(n => Object.assign({}, n, { 段: (n.段 || []).filter(x => !d.删.includes(x)) })), 新线 = [], 模 = g.模;
    const 其他 = () => ns.find(n => n.id === '其他') || (ns.push({ id: '其他', 名: '其他', 述: '没归进别处的段', 型: '核心',
      行: Math.max(0, ...ns.map(n => +n.行 || 0)) + 1, 列: 0, 段: [] }), ns.at(-1));
    try {
      if (问.length) {
        const 型 = 架构图.型.map(t => t[0]).filter(t => t !== '外部');
        const r = await 解析.问('画图师', '代码: ' + o.名 + '(' + o.id + ')。代码改过了, 业务架构图不重画, 只把下面几段归位。\n'
          + '现有节点(id · 名 · 型 · 行,列 · 管的段):\n' + ns.map(n => n.id + ' · ' + n.名 + ' · ' + n.型 + ' · ' + n.行 + ','
            + n.列 + ' · ' + (n.借 ? '(外部, 不能放段)' : n.段.join('、'))).join('\n')
          + '\n\n要归位的段:\n' + 问.map(n => '- ' + n + (d.新.includes(n) ? ' [新加的]' : ' [改过的]') + ' — '
            + ((段(n).解 || {}).述 || 段(n).头注 || '')).join('\n')
          + '\n\n只回 JSON: {"归":{"段名":"节点id"},"新节点":[{"id":"n20","名":"不超过8字","述":"不超过20字","型":"核心","行":0,"列":0}],'
          + '"线":[{"从":"节点id","到":"节点id","话":"不超过6字"}]}。改过的段用途没变就归回原来的节点; 现有节点实在放不下才开新节点'
          + '(行列别和现有的抢); 线只回这次新加的。型只能是: ' + 型.join('、'),
        '你是架构图画师, 在一张已有的业务架构图上做小修改。只回 JSON, 不要多话。');
        模 = r.模 || 模;
        const ids = new Set(ns.map(n => n.id));
        (Array.isArray(r.新节点) ? r.新节点 : []).filter(n => n && n.id && n.名 && !ids.has(String(n.id))).forEach(n => {
          ids.add(String(n.id));
          ns.push({ id: String(n.id), 名: String(n.名).slice(0, 16), 述: String(n.述 || '').slice(0, 40),
            型: 型.includes(n.型) ? n.型 : '核心', 行: n.行, 列: n.列, 段: [] });
        });
        const 归 = r.归 || {};
        问.forEach(x => {
          const 原 = ns.find(n => n.段.includes(x)), 到 = ns.find(n => n.id === String(归[x]) && !n.借 && n.型 !== '外部');
          if (到 === 原 && 原) return;
          const 去 = 到 || 原 || 其他();
          if (原 && 去 !== 原) 原.段 = 原.段.filter(y => y !== x);
          if (!去.段.includes(x)) 去.段.push(x);
        });
        新线 = (Array.isArray(r.线) ? r.线 : []).filter(e => e && e.从 && e.到)
          .map(e => ({ 从: String(e.从), 到: String(e.到), 话: String(e.话 || '').slice(0, 12) }));
      }
      ns = ns.filter(n => n.借 || n.型 === '外部' || n.段.length);
      const 定 = 画图师.定(Object.assign({}, g, { 节点: ns, 线: (g.线 || []).concat(新线) })), 量 = 布图.全(定);
      a.图 = Object.assign({}, g, { 节点: 定.节点.map(({ w, h, ...n }) => n), 线: 定.线, 纹: 画图师.纹们(o), 交: 量.交.length,
        模, 同步: Date.now() });
      a.图错 = '';
    } catch (e) {
      a.图错 = '同步没成: ' + (e.message || e);
    }
    解析.存(o.id, a);
  },
};
// ═ 版本 · 跟着: 工具, 存储, 手术台 ═
// 改动记录 code:ver:<目标> = {头: {rev}, 版: [{v, at, 注, 段: {段名: 文字纹 | ''(删了)}, 计, 钉?}], 文: {纹: 字}}。
// 一版 = 改完之后各段的样子。块和 Stem 只列和出厂不同的段, 没列的就是出厂那段, 第 0 版就是出厂版;
// 应用和粘贴的代码只有「(全文)」一段, 第 0 版是第一次解析或第一次在这里改之前(粘贴是粘进来时)的样子。同样的字只存一份。
// Stem 改了不发事件, 所以每次读目标都对一遍 revision: 谁改的、从哪条路改的都记得到
const 版本 = {
  待: 会话('code.note'),   // 目标 id → 下一版的备注; 本块改自己重启了也不丢
  读: id => 存储.读('code:ver:' + id),
  存: (id, r, 加) => 存储.改('code:ver:' + id, Object.assign({}, r, 加)),
  态(o) { // 现在各段的样子
    if (o.类 !== '块') return { '(全文)': 纹(o.文) };
    const 态 = {};
    o.段.forEach(s => s.名 !== '(前言)' && s.改过 && (态[s.名] = 纹(s.文)));
    (o.删了 || []).forEach(n => 态[n] = '');
    return 态;
  },
  现: (o, 名) => 名 === '(全文)' ? o.文 : (o.段.find(s => s.名 === 名) || {}).文 ?? null,
  字(o, r, v, 名) { // 第 v 版里这段的字; null = 那一版没有这段
    const 版 = r.版.find(x => x.v === v), h = 版 && 版.段[名];
    return h !== undefined ? (h === '' ? null : r.文[h]) : o.类 === '块' ? (o.出厂段 || {})[名] ?? null : null;
  },
  async 对(o) { // revision 变了就算现在的样子, 和上一版不同才记一版; 没有记录又不用记就回 null
    let r = await 版本.读(o.id);
    const 有 = r && r.版, 态 = 版本.态(o);
    if (有 ? r.头.rev === o.rev : o.类 !== '块' || !Object.keys(态).length) return 有 ? r : null;
    r = 有 ? r : { 头: {}, 版: [{ v: 0, at: Date.now(), 注: '出厂版', 段: {}, 计: {} }], 文: {} };
    const 上 = r.版[r.版.length - 1], 名们 = Object.keys(Object.assign({}, 态, 上.段)).filter(n => 态[n] !== 上.段[n]);
    if (名们.length) {
      const 计 = {};
      for (const n of 名们) {
        const 后 = 版本.现(o, n);
        if (态[n]) r.文[态[n]] = 后;
        const d = 态[n] !== '' && diffView(版本.字(o, r, 上.v, n), 后);
        计[n] = d ? [d.stats.added, d.stats.removed] : '删';
      }
      r.版.push({ v: 上.v + 1, at: Date.now(), 计, 段: 态, 注: 版本.待[o.id] || '改了 ' + (名们.length > 3
        ? 名们.length + ' 段: ' : '') + 名们.slice(0, 3).map(n => n + (计[n] === '删' ? ' 删了' : ' +' + 计[n][0] + ' −'
          + 计[n][1])).join('、') + (名们.length > 3 ? ' 等' : '') });
      delete 版本.待[o.id];
      版本.记待();
      版本.裁(r);
    }
    r.头 = { rev: o.rev };
    return 版本.存(o.id, r);
  },
  建(o) { // 应用、粘贴的代码: 这时的全文存成第 0 版; 已经有了就不动(粘贴的记录里名字和原文留着)
    const h = 纹(o.文);
    return 版本.读(o.id).then(r => r && r.版 || 版本.存(o.id, r, { 头: { rev: h },
      版: [{ v: 0, at: Date.now(), 注: o.类 === '粘贴' ? '粘进来时的样子' : '第一次记下的样子', 段: { '(全文)': h }, 计: {} }],
      文: { [h]: o.文 } }));
  },
  裁(r) { // 没钉住的最多留 50 版(第 0 版不算), 再清掉没人用的字
    let 多 = r.版.filter(x => x.v && !x.钉).length - 50;
    r.版 = r.版.filter(x => !(多 > 0 && x.v && !x.钉 && 多--));
    const 用 = new Set(r.版.flatMap(x => Object.values(x.段)));
    Object.keys(r.文).forEach(h => 用.has(h) || delete r.文[h]);
  },
  组: rows => rows.reduce((组, r, i) => { // 逐行对比切成一处一处的改动: [起, 止] 是 rows 的下标
    if (r.t !== ' ') 组.length && 组[组.length - 1][1] === i - 1 ? 组[组.length - 1][1] = i : 组.push([i, i]);
    return 组;
  }, []),
  回: (rows, g) => rows.filter((r, i) => r.t === ' ' || (i >= g[0] && i <= g[1] ? r.t === '-' : r.t === '+'))
    .map(r => r.a).join('\n'),   // 只把这一处换回原来的: 这处留旧行, 别处留新行
  哪版(r, to) { // 第几版, 或钉住时起的名字
    if (!r) throw new Error('还没有改动记录');
    const x = r.版.find(x => x.v === +to || x.钉 === to);
    if (!x) throw new Error('没有这一版: ' + to + '; 有 ' + r.版.map(x => x.v + (x.钉 ? '(' + x.钉 + ')' : ''))
      .join('、'));
    return x.v;
  },
  名们: (o, r) => o.类 !== '块' ? ['(全文)'] : [...new Set(o.段.map(s => s.名).concat(Object.keys(o.出厂段 || {}),
    ...r.版.map(x => Object.keys(x.段))))].filter(n => n !== '(前言)'),
  async 差(o, r, v, 段) { // 第 v 版 → 现在, 一样的段不列: [{名, 旧, rows 逐行对比, 组 一处一处}]
    const out = [];
    for (const n of 段 ? [].concat(段) : 版本.名们(o, r)) {
      const 旧 = 版本.字(o, r, v, n), 现 = 版本.现(o, n);
      if (旧 === 现) continue;
      const rows = diffView(旧, 现).hunks;
      out.push({ 名: n, 旧, rows, 组: 版本.组(rows) });
    }
    return out;
  },
  async 换(o, to, 段, 处, 注) { // 整个 / 这几段 / 这一段的第几处(从 0 数) 换回那一版; 写仍走手术台那几条路, 也记一版
    const r = await 版本.对(o), v = 版本.哪版(r, to), edits = (await 版本.差(o, r, v, 段)).map(d => {
      if (处 === undefined) return { name: d.名, text: d.旧 };
      if (!d.组[处]) throw new Error('第 ' + v + ' 版对现在, 「' + d.名 + '」没有第 ' + (处 + 1) + ' 处改动');
      return { name: d.名, text: 版本.回(d.rows, d.组[处]) };
    });
    if (!edits.length) return { 没变: true, 到: v };
    版本.待[o.id] = 注 || '换回第 ' + v + ' 版' + (段 ? ': ' + edits.map(e => e.name).join('、') : '')
      + (处 !== undefined ? ' 的第 ' + (处 + 1) + ' 处' : '');
    版本.记待();
    const 话 = await 手术台.写(o, edits), r2 = (await 地图.读(o.id)).版;
    return { 到: v, 换了: edits.map(e => e.name), 话, 现在第: r2 ? r2.版.at(-1).v : v };
  },
  async 注(o, v, 话, 钉) { // 只改那一版的备注和名字, 不删任何东西; 不给 v 就是最新一版
    const r = await 版本.对(o), x = r && r.版.find(x => x.v === (v == null ? r.版.at(-1).v : +v));
    if (!x) throw new Error(r ? '没有第 ' + v + ' 版' : '还没有改动记录');
    if (话 !== undefined) x.注 = 话;
    if (钉 !== undefined) 钉 ? x.钉 = 钉 : delete x.钉;
    版本.存(o.id, r);
    return '第 ' + x.v + ' 版' + (话 !== undefined ? ' 备注写好了' : '')
      + (钉 === undefined ? '' : 钉 ? ' 钉住为「' + 钉 + '」' : ' 不钉了');
  },
  记待: () => 会话('code.note', 版本.待),
  文(r, 段) { // code.versions 的文字: 最新的在前, 最多 10 行; 给段就只列改过这段的
    const 版们 = r.版.filter(x => x.v && (!段 || 段 in x.计)).slice(-10).reverse();
    return '现在是第 ' + r.版.at(-1).v + ' 版\n' + 版们.map(x => '第 ' + x.v + ' 版 · ' + 时(x.at) + ' · ' + x.注
      + (x.钉 ? ' · 📌' + x.钉 : '') + '\n').join('') + '第 0 版: ' + r.版[0].注
      + '\n下一步: code.versions {id, v} 看那一版和现在差什么; code.restore {id, to, segment?, hunk?} 换回';
  },
};
// ═ 粘贴 · 跟着: 工具, 存储, 外壳, 版本 ═
// 任意一份代码都能读: 粘贴、拖进文件、从电脑选, 或别的块 code.open {text, name} 交过来。单独打开的文件一开就是这页。
// 存 code:ver:paste:<号> = {名, 码, at} 加它的改动记录, 它只存在这里; 删了连解读一起删
const 粘贴 = {
  async 建(文, 名) {
    const id = 'paste:' + Date.now().toString(36);
    名 = String(名 || 行(文).find(l => l.trim()) || '粘贴的代码').trim().slice(0, 40);
    版本.存(id, { 名, 码: 文, at: Date.now() });
    await 版本.建({ id, 类: '粘贴', 文 });
    await 存储.刷();
    return id;
  },
  删(id) {
    存储.改('code:ver:' + id, null);
    存储.改('code:ana:' + id, null);
  },
  页() { // 大文本框, 拖文件进来就读进框里, 名字默认取文件名或第一行; 开始读的键上写着要问模型几次, 点了就读
    const v = 外壳.页('<div><h2>粘贴的代码</h2><p>贴进来、拖进文件或从电脑选, 点开始读就成左边一项</p></div>'
      + '<span class="c-tr"><button data-roles>⚙ 模型</button></span>', '<span>💡 ' + (colony.单独
      ? '整份交给模型切成几块, 再一块块讲' : 'Colony 块的代码带段头会按段切; 别的整份交给模型去切') + '</span>',
    '<div class="c-paste"><h1>解读 <em>任意代码</em> 的结构与逻辑</h1><p>架构全景 + 逐行解读, 讲给不懂代码的人听</p>'
      + '<textarea placeholder="把代码贴在这里, 或把文件拖进来"></textarea><div class="c-acts">'
      + '<button data-go1 class="c-pri">⚡ 开始读</button>'
      + '<button data-pick>从电脑选</button><input placeholder="名字(默认取文件名或第一行)"></div></div>');
    const t = v.querySelector('textarea'), 名 = v.querySelector('input'), 钮 = v.querySelector('[data-go1]'),
      读 = f => f.text().then(x => (t.value = x, 名.value = f.name, t.oninput()));
    t.oninput = () => 钮.textContent = '⚡ 开始读' + (t.value.trim() && 外壳.有模 ? ' · 约问模型 '
      + 外壳.次({ 文: t.value }) + ' 次' : '');
    角色.有().then(x => (外壳.有模 = x, t.oninput())).catch(外壳.错);
    t.focus();
    t.ondragover = e => (e.preventDefault(), t.classList.add('on'));
    t.ondragleave = () => t.classList.remove('on');
    t.ondrop = e => {
      e.preventDefault();
      e.stopPropagation();
      t.classList.remove('on');
      if (e.dataTransfer.files[0]) 读(e.dataTransfer.files[0]);
    };
    v.querySelector('.c-acts').onclick = async e => {
      if ('pick' in e.target.dataset) {
        const f = Object.assign(document.createElement('input'), { type: 'file' });
        f.onchange = () => f.files[0] && 读(f.files[0]);
        return f.click();
      }
      if (!('go1' in e.target.dataset)) return;
      if (!t.value.trim()) return 外壳.说('框里还是空的: 先贴一段代码或拖进一个文件', 1);
      await 外壳.开(await 粘贴.建(t.value, 名.value), null, '导图');
      if (外壳.有模 && !解析.跑[外壳.now.id]) 外壳.做('解析');   // 键上写了要问几次, 点了就是同意
    };
  },
};
// ═ 手术台 · 跟着: 工具, 目标, 存储, 外壳, 版本, 试跑 ═
// 改这段: 这段代码原地变成编辑框, 上面一条备注和 看改动 / 试跑 / 保存 / 取消(Ctrl+S 也存); 这一条吸顶。
// 单独打开的文件没有拷贝窗, 不能试跑。写回只走原来那几条路:
// 块和 Stem 走 stem.setBlock(带 expected; 语法不过就不动正在跑的), 应用写之前再读一次比指纹再 apps.update,
// 粘贴的代码写本块自己的记录。改着的时候别处刷新不重画, 免得打的字丢了。
const 手术台 = {
  中: '',
  async 开(名) {
    const o = 外壳.now, s = o.段.find(x => x.名 === 名),
      找 = () => 外壳.$('.c-view section[data-s="' + CSS.escape(名) + '"]');
    if (!s || s.借) return;
    if (外壳.看 === '导图' || !找()) await 外壳.开(null, s.起, '逐行');   // 导图里点的: 先去逐行视图
    手术台.中 = 名;
    const sec = 找(), box = sec.querySelector('.c-code') || sec, 头 = box.querySelector('.c-h,.c-sh');
    box.innerHTML = (头 ? 头.outerHTML : '') + '<div class="c-op"><input class="c-note" placeholder="这次改了什么'
      + '(会记进改动记录)"><button data-op="看">看改动</button>'
      + (colony.has('stem.mount') ? '<button data-op="试">▶ 试跑</button>' : '')
      + '<button data-op="存" class="c-pri">保存</button><button data-op="消">取消</button></div>'
      + '<textarea class="c-ed" spellcheck="false" rows="'
      + Math.min(40, 行(s.文).length + 1) + '"></textarea><div class="c-opd"></div>';
    const t = box.querySelector('.c-ed'), v = 外壳.$('.c-view');
    t.value = s.文;
    box.style.setProperty('--ht', 头 && 头.matches('.c-h')   // 源码的段头行吸顶: 键排在它下面
      ? box.firstChild.offsetHeight + 'px' : '0px');
    v.scrollTop += box.getBoundingClientRect().top - v.getBoundingClientRect().top;
    t.focus({ preventScroll: true });
    t.setSelectionRange(s.文.indexOf('\n') + 1, s.文.indexOf('\n') + 1);   // 光标放段头下一行: 段头前不能有字
    box.onclick = e => {
      const b = e.target.closest('[data-op]');
      if (b) e.stopPropagation(), 手术台[b.dataset.op](s, box).catch(外壳.错);
    };
    box.onkeydown = e => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) e.preventDefault(), 手术台.存(s, box).catch(外壳.错);
    };
  },
  对比行: r => '<div class="c-d' + ({ '+': ' a', '-': ' r', '…': ' s' }[r.t] || '') + '">' + esc(r.a) + '</div>',
  async 看(s, box) { // 原地对比: 头上一行 +几 −几 行、字节、新行超过 110 字的位置; 没变的折成「略 N 行」
    const 新 = box.querySelector('.c-ed').value,
      d = diffView(s.文, 新, 2);
    box.querySelector('.c-opd').innerHTML = '<p class="c-g">+' + d.stats.added + ' −' + d.stats.removed
      + ' 行 · ' + (d.bytes >= 0 ? '+' : '') + d.bytes + ' 字节' + (d.long ? ' · 新行超过 110 字: 第 '
        + d.long.map(x => x.line).join('、') + ' 行' : '') + '</p>' + d.hunks.map(手术台.对比行).join('');
  },
  试: (s, box) => 试跑.抽屉(s, box),
  拼: (o, edits) => { // 应用和粘贴的代码: 段拼回全文; 给「(全文)」就是整份
    const 整 = edits.find(e => e.name === '(全文)');
    return 整 ? 整.text : o.段.map(s => (edits.find(e => e.name === s.名) || { text: s.文 }).text)
      .filter(t => t != null).join('\n');
  },
  async 存(s, box) {
    const o = 外壳.now, t = box.querySelector('.c-ed').value, 注 = box.querySelector('.c-note').value.trim();
    if (t === s.文) return 外壳.说('没改动');
    外壳.说('⋯ 正在存');
    if (注) 版本.待[o.id] = 注, 版本.记待();
    const 话 = await 手术台.写(o, [{ name: s.名, text: t }]);
    手术台.中 = '';
    await 外壳.开(o.id, s.起, 外壳.看);
    const r = 外壳.now.版;
    外壳.说('✓ ' + 话 + (r ? ' · 第 ' + r.版.at(-1).v + ' 版' : ''));
  },
  async 消(s, box) { // 改过没存: 第一下只说一声, 3 秒内再点才丢
    const b = box.querySelector('[data-op="消"]');
    if (box.querySelector('.c-ed').value !== s.文 && !先问(b, '再点一下丢掉改动')) return;
    手术台.中 = '';
    await 外壳.开(外壳.now.id, 外壳.位(), 外壳.看);
  },
  async 写(o, edits) { // 写回原处, 回一句人话; 失败就抛错, 原来的一点不动。text: null = 删这段
    if (o.类 === '块') {
      const r = await ctx.call('stem.setBlock', { id: o.id, edits, expected: o.rev });
      return o.id === 'stem' ? 'Stem 已存, 刷新页面后生效' : '已换上' + (r.restarted ? ', 块重启了' : '');
    }
    const 全 = 手术台.拼(o, edits);
    await 版本.建(o);   // 第一次在这里改: 改之前的样子先记成第 0 版
    if (o.类 === '应用') {
      const a = await ctx.call('apps.get', { id: o.id.slice(8) });
      if (纹(a.code) !== o.rev) throw new Error('这个应用在你打开之后被别处改过了, 重新打开再改');
      await ctx.call('apps.update', { id: o.id.slice(8), patch: { code: 全 } });
      const 后 = await ctx.call('apps.get', { id: o.id.slice(8) });
      if (后.code !== 全) throw new Error('应用没存进去(写完读回来对不上)');
      return '已存进应用';
    }
    版本.存(o.id, await 版本.读(o.id), { 码: 全, at: Date.now() });
    await 存储.刷();
    return '已存';
  },
  async 记录(段) { // 改动记录面板: 从右边滑出, 一版一行; 整个目标(不给段)或一段; ✕ 或 Esc 关
    const o = 外壳.now, r = await 版本.对(o), 旧 = 外壳.$('.c-hist');
    if (旧) 旧.remove();
    if (!r) return 外壳.说(o.类 === '块' ? '和出厂一样, 还没有改动' : '还没有改动记录: 第一次解析或第一次在这里改时开始记');
    const 版们 = r.版.filter(x => x.v && (!段 || 段 in x.计)).reverse(), p = document.createElement('div');
    p.className = 'c-hist';
    p.innerHTML = '<p class="c-hh"><b>🕘 改动记录 · ' + esc(段 || o.名) + '</b><button data-hx title="关(Esc)">'
      + '✕</button></p>' + 版们.concat(r.版[0]).map(x => '<p class="c-hr" data-hv="' + x.v + '"><b>第 ' + x.v
        + ' 版</b> · ' + (x.v ? 时(x.at) + ' · ' : '') + esc(x.注)
        + (x.钉 ? ' <code class="c-tag">📌 ' + esc(x.钉) + '</code>' : '') + '</p>').join('')
      + '<div class="c-hd"><p class="c-g">点一版, 看它和现在差什么</p></div>';
    外壳.$('.c-main').appendChild(p);
    p.onclick = e => (e.stopPropagation(), 手术台.面(e, o, 段).catch(外壳.错));
  },
  async 面(e, o, 段) { // 面板上的点: 选一版看差别; 换回这几行 / 整段换回(点两下) / 钉住 / 写备注
    const b = e.target.closest('[data-hx],[data-hv],[data-hk],[data-hall],[data-hp],[data-hn]'),
      p = 外壳.$('.c-hist'), x = b && b.dataset, v = x && +(x.hv || p.dataset.v);
    if (!b) return;
    const 好了 = async 话 => {
      外壳.说('✓ ' + 话);
      await 外壳.开(o.id, 外壳.位(), 外壳.看);
      await 手术台.记录(段);
    };
    if ('hx' in x) return p.remove();
    if (x.hv) return 手术台.差(p, o, v, 段);
    if (x.hk) return 好了((await 版本.换(o, v, x.hk, +x.i)).话);
    if ('hall' in x) {
      if (!先问(b, '再点一次: ' + b.textContent)) return;
      const r = await 版本.换(o, v, 段);
      return r.没变 ? 外壳.说('和第 ' + v + ' 版一样, 没动') : 好了(r.话);
    }
    const 值 = b.previousElementSibling.value.trim();
    外壳.说('✓ ' + await 版本.注(o, v, 'hn' in x ? 值 : undefined, 'hp' in x ? 值 : undefined));
    await 手术台.记录(段);
  },
  async 差(p, o, v, 段) { // 第 v 版 → 现在: 红的是那一版有、现在没有, 绿的是现在才有; 每处右上角能单独换回
    const r = await 版本.读(o.id), 差 = await 版本.差(o, r, v, 段), 版 = r.版.find(x => x.v === v),
      行们 = (d, g) => d.rows.slice(Math.max(0, g[0] - 2), g[1] + 3).map(手术台.对比行).join('');
    p.dataset.v = v;
    p.querySelectorAll('.c-hr').forEach(x => x.classList.toggle('on', +x.dataset.hv === v));
    p.querySelector('.c-hd').innerHTML = (差.map(d => '<h4>' + esc(d.名) + '</h4>' + d.组.map((g, i) =>
      '<div class="c-hg"><button data-hk="' + esc(d.名) + '" data-i="' + i + '">换回这几行</button>' + 行们(d, g)
      + '</div>').join('')).join('') || '<p class="c-g">第 ' + v + ' 版和现在一样</p>') + (差.length
      ? '<div class="c-acts"><button data-hall class="c-pri">' + (段 ? '这段' : '整个') + '换回第 ' + v
        + ' 版</button></div>' : '') + (v ? '<div class="c-acts"><input value="' + esc(版.钉 || '')
      + '" placeholder="给这一版起个名字(钉住的不会被挤掉)"><button data-hp>📌 钉住</button></div>'
      + '<div class="c-acts"><input value="' + esc(版.注) + '"><button data-hn>改备注</button></div>' : '');
  },
  // ✂ 单独时不带 · 号: 剪切工具
  // 剪切工具(人和 code.cut 一条路): 选区前后各加一行 ✂ 标记; 借给别的块就在它借用行后面加一行, 导不出两边退回
  可: o => 外壳.看 === '源码' && o.类 === '块' && o.id !== 'stem',
  能剪: o => 外壳.剪 && 手术台.可(o),
  键: o => 手术台.可(o) ? '<button data-do="剪"' + (外壳.剪 ? ' class="on"' : '') + '>✂ 剪切</button>' : '',
  开关() { // 只重画顶栏(键)和范围那行(拆)
    外壳.剪 = !外壳.剪;
    外壳.顶();
    外壳.签();
    外壳.说(外壳.剪 ? '选几行, 点「✂ 圈成范围」' : '剪切收起了');
  },
  选: (o, a, b) => 行(o.文).slice(a - 1, b).join('\n'),
  定: t => [...t.matchAll(/(?:const|let|function|class)\s+([^\s=(]+)/g)].map(m => m[1]),   // 这几行里定义的量
  要(o, a, b) { // 选区里(注释不算)用到、定义在外面的本块段名、范围名(段里顶格定义的量算这段的)
    const t = 手术台.选(o, a, b).replace(/\/\/.*/g, ''), 词 = new Set(t.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu)),
      外 = n => n < a || n > b,
      量 = s => [s.名, ...[...s.文.matchAll(/^(?:const|let|function|class) ([^\s=(]+)/gm)].map(m => m[1])];
    手术台.定(t).forEach(n => 词.delete(n));
    return o.段.filter(s => !s.无头 && 外(s.起) && 量(s).some(n => 词.has(n))).map(s => s.名)
      .concat(Object.keys(o.圈.记).filter(n => 词.has(n) && 外(o.圈.记[n].头)));
  },
  表(bar, o, a, b) { // 选区小条换成小表: 范围名(默认选区里第一个定义的量)、号(范围名是单独时不带时)、要、借给哪块
    const 定 = 手术台.定(手术台.选(o, a, b)), $ = s => bar.querySelector(s), 名 = () => $('input').value.trim(),
      要 = () => [...bar.querySelectorAll('.on')].map(y => y.textContent),
      号 = () => $('[data-no]>input').value.trim();
    bar.className = 'c-pop';
    bar.innerHTML = '<label>✂ 范围名</label><input value="' + esc(定[0] || '') + '"><p></p>'
      + '<div data-no hidden><label>号(给这处单独时不带起个名字, 导回按它认)</label><input></div>'
      + '<label>要(点掉就不带)</label><div>' + 手术台.要(o, a, b).map(n => '<button class="on" data-w>' + esc(n)
        + '</button>').join('') + '</div><label>借给</label><select><option value="">只圈不借' + 目标.块
        .filter(x => x.id !== o.id).map(x => '<option value="' + esc(x.id) + '">' + esc(x.name)).join('')
      + '</select><div><button data-ok class="c-pri">✂ 圈好</button></div>';
    ($('input').oninput = () => {
      $('p').textContent = 定.includes(名()) ? '' : 'Colony 里借过去拿不到值: 选区里没定义「' + 名() + '」';
      $('[data-no]').hidden = 名() !== '单独时不带';
    })();
    bar.onclick = e => {
      const t = e.target;
      if ('w' in t.dataset) return t.classList.toggle('on');
      if ('ok' in t.dataset) 手术台.备(o, a, b, 名(), 要(), 号()).then(() => 先问(t, '再点一下: 在第 ' + a + '–' + b
        + ' 行前后各加一行标记') && 手术台.圈(o, a, b, 名(), 要(), $('select').value, 号())
        .then(话 => (bar.remove(), 外壳.说(话)))).catch(外壳.错);
    };
  },
  // 查一遍, 回要写的 edits(跨段是两段); 不行就抛错。范围写没写坏(同名套着、圈段头、和单独时不带交叉、单独时不带没号或
  // 号重了)照 Stem 的认法: 按 setBlock 试一次(preview, 不存), 和真存时同一处拦。不给「要」就自动列
  async 备(o, a, b, 名, 要 = 手术台.要(o, a, b), 号) {
    const ls = 行(o.文), 改 = {}, 不 = m => { throw new Error(m); }, 插 = (n, l, 后) => {
      const s = o.段.find(x => x.起 <= n && n <= x.止);
      if (s.借 || s.无头) 不('借来的一行、前言不能圈');
      (改[s.名] ||= 行(s.文)).splice(后 ? n - s.起 + 1 : Math.max(1, n - s.起), 0, l);   // 段头留在范围外
    };
    if (o.类 !== '块' || o.id === 'stem') 不('只能圈块的代码');
    if (!(a >= 1 && a <= b && b <= ls.length)) 不('行号要 1 ≤ from ≤ to ≤ ' + ls.length);
    if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(名) || o.段.some(s => s.名 === 名)) 不('范围名要像变量名, 也不能和段同名');
    try { new Function(手术台.选(o, a, b)); } catch (e) { 不('这几行单独拿出来不成句, 多选几行'); }
    const 缩 = /^\s*/.exec(ls[a - 1])[0], w = 要.filter(n => n !== 名);
    插(b, 缩 + '// ✂ ' + 名 + ' 完', 1);   // 先插尾, 同一段里再插头尾不挪
    插(a, 缩 + '// ✂ ' + 名 + (号 ? ' · 号: ' + 号 : '') + (w.length ? ' · 要: ' + w.join(', ') : ''));
    const edits = Object.keys(改).map(name => ({ name, text: 改[name].join('\n') }));
    await ctx.call('stem.setBlock', { id: o.id, edits, expected: o.rev, preview: true });
    return edits;
  },
  // 真写之前: 借这块的(连二级借的)各拿改后的代码单独导出一次(stem.molt 的 假如, 本机不动)。导不出, 或导出件里用到了这块顶格
  // 定义的名字、定义它的那几行却不带(只算改了才缺的), 就不写, 说是哪块、为什么。认定义只认三种(下标):
  // 0 量: const/let/var/function/class 后面的(连拆开写的、逗号后面接着写的)、函数的参数; 1 键: 行首的键和方法、.名 = …、
  // { 名, } 这样简写的; 2 顶格: 顶格和缩进两格的量、缩进两格的键和方法、.名 = …
  定义: ['\\b(?:const|let|var|function\\*?|class)\\s+(@)|,\\s*(@)\\s*=(?![=>])|(@)\\s*=>'
    + '|(?<!\\b(?:if|for|while|switch|with)\\s*)\\(([^()]*)\\)\\s*(?:=>|\\{)'
    + '|\\b(?:const|let|var)\\s*[{[]([^=]*?)[}\\]]\\s*(?:=|of\\b|in\\b)',
  '^\\s*(?:async\\s+)?#|\\.(@)\\s*=(?![=>])|[{,]\\s*(@)\\s*(?=[,}])',
  '^ {0,2}(?:async )?(?:const|let|var|function\\*?|class) (@)|^  (?:async )?#|^ {0,2}@\\.(@)\\s*=(?![=>])']
    .map(s => RegExp(s.replace('#', '(?!(?:if|for|while|switch|catch|function)\\b)(@)'
      + '\\s*(?::(?!:)|\\([^)]*\\)\\s*\\{)').replace(/@/g, '[\\p{L}_$][\\p{L}\\p{N}_$]*'), 'gmu')),
  定了: (t, 种) => new Set([...t.matchAll(手术台.定义[种])]
    .flatMap(m => m.slice(1).join(' ').match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) || [])),
  缺(t) { // 用到却没定义的名字: 光着用的要有量, 顶格(不缩进)的量点出来的要有键; 整行的注释、对象的键、方法头不算用到
    const 量 = 手术台.定了(t, 0), 键 = 手术台.定了(t, 1), 名 = '([\\p{L}_$][\\p{L}\\p{N}_$]*)',
      词 = '(?<![.\\p{L}\\p{N}_$])' + 名, s = t.replace(/^\s*\/\/.*/gm, '')
        .replace(RegExp('^\\s*(?:async\\s+)?' + 词 + '(?=\\s*\\([^)]*\\)\\s*\\{)', 'gmu'), ''),
      顶 = new Set([...t.matchAll(RegExp('^(?:async )?(?:const|let|var|function\\*?|class) ' + 词, 'gmu'))]
        .map(m => m[1]));
    return new Set([...s.matchAll(RegExp(词 + '(?![\\p{L}\\p{N}_$]|\\s*:(?!:))', 'gu'))].map(m => m[1])
      .filter(n => !量.has(n)).concat([...s.matchAll(RegExp(词 + '\\s*\\??\\.\\s*' + 名, 'gu'))]
        .filter(m => 顶.has(m[1]) && !键.has(m[2])).map(m => m[2])));
  },
  async 试导(o, edits) {
    目标.块 = (await ctx.call('stem.blocks', {})).filter(b => !b.broken);
    const 源 = 手术台.定了(o.文, 2), 坏 = [], 导 = (id, 假如) => ctx.call('stem.molt', { ids: [id], stem: false, 假如 })
      .then(手术台.缺, e => e.message);
    for (const b of 目标.块.filter(b => b.id !== o.id && b.segs.some(s => s.map
      && 目标.源(s.map.block + '/' + s.map.name)[0] === o.id))) {
      const 前 = await 导(b.id), 名 = '「' + b.name + '」单独导出';
      if (typeof 前 === 'string') continue;   // 原来就导不出的不算这一下弄坏的
      const 后 = await 导(b.id, { id: o.id, edits }),
        少 = typeof 后 === 'string' ? [] : [...后].filter(n => 源.has(n) && !前.has(n));
      if (typeof 后 === 'string') 坏.push(名 + '不了: ' + 后);
      if (少.length) 坏.push(名 + '时用到' + 少.map(n => '「' + n + '」').join('') + ', 定义它的那几行却不带');
    }
    if (坏.length) throw new Error('没写: ' + 坏.join('; '));
  },
  async 圈(o, a, b, 名, 要, 给, 号) {
    const 写 = (id, x) => ctx.call('stem.setBlock', Object.assign({ id }, x)),
      edits = await 手术台.备(o, a, b, 名, 要, 号);
    await 手术台.试导(o, edits);
    await 写(o.id, { edits, expected: o.rev });
    if (!给) return '圈好了「' + 名 + '」';
    const g = await ctx.call('stem.block', { id: 给, full: true }), ls = 行(g.code);
    ls.splice(目标.切(g.code).filter(s => s.借 || s.无头).pop()?.止 || 0, 0, '// ↦ 借 ' + o.id + ' 的 ' + 名);
    let 写了;
    try { // 整块写回(隐性改版 Stem 照留), 再试着单独导出它
      写了 = await 写(给, { code: ls.join('\n'), expected: g.revision });
      await ctx.call('stem.molt', { ids: [给], stem: false });
    } catch (e) {
      if (写了) await 写(给, { code: g.code });
      await 写(o.id, { edits: edits.map(x => ({ name: x.name, text: o.段.find(s => s.名 === x.name).文 })) });
      throw new Error('借给 ' + g.name + ' 不成, 两边都退回了: ' + e.message);
    }
    return '圈好了「' + 名 + '」, ' + g.name + ' 借了它';
  },
  async 拆(钮) { // 删掉这个范围的头尾标记(同名几处一起); 谁要它(Stem 现算的 need)就说是谁, 不拆
    const o = 外壳.now, 名 = 钮.dataset.cut, x = 目标.圈(o, (await ctx.call('stem.block', { id: o.id })).need,
        await ctx.call('stem.blocks', {})).记[名], 删 = new Set(x.处.flat()),
      edits = o.段.filter(s => s.剪.some(y => y[1] === 名))
        .map(s => ({ name: s.名, text: 行(s.文).filter((l, k) => !删.has(s.起 + k)).join('\n') }));
    if (x.要.length) return 外壳.说('「' + 名 + '」' + x.要.join('、') + ' 要用, 不拆', 1);
    if (!先问(钮, '再点一下: 删掉 ' + 删.size + ' 行标记')) return;
    await 手术台.试导(o, edits);
    await ctx.call('stem.setBlock', { id: o.id, expected: o.rev, edits });
    外壳.说('拆掉了「' + 名 + '」');
  },
  // ✂ 单独时不带 完
};
// ═ 导出 · 跟着: 工具, 样式, 导图, 逐行, 地图, 外壳, 详情, 布图, 画架构图, 画图师, 架构视图 ═
// 三种, 都能直接下载: 离线网页(样式 + 数据 JSON + 导图、详情、架构图和逐行的画法, 函数 toString 拿源码 + 一小段控制; 三种视图都能看,
// 能折叠、缩放、铺满、互相亮, 不带改、讲这些按钮, 也不跑被解读的代码; 还能放上 Colony 桌面, 同一个目标再导出只换那一个图标)、
// Markdown 和 JSON(讲解的内容, 行号都换成全局的)。块里不能出现字面的闭合 script 标签, 要拆开拼
const 导出 = {
  码(obj) { // 对象里的函数拼回源码: 方法写法原样, 箭头函数前面补「键: 」; 里面套的对象(视图)不要
    const 一 = ([k, v]) => { const t = String(v); return Array.isArray(v) ? k + ': ' + JSON.stringify(v)
      : /^(async\s+)?[^\s(=>]+\s*\(/.test(t) ? t : k + ': ' + t; };
    const 要 = ([, v]) => typeof v === 'function' || Array.isArray(v);
    return '{' + Object.entries(obj).filter(要).map(一).join(',\n') + '}';
  },
  页(o) {
    const S = 'scr' + 'ipt', 数 = { o: { id: o.id, 名: o.名, 行数: o.行数, ana: { 类: o.ana.类, 图: o.ana.图 },
      段: o.段.map(s => ({ 名: s.名, 起: s.起, 止: s.止, 文: s.文, 借: s.借, 无头: s.无头, 头注: s.头注, 改过: s.改过, 解: s.解,
        跟着: s.跟着 })) },
      d: 地图.数据(o) };
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" '
      + 'content="width=device-width"><title>解读 · ' + esc(o.名) + '</title><style>'
      + 'html,body{margin:0;height:100%;background:#0a0a0a}' + 样式
      + '[data-edit],[data-explain],[data-re],[data-ask],[data-hist]{display:none!important}'
      + '</style></head><body><div data-block-id="petri:code">'
      + '<div class="c" style="grid-template-columns:1fr">'
      + '<div class="c-main"><div class="c-top"></div><div class="c-bar"><span>💡 ' + esc(o.ana.总述 || '')
      + '</span></div><div class="c-view"></div></div></div></div><' + S + '>'
      + 'const esc = ' + esc + ';\nconst 虚 = ' + 虚 + ';\nconst 行 = ' + 行
      + ';\nconst 纹 = ' + 纹 + ';\nconst 解析 = { 讲中: {} }, 外壳 = ' + 导出.码({ 拖: 外壳.拖 }) + ', ctx = {}'
      + ', colony = { has: () => 0, 单独: 1 }, 地图 = { 数据: () => D.d }, 导图 = ' + 导出.码(导图) + ', 逐行 = ' + 导出.码(逐行)
      + ', 详情 = ' + 导出.码(详情) + ', 布图 = ' + 导出.码(布图) + ', 架构图 = ' + 导出.码(架构图) + ', 画图师 = '
      + 导出.码(画图师) + ', 架构视图 = ' + 导出.码(架构视图) + ';\n详情.视图 = ' + 导出.码(详情.视图)
      + ';\n架构视图.视图 = ' + 导出.码(架构视图.视图) + ';\n架构图.型 = ' + JSON.stringify(架构图.型)
      + ';\n画图师.跑 = {};\nconst D = '
      + JSON.stringify(数).replace(/</g, '\\u003c') + ';\n(function ' + 导出.控 + ')(D);\n</' + S
      + '></body></html>';
  },
  控(D) { // 导出页里跑的那一小段: 顶栏三种视图; 导图就是块里的详情, 逐行和源码和里面同一个画法
    const o = D.o, $ = s => document.querySelector(s), v = $('.c-view');
    const 视 = {
      导图: () => 详情.视图.画(v, o),
      架构图: () => 架构视图.视图.画(v, o),
      逐行() {
        v.innerHTML = '<div class="c-lv c-wrap">' + o.段.map(s => 逐行.排(o, s)).join('') + '</div>';
        逐行.亮(v);
      },
      源码() { v.innerHTML = '<div class="c-code c-wrap">' + o.段.map(s => 逐行.段(o, s)).join('') + '</div>'; },
    };
    $('.c-top').innerHTML = '<div><h2>' + esc(o.名) + '</h2><p>' + esc(o.id) + ' · ' + o.行数 + ' 行 · 离线解读</p>'
      + '</div><div class="c-pills">' + Object.keys(视).map(k => '<button data-v="' + k + '">' + k
        + '</button>').join('') + '</div>';
    const 切 = k => {
      v.onmouseover = null;
      视[外壳.看 = k]();
      document.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === k));
    };
    Object.assign(外壳, { $, now: o, 有模: 0, 离线: 1, 存() { }, 说() { }, 错() { }, 贴() { }, 去() { },
      跳: n => (切('逐行'), v.querySelector('.c-l[data-n="' + n + '"]').scrollIntoView({ block: 'center' })) });
    ctx.root = document.body;
    $('.c-top').onclick = e => e.target.dataset.v && 切(e.target.dataset.v);
    v.onclick = e => { // 导图照详情的点法; 别的: 「看这几行」去逐行那一行, 源码的段头行折起来
      const h = e.target.closest('.c-h');
      if (外壳.看 === '导图') 详情.视图.点(e);
      else if (外壳.看 === '架构图') 架构视图.视图.点(e);
      else if (!逐行.卡点(e, o) && h) h.parentNode.classList.toggle('c-fold');
    };
    切('导图');
  },
  数(o) { // 讲解的内容, 行号都换成全局的: Markdown 和 JSON 都从这份出
    const d = 地图.数据(o), 块 = (s, xs) => xs && xs.map(x => ({ 名: x.名 || x.图 + ' ' + x.标, 话: x.述 || x.话 || '',
      起: s.起 + x.起, 止: s.起 + x.止, 分: 块(s, x.分) }));
    return { 名: o.名, id: o.id, 行数: o.行数, 总述: d.总述 || '', 大类: (d.类 || []).map(c => ({ 名: c.名, 段: c.段 })),
      段: d.段.map(s => {
        const 注 = (o.段.find(x => x.名 === s.名).解 || {}).注 || {};
        return { 名: s.名, 起: s.起, 止: s.止, 一句话: s.注, 借: s.借, 细分: 块(s, s.分), 讲解: 块(s, s.讲),
          逐行注: Object.keys(注).map(k => ({ 行: s.起 + +k, 话: 注[k] })) };
      }) };
  },
  md(o) {
    const x = 导出.数(o), 列 = (xs, d) => (xs || []).map(y => '  '.repeat(d) + '- **' + y.名 + '**(第 ' + y.起 + '–'
      + y.止 + ' 行)' + (y.话 ? ': ' + y.话 : '') + '\n' + 列(y.分, d + 1)).join(''),
      段 = s => '### ' + s.名 + '(第 ' + s.起 + '–' + s.止 + ' 行)\n\n' + (s.一句话 ? s.一句话 + '\n\n' : '')
        + (s.细分 ? '分成几块:\n\n' + 列(s.细分, 0) + '\n' : '') + (s.讲解 ? '通俗讲解:\n\n' + 列(s.讲解, 0) + '\n' : '')
        + (s.逐行注.length ? '逐行解读:\n\n' + s.逐行注.map(y => '- 第 ' + y.行 + ' 行: ' + y.话).join('\n') + '\n\n' : '');
    return '# 解读 · ' + x.名 + '\n\n' + x.id + ' · ' + x.行数 + ' 行\n\n' + (x.总述 ? '> ' + x.总述 + '\n\n' : '')
      + (x.大类.length ? x.大类.map(c => '## ' + c.名 + '\n\n' + c.段.map(n => x.段.find(s => s.名 === n))
        .filter(Boolean).map(段).join('')).join('') : x.段.map(段).join(''));
  },
  卡(el) { // 导出小卡: 三种格式都能下载, 离线网页还能放上桌面
    const 行 = (型, 名, 说) => '<label>' + 名 + '</label><p>' + 说 + '</p><div>'
      + '<button data-ex="' + 型 + '">⬇ 下载</button>'
      + (型 === 'html' && colony.has('apps.create') ? '<button data-ex="桌面">放上桌面</button>' : '') + '</div>';
    el.innerHTML = 行('html', '离线网页', '导图、架构图、逐行、源码都能看, 发给别人双击就开')
      + 行('md', 'Markdown', '总述、大类、每段一句话、讲解和逐行注, 能贴进笔记') + 行('json', 'JSON', '同样的内容, 给程序读');
    el.onclick = e => {
      const b = e.target.closest('[data-ex]');
      if (b) 外壳.收卡(el), 导出.做(b.dataset.ex).catch(外壳.错);
    };
  },
  async 做(型) {
    const o = 外壳.now, 名 = '解读 · ' + o.名;
    if (型 === 'md') return 导出.下(名 + '.md', 导出.md(o), 'text/markdown');
    if (型 === 'json') return 导出.下(名 + '.json', JSON.stringify(导出.数(o), null, 2), 'application/json');
    const html = 导出.页(o);
    if (型 === 'html') return 导出.下(名 + '.html', html, 'text/html');
    await ctx.call('apps.create', { code: html, name: 名, icon: '🔬', 来源: 'code:' + o.id });
    外壳.说('已放上桌面: ' + 名 + '(' + Math.round(html.length / 1024) + ' K 字), 拖出桌面就是文件');
  },
  下(名, 字, 型) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([字], { type: 型 + ';charset=utf-8' }));
    a.download = 名;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    外壳.说('下载好了: ' + 名);
  },
};
// ═ 搜代码 ═
// 改名、删函数之前一次看全一个词在哪被用到: Stem、块、桌面应用都算, 一份读一次全文, 边读边认段头。
// 人用左栏的找词框(词的一部分也算, 列出每一处, 点了跳到源码那一行); agent 用 code.find(默认整词, 太多只回每段几处)
const 搜代码 = {
  async 找(t, 限, 整) { // → [{id, 名, 段, 行(段内, 段头算 0), 全(全局行号), 字(那一行)}]
    const [块, 段] = String(限 || '').split('/'), 字 = c => !!c && (/[\w$]/.test(c) || c >= '⺀');   // 标识符里的字(含汉字)
    const 对 = (l, i) => !(整 && 字(t[0]) && 字(l[i - 1])) && !(整 && 字(t[t.length - 1]) && 字(l[i + t.length]));
    const as = await ctx.call('apps.list', {}).catch(() => []), 处 = [], 全 = [{ id: 'stem', 名: 'Stem' }]
      .concat((await ctx.call('stem.blocks', {})).map(b => ({ id: b.id, 名: b.name })),
        as.map(a => ({ id: 'miniapp:' + a.id, 名: a.name, 应用: a.id }))).filter(x => !块 || x.id === 块);
    for (const x of 全) {
      let 在 = '', 头 = 0;
      const r = await (x.应用 ? ctx.call('apps.get', { id: x.应用 })
        : ctx.call('stem.block', { id: x.id, full: true }));
      String(r.code).split('\n').forEach((l, n) => {
        const h = /^\/\/ ═ (.+?) (·|═)/.exec(l);
        if (h) [在, 头] = [h[1], n];
        let i = l.indexOf(t);
        while (i >= 0 && !对(l, i)) i = l.indexOf(t, i + 1);
        if (i < 0 || h || (段 && 在 !== 段)) return;
        处.push({ id: x.id, 名: x.名, 段: 在, 行: n - 头, 全: n + 1,
          字: l.slice(Math.max(0, i - 40), i + t.length + 40).trim() });
      });
    }
    return 处;
  },
  async find(a) { // code.find: 回 块/段:段内行号(没段头的回 id:全局行号) 和那一行
    const t = String(a.text || ''), 整 = a.word !== false, 计 = {}, 位 = x => x.段 ? x.id + '/' + x.段 : x.id;
    if (!t) throw new Error('缺 text: 要找的词');
    const 处 = await 搜代码.找(t, a.in, 整);
    处.forEach(x => 计[位(x)] = (计[位(x)] || 0) + 1);
    if (!处.length) return { 共: 0, 说明: '没有「' + t + '」' + (整 ? '(按整词找; 找词的一部分传 word: false)' : '') };
    if (处.length <= 30) return { 共: 处.length, 在: 处.map(x => 位(x) + ':' + (x.段 ? x.行 : x.全) + '  ' + x.字) };
    return { 共: 处.length, 太多了: '只给每段几处: 用 in 限定到块或段(如 petri:agent/引擎), 或换个更准的词', 段: 计 };
  },
  async 页(t) { // 左栏找词框回车: 整页列出每一处, 按块分组; 点一处跳到源码的那一行
    if (!t) return;
    const 号 = ++外壳.号, v = 外壳.页('<div><h2>找「' + esc(t) + '」</h2><p>在 Stem、块和桌面应用的代码里找, 分大小写'
      + '</p></div>', '<span class="c-run">⏳ 正在找…</span>', ''), 处 = await 搜代码.找(t, '', false);
    if (号 !== 外壳.号) return;   // 找的时候人点了别处
    外壳.$('.c-bar').innerHTML = '<span>' + (处.length ? '💡 共 ' + 处.length + ' 处' + (处.length > 300
      ? ', 只列前 300 处, 换个更准的词' : '') + ' · 点一处跳到源码的那一行' : '没找到「' + esc(t) + '」') + '</span>';
    v.innerHTML = '<div class="c-dt">' + 处.slice(0, 300).map((x, i) => (i && 处[i - 1].id === x.id ? ''
      : '<p class="c-g">' + esc(x.名) + '</p>') + '<p class="c-li" data-hit="' + esc(x.id) + '" data-at="'
      + x.全 + '"><b>' + esc((x.段 ? x.段 + ' · ' : '') + '第 ' + x.全 + ' 行') + '</b><code>' + esc(x.字)
      + '</code></p>').join('') + '</div>';
  },
};
// ═ 试跑 · 跟着: 工具, 目标, 存储, 手术台 ═
// code.try: stem.molt 的 swap 导出一份换了这段的整个 Colony(改 Stem 就在导出件里换掉那段), 挂进隔离窗开机, 看块起没起来、
// 这块的能力少没少、试跑项的结果; 应用直接挂改好的代码看握手。正在跑的一点不动。拷贝是空库、没接模型, 试过了不等于真跑过。
// 块和 Stem 先让 setBlock 只查不写(preview): 保存会拒的改法(段头不对、语法错、别处改过)试跑也拒, 两边说法一样
const 试跑 = {
  宿: null,   // 屏幕外 1280×800 的宿主: 不能 display:none, 界面块靠 offsetHeight 判断有没有页
  窗: new Set(),   // 留着的 frame: 关掉或本块卸载时收
  async 跑(a, 宿) {
    const 起 = Date.now(), o = await 目标.读(a.id), s = a.segment, 旧 = s && o.段.find(x => x.名 === s.name);
    if (s && !旧) throw new Error('没有这段: ' + s.name + '(试跑只换已有的段; 新段先用 setBlock 加)');
    if (s && o.类 === '块') await ctx.call('stem.setBlock', { id: o.id, edits: [s], expected: o.rev,
      preview: true }).catch(e => { throw Object.assign(new Error('保存会被拒: ' + e.message), { 拒: 1 }); });
    let html = o.类 !== '块' ? 手术台.拼(o, s ? [s] : []) : await ctx.call('stem.molt',
      s && o.id !== 'stem' ? { swap: { id: o.id, name: s.name, text: s.text } } : {});
    if (s && o.id === 'stem') { // 导出件里的 Stem 段头可能多写了借用者: 按段身找, 连它前面那行段头一起换
      const 身 = 旧.文.slice(旧.文.indexOf('\n')), i = html.indexOf(身), h = html.lastIndexOf('\n', i - 1) + 1;
      if (i < 0) throw new Error('导出件里找不到 Stem 的「' + s.name + '」段');
      html = html.slice(0, h) + s.text + html.slice(i + 身.length);
    }
    宿 = 宿 || 试跑.宿 || (试跑.宿 = document.body.appendChild(Object.assign(document.createElement('div'),
      { style: 'position:fixed;left:-9999px;top:0;width:1280px;height:800px' })));
    const f = await ctx.call('stem.mount', { code: html, host: 宿, timeout: 15000 }).catch(e => {
      if (e.frame) e.frame.remove();
      throw new Error('没开起来: ' + e.message);
    }), 号 = f.dataset.colonyApp, 里 = (path, args) => ctx.call('stem.invoke', o.类 !== '块'
      ? { frame: 号, path, args } : { frame: 号, path: 'call', args: { path, args } });
    let 留 = a.keep;
    试跑.窗.add(号);
    try {
      let 块 = [], 少了 = [], 多了 = [], 坏了 = [];
      if (o.类 === '块') { // 里面的 Stem 装完块才露出 call: 没露出来就是还没开完机, 最多等 10 秒
        let bs;
        for (let t = 0; !bs; t += 100) {
          bs = await 里('stem.blocks', {}).catch(e => {
            if (!/未暴露/.test(e.message)) throw e;
            if (t > 10000) throw new Error('拷贝 10 秒没开完机, 多半是 Stem 一开机就出错了');
          });
          if (!bs) await new Promise(r => setTimeout(r, 100));
        }
        const 外 = await ctx.call('stem.blocks', {}), 能 = async 调 => (await 调('stem.capabilities', {}))
          .filter(c => c.by === o.id).map(c => c.path), 外能 = await 能(ctx.call), 内能 = await 能(里),
          好 = b => b.enabled && !b.error && b.running;
        块 = bs.filter(b => b.enabled).map(b => b.id + (b.error ? ' ✗ ' + b.error : b.running ? ' ✓'
          : ' 没起来'));
        坏了 = bs.filter(b => !好(b) && 好(外.find(x => x.id === b.id) || {}));   // 外面好好的, 里面起不来
        少了 = 外能.filter(p => !内能.includes(p));
        多了 = 内能.filter(p => !外能.includes(p));
      }
      const 项 = a.calls || await 存储.读('code:try:' + o.id) || [], 结果 = [];
      if (a.save && a.calls) 存储.改('code:try:' + o.id, a.calls);
      for (const c of 项) {
        try {
          const r = await 里(c.path, c.args || {}), t = typeof r === 'string' ? r : JSON.stringify(r);
          结果.push({ path: c.path, 过: !c.expect || String(t).includes(c.expect), 回: String(t).slice(0, 300) });
        } catch (e) { 结果.push({ path: c.path, 过: false, 错: e.message }); }
      }
      const 过 = !坏了.length && !少了.length && 结果.every(x => x.过);
      return Object.assign({ 过, 用时: (Date.now() - 起) + ' 毫秒', 改了: s ? [s.name] : [], 块, 能力: { 少了, 多了 },
        试跑项: 结果, 说明: '这是拷贝: 空库、没接模型, 正在跑的没动' + (过 && s ? '; 过了就用同样的段调 stem.setBlock' : '') },
      留 ? { frame: 号 } : {});
    } catch (e) {
      留 = 0;
      throw e;
    } finally {
      if (!留) 试跑.关(号);
    }
  },
  关(号) { // 不给 = 全关
    (号 === undefined ? [...试跑.窗] : [号].filter(Boolean)).forEach(x => (试跑.窗.delete(x),
      ctx.call('stem.unmount', { frame: x }).catch(() => { })));
  },
  收() { // 收起抽屉, 连它的拷贝窗
    const t = 外壳.$('.c-try');
    if (t) 试跑.关(t.dataset.f), t.remove();
  },
  async 抽屉(s, box) { // 编辑框里点「试跑」: 视图区底部拉出抽屉, 回执几行 + 活的拷贝窗 + 装上这份 / 关掉
    const o = 外壳.now, d = document.createElement('div');
    试跑.收();
    d.className = 'c-try';
    d.innerHTML = '<p class="c-hh"><b>⏳ 试跑 · ' + esc(o.名) + '(改了 ' + esc(s.名) + ')</b><span>'
      + '<button data-tk="装" class="c-pri" hidden>装上这份</button> <button data-tk="关">关掉</button></span></p>'
      + '<p class="c-g"></p><div></div>';
    外壳.$('.c-main').appendChild(d);
    d.onclick = e => {
      const b = e.target.closest('[data-tk]');
      e.stopPropagation();
      if (!b) return;
      if (b.dataset.tk === '装') box.querySelector('[data-op="存"]').click();
      试跑.收();
    };
    const r = await 试跑.跑({ id: o.id, segment: { name: s.名, text: box.querySelector('.c-ed').value },
      keep: 1 }, d.lastChild).catch(e => ({ 错: e.message, 拒: e.拒 }));
    if (!d.isConnected) return 试跑.关(r.frame);   // 没跑完就关了
    d.dataset.f = r.frame || '';
    if (r.错) d.lastChild.remove();   // 没开起来就不留空框
    d.querySelector('b').textContent = (r.错 ? r.拒 ? '✗ 这样存不进去, 没试' : '✗ 试跑没成'
      : (r.过 ? '✓ 过了' : '✗ 没过') + ' · ' + r.用时) + ' · '
      + o.名 + '(改了 ' + s.名 + ')';
    d.querySelector('.c-g').textContent = r.错 || [].concat(r.块.filter(x => !/ ✓$/.test(x)),
      r.能力.少了.length ? '能力少了: ' + r.能力.少了.join('、') : [],
      r.试跑项.map(x => (x.过 ? '✓ ' : '✗ ') + x.path + ' ' + (x.错 || x.回)))
      .join(' · ') || '块都起来了, 能力一个没少。下面是活的拷贝(空库、没接模型)';
    d.querySelector('[data-tk="装"]').hidden = !r.过;
  },
};
// ═ 自报 ═
// 看懂任何一份代码(Stem、块、桌面小应用、贴进来的): 架构导图、业务架构图、逐段逐行讲解、源码; 在这里改、试跑、看改动、换回
// 数据 {"prefix": "code:ana:", "label": "讲解(能重新生成, 但要花模型调用)", "kind": "cache"}
// 数据 {"prefix": "code:ver:", "label": "改动记录和贴进来的代码", "kind": "data"}
// 数据 {"prefix": "code:try:", "label": "试跑项", "kind": "data"}
// 数据 {"prefix": "code:roles", "label": "讲解和画图用哪个模型", "kind": "config"}
// 现在 code.map
// ═ 技能 ═
// 只写猜不到的事实, 只有注释、不跑
// 【找代码】要改一个功能、不知道它在哪时: 先 code.map {id} 看业务节点和段目录(每段一句话), 再 code.map {id, segment} 看讲解,
//   最后 stem.block 读那段原文; 找一个词用 code.find。讲解是导航不是证据, 改之前读原文。
// 【改完】用 stem.setBlock 改了块之后: code.try 真调一次看行为对不对, 再 code.note 写一句改了什么; 不对就 code.restore。
//   改的目标解读过的话, 再 code.sync {id} 看哪些解读对不上了(不花调用), 问过用户要不要同步, 要就 code.sync {id, run: true}。
// ═ 装配 · 跟着: 工具, 样式, 外壳, 逐行, 地图, 详情, 架构视图, 解析, 画图师, 同步, 版本, 粘贴, 手术台, 导出, 搜代码, 试跑 ═
// 能力都不接隔离窗: 读得到全部源码。本块比界面块先装, 装载时不调 ui.* 和 apps.*; 等 colony:blocks 来了才开始画
const 能 = (p, fn, desc, schema, common) => ctx.provide(p, fn, { desc, schema, frames: false,
  common: !!common });
能('code.open', async a => {
  if (!外壳.露()) await ctx.call('ui.do', { target: 'block:' + ctx.id, action: '打开' }).catch(() => { });
  return 外壳.开(typeof a.text === 'string' ? await 粘贴.建(a.text, a.name) : a.id, a.at, a.view);
}, '给人看一份代码: id 是 stem、块 id、miniapp:<应用 id> 或 paste:<号>(不给就开上次看的); 给 text 就新建一项「粘贴的代码」'
  + '(name 是它的名字); at 翻到哪: 段名、段名:段内行(段头算第 0 行)或全局行号; view: 导图 / 架构图 / 逐行 / 源码',
  { id: 'string?', text: 'string?', name: 'string?', at: 'any?(段名 / 段名:段内行 / 全局行号)', view: 'string?' });
能('code.map', 地图.文, '代码的目录, 回一段文字: 不给 id 列全部目标(Stem、块、桌面应用); 给 id 先列业务架构图的节点(画过的话), '
  + '再按大类列它的段(行号、一句话、'
  + '细分、改过没有、过时没有、借来的); 再给 segment 看这一段(跟着谁、谁借了它、讲解、逐行注)。找业务在哪先看这个, 不用读全文; '
  + 'make: true 先让模型把缺的补上(解析、业务架构图; 会花调用)', { id: 'string?', segment: 'string?', make: 'boolean?' }, 1);
能('code.find', 搜代码.find, '跨块跨段找一个词(Stem、桌面应用也算): 回 块/段:段内行号(应用回 id:全局行号) 和那一行; '
  + '超过 30 处只回每段几处', { text: 'string', in: 'string?(块 id 或 块/段, 如 petri:agent/引擎)',
    word: 'boolean?(默认按整词找)' }, 1);
能('code.versions', async a => { // 第几处的编号就是 code.restore 的 hunk
  const o = await 地图.读(a.id), r = o.版;
  if (!r) return '「' + o.名 + '」还没有改动记录' + (o.类 === '块' ? ': 和出厂一样' : ': 第一次解析或在这里改时开始记');
  if (a.v == null) return 版本.文(r, a.segment);
  const v = 版本.哪版(r, a.v), 差 = await 版本.差(o, r, v, a.segment);
  return 差.length ? '第 ' + v + ' 版 → 现在(- 那一版有的, + 现在的):\n' + 差.map(d => '【' + d.名 + '】\n' + d.组
    .map((g, i) => '第 ' + (i + 1) + ' 处\n' + d.rows.slice(Math.max(0, g[0] - 2), g[1] + 3)
      .map(x => x.t + ' ' + x.a).join('\n')).join('\n')).join('\n') : '第 ' + v + ' 版和现在一样';
}, '一份代码的改动记录(块、Stem、应用、粘贴的代码; 不管从哪条路改的都记着): 不给 v 列最近的版本和备注; '
  + '给 v(第几版或钉住的名字)看那一版到现在每处改了什么; segment 只看这一段', { id: 'string', v: 'any?',
    segment: 'string?' });
能('code.diff', a => diffView(a.before, a.after, a.context), '逐行对比两段文字(按最长公共子序列对齐): 回 +几 −几 行、'
  + '字节差、新行里超过 110 字的、hunks; context 只留改动前后几行。stem.setBlock 的 preview 借它画逐行对比',
  { before: 'string', after: 'string', context: 'number?' });
能('code.restore', async a => {
  const o = await 地图.读(a.id),
    x = await 版本.换(o, a.to, a.segment, a.hunk == null ? undefined : a.hunk - 1, a.note);
  if (外壳.now && 外壳.now.id === o.id) 外壳.刷().catch(外壳.错);
  return x.没变 ? '和第 ' + x.到 + ' 版一样, 没动' : x.话 + ': ' + x.换了.join('、') + ' 换回第 ' + x.到 + ' 版, 现在是第 '
    + x.现在第 + ' 版(换回也记一版, 能再换回来)';
}, '把代码换回某一版: to 是第几版或钉住的名字(0 = 出厂 / 第一次记下的样子); segment 只换这一段; 再给 hunk 只换'
  + ' code.versions 列的第几处。写回和手改走同一条路(块走 stem.setBlock, 语法不过不动)', { id: 'string', to: 'any',
    segment: 'string?', hunk: 'number?', note: 'string?' });
能('code.try', a => 试跑.跑(a), '拿整份 Colony 的拷贝在隔离窗里试一段改动(不给 segment 就只跑试跑项; 先按 setBlock 的规矩查, '
  + '存不进去的直接报错): 回块起没起来、'
  + '这块的能力少没少、试跑项的结果。正在跑的一点不动; 拷贝是空库、没接模型, 试过了不等于真跑过。segment 和 setBlock 的一段同形; '
  + 'calls: [{path, args?, expect?(结果里要有的字)}]; save 把 calls 存成这个目标的试跑项, 以后不给 calls 就跑它们; '
  + 'keep 留着窗(回 frame 给 frame.* 用, 用完 stem.unmount)',
  { id: 'string', segment: '{name, text}?', calls: 'array?', save: 'boolean?', keep: 'boolean?' });
能('code.sync', async a => {
  const o = await 地图.读(a.id);
  if (!a.run) return 同步.文(o, 同步.计(o));
  const r = await 同步.跑(o);
  if ((外壳.now || {}).id === o.id) 外壳.更(o.id);
  return '「' + o.名 + '」同步好了: ' + r;
}, '源码改过之后让已有的解读跟上(Stem、块、应用、粘贴的代码): 只重读对不上的段的一句话和细分(导图)、'
  + '重讲改过的片和补改过的行注(逐行)、把新段和改过的段归进业务架构图(不重画整张)。不给 run 只回要同步什么、约问几次(不花调用); '
  + '先问过人再给 run: true', { id: 'string', run: 'boolean?' });
能('code.note', async a => 版本.注(await 地图.读(a.id), a.v, a.note, a.pin),
  '给某一版写备注或钉住(起个名字, 钉住的不会被挤掉; pin: "" 取消钉住)。不给 v 就是最新一版; 刚用 stem.setBlock 改完, '
  + '用它写一句这次改了什么', { id: 'string', v: 'any?', note: 'string?', pin: 'string?' });
// ✂ 单独时不带 · 号: 剪切能力
能('code.cut', async a => 手术台.圈(await 地图.读(a.id), a.from, a.to, a.name, a.要, a.给, a.号),
  '同源码视图的「✂ 剪切」: 块的第 from–to 行(全局行号)圈成范围 name; 要: 一起带的段名、范围名(不给就自动列); '
  + '给: 借给哪块(加一行借用, 它单独导不出就两边都退回); name 是「单独时不带」时 号 必填(这一处的名字, 块里不能重)。'
  + '借这块的块拿改后的代码单独导不出、或缺了定义, 就不写, 说是哪块',
{ id: 'string', from: 'number', to: 'number', name: 'string', 要: 'string[]?', 给: 'string?', 号: 'string?' });
// ✂ 单独时不带 完
if (typeof document === 'undefined' || !ctx.root) return {};
const 表 = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: 样式 }));
// ✂ 单独时不带 · 号: 挂范围样式
表.textContent += 圈样;
// ✂ 单独时不带 完
外壳.视图 = { 导图: 详情.视图, 架构图: 架构视图.视图, 逐行: 逐行.视图, 源码: 逐行.源码 };
解析.变 = 外壳.更;
外壳.装();
let 起了 = false, 钟 = 0;
const 变 = () => {
  起了 = true;
  clearTimeout(钟);
  钟 = setTimeout(() => 外壳.露() && (外壳.now ? 外壳.刷() : 外壳.开()).catch(外壳.错), 300);
};
const 露了 = e => e.target === ctx.root && 起了 && 外壳.露()
  && (外壳.now ? 外壳.到(外壳.记.行) : 外壳.开().catch(外壳.错));
听('colony:blocks', 变);
听('colony:apps', 变);
听('ai:providers', () => 外壳.刷模().catch(外壳.错));   // 在小卡里接好了模型
ctx.root.addEventListener('animationstart', 露了);
ctx.cleanup(() => {
  表.remove();
  [逐行.观, 详情.观, 架构视图.观].forEach(x => x && x.disconnect());
  Object.values(解析.跑).forEach(x => x.停 = 1);
  试跑.关();
  if (试跑.宿) 试跑.宿.remove();
  存储.刷();
});
return {};
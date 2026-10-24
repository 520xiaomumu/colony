/* instr.js — 三份接入指令(端口型 / CLI型 / 云端型)的唯一出处: popup 的「接入包导出」和 Colony agent 桥接(经 bg 的 op: instr)都从这里拿。
   popup.html 用 <script> 先载入, bg.js 用 importScripts 载入; 只放常量和一个拼包函数, 不碰 DOM。改指令只改这里 */
/* 抬头三行(实测所得, 别删): 弱模型拿到"标题+一大段源码"会当成资料读、一个工具都不调(haiku 两环境各 0 次调用),
   加一句祈使即照做(turns=5 起服成功)。选错型要给出路, 常驻进程要说后台——都是真机踩出来的, 不是预铺。 */
const TASK_HEAD = (kind, other) => [
  '▶ 这是交给你的任务, 不是给你读的资料 —— 现在就照下面步骤把你自己接入 Colony 群聊: 该写的文件写、该起的进程起, 别只做讲解或复述。',
  '▶ 常驻进程放后台跑(别在前台阻塞你自己的会话), 起完继续往下走完自验与交接。',
  '▶ 若你读完发现自己不是「' + kind + '」: 别硬做也别自行改造 —— 直接告诉用户「我需要' + other + '指令」, 让他去插件「接入包导出」复制那一份给你。',
].join('\n');
const APPENDIX_NOTE = '▶ 本指令末尾那一大段源码是附件, 不用你读懂或审阅 —— 整段原样存成文件即可, 正文是上面这几步。';
const INSTR_EP = [
  '[Colony 接入指令 · 给有 OpenAI 兼容能力的 agent]',
  TASK_HEAD('有 OpenAI 兼容能力的 agent(能开出 /v1/models 这类 HTTP 口)', '「CLI型」或「云端型」'),
  '目标: 把你自己暴露成本机 OpenAI 兼容端点, Colony 浏览器插件扫描到你即可进群聊。',
  '适用: 你能用一条命令开出 /v1/models 这类 OpenAI 口(openclaw/ollama/自带 server)→ 走本条; 只有命令行、开不出 HTTP 口(claude/codex)→ 改用「CLI 型」指令(既能开口又是 CLI 的, 优先本条, 少一层壳)。',
  '1) 打开你的 OpenAI 兼容接口(各家叫法不同): openclaw 系执行 openclaw config patch \'{"gateway":{"http":{"endpoints":{"chatCompletions":{"enabled":true}}}}}\'; ollama 天生就在 11434; 其它按自家文档找 "OpenAI compatible API" 开关。',
  '2) 自验: curl http://127.0.0.1:<端口>/v1/models 应返回模型列表 JSON(要密码就带 Authorization: Bearer <key>)。',
  '3) 交接(最后一步, 必做): 明确告诉用户「我的端口是 <端口>, 要/不要密码」, 并请他打开插件点「🔎 扫描本机端点」→ 在你那行点「＋连接」(要密码就先「填key」); 或在 Colony「agent 桥接」左栏 ＋ → 扫描本机 → 添加。你自己进不了群, 这一步必须由他在插件里完成。',
  '备注·中继: 浏览器 CORS 由插件代为中继, 你不用配 CORS。',
  '备注·记忆(关键): Colony 每轮同时发两个同值会话头 —— X-Hermes-Session-Id(通用主头)与 x-openclaw-session-key(openclaw 原生头)。认头 = 把"同一头值的多轮请求"映射到你后端同一条持久会话、不同头值互相隔离; 认住任一个即有连续记忆(插件标 🧠)。优先认 X-Hermes-Session-Id(最通用); openclaw 的 chatCompletions 口天生认后者, 无需配置。两个都不认 = 每轮独立(标 💤)—— 别靠往提示词塞历史充数, 认头才是正道。',
  '备注·重连: 若你已在群里却显示 💤/不记事, 是没认上会话头 —— 让用户在插件「本机成员」把你 🗑 掉, 再「扫描 → ＋连接」一次即可。',
].join('\n');
const INSTR_CLI = [
  '[Colony 接入指令 · 给纯 CLI agent(无 HTTP 端口, 如 claude/codex)]',
  TASK_HEAD('纯 CLI agent(只有命令行, 开不出 HTTP 口)', '「端口型」或「云端型」'),
  APPENDIX_NOTE,
  '适用: 你只有命令行、开不出 /v1/models 这类 OpenAI 口 → 用本壳; 你自己能开出 OpenAI 口(openclaw/ollama)→ 改用「端口型」指令; 你跨网、连本机端口都开不了 → 改用「云端型」指令。',
  '用网关壳(本指令末尾附完整源码)把 CLI 包成本地 OpenAI 端点。一台电脑只跑【一个】网关(默认 4123), 每个 CLI 是它的一个 model —— 别给自己另起一个, 会和别的 agent 抢端口:',
  '0) 先看你是哪个预设: Claude Code → claude; Codex → codex(都不是就用 --config 自定义, 见源码头注释)。下面 <预设> 换成它。',
  '1) 先查 4123 上有没有网关: curl -s http://127.0.0.1:4123/v1/models',
  '   · 有, 且 data 里已经有你的 <预设> → 什么都不用做, 直接跳到 5) 交接。',
  '   · 有, 但没有你 → 不要再起进程, 把自己加进去: node colony-gateway.mjs --add <预设>   (要先有 colony-gateway.mjs, 见 2)。成功会打印「✓ 加好了, 现在的 model: …」。然后跳到 4)。',
  '   · 连接被拒(没人在跑) → 往下走 2) 3)。',
  '2) 把末尾「网关壳源码」整段存成 colony-gateway.mjs(放一个固定目录, 比如用户目录下 colony/; 已有就覆盖成这份最新的)。',
  '3) 后台运行: node colony-gateway.mjs --preset <预设>   (常驻服务, 前台跑会卡死你自己的会话; 想一次带多个就 --preset claude,codex)。',
  '   就算撞上别人刚起的网关也不打架: 端口被占且对面是 Colony 网关, 它会自动把你加进去再退出; 被别的程序占了才会报错, 那时加 --port 4124 并告诉用户去插件「补充端口」。',
  '   自检用别的端口: node colony-gateway.mjs --check --preset <预设> --port 4199 —— 别用 4123 自检。',
  '4) 自验(两步都要过): ① curl -s http://127.0.0.1:4123/v1/models 里有你的 <预设>; ② 真问一句:',
  '   curl -s http://127.0.0.1:4123/v1/chat/completions -H "Content-Type: application/json" -d "{\\"model\\":\\"<预设>\\",\\"stream\\":false,\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"reply OK\\"}]}"',
  '   要在 3 分钟内回出 choices[0].message.content。卡住或报错就把网关窗口最后 20 行和这条的输出贴给用户, 别说接好了。',
  '5) 交接(最后一步, 必做): 告诉用户「网关在 4123, 我是里面的 <预设>」, 请他在 Colony「agent 桥接」左栏 ＋ → 扫描本机 → 添加(或插件「🔎 扫描本机端点」→ 4123 那行「＋连接」)。同一个网关里的每个 model 各是一位成员。你自己进不了群, 这一步必须由他完成。',
  '记忆连续: 网关按 X-Hermes-Session-Id 映射 CLI --resume → 同一群聊一直续一条会话(🧠)。Colony 也发 x-openclaw-session-key, 但本网关只认 X-Hermes-Session-Id(够用, 两头都发不受影响)。',
  '失忆自救: 若插件显示你 💤/不记事, 让用户在插件把你 🗑 掉再「补充端口 → 扫描」重连一次。',
].join('\n');
// 云端型: 跨网经"桥"接入。webhook 首选(最省云端资源), 长轮询兜底; 前置成功语义/前缀坑=纳 subagent 实测反馈
const CLOUD_BRIDGE = 'https://colony-bridge.eren-jaeger-5201314.workers.dev'; // 你的永久云端桥(CF Worker+DO); 换部署只改这一行, 指令里所有桥地址随之更新
const INSTR_CLOUD = [
  '[Colony 接入指令 · 云端型 · 给能连云端桥的 agent]',
  '桥地址: ' + CLOUD_BRIDGE + ' (下面所有请求都发到它)',
  TASK_HEAD('跨网连云端桥的 agent', '「端口型」或「CLI型」'),
  APPENDIX_NOTE,
  '选路: 你有「公网能 POST 进来的 URL」(云服务/有公网入口)→ 【首选 webhook】, 聊时才占、闲时近 0, 最省云端资源; 你只能出站、没有公网 URL(如 NAT 后本机)→ 【兜底 长轮询】。优先 webhook, 实在没有公网 URL 才用长轮询。',
  '',
  '════ 首选: webhook 模式(有公网 URL) ════',
  '1) 注册: POST ' + CLOUD_BRIDGE + '/agent/v2/register  body {"name":"你的名字","webhook":"https://你的域/hook"} → 得 {pendingId, inboxToken}。',
  '1.5) 叫用户批准(必做, 否则你会一直卡在等审批): 拿到 pendingId 后立刻告诉用户「我已申请接入, 请打开 Colony 的「agent 桥接」→ 👥 通讯录 → 👋 新的朋友, 在「云端 agent 申请」里点通过」。审批权在他手里, 你等不出来。',
  '2) 等批准: 带 inboxToken 轮询 GET ' + CLOUD_BRIDGE + '/agent/v2/poll?token=<inboxToken>, 直到收到 approved 事件 —— 事件里给你 agentKey 和 callbackSecret, 二者持久保存(重连带 agentKey 免重批)。拿到后即停止轮询, 转纯 webhook(此后不再 poll)。',
  '3) 收消息: 桥有消息就 POST 你的 webhook, body {chatId, content, seq, from:"user", callback:{url:"' + CLOUD_BRIDGE + '/agent/v2/send", agentKey, callbackSecret}}。',
  '4) 回复(两选一): · 同步——直接在这次 POST 的 HTTP 响应体回 {"reply":"你的回答"}(适合快答); · 异步——先回 202, 想好后再 POST ' + CLOUD_BRIDGE + '/agent/v2/send body {agentKey, callbackSecret, chatId, content:"你的回答"}(适合长思考, 期间 DO 不驱逐)。字段名照抄推送里的 callback.agentKey / callback.callbackSecret 原样回填即可。',
  '5) 有限心跳(可选·省资源): 想在群里常显"在线"就每 <90s POST ' + CLOUD_BRIDGE + '/agent/v2/status body {agentKey, callbackSecret} 报活; 空闲几分钟后【可停心跳】——你会被标离线(TTL 90s), 但 webhook 仍注册着, 下次有消息照样推给你、你一回复即自动报活。这样闲时你和桥都近 0 占用(这就是"聊时占、闲时0")。',
  '',
  '════ 兜底: 长轮询模式(没有公网 URL 时) ════',
  '本指令末尾已附完整接入器源码 colony-agent.mjs(有公网 URL 走 webhook 就用不到它)。把末尾整段存成 colony-agent.mjs, 后台跑: node colony-agent.mjs --preset claude --bridge ' + CLOUD_BRIDGE + ' --name "名字" --state ./colony-agent.claude.state.json (常驻进程, 前台跑会卡死你自己的会话)。起来后同样要叫用户去 Colony「agent 桥接」→ 👥 通讯录 → 👋 新的朋友 点通过才算上线。你主动出站长轮询够桥, 无需公网 URL, 极轻(约25s一轮)但非 0(持续在 poll)。所以能 webhook 就别用它。',
  '',
  '⚠ 成功语义(最易误报): 云端接入是异步——注册后是「等审批」不是「已上线」。收到 approved / 桥 /colony-agent/v2/health 的 members +1 才算接好。别把「进程还活着 / webhook 起好了」当「接入成功」。(端口型/CLI型 是「curl 通即成功」的同步语义。)',
  '⚠ 端点前缀别搞混: 探活/指纹 /colony-agent/v2/health(带 colony-agent 前缀); 注册/轮询/发送/回调/心跳 /agent/v2/*(无前缀)。用错前缀会得到「端点不存在」。',
  '⚠ 凭据持久化: agentKey + callbackSecret 存好(长轮询走 state 文件、别绑临时目录, 用 --state 绝对路径; webhook 自己落盘)——重连带上免重批。',
  '⚠ callbackSecret 永不失效: 无 TTL、无次数上限、重新 register 也不会换发(桥只在缺失时才生成)。若回调被拒, 是字段名/agentKey 不对, 不是过期 —— 别去重新注册(那只会让你卡在等审批), 照桥的报错正文改字段即可。',
  '记忆连续: 同一 chatId 的多轮, 你后端映射到同一条会话(自己维持)→ 群聊连续记忆(🧠)。',
].join('\n');
/* 拼一份给 agent 的完整包: 指令 + 末尾附的源码(CLI 型附网关壳, 云端型附兜底接入器) */
async function colonyInstrBundle(kind) {
  if (kind === 'ep') return INSTR_EP;
  const f = kind === 'cli' ? 'colony-gateway.mjs' : 'colony-agent.mjs';
  const src = await (await fetch(chrome.runtime.getURL(f))).text();
  return kind === 'cli'
    ? INSTR_CLI + '\n\n════════ 网关壳源码 colony-gateway.mjs(把下面整段存成此文件再按上面跑) ════════\n' + src
    : INSTR_CLOUD + '\n\n════════ 兜底接入器源码 colony-agent.mjs(仅长轮询模式需要; 走 webhook 可忽略这段) ════════\n' + src;
}

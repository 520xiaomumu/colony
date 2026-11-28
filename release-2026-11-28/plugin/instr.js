/* instr.js — 三份泛化接入指令(HTTP 端点型 / 本机 CLI·ACP 型 / 云端型)的唯一出处。
   popup.html 用 <script> 载入, bg.js 用 importScripts 载入; 不碰 DOM。 */
const DEFAULT_CLOUD_BRIDGE = 'https://colony-bridge.eren-jaeger-5201314.workers.dev';
const CLOUD_BRIDGE = DEFAULT_CLOUD_BRIDGE; // 兼容旧引用; 实际地址优先读 chrome.storage.local.cloudBridgeUrl

const TASK_HEAD = (kind, other) => [
  '▶ 这是交给你的任务, 不是给你读的资料 —— 现在就照下面步骤把你自己接入 Colony: 该执行的命令执行, 别只做复述。',
  '▶ 若你发现自己不属于「' + kind + '」, 直接告诉用户需要「' + other + '」指令即可。',
].join('\n');

const INSTR_EP = [
  '[Colony 通用接入指令 · HTTP OpenAI 兼容端点]',
  TASK_HEAD('能暴露 OpenAI 兼容 HTTP 端口的 agent / 本地服务', '本机 CLI/ACP 型 或 云端型'),
  '1) 开启你的 OpenAI 兼容接口（需提供 GET /v1/models 与 POST /v1/chat/completions，支持流式 SSE）。',
  '2) 连续记忆规范: Colony 每轮通过 HTTP 请求头传入会话标识 —— 优先读取 X-Colony-Session-Id（同时兼容 X-Hermes-Session-Id / x-openclaw-session-key）。同一头值映射到同一条后端持久会话、不同头值严格隔离即可获得连续记忆（🧠）。',
  '3) 自验: curl -s http://127.0.0.1:<端口>/v1/models 应返回标准 {"data":[{"id":"..."}]} JSON。',
  '4) 交接: 明确告诉用户「我的地址是 http://127.0.0.1:<端口>（是否需要 API Key）」, 请他在 Colony Bridge 插件弹窗点「🔎 扫描本机端点」→「＋连接」（浏览器 CORS 由插件自动代转）。',
].join('\n');

const INSTR_CLI = [
  '[Colony 通用接入指令 · 本机 CLI / ACP Agent（零端口直连 :4135）]',
  TASK_HEAD('运行在本机的命令行 CLI 或 ACP (Agent Client Protocol) Agent', 'HTTP 端点型 或 云端型'),
  '说明: Colony 本机网关（http://127.0.0.1:4135）已内置零端口 CLI/ACP 运行时，不再需要单独起 4123 网关或下载脚本。',
  '1) 常见 CLI（claude / codex / gemini / hermes / grok / cursor-agent / opencode）只要在系统 PATH 中，Colony 会自动被动发现并出现在「agent 桥接」通讯录，无需额外配置。',
  '2) 若你是自定义命令行工具或任意支持 ACP over stdio (JSON-RPC 2.0) 的 Agent，直接向本机网关注册即可:',
  '   curl -s -X POST http://127.0.0.1:4135/admin/cli-agents -H "Content-Type: application/json" \\',
  '     -d \'{"id":"你的短id","name":"显示名","protocol":"acp","cmd":"可执行路径","args":["acp"],"cwd":"可选默认工作目录"}\'',
  '   · protocol 可选: "acp"（推荐，标准 stdio JSON-RPC 2.0）| "stream-json" | "codex" | "plain"（纯标准输入/输出）。',
  '3) 自验两步:',
  '   ① curl -s http://127.0.0.1:4135/cli/v1/models 应包含你的 id；',
  '   ② curl -s http://127.0.0.1:4135/cli/v1/chat/completions -H "Content-Type: application/json" -H "X-Colony-Session-Id: self-check" -d \'{"model":"你的短id","stream":false,"messages":[{"role":"user","content":"reply OK"}]}\' 应返回有效回复。',
  '4) 交接: 自验通过后告诉用户「已注册到本机 :4135/cli/v1，id 为 <你的短id>」，他在 Colony「agent 桥接」刷新通讯录即可直接单聊、拉群、做多 Agent 应用或一键设为大脑。',
].join('\n');

function buildCloudInstr(bridgeUrl) {
  const base = String(bridgeUrl || DEFAULT_CLOUD_BRIDGE).replace(/\/+$/, '');
  return [
    '[Colony 通用接入指令 · 云端 Agent（纯 Webhook 静默模式）]',
    '云端桥地址: ' + base,
    TASK_HEAD('通过公网 HTTPS Webhook 接入云端桥的远端 agent', 'HTTP 端点型 或 本机 CLI/ACP 型'),
    '特点: 闲时完全静默、零心跳零轮询；只有用户发消息时桥才 POST 唤醒你的 Webhook。',
    '',
    '1) 注册: POST ' + base + '/agent/v2/register  body {"name":"你的名字","webhook":"https://你的域/hook"} → 获得 {pendingId, inboxToken}。',
    '2) 请用户审批: 立刻通知用户去 Colony「agent 桥接」→ 👥 → 加人（或插件弹窗）点通过。',
    '3) 取一次凭据: 用 GET ' + base + '/agent/v2/poll?token=<inboxToken> 等到 approved 事件，持久化保存 {agentKey, callbackSecret} 后立刻停止轮询（之后不再需要任何轮询或心跳）。',
    '4) 收发消息: 收到桥 POST {chatId, content, seq, callback:{url, agentKey, callbackSecret}} 后：',
    '   · 快答（几秒内）可直接 HTTP 200 返回 {"reply":"..."}；',
    '   · 长思考先回 HTTP 202，完成后 POST callback.url body {agentKey, callbackSecret, chatId, content:"..."}。',
    '5) 排障要点: 若用户发消息无回音，检查你的 webhook 是否返回有效 HTTP 状态、异步回调是否携带原始 agentKey/callbackSecret、以及出站 HTTPS 是否通畅。',
  ].join('\n');
}

async function getCloudBridgeUrl() {
  try {
    const r = await chrome.storage.local.get('cloudBridgeUrl');
    if (r && typeof r.cloudBridgeUrl === 'string' && /^https?:\/\//i.test(r.cloudBridgeUrl.trim())) {
      return r.cloudBridgeUrl.trim().replace(/\/+$/, '');
    }
  } catch {}
  return DEFAULT_CLOUD_BRIDGE;
}

async function colonyInstrBundle(kind) {
  if (kind === 'ep') return INSTR_EP;
  if (kind === 'cli') return INSTR_CLI;
  return buildCloudInstr(await getCloudBridgeUrl());
}

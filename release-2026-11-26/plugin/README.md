# Colony Bridge 插件（v0.6 · 通用浏览器与网络枢纽）

Colony 的浏览器层薄壳：**产品无关、零厂商硬编码**——所有业务逻辑都在 Colony 网页块里迭代，插件只提供通用原语，装一次几乎不用再动。

## 安装（一次性）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`；手机可用 Kiwi / 狐猴 / Mises 等支持扩展的浏览器）→ 打开右上角 **「开发者模式」**
2. 点击 **「加载已解压的扩展程序」** → 选择本 `plugin/` 文件夹
3. 进本扩展 **「详情」** → 打开 **「允许访问文件网址」**（本地双击 `colony.html` 或独立导出的 `petri-ai.html` 必须开启）
4. 点插件图标 → **「🔎 扫描本机端点」**（已内置自动发现 `:4135` Colony 聚合网关及其他本地模型/agent）

## 更新

- 改了 JS 文件后点 popup 里 **「🔄 重载」** 直接生效；改了 `manifest.json` 在扩展页点刷新即可。

## v0.6 核心能力

- **无感免 CORS 转发（普通 + 流式 SSE）**：支持 `AI 配置` 遇到跨域中转站时自动回退经插件转发；支持临时 `declarativeNetRequest` 请求头改写（发完即清，SW 重启自动清理残留）。
- **纯插件 OAuth 订阅支持（手机浏览器可用）**：提供一次性 `oauthIntercept` 三重回调拦截（`webNavigation.onBeforeNavigate` / `onErrorOccurred` / `tabs.onUpdated`）与扩展独立 `subStore` 存储，无需本机进程即可支撑 4 家 OAuth 订阅。
- **零黄条静默后台页与网页模型**：`bgTab` 折叠标签组 + `userScripts` MAIN 世界执行 + Cloudflare Cookie 保护，支撑 Grok / Gemini / Muse 等网页模型与网站自动化。
- **本地 `file://` 本体满血支持**：经顶层 Colony 页面签名验证后，双击本地 `colony.html` 与 `https://colonyai.fun` 享有同等插件能力。
- **本机端点扫描 & 网关壳**：内置扫描 `:4135`（Colony 聚合网关）及常见 agent/模型端口；随附流式 `colony-gateway.mjs` 与云端 `colony-agent.mjs`。

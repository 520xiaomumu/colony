# Colony 发布包 · 2026-11-26（v11.26）

Colony 在 2026-11-26 的完整快照：内核 Stem + 全部 10 个块（新增「订阅中心」块、升级全能 agent 与通用网页插件引擎），另附拆开的完整源码、本机守护脚本、本机订阅代理源码、Colony Bridge 浏览器插件、4 个即用网页插件、浏览器小应用和扩展库技能。

这一版新增了什么见 [更新说明.md](更新说明.md)。

---

## 目录一览

| 路径 | 说明 |
| --- | --- |
| `colony.html` | **完整 Colony 本体**（Stem + 全部 10 块），双击用浏览器打开即可，无需服务器 |
| `start-all.bat` / `start-all.sh` | **一键启动脚本**（Windows / macOS & Linux）：自动装订阅依赖、后台拉起本机(4130) + 订阅代理(4135) 并打开 `colony.html` |
| `src/` | 拆开的完整源码：`stem.js` 内核 + `blocks/*.js` 全部 10 个块（含改过的段） |
| `local/` | 「本机」块连接的电脑端脚本 `colony-local.cjs`、单独块 `petri-local.html`、`说明.md` |
| `sub/` | 「订阅中心」连接的本机订阅代理 `server.mjs`、5 家驱动（Cursor/Grok Build/Antigravity/ChatGPT/Claude）、`petri-sub.html`、`README.md` |
| `plugin/` | **Colony Bridge** 浏览器插件源码（Manifest V3，含零黄条静默后台页与流式网关） |
| `web-plugins/` | 4 个干净的网页插件导出包：`grok.json`、`gemini.json`、`muse.json`、`priceai.json`（及合集 `web-plugins-all.json`） |
| `miniapps/` | 新版内置「浏览器」小应用 `browser.html`（其余小应用与工作流可参考 `../release-2026-10-31/`） |
| `skills/ext-library.json` | 插件管理「扩展库」导出包（不含密钥） |

### 块清单（10 块 + Stem）

| 文件 | 块 | 段数 | 改版段数 |
| --- | --- | --- | --- |
| `stem.js` | Stem | 16 | 0 |
| `blocks/ai.js` | AI 配置 | 19 | 3 |
| `blocks/agent.js` | 全能 agent | 28 | 17 |
| `blocks/bridge.js` | agent 桥接 | 25 | 1 |
| `blocks/ui.js` | 界面 | 26 | 3 |
| `blocks/porter.js` | 次元口袋 | 16 | 3 |
| `blocks/code.js` | 代码解读 | 31 | 0 |
| `blocks/workflow.js` | 工作流 | 44 | 1 |
| `blocks/plugin-manager.js` | 插件管理 | 12 | 7 |
| `blocks/local.js` | 本机 | 8 | 1 |
| `blocks/sub.js` | 订阅中心（新） | 5 | 2 |

---

## 新手完整体验上手指南（按需解锁，全套 5 分钟搞定）

### 第 0 步：下载整包
- 点击 GitHub 仓库右上角绿色 **`Code` → `Download ZIP`** 下载并解压（或 `git clone https://github.com/520xiaomumu/colony.git`），进入 `release-2026-11-26` 文件夹。
- 准备环境：Chrome / Edge 浏览器；若要体验「本机 + 订阅中心」，安装 **Node.js 22+**（https://nodejs.org/）。

### 第 1 步：只体验纯网页本体（30 秒）
1. 直接双击 `colony.html`，浏览器就会打开 Colony 桌面。
2. 点击桌面上的 **🧠 AI 配置** → 点 `+` 添加一个你的 API 厂商（填 API 网址、API Key、点「拉取全部模型」并测通对话模型）。
3. 打开右下角 **🤖 全能 agent** 对话框即可开始使用（数据全存在你自己的浏览器 IndexedDB 里）。

### 第 2 步：装上浏览器插件（解锁「网页模型 / 网站自动化 / 零黄条操控」）
1. 在 Chrome / Edge 地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`），打开右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选择 `release-2026-11-26/plugin/` 文件夹。
3. 刷新一下打开着的 `colony.html`，打开 **🛠 插件管理**，确认顶部显示插件已连接。
4. **导入 4 个网页插件（可选，强烈推荐）**：把 `web-plugins/web-plugins-all.json`（或其中任意单个 `.json`）发给全能 agent，说「帮我安装里面的网页插件并启用」。只要你在当前浏览器里登录了 Grok / Gemini / Muse 官网，它们会自动接入 AI 配置，无需 API Key 就能对话/生图/生视频。

### 第 3 步：拉起本机脚本 + 订阅代理（解锁「操作电脑 + 5 家订阅账号直连」）
- **最省事（一键启动）**：
  - Windows 直接双击 `start-all.bat`；macOS / Linux 在终端跑 `bash start-all.sh`。
  - 它会自动安装 `sub/` 依赖，在后台启动 **本机服务（4130 端口）** 和 **订阅代理（4135 端口）**，并帮你打开 `colony.html`。
- **手动分步启动 / 开机自启**：
  - 本机服务：`node local/colony-local.cjs`（想开机自启跑一次 `node local/colony-local.cjs --install`，详见 `local/说明.md`）。
  - 订阅代理：把 `sub/` 复制到你的用户目录 `~/colony-sub`（这样在 Colony 界面里点「启动订阅代理」按钮也能自动拉起），进入目录跑 `npm install && node server.mjs`。
- **登录订阅账号**：
  1. 在 Colony 桌面打开 **🔑 订阅中心**，确认顶部显示「代理已连接（127.0.0.1:4135）」。
  2. 对你要用的渠道（Cursor / Grok Build / Antigravity / ChatGPT / Claude）点 **登录**，按提示在浏览器完成 OAuth 授权。
  3. 点 **「同步到 AI 配置」**，各家订阅模型会自动出现在 **AI 配置** 里并可设为默认大脑。

### 第 4 步（可选）：导入新版小应用与扩展技能
- **浏览器小应用**：把 `miniapps/browser.html` 拖进桌面或让全能 agent 导入为桌面应用。
- **扩展技能库**：在 **🛠 插件管理 → 扩展库** 里导入 `skills/ext-library.json`。

---

> 上传前已对全部文件做自动化敏感信息扫描（API Key / OAuth Token / JWT / 个人邮箱等），未包含任何个人密钥或账号数据。

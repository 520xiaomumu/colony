# Colony 发布包 · 2026-11-28（v11.28 · 架构重构 + 三大网页插件修通版）

Colony 在 2026-11-28 的完整快照：内核 Stem + 全部 9 个块（含重构后的 `插件管理/页面工具`、`AI 配置`、`agent 桥接` 与全能 agent）、独立可打开的 `petri-ai.html`、拆开的完整源码、单进程双端口本机与聚合网关 `local/`（内嵌 `local/sub/`）、**Colony Bridge v0.6** 浏览器插件、全面修通升级的 4 个网页插件（Grok / Muse / Gemini / PriceAI）、浏览器小应用和扩展库技能。

完整更新日志见 [更新说明.md](更新说明.md)。

---

## 目录一览

| 路径 | 说明 |
| --- | --- |
| `colony.html` | **完整 Colony 本体**（Stem + 全部 9 块），双击用浏览器打开即可，无需服务器 |
| `petri-ai.html` | **单独导出的 AI 配置面板**（~165 KB），可独立作为私有 OpenRouter / 订阅网关控制台 |
| `start-all.bat` / `start-all.sh` | **一键启动脚本**（Windows / macOS & Linux）：装依赖、后台静默启动单一双端口进程（`:4130` + `:4135`）并打开 `colony.html` |
| `local/` | 本机控制面脚本 `colony-local.cjs` + 内嵌 `local/sub/`（`:4135` 聚合网关与 5 家订阅驱动 + CLI 桥接）+ `petri-local.html` |
| `plugin/` | **Colony Bridge v0.6** 浏览器插件源码（Manifest V3，含 `file://` 安全闸、无感 CORS、纯插件 OAuth 与零黄条后台页） |
| `web-plugins/` | 4 个干净的最新网页插件：`grok.json`、`muse.json`、`gemini.json`（含多账号 / Gem / Deep Research）、`priceai.json` 与合集 `web-plugins-all.json` |
| `src/` | 拆开的完整源码：`stem.js` 内核 + `blocks/*.js` 全部 9 个块 |
| `miniapps/` | 新版内置「浏览器」小应用 `browser.html` |
| `skills/ext-library.json` | 插件管理「扩展库」导出包（不含密钥） |

---

## 新手三步上手（层层按需解锁）

Colony 的壳是「层层可拔」的，你可以按需用到哪一层就装哪一层：

### 方式 A：纯网页尝鲜（0 安装）
- 直接双击 `colony.html` 打开，在 **🧠 AI 配置** 填入任意 API Key（OpenAI / Claude / Gemini / DeepSeek / OpenRouter 等）即可开聊。

### 方式 B：一键解锁本机 + 5 家订阅登录 + 本地聚合网关（推荐）
1. 确保已安装 **Node.js 18+**（建议 22+，https://nodejs.org/ ）。
2. Windows 双击 **`start-all.bat`**（macOS / Linux 运行 `bash start-all.sh`）：
   - 自动安装 `local/sub` 依赖；
   - 在后台静默启动 **唯一 1 个本机进程**（`:4130` 控制面锁死仅本机 + `:4135` 聚合网关），同时注册 `colony://` 网页一键唤醒协议；
   - 自动打开 `colony.html`。
3. 在 Colony 里打开 **🧠 AI 配置 → 🔑 订阅与网关**，直接登录你已订阅的厂商账号（ChatGPT / Claude / Antigravity / Grok Build / Cursor），登录后自动同步模型；本机其他工具也可直接把接口地址填成 **`http://127.0.0.1:4135/v1`** 复用全部模型。

### 方式 C：再装浏览器插件，补齐网页模型 + 真浏览器操控（满血）
1. 在 Chrome / Edge 地址栏打开 `chrome://extensions`，开启右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选择解压目录里的 **`plugin/`**。
3. 点进扩展 **「详情」** → 开启 **「允许访问文件网址」**（本地双击 `colony.html` 必开）。
4. 刷新 `colony.html`，确认 **🛠 插件管理** 显示 `v0.6` 已连接。
5. （可选）先在当前 Chrome 登录 `grok.com` / `muse.ai` / `gemini.google.com`，再把 `web-plugins/web-plugins-all.json` 发给全能 agent 说「帮我安装并启用里面的网页插件」，即可零 API Key 直接在 AI 配置里调用三家网页对话、生图、生视频与 Deep Research。

---

> 上传前已对全部文件执行自动化敏感信息扫描（API Key / OAuth Token / JWT / 个人邮箱与凭证目录），未包含任何个人密钥或账号数据。

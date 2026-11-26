# Colony 发布包 · 2026-11-26（v11.26.2 · 聚合网关二合一版）

Colony 在 2026-11-26 的完整快照：内核 Stem + 精简整合后的全部 9 个块（`AI 配置` 合并订阅与私有 OpenRouter 聚合网关、升级全能 agent 与通用网页插件引擎），另附独立可打开的 `petri-ai.html`、拆开的完整源码、单进程双端口本机脚本与聚合网关、**Colony Bridge v0.6** 浏览器插件、4 个即用网页插件、浏览器小应用和扩展库技能。

完整更新日志见 [更新说明.md](更新说明.md)。

---

## 目录一览

| 路径 | 说明 |
| --- | --- |
| `colony.html` | **完整 Colony 本体**（Stem + 全部 9 块），双击用浏览器打开即可，无需服务器 |
| `petri-ai.html` | **单独导出的 AI 配置面板**（~133 KB），可独立作为私有 OpenRouter / CLIProxyAPI 控制台 |
| `start-all.bat` / `start-all.sh` | **一键启动脚本**（Windows / macOS & Linux）：装依赖、启动单一双端口进程（`:4130` 控制面 + `:4135` 聚合网关）并打开 `colony.html` |
| `src/` | 拆开的完整源码：`stem.js` 内核 + `blocks/*.js` 全部 9 个块 |
| `local/` | 本机控制面脚本 `colony-local.cjs`（自动同进程挂载 `:4135` 聚合网关）、`petri-local.html`、`说明.md` |
| `sub/` | 同进程挂载的聚合网关与 5 家订阅驱动 `gateway.mjs` / `server.mjs` / `drivers/` / `lib/` |
| `plugin/` | **Colony Bridge v0.6** 浏览器插件源码（Manifest V3，含本地 `file://` 满血支持、无感 CORS、纯插件 OAuth 与零黄条后台页） |
| `web-plugins/` | 4 个干净的网页插件导出包：`grok.json`、`gemini.json`、`muse.json`、`priceai.json`（及合集 `web-plugins-all.json`） |
| `miniapps/` | 新版内置「浏览器」小应用 `browser.html`（其余小应用与工作流可参考 `../release-2026-10-31/`） |
| `skills/ext-library.json` | 插件管理「扩展库」导出包（不含密钥） |

### 块清单（9 块 + Stem）

| 文件 | 块 | 段数 | 改版段数 |
| --- | --- | --- | --- |
| `stem.js` | Stem | 16 | 0 |
| `blocks/ai.js` | AI 配置（含订阅与聚合网关） | 19 | 8 |
| `blocks/agent.js` | 全能 agent | 28 | 17 |
| `blocks/bridge.js` | agent 桥接 | 25 | 1 |
| `blocks/ui.js` | 界面 | 26 | 3 |
| `blocks/porter.js` | 次元口袋 | 16 | 3 |
| `blocks/code.js` | 代码解读 | 31 | 0 |
| `blocks/workflow.js` | 工作流 | 44 | 1 |
| `blocks/plugin-manager.js` | 插件管理 | 12 | 7 |
| `blocks/local.js` | 本机 | 8 | 2 |

---

## 新手完整体验上手指南

### 1. 下载整包
- 打开 GitHub 右侧 **Releases → `Colony 11.26 v2`**，下载 **`Colony-11.26-v2-完整包.zip`** 并解压。
- 准备 Chrome / Edge 浏览器；若要体验本机操控与 `:4135` 聚合网关，安装 **Node.js 22+**（https://nodejs.org/）。

### 2. 一键启动单进程双端口 + 打开本体
- Windows 双击 **`start-all.bat`**（macOS / Linux 运行 `bash start-all.sh`）：
  - 自动装好 `sub/` 依赖，启动 **唯一 1 个本机进程**，同时提供 `:4130` 控制面（锁死仅本机）和 `:4135` 聚合网关（默认仅本机免密），并自动打开 `colony.html`。
- *纯网页尝鲜 / 手机端*：直接打开 `colony.html` 即可用（纯手机无插件无本机时在「AI 配置 → 高级 → 转发地址」填自建反代；手机浏览器装扩展后直接解锁 4 家免本机纯插件订阅）。

### 3. 安装 Colony Bridge v0.6 浏览器插件
1. 在 Chrome / Edge 地址栏输入 `chrome://extensions`，打开右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选解压目录里的 **`plugin/`**。
3. 进扩展 **「详情」** → 打开 **「允许访问文件网址」**（双击本地 `colony.html` 必开）。
4. 刷新 `colony.html`，确认 **🛠 插件管理** 显示 `v0.6` 已连接。

### 4. 配置模型 / 登录订阅 / 接入外部工具
- **登订阅 & 开私有 OpenRouter**：打开 **🧠 AI 配置 → 🔑 订阅与网关**：
  - 给 Cursor / Grok Build / Antigravity / ChatGPT / Claude 点登录，完成后自动同步模型；
  - 电脑上其他工具（Claude Code / Codex CLI / Cherry Studio / OpenCode 等）直接填 **`http://127.0.0.1:4135/v1`**（免密，非要填 Key 随便填 `123456` 即可）就能统一调用你所有的订阅、勾选的常规 API 厂商以及在线网页模型；
  - 如需给局域网其他设备用，主动勾选 **「允许局域网外放（0.0.0.0）」** 并自定义你的外放密码。
- **装 4 个网页插件**：先在当前 Chrome 登录 `grok.com` / `gemini.google.com` 等官网，再把 `web-plugins/web-plugins-all.json` 发给全能 agent 说「安装并启用里面的网页插件」。
- **导入新版小应用与扩展技能**：把 `miniapps/browser.html` 拖入桌面，或在插件管理扩展库导入 `skills/ext-library.json`。

---

> 上传前已对全部文件做自动化敏感信息扫描（API Key / OAuth Token / JWT / 个人邮箱等），未包含任何个人密钥或账号数据。

# Colony 发布包 · 2026-11-28（v11.28 · 架构重构 + 三大网页插件修通 + 本地文件插件完全对等）

Colony 在 2026-11-28 的完整快照：内核 Stem + 全部 9 个块、独立可打开的 `petri-ai.html`、拆开的完整源码、单进程双端口本机与聚合网关 `local/`（内嵌 `local/sub/`）、**Colony Bridge v0.6** 浏览器插件（本地 `file://` 与线上域名权限完全对等）、全面修通升级的 4 个网页插件（Grok / Muse / Gemini / PriceAI）、浏览器小应用和扩展库技能。

完整更新日志见 [更新说明.md](更新说明.md)。

---

## 新手怎么上手？（按需解锁，0 拦截起步）

Colony 的能力是**层层可拔**的——绝大部分日常用法**不需要安装 Node.js，也不需要双击 `.bat`**，不会被 Windows 11「智能应用控制」拦截。

### 第 1 步：打开 Colony（0 安装，直接用）
- 用 **Chrome / Edge** 打开解压后的 **`colony.html`**（或直接访问线上版 https://colonyai.fun/s/colony1128 ）。
- 如果你手里有任意 API Key（OpenAI / Claude / Gemini / DeepSeek / OpenRouter 等），点开 **🧠 AI 配置** 填进去就能立刻开聊。

### 第 2 步：装 1 个浏览器插件，解锁 90% 满血能力（推荐所有用户）
不装 Node.js、不启任何本机进程，只要装这个插件就能**直接登录 4 家官方订阅** + **免 Key 用 3 家网页模型** + **真浏览器操控**：

1. 在 Chrome / Edge 地址栏打开 `chrome://extensions`，打开右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选中解压目录里的 **`plugin/`** 文件夹。
3. **关键一步**（本地双击 `colony.html` 必开）：点进刚装好的 **Colony Bridge → 「详情」**，打开 **「允许访问文件网址」**。
4. 回到 `colony.html` 刷新页面，右上角 **🛠 插件管理** 显示 `在线 0.6` 即成功。
5. **直接登录订阅**：打开 **🧠 AI 配置 → 🔑 订阅与网关**，直接点下方 4 家 **🧩 插件通道**（ChatGPT / Claude / Antigravity / Grok Build）的「浏览器登录 / 设备码登录」，插件会自动完成授权并同步模型。
6. **使用网页模型（可选）**：先在同一个浏览器登录 `grok.com` / `muse.ai` / `gemini.google.com`，再把 `web-plugins/web-plugins-all.json` 拖给全能 agent 说「帮我安装并启用里面的网页插件」，即可零 API Key 直接用三家对话、生图、生视频与 Deep Research。

### 第 3 步：需要操作电脑文件 / 终端 / 给其他软件提供 `:4135` 网关时，再启动本机服务（进阶可选）
只有当你想让 agent 跑电脑终端命令、读写本地文件，或让外部工具连 `http://127.0.0.1:4135/v1` 共享订阅模型时，才需要这一步：

1. 安装 **Node.js 18+**（建议 22+，https://nodejs.org/ ）。
2. 打开 Colony 里的 **💻 本机** 面板，直接复制里面的启动命令（也可手敲）：
   - 打开解压后的文件夹，在顶部地址栏输入 `cmd` 回车（macOS / Linux 在该目录打开终端），粘贴运行：
     ```bash
     node local/colony-local.cjs --install
     ```
   - *(说明：Windows 11 开启「智能应用控制」时会拦截从网上下载的未签名 `start-all.bat`，用上面这句直接调带官方签名的 `node` 运行可 100% 避开拦截；如未开启智能应用控制，也可直接双击 `start-all.bat` / 运行 `bash start-all.sh`。如需要使用 Cursor 订阅驱动，首次可在 `local/sub` 目录执行一次 `npm install`。)*
3. 首次运行后会自动后台启动单一进程（`:4130` 控制面锁死仅本机 + `:4135` 聚合网关）、设好开机静默自启并注册 `colony://` 网页一键唤醒；以后随时在 **💻 本机** 面板点 **「⚡ 一键唤醒」** 即可。

---

## 目录一览

| 路径 | 说明 |
| --- | --- |
| `colony.html` | **完整 Colony 本体**（Stem + 全部 9 块），Chrome / Edge 直接打开即可 |
| `plugin/` | **Colony Bridge v0.6** 浏览器插件源码（支持纯插件订阅、网页模型、免跨域与真浏览器操控，`file://` 与线上完全对等） |
| `web-plugins/` | 4 个干净的最新网页插件：`grok.json`、`muse.json`、`gemini.json`（含多账号 / Gem / Deep Research）、`priceai.json` 与合集 `web-plugins-all.json` |
| `local/` | 本机控制面脚本 `colony-local.cjs` + 内嵌 `local/sub/`（`:4135` 聚合网关与 5 家订阅驱动 + CLI 桥接）+ `petri-local.html` |
| `petri-ai.html` | **单独导出的 AI 配置面板**（~165 KB），可独立作为私有 OpenRouter / 订阅网关控制台 |
| `start-all.bat` / `start-all.sh` | 备用一键脚本（Windows / macOS & Linux，未开智能应用控制时可用） |
| `src/` | 拆开的完整源码：`stem.js` 内核 + `blocks/*.js` 全部 9 个块 |
| `miniapps/` | 新版内置「浏览器」小应用 `browser.html` |
| `skills/ext-library.json` | 插件管理「扩展库」导出包（不含密钥） |

---

> 上传前已对全部文件执行自动化敏感信息扫描（API Key / OAuth Token / JWT / 个人邮箱与凭证目录），未包含任何个人密钥或账号数据。

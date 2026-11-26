# Colony 本机聚合网关与订阅模块 (`sub/`)

把你的 **5 家 AI 订阅账号 + AI 配置里的常规 API 厂商 + 浏览器网页模型反桥** 统一聚合成一个本机 OpenRouter / CLIProxyAPI 兼容接口（默认 `http://127.0.0.1:4135/v1`）。

> **单进程双端口架构**：现在无需单独常驻运行此进程！运行 `local/colony-local.cjs` 时会自动在**同一个 Node 进程内**挂载本目录下的 `gateway.mjs`（`:4130` 锁死仅本机跑命令，`:4135` 物理隔离只做模型推理与 `/proxy`，路由表里零 shell/文件能力）。如只想单独跑网关，也依然保留 `node server.mjs`。

## 核心能力
- **双协议全覆盖**：OpenAI `/v1/*`（`/models`、`/chat/completions`、`/responses`、`/images/generations`、`/audio/*`、`/embeddings`）+ Anthropic `/v1/messages`（直接给 Claude Code / Cline / Codex CLI / Cherry Studio 使用）。
- **5 家订阅驱动**：Cursor（`@cursor/sdk`）、Grok Build（设备码 OAuth）、Antigravity（Google OAuth）、ChatGPT（SIWC / Codex OAuth）、Claude（Claude Code OAuth）。
- **本机免密 + 局域网外放可控**：默认只听 `127.0.0.1`，留空或任意占位 Key 均放行；在 Colony「AI 配置 → 🔑 订阅与网关」主动打开局域网外放（`0.0.0.0`）时，才启用你可自定义编辑的外放密码。
- **内置 `/proxy` 透明流式代理**：给无插件环境下的 `AI 配置` 自动兜底解决中转站 CORS 跨域。

## 安装（一次性）

需要 **Node.js 22+**（Cursor SDK 需要 Node >= 22.13；其余 4 家与常规聚合 Node 18+ 即可）。

```bash
# 推荐把本目录放到 ~/colony-sub（或放在 local/sub/ 下）
cd sub
npm install
# 之后直接运行 local/colony-local.cjs 即可同进程拉起 4130 + 4135
# 若只想单独起聚合网关：
node server.mjs
```

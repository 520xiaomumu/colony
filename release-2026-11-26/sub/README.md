# Colony 本机订阅代理 (`colony-sub`)

把你已有的 AI 订阅账号在本机转成标准 OpenAI 兼容接口（`http://127.0.0.1:4135`），登录完一键同步进 Colony「AI 配置」，所有块与小应用直接可用。

## 支持的订阅渠道

| 渠道 | 登录方式 | 能力 | 说明 |
| --- | --- | --- | --- |
| **Cursor** | 浏览器一键授权 / 贴 `crsr_...` Key | 对话、工具调用 | 基于官方 `@cursor/sdk` |
| **Grok Build** | 官方设备码 OAuth | 对话、思考、工具调用、生图、生视频 | 走 `auth.x.ai` 设备授权 |
| **Antigravity** | Google OAuth | 对话、思考（Gemini / Claude 等） | 本地回调端口 `51121` |
| **ChatGPT** | SIWC / Codex OAuth | 对话、工具调用、生图 | 本地回调端口 `1455` |
| **Claude** | Claude Code OAuth | 对话、工具调用、`/messages` 透传 | 本地回调端口 `54545` |

> **安全说明**：真实登录凭证只保存在你本机的 `tokens/` 目录（默认 `~/colony-sub/tokens/`），不上传云端、不进浏览器的 `colony.html`。删掉目录与块即彻底卸载。

## 安装与启动

需要 **Node.js 22+**（Cursor SDK 要求 Node >= 22.13；若不用 Cursor，Node 18+ 也可跑其余 4 家）。

```bash
# 推荐把本目录放到用户目录 ~/colony-sub（这样在 Colony「订阅中心」面板里点按钮也能自动启动）
cd sub
npm install
node server.mjs
```

启动后默认监听 `http://127.0.0.1:4135`：
- 健康检查：`GET http://127.0.0.1:4135/health`
- 各渠道 OpenAI 接口：`http://127.0.0.1:4135/sub/<渠道id>/v1`
- 聚合接口：`http://127.0.0.1:4135/v1`

## 单独导入「订阅中心」块

`colony.html` 已内置「订阅中心」块。如果你在旧版 Colony 上想单独装它，可在桌面 **设置 → 块 → 导入 Petri** 选中本目录的 `petri-sub.html`。

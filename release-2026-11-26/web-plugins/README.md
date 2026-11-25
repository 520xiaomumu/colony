# 网页插件导出包 (`web-plugins`)

这里包含 4 个已经打磨好的网页插件定义（纯定义，不含任何个人 Cookie、Token 或账号信息）：

| 文件 | 名称 | 类型 | 能力概览 |
| --- | --- | --- | --- |
| `grok.json` | Grok (网页) | 网页模型 | 复用 Chrome 登录态：Grok 4.7 五模式对话、Imagine 批量超清生图/改图、并发批量生视频、照片库与配额查询 |
| `gemini.json` | Gemini (网页) | 网页模型 | 复用 Chrome 登录态：Gemini 4 对话（自动/Hydrogen/Neon + 思考等级）、制作图片（含改图/GIF）、Veo 视频、Lyria 音乐、库资产与用量查询 |
| `muse.json` | Muse (网页) | 网页模型 | 复用 Chrome 登录态：1600×1600 文生图、720p 文生视频 |
| `priceai.json` | PriceAI 比价雷达 | 网页工具 | 免登录纯 HTTP 毫秒查官方订阅全球低价区、卡网报价/口碑、官方 API 与 Coding Plan、中转站倍率对比 |

`web-plugins-all.json` 是上述 4 个插件的合集。

## 怎么导入到 Colony

前置条件：已安装并启用 `plugin/` 目录下的 **Colony Bridge** 浏览器插件（网页模型插件需要在同一 Chrome 里先登录对应官网，如 `grok.com` / `gemini.google.com`）。

导入方式（任选其一）：
1. **最省事（直接跟全能 agent 说）**：把某个 `.json`（或 `web-plugins-all.json`）拖进 Colony 对话框（或告诉它本机路径），说一句「把里面的网页插件装进插件管理并启用」，agent 会自动调用 `plugin.web.install` 完成安装并接入 AI 配置。
2. **代码导入**：在 Colony 浏览器控制台或任意脚本里读取 JSON 后调用 `colony.call('plugin.web.install', { ...pluginJson, enable: true })`。

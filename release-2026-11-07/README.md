# Colony 发布包 · 2026-11-07（11.7）

Colony 在 2026-11-07 的快照：内核 Stem + 9 个块（新增「本机」块），单个 HTML 打开就能用。另附拆开的源码、本机脚本、扩展库技能和 Colony Bridge 浏览器插件。

这一版新增了什么见 [更新说明.md](更新说明.md)。

## 目录

| 路径 | 说明 |
| --- | --- |
| `colony.html` | 完整 Colony（Stem + 全部 9 块），双击用浏览器打开即可，不需要服务器 |
| `src/` | 拆开的源码：`stem.js` 内核，`blocks/*.js` 每块一份（各块当前代码，含改过的段） |
| `local/` | 「本机」块要连的电脑端脚本 `colony-local.cjs`、单独的块文件 `petri-local.html`、`说明.md` |
| `plugin/` | Colony Bridge 浏览器插件源码，manifest v3，版本 0.5.0 |
| `skills/ext-library.json` | 插件管理「扩展库」的导出包（技能，不含任何密钥），在插件管理里导入 |

### 块
| 文件 | 块 | 段数 | 用的是改版的段 |
| --- | --- | --- | --- |
| stem.js | Stem | 16 | 0 |
| blocks/ai.js | AI 配置 | 19 | 0 |
| blocks/agent.js | 全能 agent | 28 | 12 |
| blocks/bridge.js | agent 桥接 | 25 | 0 |
| blocks/ui.js | 界面 | 26 | 3 |
| blocks/porter.js | 次元口袋 | 16 | 0 |
| blocks/code.js | 代码解读 | 31 | 0 |
| blocks/workflow.js | 工作流 | 44 | 0 |
| blocks/plugin-manager.js | 插件管理 | 10 | 0 |
| blocks/local.js | 本机（新） | 8 | 0 |

### 扩展库技能
`github-pages-publish`

小应用、工作流沿用 [release-2026-10-31](../release-2026-10-31/)。

## 怎么用

1. **Colony**：打开 `colony.html`。数据存在浏览器本地（IndexedDB），没有任何账号、密钥随包发出；第一次打开在「AI 配置」里填自己的厂商 Key。
2. **本机**：在电脑上 `node local/colony-local.cjs`（Node 18+），然后在 Colony 的「本机」块里接上，详见 `local/说明.md`。
3. **插件**：浏览器扩展页开「开发者模式」→「加载已解压的扩展」→ 选 `plugin/`。

上传前已扫过 API Key / token / Bearer / sk- 等，未发现密钥。

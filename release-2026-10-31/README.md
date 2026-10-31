# Colony 发布包 · 2026-10-31

Colony 在 2026-10-31 的完整快照：内核 Stem + 8 个块，单个 HTML 打开就能用。另附拆开的源码、常用小应用、工作流、扩展库技能和 Colony Bridge 浏览器插件。

这一版是「Colony 小剧场」第一季（9 集）做完后的状态，B 站合集：https://www.bilibili.com/video/BV1QLxF6pEQF

## 目录

| 路径 | 说明 |
| --- | --- |
| `colony.html` | 完整 Colony（Stem + 全部块），双击用浏览器打开即可，不需要服务器 |
| `src/` | 拆开的源码：`stem.js` 内核，`blocks/*.js` 每块一份（和 colony.html 里的一致，方便看和比对） |
| `miniapps/` | 桌面小应用，拖到 Colony 桌面上即可用 |
| `workflows/` | 工作流图（JSON），用 workflow.save 或在画布里导入 |
| `skills/ext-library.json` | 插件管理「扩展库」的导出包（技能，不含任何密钥），在插件管理里导入 |
| `plugin/` | Colony Bridge 浏览器插件源码，manifest v3，版本 0.5.0 |

### 块
| 文件 | 块 | 段数 | 相对出厂改过的段 |
| --- | --- | --- | --- |
| stem.js | Stem | 16 | 0 |
| blocks/ai.js | AI 配置 | 19 | 2 |
| blocks/agent.js | 全能 agent | 26 | 7 |
| blocks/bridge.js | agent 桥接 | 25 | 1 |
| blocks/ui.js | 界面 | 26 | 7 |
| blocks/porter.js | 次元口袋 | 16 | 2 |
| blocks/code.js | 代码解读 | 31 | 0 |
| blocks/workflow.js | 工作流 | 44 | 1 |
| blocks/plugin-manager.js | 插件管理 | 10 | 8 |

### 小应用
| 文件 | 名字 | 用处 |
| --- | --- | --- |
| voice-qc.html | 配音质检 | 工作流节点: 剧本 JSON + 角色 → 多角色逐句配音、逐字对齐切句、音高查串音色 → 每句音频 + 全片试听 + 质检报告 |
| quiz-arena.html | 答题擂台 | 几个 agent 同台答一道题(各答各的, 互相看不到), 再匿名互评: 每条评语当场飞到答卷上, 最后亮分颁奖。用法: 写题目和评分要点 → 选选手 → 选评审(可和选手重叠,  |
| comic-4koma.html | 四格拼版 | 工作流节点: 四张图+标题+对白 → 一张带讲解的四格漫画成品图 |
| video-studio.html | 新视频工坊 | 视频工坊: 做片、改片、出片一处做完。左边是片子清单(可新建、删除)和导出(HTML 实时版 / MP4 / WebM, 720p–4K, 导出前显示预估大小); 右边是画面和分场 |
| browser.html | 浏览器 | 在 Colony 里上网: 多标签、地址栏(网址或搜索)、前进后退刷新、书签、历史; 自动继承本浏览器的登录(要装 Colony Bridge 插件, 并在窗上开「完全访问」)。a |

### 工作流
- `drama-pipeline.json`：短剧流水线 · 写稿到配音
- `drama-pipeline-inner.json`：短剧流水线·内
- `comic-4koma.json`：一句话四格漫画

### 扩展库技能
`mini-drama`、`video-publish`、`hsk-file-hosting`、`here-now`、`github-pages-publish`、`pi-mono-plan-mode`、`humanizer`、`frontend-design`

## 这一版相对 2026-10-24 的主要变化

- **agent 桥接**：本机 agent、云端 agent、好友真人统一进通讯录，可单聊、拉群、派活；小应用用 bridge.pick 选人后让多个 agent 同台（答题擂台）。
- **插件管理**：远程 MCP 直连；扩展库能学外面的技能和插件、改写成 Colony 的做法并导出；截图统一处理（后台页自动切前台，超时改截可见区）；MCP 网址里的密钥单独存，列表和导出都不出现。
- **全能 agent**：大脑断线自动换模型续做；系统提示走前缀缓存；压缩摘要先校验再替换；图片缩略显示，按文件头识别类型；技能按条读取。
- **界面**：皮肤和壁纸独立成「皮肤」段（经典 / 视窗）；收起的窗口点最大化会展开；录屏授权跨重启保留。
- **AI 配置**：转写带逐字时间戳；接口改法不会被 400 时的备用写法覆盖。
- **次元口袋**：数据地图先列后算，打开快很多。

## 怎么用

1. **Colony**：打开 `colony.html`。数据存在浏览器本地（IndexedDB），没有任何账号、密钥随包发出；第一次打开在「AI 配置」里填自己的厂商 Key。
2. **小应用**：打开 Colony 后，把 `miniapps/` 里的 HTML 拖到桌面。
3. **插件**（Chrome / Edge）：`chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `plugin/` 目录。它负责免跨域请求、CDP 操控标签页、录屏、接本机 agent（hermes / openclaw / 网关）。

## 校验口径

`colony.html` 是本机 Colony 用 stem.molt 导出的原样文件；`src/` 取自同一时刻各块的当前代码；插件源码与浏览器里正在运行的 Colony Bridge 0.5.0 逐文件一致。

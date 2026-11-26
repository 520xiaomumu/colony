# Colony Bridge 插件(独立包 · 通用本地枢纽)

Colony 的本地枢纽:免 CORS 转发本机端点 + 通用端口扫描 + 桌面通知。
**产品无关、通用稳定** —— 所有会迭代的逻辑都在 Colony 网页侧,这个插件装一次几乎不用再动。
哑管道原则:只转发 `http://127.0.0.1 / localhost`,不解析业务、不碰远端。

## 安装(一次性)

1. `chrome://extensions` → 右上「开发者模式」打开
2. 「加载已解压的扩展程序」→ 选这个 `plugin/` 文件夹
3. 进本扩展「详情」→ 打开「**允许访问文件网址**」(colony.html 是 file:// 页面必须开)
4. 点插件图标 →「🔎 扫描本机端点」→ 看到你在跑的端点即就绪

## 更新(改了插件文件后)

- 点 popup 里「🔄 重载」—— 直接吃磁盘上的新文件,**不用去 chrome://extensions**。
- 只有改了 `manifest.json` 才需要回 chrome://extensions 重新加载一次。
- 平时不用管:通用逻辑都在这,迭代都在 Colony 网页那份 bridge 里(页面刷新即生效)。

## 它做什么

- **扫描**:广扫本机常见端口(18790/4000/1234/11434/…可在 popup 补),对每个试 `/v1/models`,按端口报告 ✓可用 / 🔑要 key / ◐有服务但非 OpenAI 面。产品无关,扫到什么报什么。
- **转发**:Colony 页面 fetch 不到的本机端点(没开 CORS),经插件 background 代拉(含流式)。
- **通知**:agent 有消息时桌面提醒(可关)。
- **接入包导出**(v0.4.0):popup 底部三个按钮 —— 复制「端口型指令」(给有 OpenAI 兼容能力的 agent 自配置)、复制「CLI型指令」(纯 CLI agent 走网关壳)、下载 `colony-gateway.mjs`(把 claude 等 CLI 包成本地 OpenAI 端点)。网关壳源文件在 `rebuild/_assets/blocks/colony-gateway.mjs`,插件里是发货副本,改源后记得同步。

## 页面协议(给开发者)

    页面 → window.postMessage({ __colonyRelay: { id, op, req } })
      op: ping | fetch{url,method,headers,body,timeout} | scan | notify{title,message} | reload | stream(Port,逐块) | cancel
    插件 → { __colonyRelayResult: { id, ... } } / { __colonyRelayChunk: { id, delta|keepalive|done|error } }
    就绪广播: { __colonyRelayReady: { version } }; 页面发 { __colonyRelayHello:1 } 可请求重播。

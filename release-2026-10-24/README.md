# Colony 发布包 · 2026-10-24

这是 Colony 在 2026-10-24 的完整快照:内核 + 全部块 + 桌面小应用,可以直接打开用。

## 目录

| 路径 | 说明 |
| --- | --- |
| `colony.html` | 最新版 Colony,单文件。双击用浏览器打开即可运行,不需要服务器 |
| `miniapps/video-studio.html` | 视频工坊:任何 HTML 视频导出 MP4/WebM(720p–4K),把桌面应用图标或 .html 拖进窗口,自动选逐帧 / 虚拟时钟 / 实时录 |
| `miniapps/video-engine.html` | 视频引擎:画布/媒体渲染与逐帧导出的底层引擎 |
| `miniapps/browser.html` | 浏览器:小应用形态的浏览窗(配合 Colony Bridge 扩展用) |
| `plugin/` | Colony Bridge 浏览器扩展源码,manifest_version 3,版本 0.5.0 |

## 怎么用

**Colony 本体**:打开 `colony.html`。数据都存在浏览器本地(IndexedDB),换机器时用块导出/导入搬运。

**三个小应用**:打开 Colony 桌面后,把对应 HTML 拖到桌面上,或在"新建小应用"里粘贴内容,即可作为独立窗口运行。

**浏览器扩展**(Chrome / Edge,内核 ≥ 116):

1. 打开 `chrome://extensions`,右上角打开"开发者模式";
2. 点"加载已解压的扩展程序",选 `plugin/` 目录;
3. 打开 `colony.html` 后,扩展负责代发 HTTP 请求(免跨域)、CDP 操控标签页、用户脚本、本机端点扫描等。

## 文件校验口径

本目录内容与 Colony 导出件(Stem 导出,number1 份)逐字节一致;三个小应用取自桌面应用的原样代码;插件源码取自本机安装目录。

## 许可

跟随 Colony 项目原许可。

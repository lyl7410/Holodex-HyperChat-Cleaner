# Holodex HyperChat Cleaner

面向 **YouTube、Holodex Watch / Multiview** 的轻量级 Tampermonkey/Violentmonkey 用户脚本。

> 当前为社区自用优化版，未获 YouTube、Holodex 或 LiveTL 官方支持。脚本针对网页 DOM，网站升级后可能需要调整。

## 安装

先安装 Tampermonkey 或 Violentmonkey，再分别打开下列脚本的 Raw 页面安装：

1. [HyperChat Cleaner](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/hyperchat-cleaner.user.js)
2. [Channel Name Fix](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/channel-name-fix.user.js)

**请禁用旧版 Cleaner v1.x / v2.x 和旧版 Channel Name Fix**，避免重复注入 CSS 或互相覆盖。

## 功能

### Cleaner v2.4

- 隐藏 YouTube 原生聊天的顶部、输入区、置顶、投票、打赏条、会员通知。
- 隐藏 HyperChat 顶部提示、部分付费卡片、消息三点菜单。
- 付费留言（Super Chat / 贴纸）可通过油猴菜单切换。
- 聊天字体大小可调整，Holodex 有 **Aa** 设置入口。
- Holodex Multiview：精简聊天栏，隐藏左右频道切换箭头和频道下拉箭头，保留点击频道名称选择频道。
- YouTube 聊天栏右下角（距底部约 50px）显示按需使用的 ✎ 临时发言按钮。电脑端鼠标悬停显示；移动端半透明。
- 原生输入组件存在且可见时尝试展开；不存在时不会创建虚假的聊天输入框。

### Channel Name Fix v2.4

- 识别 Holodex 顶部 Vuetify 频道选择框中误显示的 **11 位 YouTube 视频 ID**。
- 通过 YouTube oEmbed 获取真实频道名称并本地缓存。
- 仅替换显示文本，保留下拉列表、SVG 图标和原生点击行为。
- 提供清除名称缓存菜单。

## 使用说明

- 在 Holodex Multiview 中点击频道名称区域，仍可展开原来的频道选择列表。
- ✎ 发言功能取决于当前 YouTube 聊天 iframe 是否实际提供文字输入组件、登录状态及直播权限。部分嵌入环境无法恢复输入区。
- 若出现只剩表情、爱心而没有文字输入的情况，说明 YouTube 未提供可用编辑器；此脚本不会模拟发言。
- 若频道名称未出现，检查网络是否允许访问 YouTube oEmbed；部分私有、受限制或不支持 oEmbed 的视频无法解析。

## 已知限制

- Holodex/HyperChat 的 DOM 结构可能变化，特别是多视图工具栏和聊天消息样式。
- 对频道名的修复是**视觉层修复**，不修改 Holodex 内部的 Vue 数据。
- 频道名修复需要网络请求；首次打开可能短暂显示视频 ID。
- 该版本根据讨论中的 DOM 和交互进行整理，尚未在所有桌面/安卓浏览器组合上完成回归测试。

## 目录

```text
userscripts/
  hyperchat-cleaner.user.js
  channel-name-fix.user.js
README.md
```

## 版本记录

- **2026-10-17 — v2.4.0**：首次仓库整理；整合聊天字体、付费留言、原生发言入口、Multiview 左右箭头/下拉箭头隐藏；独立频道名称修复。

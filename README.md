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

### Channel Name Fix v2.6.2

- 修复 Holodex 多视图聊天栏里的 **11 位 YouTube 视频 ID** 显示为频道名，保留原生频道下拉选择。
- 补全当前视频在 Holodex Vuex 中的频道名称、频道 ID 和直播标题，媒体控制面板显示正确直播资料。
- 媒体控制面板与布局调整面板：为 Holodex 没有收录头像的频道覆盖显示真实 YouTube 频道头像。
- **头像缓存优化**：油猴持久缓存视频资料及按频道 ID 共享的头像 URL；当前标签页预加载并复用已解码头像图片。同频道的多场直播共享最新的头像地址。
- **减少反复开关面板时的闪烁**：检测 Vuetify 弹窗显隐变化，面板显示时尽早挂载已经预热的头像；同一视频更换头像时，旧头像会保留到新头像加载完成。
- 保留油猴菜单：查看缓存、重新获取当前视频资料、清空缓存。

## 使用说明

- 在 Holodex Multiview 中点击频道名称区域，仍可展开原来的频道选择列表。
- ✎ 发言功能取决于当前 YouTube 聊天 iframe 是否实际提供文字输入组件、登录状态及直播权限。部分嵌入环境无法恢复输入区。
- 若出现只剩表情、爱心而没有文字输入的情况，说明 YouTube 未提供可用编辑器；此脚本不会模拟发言。
- 若频道名称未出现，检查网络是否允许访问 YouTube oEmbed；部分私有、受限制或不支持 oEmbed 的视频无法解析。

## 已知限制

- Holodex/HyperChat 的 DOM 结构可能变化，特别是多视图工具栏和聊天消息样式。
- 新版优先通过 Holodex 的 Vuex 同步频道名、频道 ID 和直播标题；当页面组件取不到 Vuex 时，频道名称退回仅替换显示文本。
- 视频元数据缓存：完整资料 14 天，不完整资料 24 小时；头像 URL 按频道持久保存，图片文件由浏览器 HTTP 缓存管理。在同一标签页内，预加载图片对象会保持在内存中（最多约 80 个）。
- **第一次获取头像**仍依赖网络，不能保证不显示默认头像；关闭/重开面板通常不需要再次取回频道资料，但浏览器是否联网重验图片由其缓存策略决定。
- 部分受限视频或频道，以及无法从 YouTube 网页取得真实头像的情形，仍可能回退为默认图标。
- 该版本未在所有桌面/安卓浏览器组合上完成回归测试；若更新后仍有默认头像，可在油猴菜单中选择「重新获取当前视频资料」并刷新页面。

## 目录

```text
userscripts/
  hyperchat-cleaner.user.js
  channel-name-fix.user.js
README.md
```

## 版本记录

- **2026-10-18 — Channel Name Fix v2.6.2**：频道级头像持久索引、当前标签页图片预加载/复用、减少控制面板闪烁、监听弹窗显示变化；修复媒体控制面板标题选择器。
- **2026-10-18 — Channel Name Fix v2.5.x**：补全 Holodex Vuex 视频资料、增加媒体控制与布局面板的头像修复。
- **2026-10-17 — v2.4.0**：首次仓库整理；整合聊天字体、付费留言、原生发言入口、Multiview 左右箭头/下拉箭头隐藏；独立频道名称修复。

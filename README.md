# Holodex HyperChat Cleaner

面向 **YouTube、Holodex Watch / Multiview** 的轻量级用户脚本，包含聊天清理、频道资料修复和手机端一键添加视频。

## 安装

1. [HyperChat Cleaner](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/hyperchat-cleaner.user.js)
2. [Channel Name Fix](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/channel-name-fix.user.js)
3. [Holodex Mobile Quick Add](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-mobile-quick-add.user.js)

三个脚本可独立安装。Quick Add 不要求安装另外两个脚本；要使用聊天清理或频道名修复时再分别安装。更新时覆盖同名脚本并刷新相关页面，不要同时启用多份旧版。

## 功能

### Cleaner v2.4.2

- 隐藏 YouTube 原生聊天的顶部、输入区、置顶、投票、打赏条、会员通知。
- 隐藏 HyperChat 顶部提示、部分付费卡片、消息三点菜单。
- 付费留言（Super Chat / 贴纸）可通过油猴菜单切换。
- 聊天字体大小可调整，Holodex 有 **Aa** 设置入口。
- Holodex Multiview：精简聊天栏，隐藏左右频道切换箭头和频道下拉箭头，保留点击频道名称选择频道。
- **手机竖屏工具栏精简**：仅在竖屏且页面宽度不超过 900px 时隐藏绿色「新增空白区域」按钮和链条「分享布局」按钮；横屏仍可使用。
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

### 手机版一键添加视频

1. 在支持脚本管理器的浏览器中打开 YouTube 视频网页，点击短暂显示的 **＋H**，或使用脚本菜单「将当前视频加入 Holodex」。
2. 首次添加会打开 Holodex 接收页；后续从其他 YouTube 标签页添加的视频也会排队进入这个分屏。
3. 切回 Holodex 处理队列。已有页面可通过脚本菜单「使用当前分屏接收 / 检查队列」指定为接收页。

**Quick Add v0.2.3** 优先使用 Holodex 中已保存的默认自动布局，通过原生布局合并方法调整视频与聊天区域。新增视频会尝试自动播放；切回时尝试恢复此前正在播放的视频。手机限制有声自动播放时，新视频会尝试静音播放，必要时点一下页面或播放器。

YouTube 的 ＋H 入口闲置约 4.5 秒后隐藏，触碰页面后短暂显示；Holodex 接收成功后不保留常驻按钮。普通状态提示约 6 秒后消失，脚本菜单始终可用。

完整安装步骤、默认布局选择、接收页切换和排错见 [手机版 Quick Add 使用说明](docs/mobile-quick-add.md)。

### 聊天清理和频道名称

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
- Quick Add 运行于浏览器网页，不能直接接收 YouTube App 的 Android 分享，也不能保证后台页面立即处理或自动有声播放。YouTube 和 Holodex 需使用同一浏览器、同一脚本管理器中的同一份脚本；普通模式和隐私模式不应混用。

## 目录

```text
userscripts/
  hyperchat-cleaner.user.js
  channel-name-fix.user.js
  holodex-mobile-quick-add.user.js
docs/
  mobile-quick-add.md
README.md
```

## 版本记录

- **2026-10-24 — Cleaner v2.4.2**：针对手机竖屏压缩 Holodex 多视图顶部工具栏，仅隐藏新增空白区域与分享布局两个低频图标，保留横屏布局和其他按钮。

- **2026-10-20 — Mobile Quick Add v0.2.3**：手机端当前视频入口、跨标签页共享添加队列、单个 Holodex 接收页、重复视频检查；优先采用已保存的默认布局，调用 Holodex 原生方法合并；新增/切回时尝试播放，新增视频支持静音播放回退；浮动入口和状态提示按需隐藏。安卓狐猴 + 脚本猫的基本流程已获用户反馈可用，其他组合尚未完成实际回归。

- **2026-10-18 — Channel Name Fix v2.6.2**：频道级头像持久索引、当前标签页图片预加载/复用、减少控制面板闪烁、监听弹窗显示变化；修复媒体控制面板标题选择器。
- **2026-10-18 — Channel Name Fix v2.5.x**：补全 Holodex Vuex 视频资料、增加媒体控制与布局面板的头像修复。
- **2026-10-17 — v2.4.0**：首次仓库整理；整合聊天字体、付费留言、原生发言入口、Multiview 左右箭头/下拉箭头隐藏；独立频道名称修复。

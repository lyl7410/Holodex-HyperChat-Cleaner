# Holodex Touch Controls — 手机触摸音量与播放统计

独立油猴脚本，当前 **v0.2.0（原生统计实验版）**。只在 **Holodex Multiview 的 YouTube 视频格子**上显示触控控制，不作用于普通 YouTube 网站、聊天格子和 Twitch 播放器。

**[直接安装 / 更新](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js)** · [返回项目首页](../README.md)

## 安装

1. 在手机浏览器的脚本猫（ScriptCat）、Tampermonkey 等油猴脚本管理器中打开上面的 Raw 链接安装。
2. 授权脚本同时在 `holodex.net`、`www.youtube.com/embed/*` 和 `www.youtube-nocookie.com/embed/*` 上运行，允许**第三方 iframe 中执行脚本**、`unsafeWindow`、样式注入及脚本存储。YouTube 普通观看网页不会添加按钮。
3. 打开或刷新 `https://holodex.net/multiview/`，载入 YouTube 播放视频格子。
4. 需要临时关闭功能时，使用脚本管理器菜单「暂停 Holodex Touch Controls」。

该脚本独立于 Quick Add / Cleaner / Channel Name Fix，不需要一起安装。**不会修改这些现有脚本**。

## 视频画面内的手势

| 操作 | 结果 |
| --- | --- |
| 在 YouTube 视频画面 **右侧 34%、中间 62% 高度**的区域，向上滑动 | 增加该视频音量（0–100%） |
| 在同一区域向下滑动 | 减少该视频音量 |
| 轻点该区域的 🔊 图标 | 打开大滑块、静音、±10 和播放统计面板 |
| 统计面板点击静音 | 切换该路视频静音 |
| 点击面板 × 或按 Escape | 收起面板 |

右侧手势区只覆盖视频的中段，避免挡住底部进度条、设置、全屏控件以及上方其他操作。手势在**半透明的覆盖层**上完成，因为触摸事件不会从跨域 YouTube iframe 自动传到 Holodex 外层。滑动不需按住按钮，手指在这块区域内直接滑动即可。

音量调用 Holodex 已有的 `VideoCell.setVolume()`、`setMuted()`，不是假装改变 Android 系统媒体音量。已按视频格子 ID + YouTube Video ID 双重校验，布局切换后不会盲目操作旧格子。

## 统计面板

### YouTube 自己的连接速度（重点）

**v0.2.0 已移除 `navigator.connection.downlink` 的设备网速估算。**

- 面板通过 **Holodex 页面 → YouTube 嵌入 iframe** 的受限 `postMessage` 通信，让同一份脚本在 YouTube iframe 内读取播放器自己的 `getStatsForNerds()`。
- 主要显示 `bandwidth_kbps`（YouTube Connection Speed，转换成 Mbps）、`buffer_health_seconds`、当前/推荐分辨率、编解码器、丢帧、直播延迟（如播放器提供）。
- 「Connection Speed」仍是 **YouTube 对当前播放连接的带宽估计**，并非瞬时原始网络下载流量；比系统网络速度更适合判断这一路 YouTube 播放的连接情况。
- 通过 `getStatsForNerds()` 读取失败时，再尝试播放器调试文字和已存在的原生详细统计 DOM；没有可靠字段就显示 **—**，不再回退为设备速度。
- 面板附带「**切换 YouTube 原版统计**」按钮：若内部 `showVideoInfo()` / `hideVideoInfo()` 可用，会在**该视频的小型 iframe 内**切换原版详细统计，可能因播放器尺寸而难以阅读。
- 此接口属于 YouTube **未公开的内部接口**，不受官方稳定性保证。手机浏览器、YouTube 版本或嵌入 iframe 限制可能导致不可用；不会以数据抓包或下载文件的方式强行测速。

### 播放器状态

- 播放中 / 暂停 / 缓冲 / 未就绪。
- 当前播放位置、倍速。
- 录播视频的已缓冲比例（YouTube `getVideoLoadedFraction`）。直播时标为不可用，避免误导。

YouTube **官方** IFrame API 未公开这些统计；本版使用 YouTube 嵌入文档中的**内部** Stats for nerds 实现，因此显示值仅在播放器提供可靠字段时出现。

## 兼容性与注意

- 使用粗指针或支持触摸的浏览器时才显示手势区域；无触摸输入的纯 PC 浏览器默认不会添加手势覆盖层。
- 安卓系统及某些移动浏览器可能限制网页嵌入播放器的音量调节：脚本可向 Holodex 播放器发送音量数值，但设备上的实际响度可能依赖系统音量。先尝试 0 / 30 / 70 / 100% 确认。
- 打开统计面板时才按约 2.4 秒更新状态，默认只每约 1.7 秒扫描当前布局。仅对当前选中的一路视频发送统计读取请求，不会对全部视频批量抓取。
- 若网速显示「YouTube iframe 未响应」：检查脚本管理器是否允许在跨域 YouTube 嵌入 iframe 中注入脚本；更新脚本后**刷新 Holodex 页面，确保旧 iframe 也被重新载入**。
- 若显示「嵌入播放器未提供原生详细统计」：脚本已收到 iframe 回应，但这个视频/版本没有开放可读的内部数据；不能把系统网速当作替代值。
- 若原版统计弹窗打不开，但自定义 Connection Speed 有数值，可继续使用自定义面板；两个内部功能的可用性不保证一致。
- 若右侧触控区未显示：确认是 Holodex 的多视图 YouTube 视频（不是 Twitch、聊天框或其他页面）；刷新并检查脚本权限、视频播放器加载和页面注入。
- 如果手势影响你点击视频右侧内容，可在脚本管理器菜单中直接暂停，不影响其他脚本。
- 这里通过 Holodex Vue `VideoCell` 访问播放器。Holodex 内部结构升级可能导致不可用，需要后续适配。
- **已完成静态语法与模拟测试**：原音量功能、YouTube iframe 来源校验、视频 ID 保护、Connection Speed、缓冲健康度、DOM 后备解析、原版统计切换模拟均通过。真实安卓浏览器中的跨域 iframe 注入、YouTube 内部方法兼容性和实际声音变化仍需实机验证。

## 后续可选增强

在实机确认核心可用后，可增加手势灵敏度设置、手势区域大小开关、统计数据趋势、实时健康度提醒、触控快捷切换视频质量、时间/倍速面板。应继续尊重播放器的内部接口兼容性，不再使用系统网速冒充 YouTube 连接速度。

# Holodex Touch Controls — 手机触摸音量与播放统计

独立油猴脚本，当前 **v0.1.0**。只在 **Holodex Multiview 的 YouTube 视频格子**上显示触控控制，不作用于普通 YouTube 网站、聊天格子和 Twitch 播放器。

**[直接安装 / 更新](https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js)** · [返回项目首页](../README.md)

## 安装

1. 在手机浏览器的脚本猫（ScriptCat）、Tampermonkey 等油猴脚本管理器中打开上面的 Raw 链接安装。
2. 授权脚本在 `holodex.net` 上运行，并允许页面访问、`unsafeWindow`、`GM_addStyle` 和脚本数据存储。
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

### 设备网络速度估算（重点）

- 首行显示 `≈ X.XX Mbps`（浏览器提供时）。读取自 `navigator.connection.downlink`，并展示浏览器提供的网络类型及 RTT 估算。
- 这个数值是**浏览器对设备网络的估算**，**不是 YouTube 当前单路视频的实际 CDN 连接速度、实时下载速率或码率**。
- 浏览器不支持 `navigator.connection` 时，显示 `—` 与「此浏览器不支持 Network Information API」，不伪造测速数据，也不会主动下载额外测试文件。

### 播放器状态

- 播放中 / 暂停 / 缓冲 / 未就绪。
- 当前播放位置、倍速。
- 录播视频的已缓冲比例（YouTube `getVideoLoadedFraction`）。直播时标为不可用，避免误导。

YouTube IFrame API 未公开每路视频的 Stats for nerds CDN Connection Speed、实时丢帧和完整缓冲健康数据，因此本版不会给出伪造或未经验证的「实际连接速度」。

## 兼容性与注意

- 使用粗指针或支持触摸的浏览器时才显示手势区域；无触摸输入的纯 PC 浏览器默认不会添加手势覆盖层。
- 安卓系统及某些移动浏览器可能限制网页嵌入播放器的音量调节：脚本可向 Holodex 播放器发送音量数值，但设备上的实际响度可能依赖系统音量。先尝试 0 / 30 / 70 / 100% 确认。
- 打开统计面板时才按约 2.4 秒更新状态，默认只每约 1.7 秒扫描当前布局。
- 若右侧触控区未显示：确认是 Holodex 的多视图 YouTube 视频（不是 Twitch、聊天框或其他页面）；刷新并检查脚本权限、视频播放器加载和页面注入。
- 如果手势影响你点击视频右侧内容，可在脚本管理器菜单中直接暂停，不影响其他脚本。
- 这里通过 Holodex Vue `VideoCell` 访问播放器。Holodex 内部结构升级可能导致不可用，需要后续适配。
- **当前只完成语法检查与模拟测试**：视频格子识别、音量设置/静音、旧视频拦截、统计数据读取、播放器未就绪处理通过。真实安卓浏览器的跨域注入、滑动手感和系统音量行为仍需要实机验证。

## 后续可选增强

在实机确认核心可用后，可增加手势灵敏度设置、手势区域大小开关、统计数据趋势及更高效的网络测量。真实 YouTube CDN 速率不应由 `navigator.connection.downlink` 冒充。

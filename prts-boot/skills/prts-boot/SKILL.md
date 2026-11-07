---
name: prts-boot
description: 播放或配置 ZCode 版 PRTS 启动动画（明日方舟罗德岛 PRTS 终端风格的开机动画插件）。当用户说「播放PRTS启动动画」「重播开机动画」「看一遍开机动画」「配置PRTS动画」或想调整身份/主题/速度/音效/跳过方式时使用。
---

# PRTS 启动动画（prts-boot）

明日方舟罗德岛 PRTS 终端风格的会话启动动画插件。新会话启动时（SessionStart）自动全屏播放五幕开机序列：ZCode 黑幕开机 → 入侵式乱码转场 → PRTS 字标登录屏 → 神经连接验证（金球）→ ACCESS GRANTED 揭幕。

## 使用方式

通过本插件的 MCP 工具操作（无需任何命令行）：

- **重播**：调用 `prts_boot_replay`，立即全屏播放一次。
- **读配置**：`prts_boot_config`，参数 `{"action": "get"}`。
- **改配置**：`prts_boot_config`，参数 `{"action": "set", "key": "...", "value": ...}`。
- **查状态**：`prts_boot_status`，查看 Electron 运行时、安装进度、数据目录。

## 配置项（prts_boot_config 可改）

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| enabled | boolean | true | false 时会话启动不再自动播放 |
| identity | string | Doctor | 身份档案的身份名（英文会配英文欢迎语） |
| identityId | string | 0001 | 身份编号（档案卡显示；验证卡大字固定 #0） |
| accessLevel | string | 8 | 权限等级 |
| theme | light/dark | light | light 为 PRTS 白底同款 |
| speed | number | 1 | 0.35–3，越大播放越快 |
| requireInteraction | boolean | true | true 停在登录屏等确认；false 自动播完（约 10 秒） |
| allowSkip | boolean | true | 允许 Esc / SKIP ▸ 跳过 |
| sfx | boolean | true | 合成音效总开关 |
| watchZcode | boolean | true | true: 注册 Windows 启动项常驻看门，检测到 ZCode 启动即播放（停在首页不进会话也有动画）；false 自动移除启动项 |

## 交互方式

- 登录确认：`Enter` / `空格` / 点击「确认登录」按钮（整卡可点）
- 跳过：`Esc` 或右上 `SKIP ▸`（allowSkip 开启时）
- 登录屏 55 秒无操作自动放行；窗口最长存活 90 秒

## 注意事项

- 数据与日志在 `~/.zcode/prts-boot/`（config.json / autostart.log / runtime-status.json）
- Electron 运行时优先复用狐娘挂件（`~/.zcode/whale/desktop-runtime`）的已装运行时；缺失时后台经 npmmirror 静默安装，下个会话生效
- 非官方明日方舟同人致敬作品，素材全部原创，仅供本机学习自用

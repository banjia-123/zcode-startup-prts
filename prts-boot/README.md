# prts-boot · PRTS 启动动画（ZCode 版）

灵感来自 B站视频《基于明日方舟PRTS的DSH启动动画》（UP主：橙染色）及其对应项目
[dsh-startup-rhodes](https://github.com/Moonmick/dsh-startup-rhodes)——一个为 ZCode
仿制的罗德岛 PRTS 终端风格会话启动动画插件。

新会话启动时全屏播放五幕开机序列，播完自动关闭、绝不阻塞会话：

1. **黑幕开机** — ZCode 徽记（方括号 + 几何 Z）淡入 + `ZCODE // BOOT SEQUENCE` + 低频上滑音
2. **入侵式转场** — 过曝洗白 + 1 秒绿色乱码撕裂（整屏震动、反色闪帧），屏幕中央浮现红色签名 `Welcome back, Doctor.`
3. **PRTS 字标登录屏** — 白底同款排版（粗黑线 / PRTS / 细线 / SYNTHESIZE INFORMATION / ANALYSIS OS / PLEASE LOGIN）+ 身份档案卡
4. **神经连接验证** — 黑舞台金色测地线框球（Canvas 实时 3D）+ 中央 `#0` 身份卡 + 两侧金色进度线 + 五步验证文案 + hex 码流
5. **揭幕** — `ACCESS GRANTED`（Arial Black 金字）+ `Welcome back, Doctor` + 完成琶音 → 机位后撤

## 安装（本地市场方式，自包含说明）

1. 获取插件文件（两种方式任选）：
   - **Git 仓库**：打开仓库页面 → Code → **Download ZIP** → 解压
   - **压缩包**：解压收到的压缩包
   解压后得到一层目录，里面有 `prts-boot/` 文件夹和 `marketplace.json`
2. 打开 ZCode → **插件市场 → 添加 → 添加插件市场** → 选择这一层目录（包含
   `prts-boot` 与 `marketplace.json` 的那层）
3. 在市场列表中找到 **PRTS Boot** → **安装**
4. **完全重启 ZCode**（托盘也退出）

首次使用说明：全屏动画依赖一个 Electron 运行时。若你的机器上没有现成的（例如未安装
狐娘挂件），插件会在后台经 npmmirror 静默下载（约 300MB）——当次会话不播，下次启动生效；
也可通过 MCP 工具 `prts_boot_status` 查看安装进度。

## 使用

- 新会话启动时自动播放（可关）；说「重播PRTS启动动画」可随时再看
- 登录确认：`Enter` / `空格` / 点击「确认登录」；跳过：`Esc` / `SKIP ▸`
- 配置：对话中说「配置PRTS动画」即可（MCP 工具 `prts_boot_config`），或直接改
  `~/.zcode/prts-boot/config.json`

### 配置项

| key | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `identity` | `"Doctor"` | 身份名 |
| `identityId` | `"0001"` | 编号 |
| `accessLevel` | `"8"` | 权限等级 |
| `theme` | `"light"` | `light` 白底同款 / `dark` 深色 |
| `speed` | `1` | 0.35–3，越大越快 |
| `requireInteraction` | `true` | 停在登录屏等确认；`false` 自动播完 |
| `allowSkip` | `true` | 允许跳过 |
| `sfx` | `true` | 合成音效 |
| `watchZcode` | `true` | **ZCode 启动播放**：注册 Windows 启动项（`Startup\prts-boot-watch.vbs`）常驻轻量看门进程，检测到 ZCode 启动即播放——停在首页不进会话也有动画；`false` 自动移除启动项并停止看门 |

## 技术要点

- **SessionStart hook**（`matcher: "startup"`）静默秒退，detached 拉起 Electron 后立即退出 0
- **Electron 运行时外置**：优先复用本机已有运行时（如狐娘挂件的 `~/.zcode/whale/desktop-runtime`），
  缺失时后台经 npmmirror 静默安装到 `~/.zcode/prts-boot/desktop-runtime`
- **零素材依赖**：徽记为原创 SVG、音效全部 WebAudio 程序合成、球体为 Canvas 实时渲染、
  字体全系统栈
- **MCP 工具**：`prts_boot_replay` / `prts_boot_config` / `prts_boot_status`

## 版权与免责声明

本项目为**非官方明日方舟同人致敬作品**，与鹰角网络 / Hypergryph 及 ZCode 官方均无关联。
代码与文案以 MIT 发布；所有视觉元素（徽记、排版）与音效均为本项目原创或程序合成，
不包含明日方舟游戏素材，不覆盖原版 dsh-startup-rhodes 的受限素材。仅供本机学习自用，**请勿商用**。

// SessionStart hook 入口（prts-boot）。
// 铁律（来自狐娘挂件 zcode-fox-widget 的工程经验）：
//   - hook 一律内联执行 → 本脚本必须秒退；
//   - stdout 会被严格校验 → 全程静默，日志写文件；
//   - 任何异常都 catch 住退出 0，绝不阻塞会话。
//   - 真正干活：detached spawn Electron 后 unref，动画窗口自生自灭。
// 另：顺带管理「ZCode 启动播放」看门（写 Startup 项 / 确保进程在跑）。
import fs from 'node:fs'
import path from 'node:path'
import { BOOT_COOLDOWN_MS, lastBootAt, spawnAnimation } from './boot-core.mjs'
import { dataDir, readConfig } from './config.mjs'
import { ensureWatchdogSetup } from './watchdog-setup.mjs'

function log(line) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.appendFileSync(path.join(dataDir(), 'autostart.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // 日志失败无所谓
  }
}

function main() {
  const config = readConfig()
  if (config.enabled === false) {
    log('disabled by config, skip')
    // 总开关关闭时连看门一起收掉，保持行为一致
    try {
      ensureWatchdogSetup(false)
    } catch {}
    return
  }
  if (Date.now() - lastBootAt() < BOOT_COOLDOWN_MS) {
    log('cooldown (played recently), skip')
    return
  }

  const r = spawnAnimation()
  log('session-start spawn: ' + JSON.stringify(r))

  // 「ZCode 启动播放」看门：写 Startup 项并确保进程在跑（开销极小）
  try {
    const wd = ensureWatchdogSetup(config.watchZcode !== false)
    log('watchdog: ' + JSON.stringify(wd))
  } catch (err) {
    log('watchdog setup failed: ' + String(err && err.message))
  }
}

try {
  main()
} catch (err) {
  try {
    log('fatal: ' + String(err && err.message))
  } catch {
    // 彻底放弃
  }
}
process.exit(0)

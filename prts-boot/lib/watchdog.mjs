// ZCode 启动看门进程（常驻、静默、零窗口）：
//   每 500ms 探测 ZCode 主进程，检测到「从无到有」（冷启动/完全退出后重开）即播放一次。
//   v0.5.7：仅监听进程边沿——最小化/还原、托盘唤醒不触发（窗口级检测无法可靠区分，
//   已整体移除，附带收益：轮询只剩轻量 tasklist，不再跑 PowerShell 窗口查询）。
//   - 单实例锁（PID 活性检测，兼容强杀残锁）
//   - 2 分钟冷却（与 SessionStart hook 共享 last-boot.lock，防连播）
//   - 卸载自检：源目录消失（source-marker）→ 自动删除 Startup 项并退出
// 由 Startup 项（vbs 静默拉起）拉起；会话 hook 也会尝试补拉。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, readConfig } from './config.mjs'
import { BOOT_COOLDOWN_MS, lastBootAt, spawnAnimation } from './boot-core.mjs'
import { startupVbsPath } from './watchdog-setup.mjs'

const WATCHDOG_LOG = path.join(dataDir(), 'watchdog.log')
const LOCK_FILE = path.join(dataDir(), 'watchdog.lock')
const POLL_MS = 500 // 进程边沿要快：ZCode 冷启动只有 2-4s 窗口期，慢了动画就盖不住
const SELFCHECK_MS = 10 * 60_000

function log(line) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.appendFileSync(WATCHDOG_LOG, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // 日志失败无所谓
  }
}

// ---------- 单实例 ----------
function anotherWatchdogAlive() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false
    process.kill(pid, 0) // 只探活
    return true
  } catch (err) {
    if (err && err.code === 'EPERM') return true // 存在但无权探
    return false
  }
}

// ---------- ZCode 进程探测（tasklist，快速轻量） ----------
function zcodeProcessRunning() {
  try {
    const out = execSync('tasklist /fi "imagename eq ZCode.exe" /fo csv /nh', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
    return /ZCode\.exe/i.test(out)
  } catch {
    return false
  }
}

// ---------- 播放决策（冷却 / 总开关 统一在此） ----------
function tryPlay(reason, handshake = false) {
  if (readConfig().enabled === false) {
    log(`${reason}, disabled by config, skip`)
    return
  }
  const gap = Date.now() - lastBootAt()
  if (gap < BOOT_COOLDOWN_MS) {
    log(`${reason}, cooldown (${Math.round(gap / 1000)}s), skip`)
    return
  }
  const r = spawnAnimation({ handshake })
  log(`${reason}${handshake ? ' [handshake]' : ''} -> play: ${JSON.stringify(r)}`)
}

// ---------- 主流程 ----------
if (anotherWatchdogAlive()) {
  process.exit(0)
}
if (readConfig().enabled === false) {
  log('disabled by config, watchdog idle')
}
try {
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(LOCK_FILE, String(process.pid))
} catch {
  log('failed to write lock, exit')
  process.exit(0)
}

log(`watchdog started (pid ${process.pid})`)

let wasProcess = zcodeProcessRunning()
log(`initial state: process = ${wasProcess}`)

// 已在运行（如登录后看门先于 ZCode 起且 ZCode 秒开错过边沿）：不补播，等下次边沿
setInterval(() => {
  const proc = zcodeProcessRunning()
  if (proc && !wasProcess) {
    if (readConfig().coverBoot === true) {
      // 冷启动：进程诞生即播（握手揭幕），动画盖住 ZCode 白屏/加载期
      tryPlay('cold-start (process edge)', true)
    } else {
      log('cold-start (process edge), coverBoot off, skip')
    }
  }
  wasProcess = proc
}, POLL_MS)

// 卸载自检：源目录消失（source-marker 记录的插件目录被删）→ 清理 Startup 项与锁并退出
setInterval(() => {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dataDir(), 'source-marker.json'), 'utf8'))
    if (marker && marker.source && !fs.existsSync(marker.source)) {
      log(`source gone (${marker.source}), cleaning up`)
      try {
        fs.rmSync(startupVbsPath(), { force: true })
      } catch {}
      try {
        fs.rmSync(LOCK_FILE, { force: true })
      } catch {}
      process.exit(0)
    }
  } catch {
    // marker 缺失/损坏 → 不动作（保留看门）
  }
}, SELFCHECK_MS)

// 优雅退出：进程被杀时清锁
process.on('exit', () => {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    if (pid === process.pid) fs.rmSync(LOCK_FILE, { force: true })
  } catch {}
})

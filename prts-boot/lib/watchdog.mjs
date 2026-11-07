// ZCode 启动看门进程（常驻、静默、零窗口）：
//   每 2.5s 探测 ZCode 主进程，检测到「从无到有」即播放一次开机动画。
//   - 单实例锁（PID 活性检测）
//   - 2 分钟冷却（与 SessionStart hook 共享 last-boot.lock，防连播）
//   - 卸载自检：插件目录被删（缓存清除）→ 自动删除 Startup 项并退出
// 由 Startup 项（vbs 静默）或 autostart hook 拉起。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, readConfig } from './config.mjs'
import { BOOT_COOLDOWN_MS, lastBootAt, spawnAnimation } from './boot-core.mjs'
import { startupVbsPath } from './watchdog-setup.mjs'

const WATCHDOG_LOG = path.join(dataDir(), 'watchdog.log')
const LOCK_FILE = path.join(dataDir(), 'watchdog.lock')
const POLL_MS = 500 // 进程边沿要快：ZCode 冷启动只有 2-4s 窗口期，慢了动画就盖不住
const WIN_CHECK_INTERVAL_MS = 1500 // powershell 窗口查询较慢，加缓存避免拖慢轮询
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

// ---------- ZCode 进程探测（tasklist，快速） ----------
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

// ---------- ZCode 窗口探测 ----------
// 检测「有主窗口的 ZCode 进程」而非进程本身：ZCode 关闭到托盘时进程常驻，
// 只按进程检测会永远等不到边沿；MainWindowHandle ≠ 0 才算界面真的出现了。
function zcodeWindowVisible() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "@(Get-Process -Name ZCode -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count"',
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    )
    return parseInt(String(out).trim(), 10) > 0
  } catch {
    return false
  }
}

// 窗口检测缓存策略：只对「可见=true」复用（窗口消失检测有 1.5s 容忍，无感知）；
// 「出现」方向必须实时查——托盘唤醒场景动画要尽快覆盖，缓存会把延迟拖到 2s。
let winCache = { at: 0, value: false }
function zcodeWindowVisibleCached() {
  if (winCache.value === true && Date.now() - winCache.at < WIN_CHECK_INTERVAL_MS) return true
  const v = zcodeWindowVisible()
  winCache = { at: Date.now(), value: v }
  return v
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

// 双状态机：进程边沿（冷启动，覆盖白屏期）+ 窗口边沿（托盘唤醒/窗口出现）
let wasProcess = zcodeProcessRunning()
let wasWindow = wasProcess ? zcodeWindowVisible() : false
if (wasProcess) winCache = { at: Date.now(), value: wasWindow }
let lastProcEdgeAt = 0 // 进程边沿时刻（竞速测量用）
log(`initial state: process = ${wasProcess}, window = ${wasWindow}`)

// 已在运行（如登录后看门先于 ZCode 起且 ZCode 秒开错过边沿）：不补播，等下次边沿
setInterval(() => {
  const proc = zcodeProcessRunning()
  const win = proc ? zcodeWindowVisibleCached() : false // 进程都不在就不用慢查窗口
  const procEdge = proc && !wasProcess
  const winEdge = win && !wasWindow
  const coverBoot = readConfig().coverBoot === true

  if (winEdge && lastProcEdgeAt > 0) {
    log(`timing: zcode window appeared ${Date.now() - lastProcEdgeAt}ms after process edge`)
  }
  if (procEdge) {
    lastProcEdgeAt = Date.now()
  }
  if (procEdge) {
    if (coverBoot) {
      // 冷启动：进程诞生即播，动画盖住 ZCode 白屏/加载期；握手揭幕等 ZCode 就绪
      tryPlay('cold-start (process edge)', true)
    } else {
      log('cold-start (process edge), coverBoot off, wait for window edge')
    }
  }
  if (winEdge) {
    if (coverBoot) {
      // 稳定性复查：2s 后窗口仍在才算真启动（过滤 ZCode 退出流程的瞬时窗口重建）
      // 冷启动场景由进程边沿立即播（此处复查后会被冷却自然挡住），此处主要服务托盘唤醒
      setTimeout(() => {
        if (!zcodeWindowVisibleCached()) {
          log('window appeared then vanished within 2s (exit transient), skip')
          return
        }
        tryPlay('window edge (coverBoot, stable)', true)
      }, 2000)
    } else {
      // 0.3.x 兼容行为：窗口出现后延迟 2s 播（等窗口就位）
      setTimeout(() => {
        if (!zcodeWindowVisible()) {
          log('zcode window appeared then vanished within 2s, skip')
          return
        }
        tryPlay('window edge (2s delay)')
      }, 2000)
    }
  }
  wasProcess = proc
  wasWindow = win
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

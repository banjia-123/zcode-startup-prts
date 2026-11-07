// ZCode 启动看门的安装器：管理 Windows 启动文件夹里的静默启动项（vbs）。
// watchZcode=true → 同步运行时到数据目录、写 vbs 并确保看门在跑；false → 删 vbs 并停掉看门。
// CLI：node watchdog-setup.mjs on|off|status
//
// 编码铁律：vbs/bat 按 ANSI(GBK) 解析，中文路径（如 D:\zcode工作区）会乱码成"找不到指定的路径"。
// 因此：① 看门运行时复制到数据目录 ~/.zcode/prts-boot/（纯英文路径）后再写 vbs；
//      ② vbs 以 UTF-16LE + BOM 写出（WSH 原生支持），彻底免疫代码页。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dataDir } from './config.mjs'
import { pluginRoot } from './boot-core.mjs'

const PLUGIN_ROOT = pluginRoot()
const HOME_COPY_DIR = dataDir() // ~/.zcode/prts-boot —— 纯 ASCII 路径
const LOCK_FILE = path.join(HOME_COPY_DIR, 'watchdog.lock')
const MARKER_FILE = path.join(HOME_COPY_DIR, 'source-marker.json')

// 看门运行所需的最小文件集（副本自洽：boot-core 的 DESKTOP_DIR 指向副本位置的 desktop/）
const SYNC_FILES = [
  'lib/boot-core.mjs',
  'lib/config.mjs',
  'lib/runtime.mjs',
  'lib/watchdog-setup.mjs',
  'lib/watchdog.mjs',
  'desktop/package.json',
  'desktop/main.cjs',
  'desktop/preload.cjs',
  'desktop/renderer/index.html',
  'desktop/renderer/splash.css',
  'desktop/renderer/splash.js',
]

export function startupDir() {
  return path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  )
}

export function startupVbsPath() {
  return path.join(startupDir(), 'prts-boot-watch.vbs')
}

// 数据目录的看门副本路径（vbs 指向这里，全 ASCII）。
// 副本保持 lib/ 目录结构（watchdog.mjs 的相对 import './config.mjs' 等在同目录成立）。
export function homeWatchdogScript() {
  return path.join(HOME_COPY_DIR, 'lib', 'watchdog.mjs')
}

function syncRuntimeFiles() {
  for (const rel of SYNC_FILES) {
    const src = path.join(PLUGIN_ROOT, rel)
    const dst = path.join(HOME_COPY_DIR, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  try {
    // marker：记录源目录，卸载自检用（副本看门发现源目录消失即自清）
    fs.writeFileSync(
      MARKER_FILE,
      JSON.stringify({ source: PLUGIN_ROOT, syncedAt: Date.now() }, null, 2),
      'utf8',
    )
  } catch {}
}

export function watchdogRunning() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    if (!Number.isFinite(pid) || pid <= 0) return false
    process.kill(pid, 0) // 只探活
    return true
  } catch (err) {
    if (err && err.code === 'EPERM') return true // 存在但无权探
    return false
  }
}

function stopWatchdog() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim())
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
      execSync('taskkill /pid ' + pid + ' /f', { windowsHide: true, timeout: 5000 })
    }
  } catch {
    // 锁不存在 = 没在跑
  }
  try {
    fs.rmSync(LOCK_FILE, { force: true })
  } catch {}
}

export function ensureWatchdogSetup(enabled) {
  const vbs = startupVbsPath()
  if (!enabled) {
    let removed = false
    if (fs.existsSync(vbs)) {
      try {
        fs.rmSync(vbs, { force: true })
        removed = true
      } catch {}
    }
    stopWatchdog()
    return { ok: true, action: removed ? 'removed' : 'absent' }
  }
  try {
    // 1) 同步运行时到数据目录（每次都刷，保证副本跟随插件更新）
    syncRuntimeFiles()
    // 2) 写 vbs（UTF-16LE + BOM，路径全 ASCII）
    const script = homeWatchdogScript()
    const vbsContent =
      'Set sh = CreateObject("Wscript.Shell")\r\n' +
      `sh.Run """${process.execPath}"" ""${script}""", 0, False\r\n`
    fs.mkdirSync(startupDir(), { recursive: true })
    fs.writeFileSync(vbs, Buffer.from('\ufeff' + vbsContent, 'utf16le'))
  } catch (err) {
    return { ok: false, message: '安装 Startup 项失败：' + String(err && err.message) }
  }
  // 3) 立即拉起（若未在跑）；在 ZCode 进程树内 spawn 可能被宿主回收，
  //    失败也无妨——Startup 项会在下次登录时拉起。
  if (!watchdogRunning()) {
    try {
      const child = spawn(process.execPath, [homeWatchdogScript()], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => {})
      child.unref()
    } catch {
      // 拉起失败等下次登录
    }
  }
  return { ok: true, action: 'installed', vbs: startupVbsPath(), home: HOME_COPY_DIR }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  const arg = process.argv[2]
  if (arg === 'on' || arg === 'off') {
    console.log(JSON.stringify(ensureWatchdogSetup(arg === 'on')))
  } else {
    console.log(
      JSON.stringify({
        running: watchdogRunning(),
        vbs: fs.existsSync(startupVbsPath()),
        home: HOME_COPY_DIR,
      }),
    )
  }
}

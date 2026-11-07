// 公共播放核心：autostart（SessionStart hook）/ replay（MCP）/ watchdog（ZCode 启动看门）共用。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './config.mjs'
import { findElectron } from './runtime.mjs'

function diagLog(line) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.appendFileSync(path.join(dataDir(), 'spawn.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // 日志失败无所谓
  }
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP_DIR = path.join(PLUGIN_ROOT, 'desktop')

export function pluginRoot() {
  return PLUGIN_ROOT
}

export function markBoot() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(path.join(dataDir(), 'last-boot.lock'), String(Date.now()))
  } catch {
    // 尽力而为
  }
}

export function lastBootAt() {
  try {
    return Number(fs.readFileSync(path.join(dataDir(), 'last-boot.lock'), 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

// 冷却：ZCode 启动（看门）与进入会话（hook）可能先后触发，2 分钟内只播一次；
// 手动重播（replay）走 force 绕过。
export const BOOT_COOLDOWN_MS = 120_000

export function spawnAnimation({ force = false, minGapMs = BOOT_COOLDOWN_MS, handshake = false } = {}) {
  if (!force && Date.now() - lastBootAt() < minGapMs) {
    return { ok: false, debounced: true, message: '冷却中（2 分钟内已播放过）' }
  }
  const electron = findElectron()
  if (!electron) {
    return { ok: false, message: '未找到 Electron 运行时' }
  }
  const profileDir = path.join(dataDir(), 'electron-profile')
  try {
    fs.mkdirSync(profileDir, { recursive: true })
  } catch {
    // 已存在
  }
  // fox-widget 教训：清掉 ELECTRON_RUN_AS_NODE / NODE_OPTIONS
  const env = { ...process.env, PRTS_DATA_DIR: dataDir() }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  try {
    const args = ['--user-data-dir=' + profileDir]
    if (handshake) args.push('--prts-handshake') // M2：等 ZCode 就绪再揭幕
    args.push(DESKTOP_DIR)
    const child = spawn(electron, args, { detached: true, stdio: 'ignore', windowsHide: false, env })
    child.on('error', () => {})
    child.unref()
    markBoot()
    // 3 秒探活：spawn 成功不代表窗口真出现（Electron 可能瞬间崩，如单实例锁失败/环境异常）
    const pid = child.pid
    setTimeout(() => {
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      diagLog(
        alive
          ? `animation alive after 3s (pid ${pid}, electron ${electron})`
          : `animation DIED within 3s (pid ${pid}, electron ${electron})`,
      )
    }, 3000)
    return { ok: true, electron, pid, message: '动画窗口已启动（已有窗口在播放则触发重播）' }
  } catch (err) {
    diagLog('spawn threw: ' + String(err && err.message))
    return { ok: false, message: '启动失败：' + String(err && err.message) }
  }
}

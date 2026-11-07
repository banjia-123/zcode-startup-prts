// Electron 运行时探测与后台安装。
// 探测顺序：自有数据目录 → 狐娘挂件 whale 数据目录 → PATH 中的 electron.exe。
// 全部缺失时可后台静默安装（npmmirror 镜像），绝不阻塞调用方（hook 链路）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './config.mjs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL_SCRIPT = path.join(PLUGIN_ROOT, 'lib', 'install-runtime.mjs')

const OWN_RUNTIME = path.join(dataDir(), 'desktop-runtime')
const WHALE_RUNTIME = path.join(
  process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode'),
  'whale',
  'desktop-runtime',
)

function runtimeStatusFile() {
  return path.join(dataDir(), 'runtime-status.json')
}

function distComplete(distDir) {
  // 哨兵文件（fox-widget 同款判断）：只认二进制齐全的运行时
  return (
    fs.existsSync(path.join(distDir, 'icudtl.dat')) ||
    fs.existsSync(path.join(distDir, 'v8_context_snapshot.bin'))
  )
}

export function findElectron() {
  const candidates = [
    path.join(OWN_RUNTIME, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(WHALE_RUNTIME, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ]
  for (const exe of candidates) {
    if (fs.existsSync(exe) && distComplete(path.dirname(exe))) return exe
  }
  // PATH 兜底：只认 exe（.cmd/.bat 需要 shell 包装，不值得为它复杂化）
  const pathVar = process.env.PATH || ''
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue
    const exe = path.join(dir, 'electron.exe')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

export function installStatus() {
  try {
    return JSON.parse(fs.readFileSync(runtimeStatusFile(), 'utf8'))
  } catch {
    return { state: 'absent' }
  }
}

function writeStatus(status) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(runtimeStatusFile(), JSON.stringify(status, null, 2), 'utf8')
  } catch {
    // 状态文件写不进去不影响主流程
  }
}

// 后台静默安装：detached 起独立 node 进程跑 install-runtime.mjs，立即返回。
// 30 分钟内有进行中的安装则不重复启动。
export function startBackgroundInstall() {
  const st = installStatus()
  if (
    st.state === 'installing' &&
    typeof st.startedAt === 'number' &&
    Date.now() - st.startedAt < 30 * 60_000
  ) {
    return false
  }
  const nodeBin = process.execPath
  try {
    writeStatus({ state: 'installing', startedAt: Date.now(), source: 'npmmirror' })
    const child = spawn(
      nodeBin,
      [INSTALL_SCRIPT, '--runtime-dir', OWN_RUNTIME],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: process.env,
      },
    )
    child.on('error', () => writeStatus({ state: 'failed', error: 'spawn failed', at: Date.now() }))
    child.unref()
    return true
  } catch (err) {
    writeStatus({ state: 'failed', error: String(err && err.message), at: Date.now() })
    return false
  }
}

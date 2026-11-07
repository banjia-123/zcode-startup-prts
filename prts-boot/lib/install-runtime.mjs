// Electron 运行时安装器：由 runtime.mjs detached 调起，独立进程执行，全程静默。
// 步骤：npm 安装 electron 包 → 手动跑 electron/install.js 下载二进制（npmmirror 镜像）
// → 哨兵文件校验 → 写 runtime-status.json。
// 用法：node install-runtime.mjs --runtime-dir <dir>
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REGISTRY = 'https://registry.npmmirror.com'
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
const ELECTRON_SPEC = 'electron@^44.3.0' // 与狐娘挂件 whale 运行时同版本线，本机已验证可用

function parseArg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

function statusFile(runtimeDir) {
  return path.join(path.dirname(runtimeDir), 'runtime-status.json')
}

function writeStatus(runtimeDir, status) {
  try {
    fs.mkdirSync(path.dirname(statusFile(runtimeDir)), { recursive: true })
    fs.writeFileSync(statusFile(runtimeDir), JSON.stringify(status, null, 2), 'utf8')
  } catch {
    // 尽力而为
  }
}

const runtimeDir = parseArg('--runtime-dir')
if (!runtimeDir) {
  process.exit(1)
}

const env = {
  ...process.env,
  ELECTRON_MIRROR,
  npm_config_registry: REGISTRY,
}

function fail(error) {
  writeStatus(runtimeDir, { state: 'failed', error: String(error), at: Date.now() })
  process.exit(1)
}

try {
  fs.mkdirSync(runtimeDir, { recursive: true })
  writeStatus(runtimeDir, { state: 'installing', step: 'npm-install', startedAt: Date.now() })

  execSync(`npm install ${ELECTRON_SPEC} --registry ${REGISTRY} --no-audit --no-fund`, {
    cwd: runtimeDir,
    env,
    stdio: 'ignore',
    shell: true,
    timeout: 20 * 60_000,
  })

  writeStatus(runtimeDir, { state: 'installing', step: 'fetch-binary', startedAt: Date.now() })
  execSync('node node_modules/electron/install.js', {
    cwd: runtimeDir,
    env,
    stdio: 'ignore',
    timeout: 20 * 60_000,
  })

  const exe = path.join(runtimeDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  const ok =
    fs.existsSync(exe) &&
    (fs.existsSync(path.join(path.dirname(exe), 'icudtl.dat')) ||
      fs.existsSync(path.join(path.dirname(exe), 'v8_context_snapshot.bin')))
  if (!ok) fail('sentinel missing after install')

  writeStatus(runtimeDir, { state: 'done', exe, at: Date.now() })
  process.exit(0)
} catch (err) {
  fail(err && err.message)
}

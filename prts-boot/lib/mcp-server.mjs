// prts-boot MCP server（stdio，零依赖手写 JSON-RPC 2.0）。
// 工具：prts_boot_replay（重播）/ prts_boot_config（读改配置）/ prts_boot_status（运行时与状态）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, readConfig, writeConfig } from './config.mjs'
import { findElectron, installStatus } from './runtime.mjs'
import { replay } from './replay.mjs'
import { startupVbsPath, watchdogRunning } from './watchdog-setup.mjs'
import fs from 'node:fs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL_VERSION = '2024-11-05'

const CONFIG_KEYS = {
  enabled: 'boolean',
  identity: 'string',
  identityId: 'string',
  accessLevel: 'string',
  theme: 'string',
  speed: 'number',
  requireInteraction: 'boolean',
  allowSkip: 'boolean',
  sfx: 'boolean',
  watchZcode: 'boolean',
  coverBoot: 'boolean',
}

function coerce(key, value) {
  const t = CONFIG_KEYS[key]
  if (!t) {
    return { error: `未知配置项：${key}（可用：${Object.keys(CONFIG_KEYS).join(', ')}）` }
  }
  if (t === 'boolean') {
    if (typeof value === 'boolean') return { value }
    if (value === 'true') return { value: true }
    if (value === 'false') return { value: false }
    return { error: `${key} 需要布尔值（true/false）` }
  }
  if (t === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n)) return { error: 'speed 需要数字（0.35–3，越大越快）' }
    return { value: Math.min(3, Math.max(0.35, n)) }
  }
  if (key === 'theme' && value !== 'light' && value !== 'dark') {
    return { error: "theme 只支持 'light'（PRTS 白底同款）或 'dark'" }
  }
  return { value: String(value) }
}

const TOOLS = [
  {
    name: 'prts_boot_replay',
    description:
      '立即全屏播放一次 PRTS 启动动画（ZCode 版明日方舟罗德岛 PRTS 终端风格开机动画）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'prts_boot_config',
    description:
      '读取或修改启动动画配置。可配置项：enabled（总开关）、identity（身份名）、identityId（编号）、accessLevel（权限等级）、theme（light=白底同款/dark）、speed（0.35–3，越大越快）、requireInteraction（true=停在登录屏等确认）、allowSkip（允许 Esc/SKIP 跳过）、sfx（合成音效）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: 'get=读取全部配置；set=修改单项' },
        key: { type: 'string', enum: Object.keys(CONFIG_KEYS), description: 'set 时必填' },
        value: { type: ['string', 'number', 'boolean'], description: 'set 时必填' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'prts_boot_status',
    description: '查看 prts-boot 插件状态：Electron 运行时路径、后台安装进度、当前配置、数据目录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] }
}

function callTool(name, args) {
  if (name === 'prts_boot_replay') {
    return textResult(replay())
  }
  if (name === 'prts_boot_config') {
    const action = args && args.action
    if (action === 'get') {
      return textResult({ config: readConfig(), configFile: path.join(dataDir(), 'config.json') })
    }
    if (action === 'set') {
      const key = args && args.key
      const c = coerce(key, args && args.value)
      if (c.error) {
        return { isError: true, ...textResult(c.error) }
      }
      const next = writeConfig({ [key]: c.value })
      return textResult({ ok: true, key, value: next[key] })
    }
    return { isError: true, ...textResult("action 需为 'get' 或 'set'") }
  }
  if (name === 'prts_boot_status') {
    return textResult({
      electron: findElectron(),
      install: installStatus(),
      config: readConfig(),
      dataDir: dataDir(),
      logFile: path.join(dataDir(), 'autostart.log'),
      watchdog: {
        running: watchdogRunning(),
        startupItem: fs.existsSync(startupVbsPath()),
        vbs: startupVbsPath(),
      },
    })
  }
  return { isError: true, ...textResult(`未知工具：${name}`) }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue // 非 JSON 行忽略
    }
    handleMessage(msg)
  }
})
process.stdin.on('end', () => process.exit(0))

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function handleMessage(msg) {
  const { id, method, params } = msg || {}
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'prts-boot', version: '0.2.0' },
      },
    })
    return
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) {
    return // 通知无需响应
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    try {
      send({ jsonrpc: '2.0', id, result: callTool(params && params.name, (params && params.arguments) || {}) })
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: String(err && err.message) }] },
      })
    }
    return
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } })
  }
}

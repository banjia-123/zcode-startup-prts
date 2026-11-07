// 手动重播入口：MCP 工具与命令行共用（node replay.mjs 直跑）。
// force 绕过 2 分钟冷却（用户主动要求重播）；防叠加由 Electron 单实例锁处理。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnAnimation } from './boot-core.mjs'

export function replay() {
  return spawnAnimation({ force: true })
}

// CLI 直跑
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  console.log(JSON.stringify(replay()))
}

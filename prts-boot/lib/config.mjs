// prts-boot 配置读写：~/.zcode/prts-boot/config.json
// 全部读取带兜底，任何异常都不抛出（hook 链路禁止阻塞会话）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function zcodeHome() {
  return process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode')
}

export function dataDir() {
  return path.join(zcodeHome(), 'prts-boot')
}

export function configFile() {
  return path.join(dataDir(), 'config.json')
}

export const DEFAULTS = Object.freeze({
  enabled: true, // 总开关：false 时会话启动不播
  identity: 'Doctor', // 身份档案：身份名
  identityId: '0001', // 身份档案：编号
  accessLevel: '8', // 身份档案：权限等级
  theme: 'light', // light（PRTS 同款白底） | dark
  speed: 1, // 播放速度倍率 0.35–3，越大越快
  requireInteraction: true, // true: 停在登录屏等确认; false: 自动播完
  allowSkip: true, // 是否显示 SKIP ▸ 并允许 Esc 跳过
  sfx: true, // 合成音效
  watchZcode: true, // true: Windows 启动项常驻看门，检测到 ZCode 启动即播放（不依赖进入会话）
  coverBoot: false, // M1/M2 预留：true 时启用「覆盖 ZCode 开机动画」（双边沿提前播放 + 握手揭幕）；false 行为与 0.3.1 一致
})

export function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...DEFAULTS, ...raw }
    }
  } catch {
    // 无配置文件或损坏 → 全默认
  }
  return { ...DEFAULTS }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...(patch && typeof patch === 'object' ? patch : {}) }
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

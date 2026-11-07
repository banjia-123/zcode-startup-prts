// prts-boot Electron 主进程：全屏 PRTS 启动动画窗口。
// 坑位开关均来自狐娘挂件 zcode-fox-widget 的实测经验（必须在 app ready 前设置）。
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const { exec } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// M2 握手：由看门在 coverBoot 场景传入，等 ZCode 主窗口就绪后再揭幕
const HANDSHAKE = process.argv.includes('--prts-handshake')

// 自动播放声音/动画不受手势限制；防被遮挡后冻结帧/节流
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const CONFIG_DEFAULTS = {
  enabled: true,
  identity: 'Doctor',
  identityId: '0001',
  accessLevel: '8',
  theme: 'light',
  speed: 1,
  requireInteraction: true,
  allowSkip: true,
  sfx: true,
  watchZcode: true,
  coverBoot: false,
}

function loadConfig() {
  const dir = process.env.PRTS_DATA_DIR
  if (dir) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...CONFIG_DEFAULTS, ...raw }
      }
    } catch {
      // 无配置文件 → 全默认
    }
  }
  return { ...CONFIG_DEFAULTS }
}

// 单实例锁：多会话同时启动不叠播；第二实例触发第一实例重播
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let win = null

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false, // 黑幕动画不需要透明窗（透明窗易冻帧），直接不透明铺满
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { handshake: HANDSHAKE ? '1' : '0' },
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    // 竞速测量：记录动画窗口显示时刻（与 watchdog.log 的进程/窗口边沿对比）
    try {
      const dir = process.env.PRTS_DATA_DIR
      if (dir) fs.appendFileSync(path.join(dir, 'window-show.log'), `${Date.now()}\n`)
    } catch {}
    // 起播信号：渲染层等到窗口真正可见后才开始五幕计时，避免幕①被吞
    win.webContents.send('prts:window-shown')
    // 握手就绪轮询在首屏显示之后才启动（不阻塞首屏，避免拖慢动画覆盖时机）
    setTimeout(startZcodeReadyWatch, 500)
  })
  win.on('closed', () => {
    win = null
  })
}

ipcMain.on('prts:finish', () => {
  app.quit()
})

ipcMain.handle('prts:get-config', () => loadConfig())

app.on('second-instance', () => {
  if (win) {
    win.webContents.reload() // 重播
  } else {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

// ---------- M2 握手：ZCode 就绪轮询 ----------
let zcodeReady = false

// 异步查询（exec 回调不阻塞主进程 event loop——execSync 会卡住首屏渲染/窗口显示）
function zcodeWindowVisibleAsync(cb) {
  exec(
    'powershell -NoProfile -Command "@(Get-Process -Name ZCode -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count"',
    { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    (err, stdout) => {
      if (err) return cb(false)
      cb(parseInt(String(stdout).trim(), 10) > 0)
    },
  )
}

// 就绪判定：ZCode 主窗口连续 3 次可见（约 1.5s 稳定）或 20s 硬超时。
// 就绪后置位并推送 'prts:zcode-ready'（渲染层 final 屏等待此信号决定揭幕时机）。
function startZcodeReadyWatch() {
  if (!HANDSHAKE || zcodeReady) return
  let streak = 0
  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (zcodeReady) {
      clearInterval(timer)
      return
    }
    zcodeWindowVisibleAsync((visible) => {
      streak = visible ? streak + 1 : 0
      if (streak >= 3 || Date.now() - startedAt > 20_000) {
        zcodeReady = true
        clearInterval(timer)
        try {
          if (win && !win.isDestroyed()) win.webContents.send('prts:zcode-ready')
        } catch {}
      }
    })
  }, 500)
}

ipcMain.handle('prts:is-zcode-ready', () => zcodeReady)

// 兜底：动画最长活 90s（P2 交互模式由渲染层 55s idle 自动放行，赶在 watchdog 之前）
setTimeout(() => {
  app.quit()
}, 90_000).unref()

// 渲染层桥：只暴露最小能力（读配置 + 结束信号），contextIsolation 开启。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('prts', {
  getConfig: () => ipcRenderer.invoke('prts:get-config'),
  finish: () => ipcRenderer.send('prts:finish'),
  // M2 握手揭幕预留：主进程在 ZCode 主窗口就绪时发送 'prts:zcode-ready'
  onZcodeReady: (cb) =>
    ipcRenderer.on('prts:zcode-ready', () => {
      try {
        if (typeof cb === 'function') cb()
      } catch {}
    }),
  // 起播信号：窗口真正可见后才开始五幕计时
  onWindowShown: (cb) =>
    ipcRenderer.on('prts:window-shown', () => {
      try {
        if (typeof cb === 'function') cb()
      } catch {}
    }),
  // M2：查询 ZCode 是否已就绪（握手模式揭幕用）
  isZcodeReady: () => ipcRenderer.invoke('prts:is-zcode-ready'),
})

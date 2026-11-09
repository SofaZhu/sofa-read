import { app, BrowserWindow, globalShortcut, ipcMain, net, powerMonitor, powerSaveBlocker, protocol, session } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerLibrary } from './library'

protocol.registerSchemesAsPrivileged([
  { scheme: 'sofa', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let window: BrowserWindow | null = null
let reading = false
let minutes = 0
let volume = false
let dimmed = false
let blocker: number | undefined
let readingSince = 0
const volumeKeys = ['VolumeDown', 'VolumeUp'] as const

function updatePower() {
  const active = !!window?.isFocused() && reading
  const idle = Math.min(powerMonitor.getSystemIdleTime(), (Date.now() - readingSince) / 1000)
  const dim = active && minutes > 0 && idle >= minutes * 60
  const keepAwake = active && !dim
  if (dimmed !== dim) {
    dimmed = dim
    window?.webContents.send('reading:dim', dim)
  }
  if (keepAwake && blocker === undefined) blocker = powerSaveBlocker.start('prevent-display-sleep')
  if (!keepAwake && blocker !== undefined) {
    powerSaveBlocker.stop(blocker)
    blocker = undefined
  }
}

function updateVolume() {
  globalShortcut.unregisterAll()
  if (!window?.isFocused() || !reading || !volume) return true
  const supported = volumeKeys.map((key, index) => {
    try {
      return globalShortcut.register(key, () => {
        if (!dimmed) window?.webContents.send('reading:turn', index ? 1 : -1)
      })
    } catch {
      return false
    }
  })
  if (supported.every(Boolean)) return true
  globalShortcut.unregisterAll()
  return false
}

function createWindow() {
  const current = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 760,
    minHeight: 540,
    title: 'Sofa Read',
    backgroundColor: '#f7f5ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window = current
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  current.webContents.on('will-navigate', event => event.preventDefault())
  current.on('focus', () => {
    readingSince = Date.now()
    updatePower()
    updateVolume()
  })
  current.on('blur', () => {
    updatePower()
    updateVolume()
  })
  current.on('closed', () => {
    reading = false
    window = null
    updatePower()
    updateVolume()
  })
  void current.loadURL(process.env.ELECTRON_RENDERER_URL ?? 'sofa://reader/index.html')
    .catch(error => console.error('无法加载阅读界面', error))
}

void app.whenReady().then(() => {
  const root = resolve(__dirname, '../renderer')
  protocol.handle('sofa', request => {
    const url = new URL(request.url)
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (url.host !== 'reader' || !file.startsWith(root + sep)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === window?.webContents && details.isMainFrame && String(permission) === 'local-fonts' &&
    (origin === 'sofa://reader' || origin === process.env.ELECTRON_RENDERER_URL))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(contents === window?.webContents && details.isMainFrame && String(permission) === 'local-fonts'))

  ipcMain.handle('reading:settings', (event, active: unknown, idle: unknown, keys: unknown) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame) return false
    const nextActive = active === true
    const nextMinutes = typeof idle === 'number' && [0, 5, 10, 30].includes(idle) ? idle : 0
    const nextVolume = keys === true
    if (reading !== nextActive || minutes !== nextMinutes) readingSince = Date.now()
    reading = nextActive
    minutes = nextMinutes
    volume = nextVolume
    updatePower()
    return updateVolume()
  })
  const poll = setInterval(updatePower, 1000)
  app.once('will-quit', () => {
    clearInterval(poll)
    globalShortcut.unregisterAll()
    if (blocker !== undefined) powerSaveBlocker.stop(blocker)
  })
  registerLibrary(() => window)
  createWindow()
  app.on('activate', () => {
    if (!window) createWindow()
  })
}).catch(error => console.error('无法启动阅读器', error))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

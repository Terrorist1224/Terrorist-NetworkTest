import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AppSnapshot, Limits, TestSettings } from '../shared/types'
import { APP_VERSION } from '../shared/version'
import { ChannelStore } from './channels'
import { RecordStore } from './record-store'
import { SettingsStore } from './settings'
import { SpeedEngine } from './speed-engine'

const workspace = resolve(process.cwd())
const dataDirectory = app.isPackaged
  ? join(dirname(app.getPath('exe')), 'data')
  : resolve(workspace, process.env.NETWORKTEST_DATA_DIR ?? '.tmp/user-data')
if (!app.isPackaged && !dataDirectory.startsWith(workspace + '\\'))
  throw new Error('Development data directory must stay inside the workspace')
const sessionDataDirectory = join(dataDirectory, 'session')
const temporaryDirectory = join(dataDirectory, 'temp')
const crashDumpsDirectory = join(dataDirectory, 'crash-dumps')
for (const directory of [dataDirectory, sessionDataDirectory, temporaryDirectory, crashDumpsDirectory]) {
  mkdirSync(directory, { recursive: true })
}
app.setPath('userData', dataDirectory)
// Chromium and native temporary files stay beside app data instead of falling back to AppData.
app.setPath('sessionData', sessionDataDirectory)
app.setPath('temp', temporaryDirectory)
app.setPath('crashDumps', crashDumpsDirectory)
process.env.TEMP = temporaryDirectory
process.env.TMP = temporaryDirectory
app.setAppUserModelId('com.terrorist.networktest')

let engine: SpeedEngine
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function sendSnapshot(snapshot: AppSnapshot): void {
  // Hidden windows have no rendering work; they fetch the full record when shown again.
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized()
  ) {
    mainWindow.webContents.send('speed:snapshot', snapshot)
  }
  updateTray(snapshot)
}

function updateTray(snapshot: AppSnapshot): void {
  if (!tray) return
  const latest = snapshot.record?.samples.at(-1)?.bytesPerSec ?? 0
  tray.setToolTip(
    snapshot.running
      ? `NetworkTest · ${(latest / 1024 / 1024).toFixed(1)} MB/s`
      : snapshot.paused
        ? 'NetworkTest · 已暂停'
        : 'NetworkTest · 待机'
  )
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: showMain },
      { label: '暂停测速', enabled: snapshot.running, click: () => engine.pause() },
      { label: '继续测速', enabled: snapshot.paused, click: () => engine.resume() },
      {
        label: '停止测速',
        enabled: snapshot.running || snapshot.paused,
        click: () => engine.stop()
      },
      { type: 'separator' },
      {
        label: '退出 NetworkTest',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function loadRenderer(window: BrowserWindow): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: `NetworkTest ${APP_VERSION}`,
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.destroy()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.on('show', () => window.webContents.send('speed:snapshot', engine.snapshot()))
  loadRenderer(window)
  return window
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function registerIpc(): void {
  ipcMain.handle('speed:snapshot', () => engine.snapshot())
  ipcMain.handle('speed:start', (_event, settings: TestSettings) => engine.start(settings))
  ipcMain.handle('speed:pause', () => engine.pause())
  ipcMain.handle('speed:resume', () => engine.resume())
  ipcMain.handle('speed:stop', () => engine.stop())
  ipcMain.handle('speed:channel', (_event, id: string) => engine.changeChannel(id))
  ipcMain.handle('speed:threads', (_event, count: number) => engine.changeThreads(count))
  ipcMain.handle('speed:limits', (_event, limits: Limits) => engine.saveLimits(limits))
  ipcMain.handle('speed:add-channel', (_event, label: string, url: string) =>
    engine.addChannel(label, url)
  )
  ipcMain.handle('speed:remove-channel', (_event, id: string) => engine.removeChannel(id))
  ipcMain.handle('speed:history', () => engine.history())
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  engine = new SpeedEngine(
    new ChannelStore(dataDirectory),
    new RecordStore(dataDirectory),
    new SettingsStore(dataDirectory),
    sendSnapshot
  )
  registerIpc()
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(workspace, 'resources', 'tray.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  tray.on('click', showMain)
  updateTray(engine.snapshot())
  showMain()
  app.on('activate', showMain)
})

app.on('before-quit', () => {
  quitting = true
  engine?.stop('quit')
})

// Closing the main window frees renderer memory while leaving the speed test and tray alive.
app.on('window-all-closed', () => {})

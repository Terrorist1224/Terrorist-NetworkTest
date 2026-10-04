import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type {
  AppSnapshot,
  ChannelHealthMap,
  ChannelSelectionMode,
  Limits,
  TestMode,
  TestSettings
} from '../shared/types'
import { APP_VERSION } from '../shared/version'
import { ChannelStore } from './channels'
import { ChannelHealthMonitor } from './channel-health'
import { resolvePackagedDataDirectory } from './data-directory'
import { RecordStore } from './record-store'
import { SettingsStore } from './settings'
import { SpeedEngine } from './speed-engine'
import { resolveSpeedtestCnChannels } from './speedtest-cn'
import { automaticChannelId } from '../shared/channel-selection'

const workspace = resolve(process.cwd())
const dataDirectory = app.isPackaged
  ? resolvePackagedDataDirectory(
      process.env.NETWORKTEST_APP_DATA_DIR ?? app.getPath('appData'),
      dirname(app.getPath('exe'))
    )
  : resolve(workspace, process.env.NETWORKTEST_DATA_DIR ?? '.tmp/user-data')
if (!app.isPackaged && !dataDirectory.startsWith(workspace + '\\'))
  throw new Error('Development data directory must stay inside the workspace')
const sessionDataDirectory = join(dataDirectory, 'session')
const temporaryDirectory = join(dataDirectory, 'temp')
const crashDumpsDirectory = join(dataDirectory, 'crash-dumps')
for (const directory of [
  dataDirectory,
  sessionDataDirectory,
  temporaryDirectory,
  crashDumpsDirectory
]) {
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
let channelHealthMonitor: ChannelHealthMonitor
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let speedtestCnRefreshTimer: ReturnType<typeof setInterval> | null = null
let lastSnapshotWasTesting = false
let speedStartInProgress = false

function synchronizeAutomaticChannel(health = channelHealthMonitor.snapshot()): AppSnapshot {
  const snapshot = engine.snapshot()
  if (speedStartInProgress) return snapshot
  const channelId = automaticChannelId(snapshot, health)
  if (channelId && channelId !== snapshot.settings.channelId)
    return engine.changeChannel(channelId, 'auto')
  return snapshot
}

function sendSnapshot(snapshot: AppSnapshot): void {
  const justFinished = lastSnapshotWasTesting && !snapshot.running && !snapshot.paused
  lastSnapshotWasTesting = snapshot.running || snapshot.paused
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
  if (justFinished) queueMicrotask(() => synchronizeAutomaticChannel())
}

function sendChannelHealth(health: ChannelHealthMap): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized()
  ) {
    mainWindow.webContents.send('channel-health:update', health)
  }
}

function updateTray(snapshot: AppSnapshot): void {
  if (!tray) return
  const download = snapshot.record?.samples.at(-1)?.bytesPerSec ?? 0
  const upload = snapshot.record?.uploadSamples.at(-1)?.bytesPerSec ?? 0
  const latest =
    snapshot.settings.mode === 'upload'
      ? upload
      : download + (snapshot.settings.mode === 'parallel' ? upload : 0)
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
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const windowWidth = Math.min(1440, workArea.width)
  const windowHeight = Math.min(900, workArea.height)
  const window = new BrowserWindow({
    title: `NetworkTest ${APP_VERSION}`,
    width: windowWidth,
    height: windowHeight,
    minWidth: Math.min(1200, windowWidth),
    minHeight: Math.min(850, windowHeight),
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
  window.on('show', () => {
    window.webContents.send('speed:snapshot', engine.snapshot())
    window.webContents.send('channel-health:update', channelHealthMonitor.snapshot())
  })
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
  ipcMain.handle('channel-health:snapshot', () => channelHealthMonitor.snapshot())
  ipcMain.handle('speed:start', async (_event, settings: TestSettings) => {
    if (speedStartInProgress) throw new Error('测速正在启动，请稍候')
    speedStartInProgress = true
    try {
      const current = engine.snapshot()
      const startSettings = {
        ...settings,
        channelSelection: settings.channelSelection ?? current.settings.channelSelection ?? 'auto'
      }
      const selected = automaticChannelId(
        { ...current, running: false, paused: false, settings: startSettings },
        channelHealthMonitor.snapshot()
      )
      if (selected) startSettings.channelId = selected
      return await engine.start(startSettings)
    } finally {
      speedStartInProgress = false
      if (!engine.snapshot().running && !engine.snapshot().paused)
        queueMicrotask(() => synchronizeAutomaticChannel())
    }
  })
  ipcMain.handle('speed:pause', () => engine.pause())
  ipcMain.handle('speed:resume', () => engine.resume())
  ipcMain.handle('speed:stop', () => engine.stop())
  ipcMain.handle('speed:channel', (_event, id: string) => engine.changeChannel(id))
  ipcMain.handle('speed:channel-selection', (_event, mode: ChannelSelectionMode) => {
    engine.setChannelSelection(mode)
    return synchronizeAutomaticChannel()
  })
  ipcMain.handle('speed:mode', (_event, mode: TestMode) => {
    engine.changeMode(mode)
    return synchronizeAutomaticChannel()
  })
  ipcMain.handle('speed:threads', (_event, count: number) => engine.changeThreads(count))
  ipcMain.handle('speed:limits', (_event, limits: Limits) => engine.saveLimits(limits))
  ipcMain.handle('speed:add-channel', async (_event, label: string, url: string) => {
    const snapshot = await engine.addChannel(label, url)
    channelHealthMonitor.setChannels(snapshot.channels)
    return snapshot
  })
  ipcMain.handle('speed:remove-channel', (_event, id: string) => {
    const snapshot = engine.removeChannel(id)
    channelHealthMonitor.setChannels(snapshot.channels)
    return snapshot
  })
  ipcMain.handle('speed:history', () => engine.history())
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  const channelStore = new ChannelStore(dataDirectory)
  engine = new SpeedEngine(
    channelStore,
    new RecordStore(dataDirectory),
    new SettingsStore(dataDirectory),
    sendSnapshot
  )
  channelHealthMonitor = new ChannelHealthMonitor(channelStore.list(), (health) => {
    synchronizeAutomaticChannel(health)
    sendChannelHealth(health)
  })
  channelHealthMonitor.start()
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

  let speedtestCnRefreshInFlight = false
  const refreshSpeedtestCnChannel = async (): Promise<void> => {
    if (speedtestCnRefreshInFlight || engine.snapshot().running || engine.snapshot().paused) return
    speedtestCnRefreshInFlight = true
    try {
      const channels = await resolveSpeedtestCnChannels()
      if (engine.replaceProviderChannels(channels)) {
        channelHealthMonitor.setChannels(engine.snapshot().channels)
      }
    } catch {
      // The app remains usable if Speedtest.cn is unavailable; no response metadata is logged.
      if (!engine.snapshot().channels.some((item) => item.provider === 'speedtest-cn')) {
        if (engine.replaceProviderChannels([])) {
          channelHealthMonitor.setChannels(engine.snapshot().channels)
        }
      }
    } finally {
      speedtestCnRefreshInFlight = false
    }
  }
  void refreshSpeedtestCnChannel()
  speedtestCnRefreshTimer = setInterval(() => void refreshSpeedtestCnChannel(), 15 * 60_000)
})

app.on('before-quit', () => {
  quitting = true
  if (speedtestCnRefreshTimer) clearInterval(speedtestCnRefreshTimer)
  speedtestCnRefreshTimer = null
  channelHealthMonitor?.stop()
  engine?.stop('quit')
})

// Closing the main window frees renderer memory while leaving the speed test and tray alive.
app.on('window-all-closed', () => {})

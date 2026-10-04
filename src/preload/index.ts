import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSnapshot,
  ChannelHealthMap,
  ChannelSelectionMode,
  DesktopApi,
  IpProbeResult,
  Limits,
  TestMode,
  TestSettings
} from '../shared/types'

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('speed:snapshot'),
  channelHealth: () => ipcRenderer.invoke('channel-health:snapshot'),
  start: (settings: TestSettings) => ipcRenderer.invoke('speed:start', settings),
  pause: () => ipcRenderer.invoke('speed:pause'),
  resume: () => ipcRenderer.invoke('speed:resume'),
  stop: () => ipcRenderer.invoke('speed:stop'),
  changeChannel: (id: string) => ipcRenderer.invoke('speed:channel', id),
  setChannelSelection: (mode: ChannelSelectionMode) =>
    ipcRenderer.invoke('speed:channel-selection', mode),
  changeMode: (mode: TestMode) => ipcRenderer.invoke('speed:mode', mode),
  changeThreads: (count: number) => ipcRenderer.invoke('speed:threads', count),
  saveLimits: (limits: Limits) => ipcRenderer.invoke('speed:limits', limits),
  addChannel: (label: string, url: string) => ipcRenderer.invoke('speed:add-channel', label, url),
  removeChannel: (id: string) => ipcRenderer.invoke('speed:remove-channel', id),
  history: () => ipcRenderer.invoke('speed:history'),
  probeIp: (): Promise<IpProbeResult> => ipcRenderer.invoke('ip-probe:lookup'),
  minimizeMain: () => ipcRenderer.invoke('window:minimize'),
  closeMain: () => ipcRenderer.invoke('window:close'),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('speed:snapshot', listener)
    return () => ipcRenderer.removeListener('speed:snapshot', listener)
  },
  onChannelHealth: (callback: (health: ChannelHealthMap) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, health: ChannelHealthMap): void =>
      callback(health)
    ipcRenderer.on('channel-health:update', listener)
    return () => ipcRenderer.removeListener('channel-health:update', listener)
  }
}

contextBridge.exposeInMainWorld('networkTest', api)

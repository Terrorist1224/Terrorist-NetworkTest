import { contextBridge, ipcRenderer } from 'electron'
import type { AppSnapshot, DesktopApi, Limits, TestSettings } from '../shared/types'

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('speed:snapshot'),
  start: (settings: TestSettings) => ipcRenderer.invoke('speed:start', settings),
  pause: () => ipcRenderer.invoke('speed:pause'),
  resume: () => ipcRenderer.invoke('speed:resume'),
  stop: () => ipcRenderer.invoke('speed:stop'),
  changeChannel: (id: string) => ipcRenderer.invoke('speed:channel', id),
  changeThreads: (count: number) => ipcRenderer.invoke('speed:threads', count),
  saveLimits: (limits: Limits) => ipcRenderer.invoke('speed:limits', limits),
  addChannel: (label: string, url: string) => ipcRenderer.invoke('speed:add-channel', label, url),
  removeChannel: (id: string) => ipcRenderer.invoke('speed:remove-channel', id),
  history: () => ipcRenderer.invoke('speed:history'),
  minimizeMain: () => ipcRenderer.invoke('window:minimize'),
  closeMain: () => ipcRenderer.invoke('window:close'),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('speed:snapshot', listener)
    return () => ipcRenderer.removeListener('speed:snapshot', listener)
  }
}

contextBridge.exposeInMainWorld('networkTest', api)

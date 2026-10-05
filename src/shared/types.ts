export type StopReason =
  'manual' | 'time-limit' | 'traffic-limit' | 'channel-error' | 'quit' | 'interrupted'
export type Region = 'domestic' | 'global' | 'custom'
export type TestMode = 'download' | 'upload' | 'parallel'
export type TrafficDirection = 'download' | 'upload'
export type ChannelSelectionMode = 'auto' | 'manual'

// “自动”线程数在后台固定使用 8 个方向任务，避免根据机器状态频繁伸缩。
export const AUTO_THREAD_COUNT = 8

export interface Channel {
  id: string
  label: string
  url: string
  uploadUrl?: string
  websocketUrl?: string
  region: Region
  custom?: boolean
  provider?: 'speedtest-cn'
  province?: string
  city?: string
  operator?: string
}

export interface Limits {
  maxDurationSec: number
  maxBytes: number
}

export interface TestSettings extends Limits {
  mode: TestMode
  channelId: string
  channelSelection?: ChannelSelectionMode
  threadCount: number
}

export type StopMode = 'unlimited' | 'traffic' | 'time'

export interface SpeedSample {
  at: number
  bytesPerSec: number
  totalBytes: number
}

export interface TestSegment {
  at: number
  channelId: string
  threadCount: number
  startBytes: number
  endAt?: number
  endBytes?: number
}

export interface TestRecord {
  id: string
  startedAt: number
  endedAt?: number
  activeDurationMs: number
  stopReason?: StopReason
  mode: TestMode
  totalBytes: number
  averageBytesPerSec: number
  peakBytesPerSec: number
  downloadBytes: number
  uploadBytes: number
  downloadAverageBytesPerSec: number
  uploadAverageBytesPerSec: number
  downloadPeakBytesPerSec: number
  uploadPeakBytesPerSec: number
  settings: TestSettings
  // `samples` remains the download series so records written by older builds stay compatible.
  samples: SpeedSample[]
  uploadSamples: SpeedSample[]
  segments: TestSegment[]
  error?: string
}

export interface IpGeoInfo {
  ip: string
  country: string | null
  countryCode: string | null
  region: string | null
  city: string | null
  continent: string | null
  asn: number | string | null
  organization: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  accuracyKm: number | null
}

export interface IpProbeResult {
  geo: IpGeoInfo
  geoQueriedAt: number
}

export interface AppSnapshot {
  running: boolean
  paused: boolean
  settings: TestSettings
  channels: Channel[]
  record: TestRecord | null
  error: string | null
}

export type ChannelHealthStatus = 'checking' | 'fast' | 'slow' | 'unavailable'

export interface ChannelHealth {
  status: ChannelHealthStatus
  latencyMs: number | null
  checkedAt: number | null
}

export type ChannelHealthMap = Record<string, ChannelHealth>

export interface DesktopApi {
  snapshot(): Promise<AppSnapshot>
  channelHealth(): Promise<ChannelHealthMap>
  start(settings: TestSettings): Promise<AppSnapshot>
  pause(): Promise<AppSnapshot>
  resume(): Promise<AppSnapshot>
  stop(): Promise<AppSnapshot>
  changeChannel(channelId: string): Promise<AppSnapshot>
  setChannelSelection(mode: ChannelSelectionMode): Promise<AppSnapshot>
  changeThreads(threadCount: number): Promise<AppSnapshot>
  saveLimits(limits: Limits): Promise<AppSnapshot>
  addChannel(label: string, url: string): Promise<AppSnapshot>
  removeChannel(id: string): Promise<AppSnapshot>
  history(): Promise<TestRecord[]>
  probeIp(): Promise<IpProbeResult>
  minimizeMain(): Promise<void>
  closeMain(): Promise<void>
  setImmersive(enabled: boolean): Promise<boolean>
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void
  onChannelHealth(callback: (health: ChannelHealthMap) => void): () => void
  changeMode(mode: TestMode): Promise<AppSnapshot>
}

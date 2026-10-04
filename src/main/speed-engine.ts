import { randomUUID } from 'node:crypto'
import { AUTO_THREAD_COUNT } from '../shared/types'
import type {
  AppSnapshot,
  ChannelSelectionMode,
  Limits,
  TestMode,
  TestRecord,
  TestSegment,
  TestSettings,
  StopReason,
  TrafficDirection
} from '../shared/types'
import { ChannelStore, DEFAULT_CHANNEL_ID, downloadUrlForChannel, probeDownload } from './channels'
import { RecordStore } from './record-store'
import { SettingsStore, validateSettings } from './settings'

type Fetcher = typeof fetch
const UPLOAD_PAYLOAD = Buffer.alloc(1024 * 1024)
const DIRECTIONS: TrafficDirection[] = ['download', 'upload']

export class SpeedEngine {
  private settings: TestSettings
  private record: TestRecord | null = null
  private running = false
  private paused = false
  private error: string | null = null
  private generation = 0
  private controllers = new Map<string, AbortController>()
  private stoppedDirections = new Set<TrafficDirection>()
  private reservedUploadBytes = 0
  private sampleTimer: ReturnType<typeof setInterval> | null = null
  private activeStartedMono = 0
  private activeDurationMs = 0
  private lastSampleMono = 0
  private lastSampleBytes: Record<TrafficDirection, number> = { download: 0, upload: 0 }
  private readonly fetcher: Fetcher

  constructor(
    private readonly channels: ChannelStore,
    private readonly records: RecordStore,
    private readonly settingsStore: SettingsStore,
    private readonly onUpdate: (snapshot: AppSnapshot) => void = () => {},
    fetcher: Fetcher = fetch
  ) {
    this.fetcher = fetcher
    this.settings = settingsStore.load()
    if (
      !channels.get(this.settings.channelId) &&
      this.settings.channelId !== 'speedtest-cn' &&
      !this.settings.channelId.startsWith('speedtest-cn:')
    ) {
      this.settings.channelId = this.fallbackChannelId(this.settings.mode)
      this.settingsStore.save(this.settings)
    }
  }

  snapshot(): AppSnapshot {
    return {
      running: this.running,
      paused: this.paused,
      settings: { ...this.settings },
      channels: this.channels.list(),
      record: this.record ? structuredClone(this.record) : null,
      error: this.error
    }
  }

  replaceProviderChannels(
    channels: Parameters<ChannelStore['replaceProviderChannels']>[0]
  ): boolean {
    if (this.running || this.paused) return false
    this.channels.replaceProviderChannels(channels)
    const selected = this.channels.get(this.settings.channelId)
    if (!selected || (this.settings.mode !== 'download' && !selected.uploadUrl)) {
      const legacyProviderSelection = this.settings.channelId === 'speedtest-cn'
      const firstProviderChannel = channels.find(
        (channel) =>
          channel.provider === 'speedtest-cn' &&
          channel.region === 'domestic' &&
          (this.settings.mode === 'download' || channel.uploadUrl)
      )
      this.settings.channelId =
        legacyProviderSelection && firstProviderChannel
          ? firstProviderChannel.id
          : this.fallbackChannelId(this.settings.mode)
      this.settingsStore.save(this.settings)
    }
    this.emit()
    return true
  }

  private emit(): void {
    this.onUpdate(this.snapshot())
  }

  async start(settings: TestSettings): Promise<AppSnapshot> {
    if (this.running || this.paused) throw new Error('当前测速尚未结束')
    const normalizedSettings: TestSettings = {
      ...settings,
      channelSelection: settings.channelSelection ?? this.settings.channelSelection ?? 'auto'
    }
    validateSettings(normalizedSettings)
    const channel = this.channels.get(normalizedSettings.channelId)
    if (!channel) throw new Error('测速通道不存在')
    if (channel.region === 'global') throw new Error('当前只支持国内节点和自定义节点')
    if (normalizedSettings.mode !== 'download' && !channel.uploadUrl)
      throw new Error('所选通道不支持上行测速')

    this.error = null
    if (normalizedSettings.mode !== 'upload') {
      try {
        await probeDownload(downloadUrlForChannel(channel), this.fetcher)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        this.emit()
        throw error
      }
    }

    this.settings = normalizedSettings
    this.settingsStore.save(this.settings)
    const at = Date.now()
    const id = randomUUID()
    this.records.create(id, at, this.settings)
    this.record = {
      id,
      startedAt: at,
      activeDurationMs: 0,
      mode: settings.mode,
      totalBytes: 0,
      averageBytesPerSec: 0,
      peakBytesPerSec: 0,
      downloadBytes: 0,
      uploadBytes: 0,
      downloadAverageBytesPerSec: 0,
      uploadAverageBytesPerSec: 0,
      downloadPeakBytesPerSec: 0,
      uploadPeakBytesPerSec: 0,
      settings: { ...this.settings },
      samples: [],
      uploadSamples: [],
      segments: []
    }
    this.running = true
    this.paused = false
    this.stoppedDirections.clear()
    this.activeDurationMs = 0
    this.activeStartedMono = performance.now()
    this.lastSampleMono = this.activeStartedMono
    this.lastSampleBytes = { download: 0, upload: 0 }
    this.addSegment(at)
    this.restartWorkers()
    this.startSampling()
    this.emit()
    return this.snapshot()
  }

  pause(): AppSnapshot {
    if (!this.running || !this.record) return this.snapshot()
    this.sample()
    this.activeDurationMs = this.activeElapsedMs()
    this.record.activeDurationMs = this.activeDurationMs
    this.updateAggregateMetrics()
    const at = Date.now()
    this.running = false
    this.paused = true
    this.generation++
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    this.sampleTimer = null
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.lastSampleMono = performance.now()
    this.lastSampleBytes = this.directionBytes()
    this.closeSegment(at)
    this.records.append(this.record.id, {
      kind: 'pause',
      at,
      activeDurationMs: this.activeDurationMs
    })
    this.emit()
    return this.snapshot()
  }

  resume(): AppSnapshot {
    if (!this.paused || !this.record) return this.snapshot()
    this.markCompletedTrafficDirections()
    if (this.allDirectionsStopped()) return this.stop('traffic-limit')
    if (
      this.settings.maxDurationSec > 0 &&
      this.activeDurationMs >= this.settings.maxDurationSec * 1000
    )
      return this.stop('time-limit')

    const at = Date.now()
    this.running = true
    this.paused = false
    this.activeStartedMono = performance.now()
    this.lastSampleMono = this.activeStartedMono
    this.lastSampleBytes = this.directionBytes()
    this.records.append(this.record.id, {
      kind: 'resume',
      at,
      activeDurationMs: this.activeDurationMs
    })
    this.addSegment(at)
    this.restartWorkers()
    this.startSampling()
    this.emit()
    return this.snapshot()
  }

  stop(reason: StopReason = 'manual', error?: string): AppSnapshot {
    if ((!this.running && !this.paused) || !this.record) return this.snapshot()
    if (this.running) this.sample()
    this.activeDurationMs = this.activeElapsedMs()
    this.record.activeDurationMs = this.activeDurationMs
    const wasRunning = this.running
    this.running = false
    this.paused = false
    this.generation++
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    this.sampleTimer = null
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    const at = Date.now()
    if (wasRunning) this.closeSegment(at)
    this.record.endedAt = at
    this.record.stopReason = reason
    this.record.error = error
    this.error = error ?? null
    this.updateAggregateMetrics()
    this.records.append(this.record.id, {
      kind: 'end',
      at,
      reason,
      totalBytes: this.record.totalBytes,
      downloadBytes: this.record.downloadBytes,
      uploadBytes: this.record.uploadBytes,
      activeDurationMs: this.activeDurationMs,
      error
    })
    this.emit()
    return this.snapshot()
  }

  changeMode(mode: TestMode): AppSnapshot {
    if (this.running || this.paused) throw new Error('请先结束当前测速，再切换测速模式')
    if (!['download', 'upload', 'parallel'].includes(mode)) throw new Error('测速模式无效')
    const next = { ...this.settings, mode }
    const channel = this.channels.get(next.channelId)
    if (mode !== 'download' && !channel?.uploadUrl) next.channelId = this.fallbackChannelId(mode)
    this.settings = next
    this.settingsStore.save(this.settings)
    this.emit()
    return this.snapshot()
  }

  changeChannel(channelId: string, selectionMode: ChannelSelectionMode = 'manual'): AppSnapshot {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error('测速通道不存在')
    if (channel.region === 'global') throw new Error('当前只支持国内节点和自定义节点')
    if (selectionMode !== 'auto' && selectionMode !== 'manual') throw new Error('节点选择模式无效')
    if (this.settings.mode !== 'download' && !channel.uploadUrl)
      throw new Error('当前测速模式只支持同时提供上下行地址的通道')
    if (this.settings.channelId === channelId && this.settings.channelSelection === selectionMode)
      return this.snapshot()
    const channelChanged = this.settings.channelId !== channelId
    this.settings = { ...this.settings, channelId, channelSelection: selectionMode }
    this.settingsStore.save(this.settings)
    if (this.running && channelChanged) {
      this.addSegment(Date.now())
      this.restartWorkers()
    }
    this.emit()
    return this.snapshot()
  }

  setChannelSelection(mode: ChannelSelectionMode): AppSnapshot {
    if (mode !== 'auto' && mode !== 'manual') throw new Error('节点选择模式无效')
    if (this.settings.channelSelection === mode) return this.snapshot()
    this.settings = { ...this.settings, channelSelection: mode }
    this.settingsStore.save(this.settings)
    this.emit()
    return this.snapshot()
  }

  changeThreads(threadCount: number): AppSnapshot {
    const next = { ...this.settings, threadCount }
    validateSettings(next)
    if (this.settings.threadCount === threadCount) return this.snapshot()
    this.settings = next
    this.settingsStore.save(this.settings)
    if (this.running) {
      this.addSegment(Date.now())
      this.restartWorkers()
    }
    this.emit()
    return this.snapshot()
  }

  saveLimits(limits: Limits): AppSnapshot {
    if (this.running) throw new Error('请先暂停测速，再修改自动停止条件')
    const next = { ...this.settings, ...limits }
    validateSettings(next)
    this.settings = next
    this.settingsStore.save(next)
    this.emit()
    return this.snapshot()
  }

  async addChannel(label: string, url: string): Promise<AppSnapshot> {
    await this.channels.add(label, url, (value) => probeDownload(value, this.fetcher))
    this.emit()
    return this.snapshot()
  }

  removeChannel(id: string): AppSnapshot {
    if ((this.running || this.paused) && this.settings.channelId === id)
      throw new Error('请先切换到其他通道')
    this.channels.remove(id)
    if (this.settings.channelId === id) {
      this.settings.channelId = DEFAULT_CHANNEL_ID
      this.settingsStore.save(this.settings)
    }
    this.emit()
    return this.snapshot()
  }

  history(): TestRecord[] {
    const active = this.running || this.paused
    return this.records.list().filter((record) => !active || record.id !== this.record?.id)
  }

  private fallbackChannelId(mode: TestMode): string {
    return (
      this.channels
        .list()
        .find(
          (channel) =>
            channel.region === 'domestic' && (mode === 'download' || Boolean(channel.uploadUrl))
        )?.id ?? DEFAULT_CHANNEL_ID
    )
  }

  private activeDirections(): TrafficDirection[] {
    if (this.settings.mode === 'download') return ['download']
    if (this.settings.mode === 'upload') return ['upload']
    return DIRECTIONS
  }

  private directionBytes(): Record<TrafficDirection, number> {
    return {
      download: this.record?.downloadBytes ?? 0,
      upload: this.record?.uploadBytes ?? 0
    }
  }

  private directionTotal(direction: TrafficDirection): number {
    return direction === 'download'
      ? (this.record?.downloadBytes ?? 0)
      : (this.record?.uploadBytes ?? 0)
  }

  private updateAggregateMetrics(): void {
    if (!this.record) return
    this.record.totalBytes = this.record.downloadBytes + this.record.uploadBytes
    const elapsedSec = Math.max(this.record.activeDurationMs / 1000, 0.001)
    this.record.averageBytesPerSec = this.record.totalBytes / elapsedSec
    this.record.downloadAverageBytesPerSec = this.record.downloadBytes / elapsedSec
    this.record.uploadAverageBytesPerSec = this.record.uploadBytes / elapsedSec
  }

  private markCompletedTrafficDirections(): void {
    if (this.settings.maxBytes <= 0) return
    for (const direction of this.activeDirections()) {
      if (this.directionTotal(direction) >= this.settings.maxBytes)
        this.stoppedDirections.add(direction)
    }
  }

  private allDirectionsStopped(): boolean {
    return this.activeDirections().every((direction) => this.stoppedDirections.has(direction))
  }

  private addMeasuredBytes(direction: TrafficDirection, bytes: number): void {
    if (!this.record || !this.running || this.stoppedDirections.has(direction)) return
    if (direction === 'download') this.record.downloadBytes += bytes
    else this.record.uploadBytes += bytes
    this.record.totalBytes = this.record.downloadBytes + this.record.uploadBytes

    if (this.settings.maxBytes > 0 && this.directionTotal(direction) >= this.settings.maxBytes) {
      this.stoppedDirections.add(direction)
      if (this.activeDirections().length === 1) {
        this.stop('traffic-limit')
        return
      }
      for (const [key, controller] of this.controllers) {
        if (key.startsWith(`${direction}:`)) controller.abort()
      }
      if (this.allDirectionsStopped()) this.stop('traffic-limit')
    }
  }

  private reserveUploadBytes(): number {
    if (!this.record) return 0
    if (this.settings.maxBytes <= 0) return UPLOAD_PAYLOAD.byteLength
    const remaining = Math.floor(
      this.settings.maxBytes - this.record.uploadBytes - this.reservedUploadBytes
    )
    if (remaining <= 0) return 0
    const reserved = Math.min(UPLOAD_PAYLOAD.byteLength, remaining)
    this.reservedUploadBytes += reserved
    return reserved
  }

  private releaseUploadBytes(bytes: number): void {
    this.reservedUploadBytes = Math.max(0, this.reservedUploadBytes - bytes)
  }

  private addSegment(at: number): void {
    if (!this.record) return
    this.closeSegment(at)
    const segment: TestSegment = {
      at,
      channelId: this.settings.channelId,
      threadCount: this.settings.threadCount,
      startBytes: this.record.totalBytes
    }
    this.record.segments.push(segment)
    this.records.append(this.record.id, { kind: 'segment', segment })
  }

  private closeSegment(at: number): void {
    if (!this.record) return
    const last = this.record.segments.at(-1)
    if (last && !last.endAt) {
      last.endAt = at
      last.endBytes = this.record.totalBytes
    }
  }

  private restartWorkers(): void {
    this.generation++
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    const current = this.generation
    // Zero is the UI's automatic choice; parallel mode uses this count independently per direction.
    const workerCount = this.settings.threadCount || AUTO_THREAD_COUNT
    for (const direction of this.activeDirections()) {
      if (this.stoppedDirections.has(direction)) continue
      for (let index = 0; index < workerCount; index++)
        void this.runWorker(direction, index, current)
    }
  }

  private startSampling(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    this.sampleTimer = setInterval(() => {
      if (!this.running) return
      this.sample()
      if (
        this.settings.maxDurationSec > 0 &&
        this.activeElapsedMs() >= this.settings.maxDurationSec * 1000
      )
        this.stop('time-limit')
    }, 1000)
  }

  private activeElapsedMs(): number {
    return this.activeDurationMs + (this.running ? performance.now() - this.activeStartedMono : 0)
  }

  private async runWorker(
    direction: TrafficDirection,
    index: number,
    generation: number
  ): Promise<void> {
    let failures = 0
    const key = `${direction}:${index}`
    while (
      this.running &&
      generation === this.generation &&
      !this.stoppedDirections.has(direction)
    ) {
      const channel = this.channels.get(this.settings.channelId)
      if (!channel) return
      const controller = new AbortController()
      this.controllers.set(key, controller)
      let watchdog: ReturnType<typeof setTimeout> | null = null
      let uploadReservation = 0
      // Speedtest.cn nodes can take over 15 seconds to acknowledge a 1 MiB upload.
      const watchdogTimeoutMs =
        direction === 'upload' && channel.provider === 'speedtest-cn' ? 45_000 : 15_000
      const refreshWatchdog = (): void => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = setTimeout(() => controller.abort(), watchdogTimeoutMs)
      }
      try {
        refreshWatchdog()
        if (direction === 'upload') {
          const uploadUrl = channel.uploadUrl
          if (!uploadUrl) throw new Error('当前通道没有上传地址')
          uploadReservation = this.reserveUploadBytes()
          if (uploadReservation <= 0) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            continue
          }
          const response = await this.fetcher(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: UPLOAD_PAYLOAD.subarray(0, uploadReservation),
            signal: controller.signal,
            redirect: 'follow'
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          if (response.body) await response.body.cancel().catch(() => {})
          if (this.running && generation === this.generation)
            this.addMeasuredBytes(direction, uploadReservation)
        } else {
          const response = await this.fetcher(downloadUrlForChannel(channel), {
            signal: controller.signal,
            redirect: 'follow'
          })
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
          const reader = response.body.getReader()
          let responseBytes = 0
          while (
            this.running &&
            generation === this.generation &&
            !this.stoppedDirections.has(direction)
          ) {
            refreshWatchdog()
            const { value, done } = await reader.read()
            if (done) break
            if (!value || generation !== this.generation || !this.running) break
            responseBytes += value.byteLength
            this.addMeasuredBytes(direction, value.byteLength)
            if (!this.running || this.stoppedDirections.has(direction)) break
          }
          await reader.cancel().catch(() => {})
          if (
            this.running &&
            generation === this.generation &&
            !this.stoppedDirections.has(direction) &&
            responseBytes < 1024 * 1024
          )
            throw new Error('下载资源小于 1 MB，不适合持续压测')
        }
        failures = 0
      } catch (error) {
        if (uploadReservation > 0) {
          this.releaseUploadBytes(uploadReservation)
          uploadReservation = 0
        }
        if (
          this.running &&
          generation === this.generation &&
          !this.stoppedDirections.has(direction)
        ) {
          failures++
          if (failures >= 3) {
            const label = direction === 'upload' ? '上行' : '下行'
            this.stop(
              'channel-error',
              `${label}通道 ${channel.label} 连续失败：${error instanceof Error ? error.message : String(error)}`
            )
            return
          }
          await new Promise((resolve) => setTimeout(resolve, failures * 500))
        }
      } finally {
        if (uploadReservation > 0) this.releaseUploadBytes(uploadReservation)
        if (watchdog) clearTimeout(watchdog)
        if (this.controllers.get(key) === controller) this.controllers.delete(key)
      }
      if (direction === 'download' && this.running && generation === this.generation)
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  private sample(): void {
    if (!this.record) return
    const nowMono = performance.now()
    const elapsedMs = nowMono - this.lastSampleMono
    if (elapsedMs < 100) return
    const now = Date.now()
    const activeDurationMs = this.activeElapsedMs()
    let combinedBytesPerSec = 0

    for (const direction of this.activeDirections()) {
      const totalBytes = this.directionTotal(direction)
      const bytesPerSec = ((totalBytes - this.lastSampleBytes[direction]) * 1000) / elapsedMs
      const sample = { at: now, bytesPerSec, totalBytes }
      const samples = direction === 'download' ? this.record.samples : this.record.uploadSamples
      samples.push(sample)
      combinedBytesPerSec += bytesPerSec
      if (direction === 'download') {
        this.record.downloadPeakBytesPerSec = Math.max(
          this.record.downloadPeakBytesPerSec,
          bytesPerSec
        )
      } else {
        this.record.uploadPeakBytesPerSec = Math.max(this.record.uploadPeakBytesPerSec, bytesPerSec)
      }
      this.records.append(this.record.id, {
        kind: 'sample',
        direction,
        sample,
        activeDurationMs
      })
      this.lastSampleBytes[direction] = totalBytes
    }

    this.record.activeDurationMs = activeDurationMs
    this.record.peakBytesPerSec = Math.max(this.record.peakBytesPerSec, combinedBytesPerSec)
    this.updateAggregateMetrics()
    this.lastSampleMono = nowMono
    this.emit()
  }
}

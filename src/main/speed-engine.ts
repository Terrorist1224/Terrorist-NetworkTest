import { randomUUID } from 'node:crypto'
import { AUTO_THREAD_COUNT } from '../shared/types'
import type {
  AppSnapshot,
  Limits,
  TestRecord,
  TestSegment,
  TestSettings,
  StopReason
} from '../shared/types'
import { ChannelStore, probeDownload } from './channels'
import { RecordStore } from './record-store'
import { SettingsStore, validateSettings } from './settings'

type Fetcher = typeof fetch

export class SpeedEngine {
  private settings: TestSettings
  private record: TestRecord | null = null
  private running = false
  private paused = false
  private error: string | null = null
  private generation = 0
  private controllers = new Map<number, AbortController>()
  private sampleTimer: ReturnType<typeof setInterval> | null = null
  private activeStartedMono = 0
  private activeDurationMs = 0
  private lastSampleMono = 0
  private lastSampleBytes = 0
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
    if (!channels.get(this.settings.channelId)) this.settings.channelId = 'cloudflare'
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

  private emit(): void {
    this.onUpdate(this.snapshot())
  }

  async start(settings: TestSettings): Promise<AppSnapshot> {
    if (this.running || this.paused) throw new Error('当前测速尚未结束')
    validateSettings(settings)
    const channel = this.channels.get(settings.channelId)
    if (!channel) throw new Error('测速通道不存在')
    this.error = null
    try {
      await probeDownload(channel.url, this.fetcher)
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.emit()
      throw error
    }

    this.settings = { ...settings }
    this.settingsStore.save(this.settings)
    const at = Date.now()
    const id = randomUUID()
    this.records.create(id, at, this.settings)
    this.record = {
      id,
      startedAt: at,
      activeDurationMs: 0,
      totalBytes: 0,
      averageBytesPerSec: 0,
      peakBytesPerSec: 0,
      settings: { ...this.settings },
      samples: [],
      segments: []
    }
    this.running = true
    this.paused = false
    this.activeDurationMs = 0
    this.activeStartedMono = performance.now()
    this.lastSampleMono = this.activeStartedMono
    this.lastSampleBytes = 0
    this.addSegment(at)
    this.restartWorkers()
    this.startSampling()
    this.emit()
    return this.snapshot()
  }

  pause(): AppSnapshot {
    if (!this.running || !this.record) return this.snapshot()
    this.sample()
    // Keep only active runtime so a pause never consumes the time limit.
    this.activeDurationMs = this.activeElapsedMs()
    this.record.activeDurationMs = this.activeDurationMs
    const at = Date.now()
    this.running = false
    this.paused = true
    this.generation++
    if (this.sampleTimer) clearInterval(this.sampleTimer)
    this.sampleTimer = null
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.lastSampleMono = performance.now()
    this.lastSampleBytes = this.record.totalBytes
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
    // Traffic and active runtime remain cumulative across pause/resume cycles.
    if (this.settings.maxBytes > 0 && this.record.totalBytes >= this.settings.maxBytes)
      return this.stop('traffic-limit')
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
    this.lastSampleBytes = this.record.totalBytes
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
    const elapsedSec = Math.max(this.activeDurationMs / 1000, 0.001)
    this.record.averageBytesPerSec = this.record.totalBytes / elapsedSec
    this.records.append(this.record.id, {
      kind: 'end',
      at,
      reason,
      totalBytes: this.record.totalBytes,
      activeDurationMs: this.activeDurationMs,
      error
    })
    this.emit()
    return this.snapshot()
  }

  changeChannel(channelId: string): AppSnapshot {
    if (!this.channels.get(channelId)) throw new Error('测速通道不存在')
    if (this.settings.channelId === channelId) return this.snapshot()
    this.settings.channelId = channelId
    this.settingsStore.save(this.settings)
    if (this.running) {
      this.addSegment(Date.now())
      this.restartWorkers()
    }
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
      this.settings.channelId = 'cloudflare'
      this.settingsStore.save(this.settings)
    }
    this.emit()
    return this.snapshot()
  }

  history(): TestRecord[] {
    const active = this.running || this.paused
    return this.records.list().filter((record) => !active || record.id !== this.record?.id)
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
    // A generation invalidates every old stream before its next chunk is counted.
    this.generation++
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    const current = this.generation
    // Zero is the UI's automatic choice; keep its worker count predictable and bounded.
    const workerCount = this.settings.threadCount || AUTO_THREAD_COUNT
    for (let index = 0; index < workerCount; index++) void this.runWorker(index, current)
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

  private async runWorker(index: number, generation: number): Promise<void> {
    let failures = 0
    while (this.running && generation === this.generation) {
      const channel = this.channels.get(this.settings.channelId)
      if (!channel) return
      const controller = new AbortController()
      this.controllers.set(index, controller)
      let watchdog: ReturnType<typeof setTimeout> | null = null
      const refreshWatchdog = (): void => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = setTimeout(() => controller.abort(), 15000)
      }
      try {
        refreshWatchdog()
        const response = await this.fetcher(channel.url, {
          signal: controller.signal,
          redirect: 'follow'
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const reader = response.body.getReader()
        let responseBytes = 0
        while (this.running && generation === this.generation) {
          refreshWatchdog()
          const { value, done } = await reader.read()
          if (done) break
          if (!value || generation !== this.generation || !this.running) break
          // Count received body bytes, not headers or traffic from other applications.
          this.record!.totalBytes += value.byteLength
          responseBytes += value.byteLength
          if (this.settings.maxBytes > 0 && this.record!.totalBytes >= this.settings.maxBytes) {
            this.stop('traffic-limit')
            break
          }
        }
        await reader.cancel().catch(() => {})
        if (this.running && generation === this.generation && responseBytes < 1024 * 1024) {
          throw new Error('下载资源小于 1 MB，不适合持续压测')
        }
        failures = 0
      } catch (error) {
        if (this.running && generation === this.generation) {
          failures++
          if (failures >= 3) {
            this.stop(
              'channel-error',
              `通道 ${channel.label} 连续失败：${error instanceof Error ? error.message : String(error)}`
            )
            return
          }
          await new Promise((resolve) => setTimeout(resolve, failures * 500))
        }
      } finally {
        if (watchdog) clearTimeout(watchdog)
        if (this.controllers.get(index) === controller) this.controllers.delete(index)
      }
      // Avoid a request storm when a custom URL returns a short finite body.
      if (this.running && generation === this.generation)
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  private sample(): void {
    if (!this.record) return
    const nowMono = performance.now()
    const elapsedMs = nowMono - this.lastSampleMono
    if (elapsedMs < 100) return
    const delta = this.record.totalBytes - this.lastSampleBytes
    const sample = {
      at: Date.now(),
      bytesPerSec: (delta * 1000) / elapsedMs,
      totalBytes: this.record.totalBytes
    }
    this.record.activeDurationMs = this.activeElapsedMs()
    this.record.samples.push(sample)
    this.record.peakBytesPerSec = Math.max(this.record.peakBytesPerSec, sample.bytesPerSec)
    this.record.averageBytesPerSec =
      this.record.totalBytes / Math.max(this.record.activeDurationMs / 1000, 0.001)
    this.lastSampleBytes = this.record.totalBytes
    this.lastSampleMono = nowMono
    this.records.append(this.record.id, {
      kind: 'sample',
      sample,
      activeDurationMs: this.record.activeDurationMs
    })
    this.emit()
  }
}

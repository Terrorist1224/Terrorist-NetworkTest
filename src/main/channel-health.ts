import { performance } from 'node:perf_hooks'
import type { Channel, ChannelHealthMap, ChannelHealthStatus } from '../shared/types'

export const CHANNEL_HEALTH_INTERVAL_MS = 60_000
export const CHANNEL_HEALTH_TIMEOUT_MS = 5_000
export const CHANNEL_HEALTH_CONCURRENCY = 2
export const CHANNEL_HEALTH_SLOW_THRESHOLD_MS = 300
export const SPEEDTEST_CN_FAST_THRESHOLD_MS = 100

type Fetcher = typeof fetch

export async function probeChannelLatency(
  url: string,
  fetcher: Fetcher = fetch,
  timeoutMs = CHANNEL_HEALTH_TIMEOUT_MS,
  outerSignal?: AbortSignal
): Promise<number> {
  const controller = new AbortController()
  const startedAt = performance.now()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  try {
    const signals = [controller.signal, outerSignal].filter(Boolean) as AbortSignal[]
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.any(signals),
      redirect: 'follow',
      cache: 'no-store'
    })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    reader = response.body.getReader()
    const first = await reader.read()
    if (!first.value?.byteLength) throw new Error('No response body')
    return Math.max(0, Math.round(performance.now() - startedAt))
  } catch (error) {
    if (controller.signal.aborted || outerSignal?.aborted) throw new Error('通道连接超时')
    throw error
  } finally {
    clearTimeout(timeout)
    if (reader) await reader.cancel().catch(() => undefined)
    controller.abort()
  }
}

export function probeWebSocketLatency(
  url: string,
  timeoutMs = CHANNEL_HEALTH_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('通道连接超时'))
      return
    }

    let socket: WebSocket | undefined
    let sentAt = 0
    const samples: number[] = []
    let completed = false
    const timeout = setTimeout(() => fail(new Error('WebSocket probe timed out')), timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (socket && socket.readyState < 2) socket.close()
    }
    const fail = (error: Error): void => {
      if (completed) return
      completed = true
      cleanup()
      reject(error)
    }
    const finish = (): void => {
      if (completed) return
      completed = true
      cleanup()
      resolve(Math.min(...samples))
    }
    const abort = (): void => fail(new Error('通道连接超时'))
    const sendPing = (): void => {
      if (completed || !socket || socket.readyState !== WebSocket.OPEN) return
      sentAt = performance.now()
      socket.send(`PING ${Date.now()}`)
    }

    signal?.addEventListener('abort', abort, { once: true })
    try {
      socket = new WebSocket(url)
      socket.addEventListener('open', sendPing)
      socket.addEventListener('message', (event) => {
        if (completed) return
        const data = String(event.data)
        if (data.includes('ERROR')) {
          fail(new Error('WebSocket probe failed'))
          return
        }
        if (!data.startsWith('PING ')) return
        samples.push(Math.max(0, Math.round(performance.now() - sentAt)))
        if (samples.length === 3) finish()
        else sendPing()
      })
      socket.addEventListener('error', () => fail(new Error('WebSocket probe failed')))
      socket.addEventListener('close', () => {
        if (!completed) fail(new Error('WebSocket probe closed'))
      })
    } catch {
      fail(new Error('WebSocket probe failed'))
    }
  })
}

function classifyLatency(channel: Channel, latencyMs: number): ChannelHealthStatus {
  if (channel.provider === 'speedtest-cn') {
    if (latencyMs <= SPEEDTEST_CN_FAST_THRESHOLD_MS) return 'fast'
    if (latencyMs <= CHANNEL_HEALTH_SLOW_THRESHOLD_MS) return 'slow'
    return 'unavailable'
  }
  return latencyMs < CHANNEL_HEALTH_SLOW_THRESHOLD_MS ? 'fast' : 'slow'
}

export class ChannelHealthMonitor {
  private channels: Channel[]
  private health: ChannelHealthMap
  private timer: ReturnType<typeof setInterval> | null = null
  private active = false
  private tickRunning = false
  private rerunRequested = false
  private readonly controllers = new Set<AbortController>()

  constructor(
    channels: readonly Channel[],
    private readonly onUpdate: (health: ChannelHealthMap) => void = () => {},
    private readonly fetcher: Fetcher = fetch
  ) {
    this.channels = [...channels]
    this.health = Object.fromEntries(
      channels.map((channel) => [
        channel.id,
        { status: 'checking', latencyMs: null, checkedAt: null }
      ])
    )
  }

  snapshot(): ChannelHealthMap {
    return structuredClone(this.health)
  }

  setChannels(channels: readonly Channel[]): void {
    const previous = new Map(this.channels.map((channel) => [channel.id, channel]))
    const next = new Map(channels.map((channel) => [channel.id, channel]))
    for (const channel of channels) {
      const old = previous.get(channel.id)
      if (
        !this.health[channel.id] ||
        old?.url !== channel.url ||
        old?.websocketUrl !== channel.websocketUrl
      ) {
        this.health[channel.id] = { status: 'checking', latencyMs: null, checkedAt: null }
      }
    }
    for (const id of Object.keys(this.health)) {
      if (!next.has(id)) delete this.health[id]
    }
    this.channels = [...channels]
    this.publish()
    if (this.active) {
      if (this.tickRunning) this.rerunRequested = true
      else void this.runTick()
    }
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.publish()
    void this.runTick()
    this.timer = setInterval(() => void this.runTick(), CHANNEL_HEALTH_INTERVAL_MS)
  }

  stop(): void {
    this.active = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  private publish(): void {
    this.onUpdate(this.snapshot())
  }

  private async runTick(): Promise<void> {
    if (!this.active || this.tickRunning) return
    this.tickRunning = true
    const channels = [...this.channels]
    let next = 0
    const worker = async (): Promise<void> => {
      while (this.active) {
        const channel = channels[next++]
        if (!channel) return
        await this.probe(channel)
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(CHANNEL_HEALTH_CONCURRENCY, channels.length) }, () =>
          worker()
        )
      )
    } finally {
      this.tickRunning = false
      if (this.active && this.rerunRequested) {
        this.rerunRequested = false
        queueMicrotask(() => void this.runTick())
      }
    }
  }

  private async probe(channel: Channel): Promise<void> {
    const current = this.channels.find((item) => item.id === channel.id)
    if (
      !this.active ||
      !current ||
      current.url !== channel.url ||
      current.websocketUrl !== channel.websocketUrl
    )
      return

    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      const latencyMs =
        channel.provider === 'speedtest-cn' && channel.websocketUrl
          ? await probeWebSocketLatency(
              channel.websocketUrl,
              CHANNEL_HEALTH_TIMEOUT_MS,
              controller.signal
            )
          : await probeChannelLatency(
              channel.url,
              this.fetcher,
              CHANNEL_HEALTH_TIMEOUT_MS,
              controller.signal
            )
      if (!this.active) return
      const latest = this.channels.find((item) => item.id === channel.id)
      if (!latest || latest.url !== channel.url || latest.websocketUrl !== channel.websocketUrl)
        return
      this.health[channel.id] = {
        status: classifyLatency(channel, latencyMs),
        latencyMs,
        checkedAt: Date.now()
      }
    } catch {
      if (!this.active || controller.signal.aborted) return
      const latest = this.channels.find((item) => item.id === channel.id)
      if (!latest || latest.url !== channel.url || latest.websocketUrl !== channel.websocketUrl)
        return
      this.health[channel.id] = {
        status: 'unavailable',
        latencyMs: null,
        checkedAt: Date.now()
      }
    } finally {
      this.controllers.delete(controller)
    }
    this.publish()
  }
}

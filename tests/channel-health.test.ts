import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '../src/shared/types'
import {
  CHANNEL_HEALTH_INTERVAL_MS,
  ChannelHealthMonitor,
  probeChannelLatency,
  probeWebSocketLatency
} from '../src/main/channel-health'

class EchoWebSocket extends EventTarget {
  static OPEN = 1
  readyState = 0

  constructor(readonly url: string) {
    super()
    queueMicrotask(() => {
      this.readyState = EchoWebSocket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }

  send(data: string): void {
    const delayMs = this.url.includes('over-300') ? 350 : this.url.includes('yellow') ? 150 : 0
    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data })), delayMs)
  }

  close(): void {
    this.readyState = 3
    queueMicrotask(() => this.dispatchEvent(new Event('close')))
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('channel health probes', () => {
  it('requests one byte and measures through the first response byte', async () => {
    let request: RequestInit | undefined
    const latency = await probeChannelLatency('https://example.test/file', async (_input, init) => {
      request = init
      return new Response(new Uint8Array([1]), { status: 206 })
    })

    expect(request?.method).toBe('GET')
    expect(new Headers(request?.headers).get('range')).toBe('bytes=0-0')
    expect(request?.cache).toBe('no-store')
    expect(latency).toBeGreaterThanOrEqual(0)
  })

  it('reports an aborted request as a timeout', async () => {
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })

    await expect(probeChannelLatency('https://example.test/slow', fetcher, 5)).rejects.toThrow(
      '通道连接超时'
    )
  })

  it('measures Speedtest.cn latency with three echoed PING messages', async () => {
    vi.stubGlobal('WebSocket', EchoWebSocket)
    const latency = await probeWebSocketLatency('wss://node-1.speedtest.cn:51090/ws')
    expect(latency).toBeGreaterThanOrEqual(0)
  })

  it('classifies ordinary channels and the provider channel by latency', async () => {
    const channels: Channel[] = [
      { id: 'fast', label: 'Fast', url: 'https://example.test/fast', region: 'global' },
      { id: 'slow', label: 'Slow', url: 'https://example.test/slow', region: 'global' },
      { id: 'bad', label: 'Bad', url: 'https://example.test/bad', region: 'global' },
      {
        id: 'speedtest-cn:1',
        label: '测速网节点',
        url: 'https://node-1.speedtest.cn:51090/download',
        websocketUrl: 'wss://node-1.speedtest.cn:51090/ws',
        region: 'domestic',
        provider: 'speedtest-cn'
      }
    ]
    let requestCount = 0
    const fetcher: typeof fetch = async (input) => {
      requestCount++
      const url = String(input)
      if (url.endsWith('/bad')) return new Response('failed', { status: 503 })
      if (url.endsWith('/slow')) await new Promise((resolve) => setTimeout(resolve, 350))
      return new Response(new Uint8Array([1]), { status: 200 })
    }
    vi.stubGlobal('WebSocket', EchoWebSocket)
    let latest = {} as ReturnType<ChannelHealthMonitor['snapshot']>
    const monitor = new ChannelHealthMonitor(channels, (health) => (latest = health), fetcher)

    monitor.start()
    await vi.waitFor(() => {
      expect(latest.fast.status).toBe('fast')
      expect(latest.slow.status).toBe('slow')
      expect(latest.bad.status).toBe('unavailable')
      expect(latest['speedtest-cn:1'].status).toBe('fast')
    })

    expect(requestCount).toBe(3)
    monitor.stop()
  })

  it('keeps provider nodes at 300 ms yellow and marks slower nodes unavailable', async () => {
    const channels: Channel[] = [
      {
        id: 'speedtest-cn:yellow',
        label: '测速网节点 150 ms',
        url: 'https://node-yellow.speedtest.cn/download',
        websocketUrl: 'wss://node-yellow.speedtest.cn/ws/yellow',
        region: 'domestic',
        provider: 'speedtest-cn'
      },
      {
        id: 'speedtest-cn:over-300',
        label: '测速网节点 350 ms',
        url: 'https://node-slow.speedtest.cn/download',
        websocketUrl: 'wss://node-slow.speedtest.cn/ws/over-300',
        region: 'domestic',
        provider: 'speedtest-cn'
      }
    ]
    vi.stubGlobal('WebSocket', EchoWebSocket)
    let latest = {} as ReturnType<ChannelHealthMonitor['snapshot']>
    const monitor = new ChannelHealthMonitor(channels, (health) => (latest = health))

    monitor.start()
    await vi.waitFor(
      () => {
        expect(latest['speedtest-cn:yellow'].status).toBe('slow')
        expect(latest['speedtest-cn:yellow'].latencyMs).toBeLessThanOrEqual(300)
        expect(latest['speedtest-cn:over-300'].status).toBe('unavailable')
        expect(latest['speedtest-cn:over-300'].latencyMs).toBeGreaterThan(300)
      },
      { timeout: 2500 }
    )
    monitor.stop()
  })

  it('refreshes every minute and stops its timer when stopped', async () => {
    vi.useFakeTimers()
    const channels: Channel[] = [
      { id: 'fast', label: 'Fast', url: 'https://example.test/fast', region: 'global' }
    ]
    let requestCount = 0
    const fetcher: typeof fetch = async () => {
      requestCount++
      return new Response(new Uint8Array([1]), { status: 200 })
    }
    const monitor = new ChannelHealthMonitor(channels, () => {}, fetcher)

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(requestCount).toBe(1)

    await vi.advanceTimersByTimeAsync(CHANNEL_HEALTH_INTERVAL_MS)
    expect(requestCount).toBe(2)
    monitor.stop()
    const callCount = requestCount
    await vi.advanceTimersByTimeAsync(CHANNEL_HEALTH_INTERVAL_MS)
    expect(requestCount).toBe(callCount)
  })
})

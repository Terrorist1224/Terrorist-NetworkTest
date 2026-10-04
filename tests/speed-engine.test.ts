import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ChannelStore, downloadUrlForChannel } from '../src/main/channels'
import { RecordStore, parseRecord } from '../src/main/record-store'
import { SettingsStore } from '../src/main/settings'
import { SpeedEngine } from '../src/main/speed-engine'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done())))
  )
})

async function localServer(): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': 2 * 1024 * 1024
    })
    const chunk = Buffer.alloc(64 * 1024, 7)
    let count = 0
    const timer = setInterval(() => {
      if (response.destroyed) {
        clearInterval(timer)
        return
      }
      response.write(chunk)
      count++
      if (count === 32) {
        clearInterval(timer)
        response.end()
      }
    }, 8)
    response.on('close', () => clearInterval(timer))
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local port')
  return `http://127.0.0.1:${address.port}`
}

async function localDuplexServer(): Promise<{
  url: string
  uploads: () => { requests: number; bytes: number }
  downloads: () => string[]
}> {
  let requests = 0
  let uploadedBytes = 0
  const downloadUrls: string[] = []
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let requestBytes = 0
      request.on('data', (chunk: Buffer) => (requestBytes += chunk.byteLength))
      request.on('end', () => {
        requests++
        uploadedBytes += requestBytes
        response.writeHead(204).end()
      })
      return
    }
    downloadUrls.push(request.url ?? '')
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': 2 * 1024 * 1024
    })
    response.end(Buffer.alloc(2 * 1024 * 1024, 9))
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    uploads: () => ({ requests, bytes: uploadedBytes }),
    downloads: () => [...downloadUrls]
  }
}

function createEngine() {
  const directory = resolve('.tmp', 'test-data', randomUUID())
  mkdirSync(directory, { recursive: true })
  const channels = new ChannelStore(directory)
  const records = new RecordStore(directory)
  const settings = new SettingsStore(directory)
  return { engine: new SpeedEngine(channels, records, settings), channels, records }
}

describe('managed speed-test provider channels', () => {
  it('stores only domestic provider nodes and keeps built-in fallback domestic', () => {
    const { channels } = createEngine()
    const domestic = {
      id: 'speedtest-cn:domestic',
      label: '国内节点',
      url: 'https://domestic.example.test/download',
      uploadUrl: 'https://domestic.example.test/upload',
      region: 'domestic' as const,
      provider: 'speedtest-cn' as const
    }
    const global = {
      ...domestic,
      id: 'speedtest-cn:global',
      label: '全球节点',
      region: 'global' as const
    }

    channels.replaceProviderChannels([domestic, global])

    expect(channels.list().map((channel) => channel.id)).toContain(domestic.id)
    expect(channels.list().map((channel) => channel.id)).not.toContain(global.id)
    expect(channels.list().every((channel) => channel.region !== 'global')).toBe(true)
  })

  it('migrates the old automatic Speedtest.cn selection to the first regional candidate', () => {
    const directory = resolve('.tmp', 'test-data', randomUUID())
    mkdirSync(directory, { recursive: true })
    const channels = new ChannelStore(directory)
    const records = new RecordStore(directory)
    const settings = new SettingsStore(directory)
    settings.save({
      mode: 'download',
      channelId: 'speedtest-cn',
      threadCount: 8,
      maxDurationSec: 0,
      maxBytes: 0
    })
    const engine = new SpeedEngine(channels, records, settings)
    const candidate = {
      id: 'speedtest-cn:433865',
      label: '测速网 · 湖南 · 长沙 · 移动 #433865',
      url: 'https://node-433865.speedtest.cn/download',
      uploadUrl: 'https://node-433865.speedtest.cn/upload',
      websocketUrl: 'wss://node-433865.speedtest.cn/ws',
      region: 'domestic' as const,
      provider: 'speedtest-cn' as const
    }

    expect(engine.replaceProviderChannels([candidate])).toBe(true)
    expect(engine.snapshot().settings.channelId).toBe(candidate.id)
  })

  it('falls back to a built-in channel when the selected provider node loses upload support', () => {
    const { engine, channels } = createEngine()
    const provider = {
      id: 'speedtest-cn:301',
      label: '测速网 · 浙江 · 杭州 · 联通 #301',
      url: 'https://example.test/download',
      uploadUrl: 'https://example.test/upload',
      websocketUrl: 'wss://node-1.speedtest.cn:51090/ws',
      region: 'domestic' as const,
      provider: 'speedtest-cn' as const,
      operator: '联通'
    }
    channels.replaceProviderChannels([provider])
    engine.changeChannel(provider.id)
    engine.changeMode('upload')

    const refreshed = { ...provider, uploadUrl: undefined }
    expect(engine.replaceProviderChannels([refreshed])).toBe(true)
    expect(engine.snapshot().settings).toMatchObject({ mode: 'upload', channelId: 'mcloud' })
    expect(engine.snapshot().channels.some((channel) => channel.id === provider.id)).toBe(true)
  })

  it('adds the Speedtest.cn size and cache-busting parameters only to provider downloads', () => {
    const provider = {
      id: 'speedtest-cn:301',
      label: '测速网 · 杭州 · 联通 #301',
      url: 'https://node-1.speedtest.cn:51090/download?existing=value',
      region: 'domestic' as const,
      provider: 'speedtest-cn' as const
    }
    const built = new URL(downloadUrlForChannel(provider, 1234))
    expect(built.searchParams.get('size')).toBe('1048576')
    expect(built.searchParams.get('r')).toBe('1234')
    expect(built.searchParams.get('existing')).toBe('value')

    const ordinary = { ...provider, provider: undefined }
    expect(downloadUrlForChannel(ordinary, 1234)).toBe(ordinary.url)
  })

  it('uses the provider download parameters during both the preflight and the test', async () => {
    const local = await localDuplexServer()
    const { engine, channels } = createEngine()
    const provider = {
      id: 'speedtest-cn:301',
      label: '测速网 · 杭州 · 联通 #301',
      url: `${local.url}/download`,
      uploadUrl: `${local.url}/upload`,
      websocketUrl: 'ws://node-1.speedtest.cn:51090/ws',
      region: 'domestic' as const,
      provider: 'speedtest-cn' as const
    }
    channels.replaceProviderChannels([provider])
    await engine.start({
      mode: 'download',
      channelId: provider.id,
      threadCount: 1,
      maxDurationSec: 10,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => (engine.snapshot().record?.downloadBytes ?? 0) > 0)
    engine.stop()

    expect(local.downloads().length).toBeGreaterThanOrEqual(2)
    for (const path of local.downloads()) {
      expect(path).toMatch(/^\/download\?size=1048576&r=\d+$/)
    }
  })
})

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('speed engine with a local download service', () => {
  it('records samples and configuration segments during an uninterrupted run', async () => {
    const url = await localServer()
    const { engine, channels, records } = createEngine()
    const first = await channels.add('Local A', `${url}/a`, async () => {})
    const second = await channels.add('Local B', `${url}/b`, async () => {})
    await engine.start({
      mode: 'download',
      channelId: first.id,
      threadCount: 2,
      maxDurationSec: 10,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => (engine.snapshot().record?.totalBytes ?? 0) > 0)
    engine.changeThreads(4)
    engine.changeChannel(second.id)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const result = engine.stop('manual').record!
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.samples.length).toBeGreaterThan(0)
    expect(result.segments.map((segment) => segment.threadCount)).toEqual([2, 4, 4])
    expect(result.segments.map((segment) => segment.channelId)).toEqual([
      first.id,
      first.id,
      second.id
    ])
    expect(result.averageBytesPerSec).toBeGreaterThan(0)
    expect(result.peakBytesPerSec).toBeGreaterThan(0)
    expect(records.get(result.id)?.stopReason).toBe('manual')
  })

  it('keeps both curve directions and full totals across a pause and resume', async () => {
    const local = await localDuplexServer()
    const { engine, channels, records } = createEngine()
    const channel = await channels.add('Local duplex', `${local.url}/down`, async () => {})
    channel.uploadUrl = `${local.url}/up`
    await engine.start({
      mode: 'parallel',
      channelId: channel.id,
      threadCount: 1,
      maxDurationSec: 0,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => {
      const record = engine.snapshot().record
      return Boolean(record?.downloadBytes && record.uploadBytes)
    })
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const paused = engine.pause().record!
    expect(paused.samples.length).toBeGreaterThan(0)
    expect(paused.uploadSamples.length).toBeGreaterThan(0)
    const pausedTotal = paused.totalBytes
    await new Promise((resolve) => setTimeout(resolve, 150))
    engine.resume()
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const finished = engine.stop('manual').record!
    const restored = records.get(finished.id)!
    expect(finished.totalBytes).toBeGreaterThan(pausedTotal)
    expect(finished.samples.length).toBeGreaterThan(0)
    expect(finished.uploadSamples.length).toBeGreaterThan(0)
    expect(restored.totalBytes).toBe(finished.totalBytes)
    expect(restored.activeDurationMs).toBe(finished.activeDurationMs)
    expect(restored.samples.at(-1)?.at).toBeGreaterThan(paused.samples.at(-1)!.at)
    expect(restored.uploadSamples.at(-1)?.at).toBeGreaterThan(paused.uploadSamples.at(-1)!.at)
  })

  it('stops at the traffic limit', async () => {
    const url = await localServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local', url, async () => {})
    await engine.start({
      mode: 'download',
      channelId: channel.id,
      threadCount: 2,
      maxDurationSec: 10,
      maxBytes: 1024 * 1024
    })
    await waitUntil(() => !engine.snapshot().running)
    expect(engine.snapshot().record?.stopReason).toBe('traffic-limit')
    expect(engine.snapshot().record?.totalBytes).toBeGreaterThanOrEqual(1024 * 1024)
  })

  it('measures completed upload requests and enforces the upload traffic limit', async () => {
    const local = await localDuplexServer()
    const { engine, channels, records } = createEngine()
    const channel = await channels.add('Local duplex', `${local.url}/down`, async () => {})
    channel.uploadUrl = `${local.url}/up`
    await engine.start({
      mode: 'upload',
      channelId: channel.id,
      threadCount: 32,
      maxDurationSec: 0,
      maxBytes: 1024 * 1024
    })
    await waitUntil(() => !engine.snapshot().running)
    const record = engine.snapshot().record!
    expect(local.uploads().requests).toBeGreaterThan(0)
    expect(local.uploads().bytes).toBe(1024 * 1024)
    expect(record.stopReason).toBe('traffic-limit')
    expect(record.downloadBytes).toBe(0)
    expect(record.uploadBytes).toBeGreaterThanOrEqual(1024 * 1024)
    expect(records.get(record.id)?.mode).toBe('upload')
  })

  it('keeps the recorded average speed accurate when pausing', async () => {
    const local = await localDuplexServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local duplex', `${local.url}/down`, async () => {})
    channel.uploadUrl = `${local.url}/up`
    await engine.start({
      mode: 'upload',
      channelId: channel.id,
      threadCount: 1,
      maxDurationSec: 0,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => (engine.snapshot().record?.uploadBytes ?? 0) > 0)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const record = engine.pause().record!
    const expectedAverage = record.uploadBytes / (record.activeDurationMs / 1000)
    expect(record.uploadAverageBytesPerSec).toBeCloseTo(expectedAverage, 0)
  })

  it('keeps separate traffic quotas in parallel mode', async () => {
    const local = await localDuplexServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local duplex', `${local.url}/down`, async () => {})
    channel.uploadUrl = `${local.url}/up`
    await engine.start({
      mode: 'parallel',
      channelId: channel.id,
      threadCount: 1,
      maxDurationSec: 10,
      maxBytes: 1024 * 1024
    })
    await waitUntil(() => !engine.snapshot().running)
    const record = engine.snapshot().record!
    expect(record.stopReason).toBe('traffic-limit')
    expect(record.downloadBytes).toBeGreaterThanOrEqual(1024 * 1024)
    expect(record.uploadBytes).toBeGreaterThanOrEqual(1024 * 1024)
    expect(record.totalBytes).toBe(record.downloadBytes + record.uploadBytes)
  })

  it('stops at the time limit', async () => {
    const url = await localServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local', url, async () => {})
    await engine.start({
      mode: 'download',
      channelId: channel.id,
      threadCount: 1,
      maxDurationSec: 1,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => !engine.snapshot().running, 2500)
    expect(engine.snapshot().record?.stopReason).toBe('time-limit')
  })

  it('stops when a custom channel repeatedly returns a tiny body', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.end(Buffer.alloc(64 * 1024))
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No local port')
    const { engine, channels } = createEngine()
    const channel = await channels.add(
      'Too small',
      `http://127.0.0.1:${address.port}`,
      async () => {}
    )
    await engine.start({
      mode: 'download',
      channelId: channel.id,
      threadCount: 1,
      maxDurationSec: 10,
      maxBytes: 1024 ** 3
    })
    await waitUntil(() => !engine.snapshot().running, 5000)
    expect(engine.snapshot().record?.stopReason).toBe('channel-error')
    expect(engine.snapshot().error).toContain('小于 1 MB')
  })
})

it('recovers a record without an end event as interrupted', () => {
  const record = parseRecord(
    [
      JSON.stringify({
        kind: 'start',
        id: randomUUID(),
        at: 1000,
        settings: { channelId: 'a', threadCount: 1, maxDurationSec: 10, maxBytes: 1048576 }
      }),
      JSON.stringify({
        kind: 'segment',
        segment: { at: 1000, channelId: 'a', threadCount: 1, startBytes: 0 }
      }),
      JSON.stringify({ kind: 'sample', sample: { at: 2000, bytesPerSec: 2048, totalBytes: 2048 } })
    ].join('\n')
  )
  expect(record?.stopReason).toBe('interrupted')
  expect(record?.endedAt).toBe(2000)
  expect(record?.totalBytes).toBe(2048)
  expect(record?.mode).toBe('download')
  expect(record?.uploadBytes).toBe(0)
})

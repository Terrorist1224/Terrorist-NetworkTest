import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ChannelStore } from '../src/main/channels'
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

function createEngine() {
  const directory = resolve('.tmp', 'test-data', randomUUID())
  mkdirSync(directory, { recursive: true })
  const channels = new ChannelStore(directory)
  const records = new RecordStore(directory)
  const settings = new SettingsStore(directory)
  return { engine: new SpeedEngine(channels, records, settings), channels, records }
}

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

  it('stops at the traffic limit', async () => {
    const url = await localServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local', url, async () => {})
    await engine.start({
      channelId: channel.id,
      threadCount: 2,
      maxDurationSec: 10,
      maxBytes: 1024 * 1024
    })
    await waitUntil(() => !engine.snapshot().running)
    expect(engine.snapshot().record?.stopReason).toBe('traffic-limit')
    expect(engine.snapshot().record?.totalBytes).toBeGreaterThanOrEqual(1024 * 1024)
  })

  it('stops at the time limit', async () => {
    const url = await localServer()
    const { engine, channels } = createEngine()
    const channel = await channels.add('Local', url, async () => {})
    await engine.start({
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
})

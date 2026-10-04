import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TestRecord, TestSettings } from '../src/shared/types'
import {
  CURVE_WINDOW_MS,
  MAX_CURVE_SAMPLES,
  MAX_CURVE_SEGMENTS,
  trimCurveData
} from '../src/shared/curve-window'
import { parseRecord, RecordStore } from '../src/main/record-store'

const temporaryRoot = resolve('.tmp')
let temporaryDirectory: string

beforeEach(() => {
  mkdirSync(temporaryRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'curve-window-'))
})

afterEach(() => rmSync(temporaryDirectory, { recursive: true, force: true }))

function recordFixture(now: number): TestRecord {
  const settings: TestSettings = {
    mode: 'parallel',
    channelId: 'mcloud',
    channelSelection: 'auto',
    threadCount: 8,
    maxDurationSec: 0,
    maxBytes: 0
  }
  return {
    id: randomUUID(),
    startedAt: now - 10 * CURVE_WINDOW_MS,
    endedAt: now,
    activeDurationMs: 10 * CURVE_WINDOW_MS,
    stopReason: 'manual',
    mode: 'parallel',
    totalBytes: 9_000_000,
    averageBytesPerSec: 15_000,
    peakBytesPerSec: 80_000,
    downloadBytes: 6_000_000,
    uploadBytes: 3_000_000,
    downloadAverageBytesPerSec: 10_000,
    uploadAverageBytesPerSec: 5000,
    downloadPeakBytesPerSec: 70_000,
    uploadPeakBytesPerSec: 10_000,
    settings,
    samples: [],
    uploadSamples: [],
    segments: []
  }
}

describe('rolling curve window', () => {
  it('bounds both in-memory directions and change markers without changing cumulative metrics', () => {
    const now = Date.now()
    const record = recordFixture(now)
    for (let index = 0; index < 360; index++) {
      const at = now - 359_000 + index * 1000
      record.samples.push({ at, bytesPerSec: index, totalBytes: index * 1000 })
      record.uploadSamples.push({ at, bytesPerSec: index * 2, totalBytes: index * 2000 })
      if (index % 2 === 0) {
        record.segments.push({
          at,
          channelId: `node-${index}`,
          threadCount: 8,
          startBytes: index * 1000,
          endAt: at + 500,
          endBytes: index * 1000 + 1
        })
      }
      trimCurveData(record, at)
      expect(record.samples.length).toBeLessThanOrEqual(MAX_CURVE_SAMPLES)
      expect(record.uploadSamples.length).toBeLessThanOrEqual(MAX_CURVE_SAMPLES)
      expect(record.segments.length).toBeLessThanOrEqual(MAX_CURVE_SEGMENTS)
    }

    expect(record.samples.at(-1)?.at).toBe(now)
    expect(record.samples[0].at).toBeGreaterThanOrEqual(now - CURVE_WINDOW_MS)
    expect(record.totalBytes).toBe(9_000_000)
    expect(record.activeDurationMs).toBe(10 * CURVE_WINDOW_MS)
    expect(record.averageBytesPerSec).toBe(15_000)
    expect(record.peakBytesPerSec).toBe(80_000)
  })

  it('writes a bounded snapshot for new records and retains full metrics', () => {
    const now = Date.now()
    const record = recordFixture(now)
    for (let index = 0; index < 180; index++) {
      const at = now - 59_000 + Math.round((index * 59_000) / 179)
      record.samples.push({ at, bytesPerSec: index, totalBytes: index * 10 })
      record.uploadSamples.push({ at, bytesPerSec: index * 2, totalBytes: index * 20 })
      record.segments.push({ at, channelId: `node-${index}`, threadCount: 8, startBytes: index })
    }
    const store = new RecordStore(temporaryDirectory)
    store.create(record.id, record.startedAt, record.settings)
    store.save(record)

    const filePath = join(temporaryDirectory, 'records', `${record.id}.jsonl`)
    const text = readFileSync(filePath, 'utf8')
    const restored = store.get(record.id)!
    expect(text.trim().split(/\r?\n/)).toHaveLength(1)
    expect(restored.samples).toHaveLength(MAX_CURVE_SAMPLES)
    expect(restored.uploadSamples).toHaveLength(MAX_CURVE_SAMPLES)
    expect(restored.segments.length).toBeLessThanOrEqual(MAX_CURVE_SEGMENTS)
    expect(restored.totalBytes).toBe(record.totalBytes)
    expect(restored.activeDurationMs).toBe(record.activeDurationMs)
    expect(restored.averageBytesPerSec).toBe(record.averageBytesPerSec)
    expect(restored.peakBytesPerSec).toBe(record.peakBytesPerSec)
    expect(text).not.toContain('"bytesPerSec":0')
  })

  it('reads a legacy event log with complete metrics and only its latest minute of curves', () => {
    const id = randomUUID()
    const startedAt = Date.now() - 80_000
    const settings: TestSettings = {
      mode: 'download',
      channelId: 'mcloud',
      threadCount: 8,
      maxDurationSec: 0,
      maxBytes: 0
    }
    const events: unknown[] = [
      { kind: 'start', id, at: startedAt, settings },
      {
        kind: 'segment',
        segment: { at: startedAt, channelId: 'mcloud', threadCount: 8, startBytes: 0 }
      }
    ]
    for (let second = 1; second <= 80; second++) {
      if (second === 10 || second === 75) {
        events.push({
          kind: 'segment',
          segment: {
            at: startedAt + second * 1000,
            channelId: second === 10 ? 'node-old' : 'node-new',
            threadCount: 8,
            startBytes: (second - 1) * 1000
          }
        })
      }
      events.push({
        kind: 'sample',
        sample: {
          at: startedAt + second * 1000,
          bytesPerSec: second === 2 ? 99_999 : 1000,
          totalBytes: second * 1000
        },
        activeDurationMs: second * 1000
      })
    }
    events.push({
      kind: 'end',
      at: startedAt + 80_000,
      reason: 'manual',
      totalBytes: 80_000,
      activeDurationMs: 80_000
    })

    const record = parseRecord(events.map((event) => JSON.stringify(event)).join('\n'))!
    expect(record.downloadBytes).toBe(80_000)
    expect(record.downloadAverageBytesPerSec).toBe(1000)
    expect(record.downloadPeakBytesPerSec).toBe(99_999)
    expect(record.samples.length).toBeLessThanOrEqual(61)
    expect(record.samples[0].at).toBeGreaterThanOrEqual(record.endedAt! - CURVE_WINDOW_MS)
    expect(record.segments.map((segment) => segment.channelId)).toEqual(['node-new'])
  })
})

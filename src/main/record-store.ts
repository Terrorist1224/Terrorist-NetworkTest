import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type {
  SpeedSample,
  StopReason,
  TestRecord,
  TestSegment,
  TestSettings
} from '../shared/types'

type RecordEvent =
  | { kind: 'start'; id: string; at: number; settings: TestSettings }
  | { kind: 'segment'; segment: TestSegment }
  | { kind: 'sample'; sample: SpeedSample; activeDurationMs?: number }
  | { kind: 'pause' | 'resume'; at: number; activeDurationMs?: number }
  | {
      kind: 'end'
      at: number
      reason: StopReason
      totalBytes: number
      activeDurationMs?: number
      error?: string
    }

const MAX_HISTORY_RECORDS = 20

export function parseRecord(text: string): TestRecord | null {
  let record: TestRecord | null = null
  let latestEventAt = 0
  let hasActiveDuration = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let event: RecordEvent
    try {
      event = JSON.parse(line) as RecordEvent
    } catch {
      continue
    }
    if (event.kind === 'start') {
      record = {
        id: event.id,
        startedAt: event.at,
        activeDurationMs: 0,
        totalBytes: 0,
        averageBytesPerSec: 0,
        peakBytesPerSec: 0,
        settings: event.settings,
        samples: [],
        segments: []
      }
      latestEventAt = event.at
    } else if (record && event.kind === 'segment') {
      const previous = record.segments.at(-1)
      // A pause event has already closed this segment; don't stretch it across idle time.
      if (previous && !previous.endAt) {
        previous.endAt = event.segment.at
        previous.endBytes = event.segment.startBytes
      }
      record.segments.push(event.segment)
      latestEventAt = event.segment.at
    } else if (record && event.kind === 'sample') {
      record.samples.push(event.sample)
      record.totalBytes = event.sample.totalBytes
      record.peakBytesPerSec = Math.max(record.peakBytesPerSec, event.sample.bytesPerSec)
      latestEventAt = event.sample.at
      if (Number.isFinite(event.activeDurationMs)) {
        record.activeDurationMs = event.activeDurationMs!
        hasActiveDuration = true
      }
    } else if (record && (event.kind === 'pause' || event.kind === 'resume')) {
      if (Number.isFinite(event.activeDurationMs)) {
        record.activeDurationMs = event.activeDurationMs!
        hasActiveDuration = true
      }
      latestEventAt = event.at
      if (event.kind === 'pause') {
        const lastSegment = record.segments.at(-1)
        if (lastSegment && !lastSegment.endAt) {
          lastSegment.endAt = event.at
          lastSegment.endBytes = record.totalBytes
        }
      }
    } else if (record && event.kind === 'end') {
      record.endedAt = event.at
      record.stopReason = event.reason
      record.totalBytes = event.totalBytes
      record.error = event.error
      if (Number.isFinite(event.activeDurationMs)) {
        record.activeDurationMs = event.activeDurationMs!
        hasActiveDuration = true
      }
      latestEventAt = event.at
    }
  }
  if (!record) return null
  // A missing end event means the process exited unexpectedly. Preserve the measured data.
  if (!record.endedAt) {
    record.endedAt = latestEventAt || record.samples.at(-1)?.at || record.startedAt
    record.stopReason = 'interrupted'
  }
  // Older record files did not store active duration, so retain their wall-clock calculation.
  if (!hasActiveDuration) record.activeDurationMs = Math.max(0, record.endedAt - record.startedAt)
  const lastSegment = record.segments.at(-1)
  if (lastSegment && !lastSegment.endAt) {
    lastSegment.endAt = record.endedAt
    lastSegment.endBytes = record.totalBytes
  }
  const elapsedSec = Math.max(record.activeDurationMs / 1000, 0.001)
  record.averageBytesPerSec = record.totalBytes / elapsedSec
  return record
}

export class RecordStore {
  private readonly directory: string

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, 'records')
    mkdirSync(this.directory, { recursive: true })
    this.prune()
  }

  private path(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid record ID')
    return join(this.directory, `${id}.jsonl`)
  }

  create(id: string, at: number, settings: TestSettings): void {
    const path = this.path(id)
    if (existsSync(path)) throw new Error('Record already exists')
    writeFileSync(path, JSON.stringify({ kind: 'start', id, at, settings }) + '\n', 'utf8')
    this.prune()
  }

  append(id: string, event: Exclude<RecordEvent, { kind: 'start' }>): void {
    appendFileSync(this.path(id), JSON.stringify(event) + '\n', 'utf8')
  }

  get(id: string): TestRecord | null {
    const path = this.path(id)
    return existsSync(path) ? parseRecord(readFileSync(path, 'utf8')) : null
  }

  list(): TestRecord[] {
    return readdirSync(this.directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        try {
          return this.get(name.slice(0, -6))
        } catch {
          return null
        }
      })
      .filter((record): record is TestRecord => record !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  private prune(): void {
    for (const record of this.list().slice(MAX_HISTORY_RECORDS)) {
      unlinkSync(this.path(record.id))
    }
  }
}

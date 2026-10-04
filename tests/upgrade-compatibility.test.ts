import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolvePackagedDataDirectory, USER_DATA_FOLDER } from '../src/main/data-directory'
import { RecordStore } from '../src/main/record-store'

const temporaryRoot = resolve('.tmp')
let temporaryDirectory: string

beforeEach(() => {
  mkdirSync(temporaryRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'upgrade-compatibility-'))
})

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('upgrade compatibility', () => {
  it('keeps the install directory page visible and defaults it to the previous path', () => {
    const installer = readFileSync(resolve('installer/setup.iss'), 'utf8')

    expect(installer).toMatch(/^DisableDirPage=no$/m)
    expect(installer).toMatch(/^UsePreviousAppDir=yes$/m)
    expect(installer).toMatch(/CopyDataDirectory\(PreviousDataDirectory, NewDataDirectory\)/)
    expect(installer).not.toMatch(/^\[UninstallDelete\]$/m)
  })

  it('loads version 1.0 records and maps the legacy final total into download statistics', () => {
    const id = randomUUID()
    const recordsDirectory = join(temporaryDirectory, 'records')
    mkdirSync(recordsDirectory, { recursive: true })
    writeFileSync(
      join(recordsDirectory, `${id}.jsonl`),
      [
        JSON.stringify({
          kind: 'start',
          id,
          at: 1000,
          settings: { channelId: 'mcloud', threadCount: 8, maxDurationSec: 0, maxBytes: 0 }
        }),
        JSON.stringify({
          kind: 'segment',
          segment: { at: 1000, channelId: 'mcloud', threadCount: 8, startBytes: 0 }
        }),
        JSON.stringify({
          kind: 'sample',
          sample: { at: 2000, bytesPerSec: 2048, totalBytes: 2048 },
          activeDurationMs: 1000
        }),
        JSON.stringify({ kind: 'end', at: 4000, reason: 'manual', totalBytes: 4096 })
      ].join('\n'),
      'utf8'
    )

    const [record] = new RecordStore(temporaryDirectory).list()

    expect(record).toMatchObject({
      id,
      mode: 'download',
      totalBytes: 4096,
      downloadBytes: 4096,
      uploadBytes: 0,
      downloadAverageBytesPerSec: 4096,
      uploadAverageBytesPerSec: 0,
      uploadSamples: []
    })
  })

  it('migrates old install data to the stable user data directory without overwriting existing files', () => {
    const previousInstallDirectory = join(temporaryDirectory, 'previous-install')
    const previousDataDirectory = join(previousInstallDirectory, 'data')
    const appDataRoot = join(temporaryDirectory, 'roaming')
    const stableDataDirectory = join(appDataRoot, USER_DATA_FOLDER)
    const recordId = randomUUID()
    mkdirSync(join(previousDataDirectory, 'records'), { recursive: true })
    mkdirSync(stableDataDirectory, { recursive: true })
    writeFileSync(join(previousDataDirectory, 'settings.json'), 'old-settings', 'utf8')
    writeFileSync(join(stableDataDirectory, 'settings.json'), 'current-settings', 'utf8')
    writeFileSync(join(previousDataDirectory, 'records', `${recordId}.jsonl`), 'legacy-record', 'utf8')

    const resolved = resolvePackagedDataDirectory(appDataRoot, previousInstallDirectory)

    expect(resolved).toBe(stableDataDirectory)
    expect(readFileSync(join(stableDataDirectory, 'settings.json'), 'utf8')).toBe('current-settings')
    expect(readFileSync(join(stableDataDirectory, 'records', `${recordId}.jsonl`), 'utf8')).toBe(
      'legacy-record'
    )
    expect(readFileSync(join(previousDataDirectory, 'settings.json'), 'utf8')).toBe('old-settings')
  })
})

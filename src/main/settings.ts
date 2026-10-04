import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestSettings } from '../shared/types'

export const defaultSettings: TestSettings = {
  mode: 'download',
  channelId: 'mcloud',
  channelSelection: 'auto',
  threadCount: 8,
  maxDurationSec: 0,
  maxBytes: 0
}

export function validateSettings(settings: TestSettings): void {
  if (!['download', 'upload', 'parallel'].includes(settings.mode)) throw new Error('测速模式无效')
  if (
    settings.channelSelection !== undefined &&
    !['auto', 'manual'].includes(settings.channelSelection)
  )
    throw new Error('节点选择模式无效')
  if (
    !Number.isInteger(settings.threadCount) ||
    settings.threadCount < 0 ||
    settings.threadCount > 64
  ) {
    throw new Error('线程数必须为 0–64')
  }
  if (!Number.isFinite(settings.maxDurationSec) || settings.maxDurationSec < 0) {
    throw new Error('最长运行时间不能小于 0 秒')
  }
  if (
    !Number.isFinite(settings.maxBytes) ||
    settings.maxBytes < 0 ||
    (settings.maxBytes > 0 && settings.maxBytes < 1024 * 1024)
  ) {
    throw new Error('流量上限必须为 0（不限）或至少 1 MB')
  }
}

function normalizeSavedSettings(settings: TestSettings): TestSettings {
  // Earlier builds allowed arbitrary counts; map saved values to the new picker choices.
  if (![0, 4, 8, 16, 32].includes(settings.threadCount)) settings.threadCount = 8
  if (!['download', 'upload', 'parallel'].includes(settings.mode)) settings.mode = 'download'
  if (settings.channelSelection !== 'auto' && settings.channelSelection !== 'manual')
    settings.channelSelection = 'auto'
  return settings
}

export class SettingsStore {
  private readonly path: string
  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true })
    this.path = join(dataDirectory, 'settings.json')
  }
  load(): TestSettings {
    if (!existsSync(this.path)) return { ...defaultSettings }
    try {
      const settings = normalizeSavedSettings({
        ...defaultSettings,
        ...JSON.parse(readFileSync(this.path, 'utf8'))
      } as TestSettings)
      validateSettings(settings)
      return settings
    } catch {
      return { ...defaultSettings }
    }
  }
  save(settings: TestSettings): void {
    validateSettings(settings)
    writeFileSync(this.path, JSON.stringify(settings, null, 2), 'utf8')
  }
}

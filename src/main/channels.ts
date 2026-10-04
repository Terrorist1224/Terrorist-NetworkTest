import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Channel } from '../shared/types'

// This list keeps only reference URLs that currently return downloadable objects
// larger than the engine's 1 MiB minimum during an ordinary GET probe.
export const builtInChannels: Channel[] = [
  {
    id: 'mcloud',
    label: '和彩云',
    region: 'domestic',
    url: 'https://img.mcloud.139.com/material_prod/material_media/20221128/1669626861087.png'
  }
]

export const DEFAULT_CHANNEL_ID = 'mcloud'

export class ChannelStore {
  private readonly path: string
  private custom: Channel[] = []
  private provider: Channel[]

  constructor(dataDirectory: string, provider: Channel[] = []) {
    mkdirSync(dataDirectory, { recursive: true })
    this.path = join(dataDirectory, 'channels.json')
    this.provider = provider
    if (existsSync(this.path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(parsed)) {
          this.custom = parsed.filter(
            (item): item is Channel =>
              typeof item?.id === 'string' &&
              typeof item?.url === 'string' &&
              typeof item?.label === 'string' &&
              item.custom === true
          )
        }
      } catch {
        this.custom = []
      }
    }
  }

  list(): Channel[] {
    return [...builtInChannels, ...this.provider, ...this.custom].filter(
      (channel) => channel.region !== 'global'
    )
  }

  replaceProviderChannels(channels: Channel[]): void {
    this.provider = channels.filter(
      (channel) => channel.provider === 'speedtest-cn' && channel.region === 'domestic'
    )
  }
  get(id: string): Channel | undefined {
    return this.list().find((channel) => channel.id === id)
  }

  async add(
    label: string,
    rawUrl: string,
    probe: (url: string) => Promise<void>
  ): Promise<Channel> {
    const cleanLabel = label.trim().slice(0, 60)
    if (!cleanLabel) throw new Error('请输入通道名称')
    const url = new URL(rawUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('通道只支持 HTTP 或 HTTPS')
    if (url.username || url.password) throw new Error('通道地址不能包含账号密码')
    await probe(url.toString())
    const channel: Channel = {
      id: randomUUID(),
      label: cleanLabel,
      url: url.toString(),
      region: 'custom',
      custom: true
    }
    this.custom.push(channel)
    this.save()
    return channel
  }

  remove(id: string): void {
    if (!this.custom.some((channel) => channel.id === id)) throw new Error('只能删除自定义通道')
    this.custom = this.custom.filter((channel) => channel.id !== id)
    this.save()
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.custom, null, 2), 'utf8')
  }
}

export function downloadUrlForChannel(channel: Channel, now = Date.now()): string {
  if (channel.provider !== 'speedtest-cn') return channel.url
  const url = new URL(channel.url)
  url.searchParams.set('size', '1048576')
  url.searchParams.set('r', String(now))
  return url.toString()
}

export async function probeDownload(url: string, fetcher: typeof fetch = fetch): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetcher(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`通道响应异常：HTTP ${response.status}`)
    const reader = response.body.getReader()
    const first = await reader.read()
    await reader.cancel()
    if (!first.value?.byteLength) throw new Error('通道未返回下载数据')
    const length = Number(response.headers.get('content-length'))
    if (length > 0 && length < 1024 * 1024) throw new Error('下载文件小于 1 MB，不适合持续压测')
  } catch (error) {
    if (controller.signal.aborted) throw new Error('通道连接超时')
    throw error
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

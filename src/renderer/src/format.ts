import { AUTO_THREAD_COUNT } from '../../shared/types'

export function bytes(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size.toFixed(index < 2 ? 0 : 1)} ${units[index]}`
}

export function speed(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB/s`
}

export function mbps(value: number): string {
  return `${((value * 8) / 1_000_000).toFixed(1)} Mbps`
}

export function threadLabel(value: number): string {
  return value === 0 ? `0（自动，${AUTO_THREAD_COUNT} 线程）` : `${value} 线程`
}

export function clockTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function elapsed(startedAt: number, endedAt = Date.now()): string {
  return duration(endedAt - startedAt)
}

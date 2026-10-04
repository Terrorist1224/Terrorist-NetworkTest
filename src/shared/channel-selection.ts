import type { AppSnapshot, Channel, ChannelHealthMap, TestMode } from './types'

export const MAX_CHANNEL_LATENCY_MS = 300
const MAX_HEALTH_AGE_MS = 75 * 60_000

export function isEligibleChannel(
  channel: Channel,
  healthMap: ChannelHealthMap,
  mode: TestMode
): boolean {
  if (channel.region !== 'domestic' && !channel.custom) return false
  if (mode !== 'download' && !channel.uploadUrl) return false

  const health = healthMap[channel.id]
  return (
    (health?.status === 'fast' || health?.status === 'slow') &&
    health.latencyMs !== null &&
    health.latencyMs <= MAX_CHANNEL_LATENCY_MS &&
    health.checkedAt !== null &&
    Date.now() - health.checkedAt <= MAX_HEALTH_AGE_MS
  )
}

export function bestDomesticChannel(
  channels: readonly Channel[],
  healthMap: ChannelHealthMap,
  mode: TestMode
): Channel | undefined {
  return channels
    .filter(
      (channel) => channel.region === 'domestic' && isEligibleChannel(channel, healthMap, mode)
    )
    .sort((left, right) => {
      const latency = healthMap[left.id].latencyMs! - healthMap[right.id].latencyMs!
      return latency || left.label.localeCompare(right.label, 'zh-CN')
    })[0]
}

export function automaticChannelId(
  snapshot: AppSnapshot,
  healthMap: ChannelHealthMap
): string | undefined {
  if (snapshot.settings.channelSelection !== 'auto' || snapshot.running || snapshot.paused)
    return undefined
  return bestDomesticChannel(snapshot.channels, healthMap, snapshot.settings.mode)?.id
}

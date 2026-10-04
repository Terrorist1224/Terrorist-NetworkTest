import { describe, expect, it } from 'vitest'
import type { AppSnapshot, Channel, ChannelHealthMap } from '../src/shared/types'
import {
  automaticChannelLabel,
  automaticChannelId,
  bestDomesticChannel,
  isEligibleChannel
} from '../src/shared/channel-selection'

const now = Date.now()

function channel(
  id: string,
  region: Channel['region'],
  latencyMs: number,
  upload = true,
  extra: Partial<Channel> = {}
): { channel: Channel; health: ChannelHealthMap } {
  const node: Channel = {
    id,
    label: id,
    url: `https://${id}.example.test/download`,
    uploadUrl: upload ? `https://${id}.example.test/upload` : undefined,
    region,
    ...extra
  }
  return {
    channel: node,
    health: {
      [id]: {
        status: latencyMs <= 100 ? 'fast' : latencyMs <= 300 ? 'slow' : 'unavailable',
        latencyMs,
        checkedAt: now
      }
    }
  }
}

function snapshot(channels: Channel[], mode: 'auto' | 'manual' = 'auto'): AppSnapshot {
  return {
    running: false,
    paused: false,
    settings: {
      mode: 'download',
      channelId: channels[0]?.id ?? 'mcloud',
      channelSelection: mode,
      threadCount: 8,
      maxDurationSec: 0,
      maxBytes: 0
    },
    channels,
    record: null,
    error: null
  }
}

describe('channel selection', () => {
  it('accepts only domestic or custom nodes with fresh latency no higher than 300 ms', () => {
    const at300 = channel('at-300', 'domestic', 300)
    const over300 = channel('over-300', 'domestic', 301)
    const global = channel('global', 'global', 20)
    const custom = channel('custom', 'custom', 200, true, { custom: true })

    expect(isEligibleChannel(at300.channel, at300.health, 'download')).toBe(true)
    expect(isEligibleChannel(over300.channel, over300.health, 'download')).toBe(false)
    expect(isEligibleChannel(global.channel, global.health, 'download')).toBe(false)
    expect(isEligibleChannel(custom.channel, custom.health, 'download')).toBe(true)
    expect(isEligibleChannel(at300.channel, {}, 'download')).toBe(false)
    expect(
      isEligibleChannel(
        at300.channel,
        {
          ...at300.health,
          [at300.channel.id]: {
            ...at300.health[at300.channel.id],
            checkedAt: now - 75 * 60_000 - 1
          }
        },
        'download'
      )
    ).toBe(false)
  })

  it('auto-selects the lowest-latency compatible domestic node and excludes custom nodes', () => {
    const slower = channel('slower', 'domestic', 120)
    const fastest = channel('fastest', 'domestic', 34)
    const custom = channel('custom', 'custom', 1, true, { custom: true })
    const global = channel('global', 'global', 2)
    const channels = [slower.channel, fastest.channel, custom.channel, global.channel]
    const health = { ...slower.health, ...fastest.health, ...custom.health, ...global.health }

    expect(bestDomesticChannel(channels, health, 'download')?.id).toBe('fastest')
    expect(bestDomesticChannel(channels, health, 'upload')?.id).toBe('fastest')
  })

  it('requires an upload endpoint in upload and parallel modes', () => {
    const downloadOnly = channel('download-only', 'domestic', 20, false)
    const duplex = channel('duplex', 'domestic', 80, true)

    expect(bestDomesticChannel([downloadOnly.channel], downloadOnly.health, 'download')?.id).toBe(
      'download-only'
    )
    expect(
      bestDomesticChannel([downloadOnly.channel], downloadOnly.health, 'upload')
    ).toBeUndefined()
    expect(bestDomesticChannel([duplex.channel], duplex.health, 'parallel')?.id).toBe('duplex')
  })

  it('does not change the automatic choice during a run, while paused, or in manual mode', () => {
    const candidate = channel('fastest', 'domestic', 25)
    const state = snapshot([candidate.channel])

    expect(automaticChannelId(state, candidate.health)).toBe('fastest')
    expect(automaticChannelId({ ...state, running: true }, candidate.health)).toBeUndefined()
    expect(automaticChannelId({ ...state, paused: true }, candidate.health)).toBeUndefined()
    expect(
      automaticChannelId(snapshot([candidate.channel], 'manual'), candidate.health)
    ).toBeUndefined()
  })

  it('shows the automatically selected node while idle and the actual node while active', () => {
    const current = channel('current-node', 'domestic', 25)
    const candidate = channel('best-node', 'domestic', 10)
    const state = snapshot([current.channel, candidate.channel])
    const health = { ...current.health, ...candidate.health }

    expect(automaticChannelLabel(state, health)).toBe('自动（best-node）')
    expect(automaticChannelLabel({ ...state, running: true }, health)).toBe('current-node')
    expect(automaticChannelLabel({ ...state, paused: true }, health)).toBe('current-node')
    expect(automaticChannelLabel(snapshot([]), {})).toBe('自动（等待可用节点）')
    expect(automaticChannelLabel({ ...snapshot([]), paused: true }, {})).toBe('等待可用节点')
  })
})

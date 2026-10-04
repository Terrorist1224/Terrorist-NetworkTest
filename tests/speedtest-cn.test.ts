import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSpeedtestCnResponse, resolveSpeedtestCnChannels } from '../src/main/speedtest-cn'

const key = Buffer.from('5ECC5D62140EC099', 'utf8')
const iv = Buffer.from('E63EA892A702EEAA', 'utf8')

function encryptedResponse(data: unknown[]): { data: string } {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ data, meta: { ip: 'discard-this-value' } }), 'utf8'),
    cipher.final()
  ])
  return { data: encrypted.toString('base64') }
}

function node(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    active: '1',
    isPrivate: 0,
    province: '陕西',
    city: '西安',
    operator: '移动',
    distance: id === 1 ? 100 : 200,
    websocketUrl: `wss://node-${id}.speedtest.cn:51090/ws`,
    downloadUrl: `https://node-${id}.speedtest.cn:51090/download`,
    uploadUrl: `https://node-${id}.speedtest.cn:51090/upload`,
    ...overrides
  }
}

describe('Speedtest.cn regional node discovery', () => {
  it('keeps endpoint-valid regional nodes regardless of active/private flags', () => {
    const parsed = parseSpeedtestCnResponse(
      encryptedResponse([
        node(1),
        node(2, { active: '2' }),
        node(3, { isPrivate: 1 }),
        node(4, { uploadUrl: 'https://other.example/upload' })
      ])
    )

    expect(parsed.map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(parsed[0]).toMatchObject({ city: '西安', operator: '移动' })
    expect(parsed[0]).not.toHaveProperty('ip')
    expect(parsed[0]).not.toHaveProperty('meta')
  })

  it('returns each endpoint-valid node from the regional API response', async () => {
    const requestUrls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      requestUrls.push(String(input))
      return new Response(JSON.stringify(encryptedResponse([node(1), node(2), node(3)])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const channels = await resolveSpeedtestCnChannels(fetcher)

    expect(requestUrls).toHaveLength(1)
    const request = new URL(requestUrls[0])
    expect(request.hostname).toBe('nodes-api.speedtest.cn')
    expect(request.searchParams.get('type')).toBe('multi')
    expect(request.searchParams.get('https')).toBe('1')
    expect(request.searchParams.get('browser')).toBe('1')
    expect(request.searchParams.get('domainType')).toBe('2')
    expect(request.searchParams.get('use_cdn')).toBe('1')
    expect(channels.map((channel) => channel.id)).toEqual([
      'speedtest-cn:1',
      'speedtest-cn:2',
      'speedtest-cn:3'
    ])
    expect(channels[0]).toMatchObject({
      provider: 'speedtest-cn',
      region: 'domestic',
      city: '西安',
      uploadUrl: 'https://node-1.speedtest.cn:51090/upload',
      websocketUrl: 'wss://node-1.speedtest.cn:51090/ws'
    })
    expect(channels[0].label).toContain('#1')
  })

  it('fails with a generic message when the encrypted node payload is invalid', () => {
    expect(() => parseSpeedtestCnResponse({ data: 'not encrypted' })).toThrow(
      '测速网节点列表格式异常'
    )
  })
})

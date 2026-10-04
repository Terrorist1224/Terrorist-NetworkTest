import { createDecipheriv } from 'node:crypto'
import type { Channel } from '../shared/types'

const NODE_API_URL = 'https://nodes-api.speedtest.cn/'
const NODE_API_PARAMS = {
  type: 'multi',
  https: '1',
  browser: '1',
  domainType: '2',
  use_cdn: '1'
}
const RESPONSE_KEY = '5ECC5D62140EC099'
const RESPONSE_IV = 'E63EA892A702EEAA'
interface SpeedtestCnNode {
  id: string
  province: string
  city: string
  operator: string
  distance: number
  websocketUrl: string
  downloadUrl: string
  uploadUrl: string
}

function validNodeUrl(value: unknown, protocols: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (
      !protocols.includes(url.protocol) ||
      (url.hostname !== 'speedtest.cn' && !url.hostname.endsWith('.speedtest.cn')) ||
      url.username ||
      url.password
    )
      return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export function parseSpeedtestCnResponse(response: unknown): SpeedtestCnNode[] {
  try {
    const encrypted = (response as { data?: unknown } | null)?.data
    if (typeof encrypted !== 'string') throw new Error()
    const bytes = Buffer.from(encrypted, 'base64')
    const decipher = createDecipheriv(
      'aes-128-cbc',
      Buffer.from(RESPONSE_KEY, 'utf8'),
      Buffer.from(RESPONSE_IV, 'utf8')
    )
    const clearText = Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(clearText) as { data?: unknown }
    if (!Array.isArray(parsed.data)) throw new Error()

    const nodes: SpeedtestCnNode[] = []
    const seen = new Set<string>()
    for (const item of parsed.data) {
      if (!item || typeof item !== 'object') continue
      const node = item as Record<string, unknown>
      const id = String(node.id ?? '')
      const websocketUrl = validNodeUrl(node.websocketUrl, ['wss:', 'ws:'])
      const downloadUrl = validNodeUrl(node.downloadUrl, ['https:', 'http:'])
      const uploadUrl = validNodeUrl(node.uploadUrl, ['https:', 'http:'])
      if (!id || seen.has(id) || !websocketUrl || !downloadUrl || !uploadUrl) continue
      seen.add(id)
      nodes.push({
        id,
        province: typeof node.province === 'string' ? node.province : '',
        city: typeof node.city === 'string' ? node.city : '',
        operator: typeof node.operator === 'string' ? node.operator : '',
        distance: Number.isFinite(Number(node.distance))
          ? Number(node.distance)
          : Number.MAX_SAFE_INTEGER,
        websocketUrl,
        downloadUrl,
        uploadUrl
      })
    }
    // The response metadata can contain the caller's public IP. It is intentionally discarded.
    return nodes
  } catch {
    throw new Error('测速网节点列表格式异常')
  }
}

function toChannel(node: SpeedtestCnNode): Channel {
  const location = [node.province, node.city].filter(Boolean).join(' · ')
  const details = [location, node.operator, `#${node.id}`].filter(Boolean).join(' · ')
  return {
    id: `speedtest-cn:${node.id}`,
    label: `测速网 · ${details}`,
    url: node.downloadUrl,
    uploadUrl: node.uploadUrl,
    websocketUrl: node.websocketUrl,
    region: 'domestic',
    provider: 'speedtest-cn',
    province: node.province,
    city: node.city,
    operator: node.operator
  }
}

export async function resolveSpeedtestCnChannels(
  fetcher: typeof fetch = fetch
): Promise<Channel[]> {
  const url = new URL(NODE_API_URL)
  for (const [key, value] of Object.entries(NODE_API_PARAMS)) url.searchParams.set(key, value)

  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    })
  } catch {
    throw new Error('测速网节点列表暂不可用')
  }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => undefined)
    throw new Error(`测速网节点列表响应异常：HTTP ${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('测速网节点列表格式异常')
  }
  const candidates = parseSpeedtestCnResponse(body)
  if (!candidates.length) throw new Error('测速网当前没有可用的区域节点')
  return candidates.map(toChannel)
}

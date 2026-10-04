import { isIP } from 'node:net'
import type { IpGeoInfo, IpProbeResult } from '../shared/types'

const GEOJS_URL = 'https://get.geojs.io/v1/ip/geo.json'
const REQUEST_TIMEOUT_MS = 10_000
type Fetcher = typeof fetch

interface JsonReply {
  ok: boolean
  status: number
  body: Record<string, unknown> | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function requestJson(fetcher: Fetcher, timeoutMs: number): Promise<JsonReply> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetcher(GEOJS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    let body: Record<string, unknown> | null = null
    try {
      body = asObject(await response.json())
    } catch {
      // Invalid response data is reported using the HTTP status below.
    }
    return { ok: response.ok, status: response.status, body }
  } catch {
    throw new Error(timedOut ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
}

function mapGeo(body: Record<string, unknown>): IpGeoInfo | null {
  const ip = optionalText(body.ip)
  if (!ip || isIP(ip) === 0) return null
  const latitude = optionalNumber(body.latitude)
  const longitude = optionalNumber(body.longitude)
  const asn = body.asn
  return {
    ip,
    country: optionalText(body.country),
    countryCode: optionalText(body.country_code),
    region: optionalText(body.region),
    city: optionalText(body.city),
    continent: optionalText(body.continent_code),
    asn: typeof asn === 'number' || typeof asn === 'string' ? asn : null,
    organization: optionalText(body.organization_name),
    latitude: latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null,
    timezone: optionalText(body.timezone),
    accuracyKm: optionalNumber(body.accuracy)
  }
}

export class IpProbeService {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async lookup(): Promise<IpProbeResult> {
    let reply: JsonReply
    try {
      reply = await requestJson(this.fetcher, this.timeoutMs)
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === 'timeout'
          ? 'GeoJS 查询超时，请稍后重试。'
          : 'GeoJS 网络请求失败，请检查网络后重试。'
      )
    }
    if (!reply.ok) throw new Error(`GeoJS 查询失败（HTTP ${reply.status}）。`)
    const geo = reply.body ? mapGeo(reply.body) : null
    if (!geo) throw new Error('GeoJS 未返回有效的公网 IP 信息。')
    return { geo, geoQueriedAt: Date.now() }
  }
}

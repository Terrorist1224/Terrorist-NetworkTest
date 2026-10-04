import { describe, expect, it } from 'vitest'
import { IpProbeService } from '../src/main/ip-probe'

const geoReply = {
  ip: '203.0.113.10',
  country: 'Example Country',
  country_code: 'EX',
  region: 'Example Region',
  city: 'Example City',
  continent_code: 'EX',
  asn: 64500,
  organization_name: 'Example Network',
  latitude: '10.5',
  longitude: '20.5',
  timezone: 'Etc/UTC',
  accuracy: 20
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('IP probe service', () => {
  it('returns GeoJS public IP details and numeric map coordinates', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return jsonResponse(geoReply)
    }

    const result = await new IpProbeService(fetcher).lookup()

    expect(result.geo).toMatchObject({
      ip: geoReply.ip,
      country: geoReply.country,
      city: geoReply.city,
      asn: geoReply.asn,
      organization: geoReply.organization_name,
      latitude: 10.5,
      longitude: 20.5,
      accuracyKm: 20
    })
    expect(result.geoQueriedAt).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://get.geojs.io/v1/ip/geo.json')
    expect(requests[0].init?.headers).toEqual({ Accept: 'application/json' })
  })

  it('keeps the IP result when GeoJS coordinates are missing or invalid', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ ...geoReply, latitude: '91', longitude: 'not-a-coordinate' })

    const result = await new IpProbeService(fetcher).lookup()

    expect(result.geo.ip).toBe(geoReply.ip)
    expect(result.geo.latitude).toBeNull()
    expect(result.geo.longitude).toBeNull()
  })

  it('rejects a response without a valid IP address', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({ ...geoReply, ip: 'unknown' })

    await expect(new IpProbeService(fetcher).lookup()).rejects.toThrow(
      'GeoJS 未返回有效的公网 IP 信息'
    )
  })

  it('reports HTTP errors and timeouts from GeoJS', async () => {
    const httpError: typeof fetch = async () => jsonResponse({}, 503)
    await expect(new IpProbeService(httpError).lookup()).rejects.toThrow('HTTP 503')

    const timeout: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        const onAbort = (): void => reject(new Error('aborted'))
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      })
    await expect(new IpProbeService(timeout, 5).lookup()).rejects.toThrow('GeoJS 查询超时')
  })

  it('reports network failures without exposing response details', async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error('internal network error')
    }
    await expect(new IpProbeService(fetcher).lookup()).rejects.toThrow(
      'GeoJS 网络请求失败，请检查网络后重试。'
    )
  })
})

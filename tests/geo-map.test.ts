import { describe, expect, it } from 'vitest'
import { createIpLocationMapUrl } from '../src/renderer/src/geo-map'

describe('IP location map URL', () => {
  it('centers an OpenStreetMap embed on the GeoJS coordinates', () => {
    const url = createIpLocationMapUrl({
      latitude: 10.5,
      longitude: 20.5,
      accuracyKm: 20
    })

    expect(url).not.toBeNull()
    const parsed = new URL(url!)
    expect(parsed.origin).toBe('https://www.openstreetmap.org')
    expect(parsed.pathname).toBe('/export/embed.html')
    expect(parsed.searchParams.get('layer')).toBe('mapnik')
    expect(parsed.searchParams.get('marker')).toBe('10.50000,20.50000')
    const bounds = parsed.searchParams.get('bbox')!.split(',').map(Number)
    expect(bounds).toHaveLength(4)
    expect(bounds[0]).toBeLessThan(20.5)
    expect(bounds[1]).toBeLessThan(10.5)
    expect(bounds[2]).toBeGreaterThan(20.5)
    expect(bounds[3]).toBeGreaterThan(10.5)
  })

  it('does not create a map URL for missing or unsupported coordinates', () => {
    expect(createIpLocationMapUrl({ latitude: null, longitude: 20, accuracyKm: null })).toBeNull()
    expect(createIpLocationMapUrl({ latitude: 90, longitude: 20, accuracyKm: null })).toBeNull()
  })
})

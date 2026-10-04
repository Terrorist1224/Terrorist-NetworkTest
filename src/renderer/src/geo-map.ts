import type { IpGeoInfo } from '../../shared/types'

const MAX_MERCATOR_LATITUDE = 85.05112878
const EARTH_KM_PER_DEGREE = 111.32
const DEFAULT_ACCURACY_KM = 20
const MIN_MAP_RADIUS_KM = 5
const MAX_MAP_RADIUS_KM = 100

export function createIpLocationMapUrl(
  geo: Pick<IpGeoInfo, 'latitude' | 'longitude' | 'accuracyKm'>
): string | null {
  const { latitude, longitude } = geo
  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -MAX_MERCATOR_LATITUDE ||
    latitude > MAX_MERCATOR_LATITUDE ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  const accuracyKm = geo.accuracyKm ?? DEFAULT_ACCURACY_KM
  const radiusKm = Math.max(MIN_MAP_RADIUS_KM, Math.min(MAX_MAP_RADIUS_KM, accuracyKm))
  const latitudePadding = radiusKm / EARTH_KM_PER_DEGREE
  const longitudePadding = Math.min(
    180,
    latitudePadding / Math.max(Math.cos((latitude * Math.PI) / 180), 0.15)
  )
  const bbox = [
    Math.max(-180, longitude - longitudePadding),
    Math.max(-MAX_MERCATOR_LATITUDE, latitude - latitudePadding),
    Math.min(180, longitude + longitudePadding),
    Math.min(MAX_MERCATOR_LATITUDE, latitude + latitudePadding)
  ]
    .map((coordinate) => coordinate.toFixed(5))
    .join(',')
  const params = new URLSearchParams({
    bbox,
    layer: 'mapnik',
    marker: `${latitude.toFixed(5)},${longitude.toFixed(5)}`
  })
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`
}

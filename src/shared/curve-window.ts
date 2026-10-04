import type { SpeedSample, TestRecord, TestSegment } from './types'

export const CURVE_WINDOW_MS = 60_000
export const MAX_CURVE_SAMPLES = 120
export const MAX_CURVE_SEGMENTS = 64

function keepRecent<T extends { at: number }>(items: T[], cutoff: number, maxItems: number): T[] {
  const recent = items.filter((item) => item.at >= cutoff)
  return recent.length > maxItems ? recent.slice(-maxItems) : recent
}

export function trimCurveData(record: TestRecord, referenceAt: number): void {
  const cutoff = referenceAt - CURVE_WINDOW_MS
  record.samples = keepRecent<SpeedSample>(record.samples, cutoff, MAX_CURVE_SAMPLES)
  record.uploadSamples = keepRecent<SpeedSample>(record.uploadSamples, cutoff, MAX_CURVE_SAMPLES)

  const currentSegment = record.segments.at(-1)
  const recentSegments = record.segments.filter(
    (segment) => segment.at >= cutoff || (segment === currentSegment && !segment.endAt)
  )
  record.segments =
    recentSegments.length > MAX_CURVE_SEGMENTS
      ? recentSegments.slice(-MAX_CURVE_SEGMENTS)
      : recentSegments
}

export function latestCurveTime(
  samples: readonly SpeedSample[],
  segments: readonly TestSegment[],
  fallback: number
): number {
  return Math.max(fallback, samples.at(-1)?.at ?? 0, segments.at(-1)?.at ?? 0)
}

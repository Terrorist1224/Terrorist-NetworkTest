import { describe, expect, it } from 'vitest'
import { speedForDisplay } from '../src/renderer/src/format'

describe('speed display selection', () => {
  it('keeps the latest sample while running or paused and uses the average after stopping', () => {
    const latestSample = 4 * 1024 * 1024
    const average = 7 * 1024 * 1024

    expect(speedForDisplay(latestSample, average, true, false)).toBe(latestSample)
    expect(speedForDisplay(latestSample, average, false, true)).toBe(latestSample)
    expect(speedForDisplay(latestSample, average, false, false)).toBe(average)
  })
})

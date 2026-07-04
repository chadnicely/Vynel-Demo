// Unit tests for `detectContextPressure` — the tested threshold logic.

import { describe, expect, it } from 'vitest'
import {
  detectContextPressure,
  DEFAULT_CONTEXT_PRESSURE_THRESHOLD,
} from './detect-context-pressure.js'

describe('detectContextPressure', () => {
  it('computes the used/window ratio', () => {
    const pressure = detectContextPressure({ usedTokens: 100_000, contextWindow: 200_000 })
    expect(pressure.ratio).toBeCloseTo(0.5)
    expect(pressure.isUnderPressure).toBe(false)
    expect(pressure.threshold).toBe(DEFAULT_CONTEXT_PRESSURE_THRESHOLD)
  })

  it('is under pressure at or above the threshold (inclusive)', () => {
    const atThreshold = detectContextPressure(
      { usedTokens: 85, contextWindow: 100 },
      { threshold: 0.85 },
    )
    expect(atThreshold.isUnderPressure).toBe(true)

    const justBelow = detectContextPressure(
      { usedTokens: 84, contextWindow: 100 },
      { threshold: 0.85 },
    )
    expect(justBelow.isUnderPressure).toBe(false)
  })

  it('honors a custom threshold', () => {
    const pressure = detectContextPressure(
      { usedTokens: 60, contextWindow: 100 },
      { threshold: 0.5 },
    )
    expect(pressure.isUnderPressure).toBe(true)
    expect(pressure.threshold).toBe(0.5)
  })

  it('returns ratio 0 (not under pressure) when the window is unknown', () => {
    const pressure = detectContextPressure({ usedTokens: 1000, contextWindow: 0 })
    expect(pressure.ratio).toBe(0)
    expect(pressure.isUnderPressure).toBe(false)
  })

  it('clamps the ratio to 1 when usage exceeds the window', () => {
    const pressure = detectContextPressure({ usedTokens: 250_000, contextWindow: 200_000 })
    expect(pressure.ratio).toBe(1)
    expect(pressure.isUnderPressure).toBe(true)
  })
})

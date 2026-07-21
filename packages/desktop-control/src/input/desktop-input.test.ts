import { describe, it, expect } from 'vitest'
import { translatePoint, actOnDesktop } from './desktop-input.js'

describe('translatePoint', () => {
  it('returns absolute coordinates unchanged with a zero frame', () => {
    expect(translatePoint({ offsetX: 0, offsetY: 0 }, 120, 340)).toEqual({ x: 120, y: 340 })
  })

  it('adds the window origin for window-relative coordinates', () => {
    // A screenshot-relative (10, 20) inside a window at (1600, 300) → screen coords.
    expect(translatePoint({ offsetX: 1600, offsetY: 300 }, 10, 20)).toEqual({ x: 1610, y: 320 })
  })

  it('rounds fractional coordinates (pixels are integers)', () => {
    expect(translatePoint({ offsetX: 0.4, offsetY: 0 }, 10.6, 5.5)).toEqual({ x: 11, y: 6 })
  })
})

// These guards run BEFORE nut.js loads (validation happens before the engine is
// touched), so they exercise the fail-closed paths with no native binary — the
// same pattern as actOnApp's guard tests.
describe('actOnDesktop — fail-closed validation (before the input engine loads)', () => {
  it('rejects a click with missing coordinates', async () => {
    await expect(actOnDesktop({ action: 'click', x: 10 })).rejects.toThrow(/requires a numeric "y"/)
    await expect(actOnDesktop({ action: 'click' })).rejects.toThrow(/requires a numeric "x"/)
  })

  it('rejects a type with no text', async () => {
    await expect(actOnDesktop({ action: 'type' })).rejects.toThrow(/requires a non-empty "text"/)
    await expect(actOnDesktop({ action: 'type', text: '' })).rejects.toThrow(/non-empty "text"/)
  })

  it('rejects a press with no keys', async () => {
    await expect(actOnDesktop({ action: 'press' })).rejects.toThrow(/requires "keys"/)
  })

  it('rejects a drag missing a target', async () => {
    await expect(actOnDesktop({ action: 'drag', x: 1, y: 2, toX: 3 })).rejects.toThrow(
      /requires a numeric "toY"/,
    )
  })
})

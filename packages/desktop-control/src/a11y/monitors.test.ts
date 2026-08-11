import { describe, expect, it } from 'vitest'
import { readMonitor, toLogicalExtent } from './monitors.js'
import type { NativeMonitor } from './screenshot-adapter.js'

/** A stand-in for the native binding — every field is a METHOD there, so the
 *  fake mirrors that rather than being a plain object. */
function fakeMonitor(overrides: Partial<Record<string, unknown>> = {}): NativeMonitor {
  const values = {
    id: 1,
    name: 'Display 1',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    scaleFactor: 1,
    isPrimary: true,
    ...overrides,
  }
  return {
    id: () => values['id'] as number,
    name: () => values['name'] as string,
    x: () => values['x'] as number,
    y: () => values['y'] as number,
    width: () => values['width'] as number,
    height: () => values['height'] as number,
    rotation: () => values['rotation'] as number,
    scaleFactor: () => values['scaleFactor'] as number,
    isPrimary: () => values['isPrimary'] as boolean,
  }
}

describe('toLogicalExtent', () => {
  it('is the identity at 100%', () => {
    expect(toLogicalExtent(1920, 1)).toBe(1920)
  })

  it('divides by the scale factor — 1350 physical at 125% is 1080 to aim in', () => {
    expect(toLogicalExtent(1350, 1.25)).toBe(1080)
  })

  it('falls back to the physical extent for a nonsense factor rather than dividing by zero', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toLogicalExtent(1920, bad)).toBe(1920)
    }
  })
})

describe('readMonitor', () => {
  it('reports physical and logical size separately — they differ on a scaled display', () => {
    // The real second display measured 2026-08-11: portrait, 125%, placed left
    // of and above the primary, so its origin is NEGATIVE.
    const info = readMonitor(
      fakeMonitor({
        id: 131073,
        name: 'Display 2',
        x: -1080,
        y: -847,
        width: 1080,
        height: 1920,
        rotation: 270,
        scaleFactor: 1.25,
        isPrimary: false,
      }),
    )
    expect(info).toEqual({
      id: 131073,
      name: 'Display 2',
      x: -1080,
      y: -847,
      physicalWidth: 1080,
      physicalHeight: 1920,
      logicalWidth: 864,
      logicalHeight: 1536,
      scaleFactor: 1.25,
      rotationDegrees: 270,
      isPrimary: false,
    })
  })

  it('keeps negative origins intact — a display left of the primary is not an error', () => {
    const info = readMonitor(fakeMonitor({ x: -1920, y: -200, isPrimary: false }))
    expect(info.x).toBe(-1920)
    expect(info.y).toBe(-200)
  })

  it('leaves an unscaled display untouched', () => {
    const info = readMonitor(fakeMonitor())
    expect(info.logicalWidth).toBe(info.physicalWidth)
    expect(info.logicalHeight).toBe(info.physicalHeight)
  })

  it('degrades a broken scale factor to 1 instead of emitting NaN geometry', () => {
    const info = readMonitor(fakeMonitor({ scaleFactor: 0 }))
    expect(info.scaleFactor).toBe(1)
    expect(info.logicalWidth).toBe(1920)
  })
})

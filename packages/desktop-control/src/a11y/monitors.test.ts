import { describe, expect, it } from 'vitest'
import { readMonitor } from './monitors.js'
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
    captureImageSync: () => {
      throw new Error('fakeMonitor does not capture — geometry tests only')
    },
  }
}

describe('readMonitor', () => {
  // THE regression this file exists for. An earlier version derived a "logical"
  // size (physical ÷ scaleFactor) on the theory that origin and size were in
  // different units. Measuring it properly disproved that: a
  // per-monitor-DPI-aware process — the frame clicks and window moves both run
  // in — reports this exact panel as -1080,-847 1080x1920, identical to the
  // binding. The invented 864x1536 would have made "fill this screen" cover 64%.
  it('reports the display EXACTLY as given — nothing is scaled or corrected', () => {
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
      width: 1080,
      height: 1920,
      scaleFactor: 1.25,
      rotationDegrees: 270,
      isPrimary: false,
    })
    // Named explicitly so a future "helpful" division fails here first.
    expect(info.width).not.toBe(864)
    expect(info.height).not.toBe(1536)
  })

  it('keeps negative origins intact — a display left of the primary is not an error', () => {
    const info = readMonitor(fakeMonitor({ x: -1920, y: -200, isPrimary: false }))
    expect(info.x).toBe(-1920)
    expect(info.y).toBe(-200)
  })

  it('a scaled display reports the same size an unscaled one would', () => {
    const scaled = readMonitor(fakeMonitor({ scaleFactor: 1.5 }))
    const plain = readMonitor(fakeMonitor())
    expect(scaled.width).toBe(plain.width)
    expect(scaled.height).toBe(plain.height)
  })

  it('degrades a broken scale factor to 1 without touching the geometry', () => {
    const info = readMonitor(fakeMonitor({ scaleFactor: 0 }))
    expect(info.scaleFactor).toBe(1)
    expect(info.width).toBe(1920)
  })
})

import { describe, it, expect } from 'vitest'
import { selectWindowId, screenshotApp, clampZoomRegion, type WindowInfo } from './screenshot-adapter.js'

// Plain window snapshots — the SAME shape the adapter reads native windows into
// at the binding boundary, so the ranking is tested on real data, not a fake
// that could re-encode a wrong assumption about the native object's shape.
function windowInfo(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    id: 1,
    appName: 'App',
    title: 'Window',
    isMinimized: false,
    width: 800,
    height: 600,
    ...overrides,
  }
}

describe('selectWindowId', () => {
  it('ranks like the a11y pid fallback: app-name match > title match, longest title wins', () => {
    const windows = [
      windowInfo({ id: 1, appName: 'Code', title: 'a.ts - discord-bot - Visual Studio Code' }),
      windowInfo({ id: 2, appName: 'Discord', title: '' }),
      windowInfo({ id: 3, appName: 'Discord', title: '@user - #general - Discord' }),
    ]
    expect(selectWindowId(windows, 'discord')).toBe(3)
  })

  it('returns null when nothing matches or the query is blank', () => {
    const windows = [windowInfo({ id: 1, appName: 'Notepad', title: 'notes.txt - Notepad' })]
    expect(selectWindowId(windows, 'discord')).toBeNull()
    expect(selectWindowId(windows, '   ')).toBeNull()
  })
})

describe('screenshotApp — fail-closed guards (run before the native binary loads)', () => {
  it('rejects an empty/whitespace app name — never captures an arbitrary window', async () => {
    await expect(screenshotApp('')).rejects.toThrow(/app name .*is required/)
    await expect(screenshotApp('   ')).rejects.toThrow(/app name .*is required/)
  })
})

describe('clampZoomRegion', () => {
  it('passes a fully-inside region through (floored to whole pixels)', () => {
    expect(clampZoomRegion({ x: 10.7, y: 20.2, width: 100.9, height: 50.5 }, 1920, 1080)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('clamps a region that overflows the image edges', () => {
    expect(clampZoomRegion({ x: 1800, y: 1000, width: 500, height: 500 }, 1920, 1080)).toEqual({
      x: 1800,
      y: 1000,
      width: 120,
      height: 80,
    })
  })

  it('degrades to null (full capture) when the region lies outside the image', () => {
    expect(clampZoomRegion({ x: 2000, y: 10, width: 100, height: 100 }, 1920, 1080)).toBeNull()
    expect(clampZoomRegion({ x: 10, y: 10, width: 0, height: 100 }, 1920, 1080)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { selectWindowId, screenshotApp, type WindowInfo } from './screenshot-adapter.js'

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

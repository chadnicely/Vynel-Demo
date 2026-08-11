import { describe, it, expect } from 'vitest'
import {
  isAppNameMatch,
  actionRequiresValue,
  actOnApp,
  resolveDesktopTimeout,
  MAX_DESKTOP_TIMEOUT_MS,
} from './xa11y-adapter.js'

describe('isAppNameMatch', () => {
  it('matches a substring of a dynamic window title, case-insensitively', () => {
    expect(isAppNameMatch('*Servers.txt - Notepad', 'notepad')).toBe(true)
    expect(isAppNameMatch('YouTube - Google Chrome', 'chrome')).toBe(true)
    expect(isAppNameMatch('Calculator', 'CALC')).toBe(true)
  })

  it('does not match an unrelated app', () => {
    expect(isAppNameMatch('Calculator', 'notepad')).toBe(false)
  })

  it('trims surrounding whitespace from the query', () => {
    expect(isAppNameMatch('Notepad', '  notepad  ')).toBe(true)
  })

  it('an empty query matches anything (snapshotApp guards against empty separately)', () => {
    expect(isAppNameMatch('Anything', '')).toBe(true)
  })
})

describe('actionRequiresValue', () => {
  it('requires a value for text-entry actions but not for press', () => {
    expect(actionRequiresValue('press')).toBe(false)
    expect(actionRequiresValue('type_text')).toBe(true)
    expect(actionRequiresValue('set_value')).toBe(true)
  })
})

describe('actOnApp — fail-closed guards (run before xa11y loads)', () => {
  it('rejects an empty/whitespace app name — never acts on a default app', async () => {
    await expect(actOnApp('', 'button[name="X"]', 'press')).rejects.toThrow(/app name is required/)
    await expect(actOnApp('   ', 'button[name="X"]', 'press')).rejects.toThrow(/app name is required/)
  })

  it('rejects an empty selector', async () => {
    await expect(actOnApp('Calculator', '   ', 'press')).rejects.toThrow(/selector is required/)
  })

  it('rejects a text action with no value', async () => {
    await expect(actOnApp('Calculator', 'edit', 'type_text')).rejects.toThrow(/requires a non-empty value/)
  })
})

describe('resolveDesktopTimeout', () => {
  it('uses the default when nothing sensible was asked for', () => {
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveDesktopTimeout(bad, 25_000)).toBe(25_000)
    }
  })

  it('honours a longer request — the point is retrying a slow app with more room', () => {
    expect(resolveDesktopTimeout(60_000, 25_000)).toBe(60_000)
  })

  // Shortening only manufactures failures; the useful direction is upward.
  it('ignores a request BELOW the default', () => {
    expect(resolveDesktopTimeout(500, 25_000)).toBe(25_000)
  })

  it('caps the ceiling — an unbounded timeout is a hang with extra steps', () => {
    expect(resolveDesktopTimeout(999_999_999, 25_000)).toBe(MAX_DESKTOP_TIMEOUT_MS)
  })
})

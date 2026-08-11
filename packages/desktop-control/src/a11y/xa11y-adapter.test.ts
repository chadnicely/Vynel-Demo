import { describe, it, expect } from 'vitest'
import { isAppNameMatch, actionRequiresValue, actOnApp } from './xa11y-adapter.js'

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


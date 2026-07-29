import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSION_MODE, SESSION_MODES, toPermissionMode } from './session-mode.js'

describe('toPermissionMode', () => {
  it('maps each user-facing mode to its provider permission mode', () => {
    expect(toPermissionMode('ask')).toBe('ask')
    expect(toPermissionMode('auto')).toBe('auto')
    // test: correct expectation — the user's bypass maps to the truly-silent
    // provider mode since 2026-07-30; `bypass-with-behavior-gate` remains the
    // UNATTENDED default no user-facing mode maps to.
    expect(toPermissionMode('bypass')).toBe('bypass')
  })
})

describe('SESSION_MODES', () => {
  it('covers exactly ask/auto/bypass, each with a label + description', () => {
    expect(SESSION_MODES.map((entry) => entry.mode)).toEqual(['ask', 'auto', 'bypass'])
    for (const entry of SESSION_MODES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('every catalog mode resolves to a provider permission mode', () => {
    for (const { mode } of SESSION_MODES) {
      expect(toPermissionMode(mode)).toBeTruthy()
    }
  })
})

describe('DEFAULT_SESSION_MODE', () => {
  it('is one of the three user-facing modes (ask for v1)', () => {
    expect(SESSION_MODES.map((entry) => entry.mode)).toContain(DEFAULT_SESSION_MODE)
    expect(DEFAULT_SESSION_MODE).toBe('ask')
  })
})

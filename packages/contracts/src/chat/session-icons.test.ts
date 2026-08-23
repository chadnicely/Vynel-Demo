// The curated session-icon vocabulary — the guard admits exactly the catalog.

import { describe, expect, it } from 'vitest'
import { SESSION_ICONS, isSessionIcon } from './session-icons.js'

describe('isSessionIcon', () => {
  it('accepts every catalog name', () => {
    for (const name of SESSION_ICONS) {
      expect(isSessionIcon(name)).toBe(true)
    }
  })

  it('rejects what no surface can draw', () => {
    expect(isSessionIcon('sparkles')).toBe(false)
    expect(isSessionIcon('')).toBe(false)
    expect(isSessionIcon(null)).toBe(false)
    expect(isSessionIcon(undefined)).toBe(false)
    expect(isSessionIcon(42)).toBe(false)
  })
})

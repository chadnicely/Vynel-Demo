// Tests for OS detection helpers. These must not throw on any supported
// Node 22 environment (macOS / Windows / Linux).

import { describe, it, expect } from 'vitest'
import { detectOsUsername, detectOsLocale, detectOsTimezone } from './os-detection.js'

describe('os-detection', () => {
  it('detectOsUsername returns a non-empty string or null (never throws)', () => {
    const username = detectOsUsername()
    if (username !== null) {
      expect(username.length).toBeGreaterThan(0)
    }
  })

  it('detectOsLocale always returns a non-empty BCP-47 shaped string', () => {
    const locale = detectOsLocale()
    expect(locale.length).toBeGreaterThan(0)
    expect(locale).toMatch(/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  })

  it('detectOsTimezone always returns a non-empty IANA-shaped string', () => {
    const tz = detectOsTimezone()
    expect(tz.length).toBeGreaterThan(0)
    // IANA names use `/` separators or are short single-segment names
    // like `UTC`. Allow both shapes.
    expect(tz).toMatch(/^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$/)
  })
})

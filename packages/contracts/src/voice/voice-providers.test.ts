import { describe, expect, it } from 'vitest'
import { WAKE_NAME_MAX_LENGTH, isValidWakeName } from './voice-providers.js'

// The ONE predicate the Settings input, the prefs route, and the daemon's
// read all share — the wake name's whole validity story in one place.
describe('isValidWakeName', () => {
  it('accepts one word of letters, with digits or an apostrophe after the first letter', () => {
    expect(isValidWakeName('Friday')).toBe(true)
    expect(isValidWakeName("D'arcy")).toBe(true)
    expect(isValidWakeName('r2d2')).toBe(true)
    expect(isValidWakeName('abc')).toBe(true)
  })

  it('refuses what the loose matcher could not contain', () => {
    // Min 3: a 2-letter name is a false-wake machine ("Jo" vs no/so/go).
    expect(isValidWakeName('Jo')).toBe(false)
    expect(isValidWakeName('')).toBe(false)
    expect(isValidWakeName('two words')).toBe(false)
    expect(isValidWakeName('2pac')).toBe(false) // must start with a letter
    expect(isValidWakeName('a'.repeat(WAKE_NAME_MAX_LENGTH + 1))).toBe(false)
    expect(isValidWakeName(42)).toBe(false)
  })
})

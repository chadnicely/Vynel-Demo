import { describe, it, expect } from 'vitest'
import { pickTopmostWindowAt, resolveAppIdentity, type WindowHitCandidate } from './window-identity.js'

describe('pickTopmostWindowAt', () => {
  const candidate = (overrides: Partial<WindowHitCandidate>): WindowHitCandidate => ({
    appName: 'App',
    isMinimized: false,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 0,
    ...overrides,
  })

  it('picks the HIGHEST z among windows containing the point, regardless of list order', () => {
    const bottomFirst = [
      candidate({ appName: 'Below', z: 10 }),
      candidate({ appName: 'OnTop', z: 90 }),
    ]
    expect(pickTopmostWindowAt(bottomFirst, 50, 50)?.appName).toBe('OnTop')
    expect(pickTopmostWindowAt([...bottomFirst].reverse(), 50, 50)?.appName).toBe('OnTop')
  })

  it('ignores minimized windows and windows not containing the point', () => {
    const candidates = [
      candidate({ appName: 'Minimized', z: 99, isMinimized: true }),
      candidate({ appName: 'Elsewhere', z: 98, x: 500 }),
      candidate({ appName: 'Hit', z: 1 }),
    ]
    expect(pickTopmostWindowAt(candidates, 50, 50)?.appName).toBe('Hit')
  })

  it('returns null when nothing contains the point (fail closed at the caller)', () => {
    expect(pickTopmostWindowAt([candidate({})], 500, 500)).toBeNull()
  })
})

describe('resolveAppIdentity', () => {
  it('prefers the pid-mapped APP name over the caller name (the window title)', () => {
    // The bug this exists for: xa11y hands us "Vynel – Google Chrome", which
    // becomes a different string on the next tab switch.
    expect(resolveAppIdentity(4242, 'Vynel – Google Chrome', () => 'Google Chrome')).toBe(
      'Google Chrome',
    )
  })

  it('falls back to the caller name when the pid maps to nothing', () => {
    expect(resolveAppIdentity(4242, 'Some App', () => null)).toBe('Some App')
  })

  it('falls back when there is no pid at all', () => {
    expect(
      resolveAppIdentity(null, 'Some App', () => {
        throw new Error('lookup must not run without a pid')
      }),
    ).toBe('Some App')
  })
})

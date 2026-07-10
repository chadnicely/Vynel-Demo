// Pins the two behaviors that matter: windows actually reset with time, and
// the overflow sweep removes only EXPIRED entries (an attacker burning junk
// keys must not reset a live target window).

import { describe, it, expect } from 'vitest'
import { createFixedWindowRateLimiter } from './rate-limit.js'

describe('createFixedWindowRateLimiter', () => {
  it('blocks past the limit and resets on the next window', () => {
    let clock = 0
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => clock })
    limiter.consume('a')
    limiter.consume('a')
    expect(() => limiter.consume('a')).toThrowError(/Too many attempts/)
    clock = 1000
    expect(() => limiter.consume('a')).not.toThrow()
  })

  it('keeps keys independent', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
    limiter.consume('a')
    expect(() => limiter.consume('b')).not.toThrow()
    expect(() => limiter.consume('a')).toThrowError(/Too many attempts/)
  })

  it('overflow sweep never resets a LIVE window', () => {
    let clock = 0
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock })
    // The target key is at its limit inside a live window.
    limiter.consume('target')
    limiter.consume('target')
    // An attacker floods >10k distinct keys to force the sweep.
    for (let i = 0; i < 10_100; i += 1) {
      clock += 1 // still far inside every window
      limiter.consume(`junk-${i}`)
    }
    // The live target window must have survived the sweeps.
    expect(() => limiter.consume('target')).toThrowError(/Too many attempts/)
  })
})

import { describe, it, expect } from 'vitest'
import {
  pickIdentityForPid,
  pickTopmostWindowAt,
  resolveAppIdentity,
  type WindowHitCandidate,
} from './window-identity.js'

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

describe('resolveAppIdentity — the host backstop', () => {
  it('never returns a host name, whichever route it arrives by', () => {
    // A stale grant keyed "application frame host" exists in the dev database.
    // Making this unreachable is what actually closes the widening.
    expect(resolveAppIdentity(8828, 'x', () => 'Application Frame Host')).toBe('')
    expect(resolveAppIdentity(8828, 'Application Frame Host', () => null)).toBe('')
    expect(resolveAppIdentity(null, 'Application Frame Host')).toBe('')
  })

  it('still resolves a real app normally', () => {
    expect(resolveAppIdentity(42, 'Vynel - Google Chrome', () => 'Google Chrome')).toBe(
      'Google Chrome',
    )
  })

  it('lets an OBSERVED fallback answer an ambiguous hosted pid', () => {
    // The hosted pid is ambiguous, so the lookup returns null and the fallback
    // decides. That is correct ONLY because callers pass an observed name —
    // xa11y's resolved App.name, which IS the window it actually opened.
    expect(resolveAppIdentity(8828, 'Settings', () => null)).toBe('Settings')
  })

  it('a caller with nothing observed gets nothing back, not a guess', () => {
    // set_window_bounds passes '' rather than the model's query for this reason:
    // an unidentifiable window must produce no name at all.
    expect(resolveAppIdentity(8828, '', () => null)).toBe('')
  })
})

// The most substantive rule in the packaged-app fix, extracted pure for exactly
// this reason (the `pickTopmostWindowAt` precedent). Calculator and Settings
// both live on pid 8828 inside one ApplicationFrameHost — measured 2026-08-12.
describe('pickIdentityForPid', () => {
  const hosted = (title: string, pid = 8828) => ({
    pid,
    appName: 'Application Frame Host',
    title,
  })

  it('names a lone packaged app by its title', () => {
    expect(pickIdentityForPid([hosted('Calculator')], 8828)).toBe('Calculator')
  })

  it('refuses when one hosted pid owns TWO named apps', () => {
    // The security case. Answering either way names the wrong app half the time.
    expect(pickIdentityForPid([hosted('Calculator'), hosted('Settings')], 8828)).toBeNull()
  })

  it('still answers when the siblings are untitled', () => {
    // Untitled hosted windows cannot be addressed by name at all, so refusing
    // over them would break the ordinary single-Store-app case for nothing.
    expect(pickIdentityForPid([hosted('Calculator'), hosted(''), hosted('  ')], 8828)).toBe(
      'Calculator',
    )
  })

  it('ignores windows belonging to other pids', () => {
    expect(pickIdentityForPid([hosted('Calculator'), hosted('Settings', 999)], 8828)).toBe(
      'Calculator',
    )
  })

  it('is unaffected by an ordinary app owning several windows', () => {
    // Only the HOSTED class is ambiguous — Chrome's many windows are all Chrome.
    const chrome = (title: string) => ({ pid: 7, appName: 'Google Chrome', title })
    expect(pickIdentityForPid([chrome('Gmail'), chrome('Docs')], 7)).toBe('Google Chrome')
  })

  it('returns null for a pid with no windows', () => {
    expect(pickIdentityForPid([hosted('Calculator')], 4242)).toBeNull()
  })
})

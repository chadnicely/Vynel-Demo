import { describe, expect, it } from 'vitest'
import {
  clampWaitTimeout,
  conditionMet,
  conditionReadsContent,
  waitForCondition,
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  type WaitClock,
  type WaitProbes,
} from './wait-for-condition.js'

/** A clock the test drives by hand — no test ever waits in real time, and
 *  `sleep` advances it so the polling loop makes progress deterministically. */
function fakeClock(): WaitClock & { elapsed: () => number } {
  let current = 10_000
  const start = current
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms
    },
    elapsed: () => current - start,
  }
}

const neverOpen: WaitProbes = {
  readTree: async () => '',
  isAppOpen: async () => false,
}

/** The shape `assertDesktopAccess` throws — a denial that no wait can fix. */
function forbidden(message = 'No access to "X". Call request_desktop_access.'): Error {
  const error = new Error(message)
  error.name = 'ForbiddenError'
  return error
}

describe('clampWaitTimeout', () => {
  it('defaults when unset or nonsense — a wait must always be bounded', () => {
    for (const bad of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampWaitTimeout(bad)).toBe(DEFAULT_WAIT_TIMEOUT_MS)
    }
  })

  it('caps the ceiling — a model that could wait forever would park a turn', () => {
    expect(clampWaitTimeout(999_999)).toBe(MAX_WAIT_TIMEOUT_MS)
  })

  it('honours a sensible request', () => {
    expect(clampWaitTimeout(3_000)).toBe(3_000)
  })
})

describe('conditionMet', () => {
  it('matches text case-insensitively, anywhere in the tree', () => {
    const seen = { kind: 'read', tree: 'button[name="Send Message"]' } as const
    expect(conditionMet('text_appears', seen, 'send message')).toBe(true)
    expect(conditionMet('text_appears', seen, 'Reply')).toBe(false)
  })

  it('reads existence conditions off isOpen', () => {
    expect(conditionMet('app_appears', { kind: 'open-state', isOpen: true }, '')).toBe(true)
    expect(conditionMet('app_closes', { kind: 'open-state', isOpen: false }, '')).toBe(true)
    expect(conditionMet('app_closes', { kind: 'open-state', isOpen: true }, '')).toBe(false)
  })

  // THE security property. An earlier version collapsed "the read failed" into
  // "the tree is empty", so a DENIED grant satisfied text_disappears on the
  // first attempt and the refusal was reported to the model as success.
  describe('an UNREADABLE app proves nothing about content', () => {
    const unreadable = { kind: 'unreadable', error: 'no access' } as const

    it('does NOT satisfy text_disappears', () => {
      expect(conditionMet('text_disappears', unreadable, 'Saving…')).toBe(false)
    })

    it('does not satisfy text_appears or app_appears either', () => {
      expect(conditionMet('text_appears', unreadable, 'Done')).toBe(false)
      expect(conditionMet('app_appears', unreadable, '')).toBe(false)
    })

    it('DOES satisfy app_closes — that condition is about reachability', () => {
      expect(conditionMet('app_closes', unreadable, '')).toBe(true)
    })
  })
})

describe('conditionReadsContent', () => {
  it('separates content conditions (need a read grant) from existence ones', () => {
    expect(conditionReadsContent('text_appears')).toBe(true)
    expect(conditionReadsContent('text_disappears')).toBe(true)
    expect(conditionReadsContent('app_appears')).toBe(false)
    expect(conditionReadsContent('app_closes')).toBe(false)
  })
})

describe('waitForCondition', () => {
  it('returns IMMEDIATELY when the condition already holds — no sleep first', async () => {
    // The thing being waited for has often already happened by the time the
    // model asks; sleeping first would tax the common case.
    const clock = fakeClock()
    const outcome = await waitForCondition(
      { kind: 'text_appears', app: 'X', text: 'Done' },
      { readTree: async () => 'Done', isAppOpen: async () => true },
      clock,
    )
    expect(outcome.met).toBe(true)
    expect(outcome.attempts).toBe(1)
    expect(outcome.elapsedMs).toBe(0)
  })

  it('polls until the condition turns true', async () => {
    const clock = fakeClock()
    let look = 0
    const outcome = await waitForCondition(
      { kind: 'text_appears', app: 'X', text: 'Loaded' },
      { readTree: async () => (++look >= 3 ? 'Loaded' : 'Spinner'), isAppOpen: async () => true },
      clock,
    )
    expect(outcome.met).toBe(true)
    expect(outcome.attempts).toBe(3)
    expect(outcome.elapsedMs).toBeGreaterThan(0)
  })

  it('gives up at the deadline and says so, rather than hanging', async () => {
    const clock = fakeClock()
    const outcome = await waitForCondition(
      { kind: 'app_appears', app: 'NeverStarts', timeoutMs: 3_000 },
      neverOpen,
      clock,
    )
    expect(outcome.met).toBe(false)
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(3_000)
    // Bounded, not runaway: ~3s at a 750ms interval.
    expect(outcome.attempts).toBeLessThanOrEqual(6)
  })

  it('always LOOKS once, even at a zero budget', async () => {
    const clock = fakeClock()
    const outcome = await waitForCondition(
      { kind: 'app_appears', app: 'X', timeoutMs: 0 },
      { readTree: async () => '', isAppOpen: async () => true },
      clock,
    )
    expect(outcome.met).toBe(true)
    expect(outcome.attempts).toBe(1)
  })

  // A probe that throws is NOT the same as the condition being false — and one
  // condition is satisfied precisely BY reads failing.
  it('keeps waiting through a transient read failure, and reports it', async () => {
    const clock = fakeClock()
    let look = 0
    const outcome = await waitForCondition(
      { kind: 'text_appears', app: 'X', text: 'Ready', timeoutMs: 10_000 },
      {
        readTree: async () => {
          if (++look < 3) throw new Error('tree not readable yet')
          return 'Ready'
        },
        isAppOpen: async () => true,
      },
      clock,
    )
    expect(outcome.met).toBe(true)
    expect(outcome.lastError).toMatch(/not readable/)
  })

  it('treats an unreadable app as CLOSED for app_closes', async () => {
    const clock = fakeClock()
    const outcome = await waitForCondition(
      { kind: 'app_closes', app: 'Gone' },
      {
        readTree: async () => '',
        isAppOpen: async () => {
          throw new Error('app is gone')
        },
      },
      clock,
    )
    expect(outcome.met).toBe(true)
    expect(outcome.lastError).toMatch(/gone/)
  })

  // A denial can never come good on a later poll. Swallowing it would spend the
  // whole budget hiding the one thing the caller needs — and the recovery path
  // that error names.
  it('RETHROWS a permission denial instead of waiting it out', async () => {
    const clock = fakeClock()
    await expect(
      waitForCondition(
        { kind: 'text_appears', app: 'Secret', text: 'x', timeoutMs: 30_000 },
        {
          readTree: async () => {
            throw forbidden()
          },
          isAppOpen: async () => true,
        },
        clock,
      ),
    ).rejects.toThrow(/request_desktop_access/)
  })

  it('a denial does not silently satisfy text_disappears', async () => {
    const clock = fakeClock()
    await expect(
      waitForCondition(
        { kind: 'text_disappears', app: 'Secret', text: 'x' },
        {
          readTree: async () => {
            throw forbidden()
          },
          isAppOpen: async () => true,
        },
        clock,
      ),
    ).rejects.toThrow(/request_desktop_access/)
  })

  it('never exceeds the hard ceiling however large the ask', async () => {
    const clock = fakeClock()
    const outcome = await waitForCondition(
      { kind: 'app_appears', app: 'X', timeoutMs: 10 * MAX_WAIT_TIMEOUT_MS },
      neverOpen,
      clock,
    )
    expect(outcome.met).toBe(false)
    expect(outcome.elapsedMs).toBeLessThan(MAX_WAIT_TIMEOUT_MS + 2 * 750)
  })
})

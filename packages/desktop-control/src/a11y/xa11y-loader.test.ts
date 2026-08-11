// `withTimeout` is the module's "never hang the brain" backstop — every a11y
// op routes through it, so its own behavior is load-bearing. A wedged native
// UIA call is exactly what it exists to survive (the `list_open_apps` hang,
// 2026-08-04: an unbounded `App.list()` left a turn running for minutes).

import { describe, it, expect, vi } from 'vitest'
import {
  withTimeout,
  resolveDesktopTimeout,
  MAX_DESKTOP_TIMEOUT_MS,
} from './xa11y-loader.js'

describe('withTimeout', () => {
  it('passes a value through when the operation settles in time', async () => {
    await expect(withTimeout(Promise.resolve('tree'), 1000, 'snapshot')).resolves.toBe('tree')
  })

  it('propagates the original rejection untouched (never masks a real error)', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('UIA said no')), 1000, 'press'),
    ).rejects.toThrow('UIA said no')
  })

  it('rejects with an ACTIONABLE, labelled message when the operation never settles', async () => {
    vi.useFakeTimers()
    try {
      // A promise that never settles — the wedged-native-call case.
      const wedged = withTimeout(new Promise<string>(() => {}), 10_000, 'app list')
      const assertion = expect(wedged).rejects.toThrow(/app list did not complete within 10s/)
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears its timer on success so a settled op leaves nothing pending', async () => {
    vi.useFakeTimers()
    try {
      await expect(withTimeout(Promise.resolve(1), 10_000, 'snapshot')).resolves.toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// The timeout MESSAGE, not just the timing. A slow app and a dead control fail
// identically, and the wording is the only thing that tells the model which
// recovery to reach for — so it is behaviour, not prose.
describe('withTimeout — what it tells the model to do next', () => {
  const never = new Promise<never>(() => {})

  it('offers the longer retry FIRST when a higher limit is available', async () => {
    // Without this, a merely-slow app (big window, heavy page, cold start)
    // read as "this control is dead" and the model went hunting for another
    // element instead of just trying again with more room.
    await expect(
      withTimeout(never, 1, 'snapshot', { retryUpToMs: 120_000 }),
    ).rejects.toThrow(/retry the SAME call with timeoutMs up to 120000/)
  })

  it('falls back to the dead-end wording when no retry is available', async () => {
    const error = await withTimeout(never, 1, 'act').catch((err: Error) => err)
    expect(error.message).toMatch(/custom-drawn control/)
    expect(error.message).not.toMatch(/timeoutMs up to/)
  })

  it('does NOT promise a retry once already at the ceiling', async () => {
    // The branch is `retryUpToMs > ms`, so equal values exercise "already at the
    // limit" without the test actually waiting it out. Promising a limit the
    // caller is already using would loop the model on a raise that changes
    // nothing.
    const error = await withTimeout(never, 5, 'snapshot', { retryUpToMs: 5 }).catch(
      (err: Error) => err,
    )
    expect(error.message).not.toMatch(/timeoutMs up to/)
    expect(error.message).toMatch(/custom-drawn control/)
  })

  it('always names the fallback that actually works', async () => {
    const error = await withTimeout(never, 1, 'snapshot', { retryUpToMs: 9_000 }).catch(
      (err: Error) => err,
    )
    expect(error.message).toMatch(/screenshot_app/)
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

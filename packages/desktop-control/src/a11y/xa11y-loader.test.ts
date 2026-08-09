// `withTimeout` is the module's "never hang the brain" backstop — every a11y
// op routes through it, so its own behavior is load-bearing. A wedged native
// UIA call is exactly what it exists to survive (the `list_open_apps` hang,
// 2026-08-04: an unbounded `App.list()` left a turn running for minutes).

import { describe, it, expect, vi } from 'vitest'
import { withTimeout } from './xa11y-loader.js'

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

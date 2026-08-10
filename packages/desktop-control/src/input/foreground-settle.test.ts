import { describe, it, expect } from 'vitest'
import type { DesktopInputProbes } from './input-authorization.js'
import { waitForForegroundSettle } from './foreground-settle.js'

// A fake clock so the settle's timing is asserted deterministically — no real
// waiting, and the deadline is exercised exactly.
function makeHarness(focusReads: Array<string | null>) {
  let clock = 0
  const seen: Array<string | null> = []
  let index = 0
  const probes = {
    focusedWindowAppName: () => {
      const value = focusReads[Math.min(index, focusReads.length - 1)] ?? null
      index += 1
      seen.push(value)
      return value
    },
    resolveTargetFrame: () => {
      throw new Error('unused')
    },
    windowAppNameAt: () => null,
  } as unknown as DesktopInputProbes
  return {
    probes,
    seen,
    options: {
      timeoutMs: 400,
      intervalMs: 25,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms
      },
    },
  }
}

describe('waitForForegroundSettle', () => {
  it('returns as soon as two consecutive reads agree', async () => {
    const harness = makeHarness(['Notepad', 'Notepad'])
    await waitForForegroundSettle(harness.probes, harness.options)
    expect(harness.seen).toEqual(['Notepad', 'Notepad'])
  })

  it('keeps polling while focus is still moving (the post-click window)', async () => {
    // The race batching opened: the tick after a click still reports the
    // PREVIOUS foreground. Settling is what stops the next step authorizing
    // against a window that is about to lose focus.
    const harness = makeHarness(['Notepad', 'Notepad', 'Google Chrome', 'Google Chrome'])
    await waitForForegroundSettle(harness.probes, harness.options)
    expect(harness.seen).toEqual(['Notepad', 'Notepad'])

    const churning = makeHarness(['A', 'B', 'C', 'C'])
    await waitForForegroundSettle(churning.probes, churning.options)
    expect(churning.seen).toEqual(['A', 'B', 'C', 'C'])
  })

  it('gives up at the deadline instead of hanging the turn', async () => {
    // A desktop that never settles (an animation, a busy app) must not stall
    // the batch: authorization runs anyway and still fails closed.
    let flip = 0
    const harness = makeHarness([])
    const probes = {
      ...harness.probes,
      focusedWindowAppName: () => `app-${(flip += 1)}`,
    } as unknown as DesktopInputProbes
    await expect(waitForForegroundSettle(probes, harness.options)).resolves.toBeUndefined()
    // 400ms deadline / 25ms interval — bounded, not unbounded.
    expect(flip).toBeLessThanOrEqual(17)
  })

  it('settles on a null focus too (no window focused is a stable state)', async () => {
    const harness = makeHarness([null, null])
    await waitForForegroundSettle(harness.probes, harness.options)
    expect(harness.seen).toEqual([null, null])
  })
})

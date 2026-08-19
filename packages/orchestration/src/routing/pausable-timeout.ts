// `startPausableTimeout` — a timeout that SUSPENDS while a human decision is
// parked (an approval card / an ask) and resumes with its remaining budget when
// every parked decision is decided. Extracted from `routeRequest`'s wait clock
// (surface-up decision C) so every bound in the system measures the same thing:
// WORKING time, never DECIDING time. Consumers: the delegated-run hard cap, the
// interactive turn wall clock, the ask/approval bounds (session-hardening arc,
// 2026-08-19).
//
// The gate is optional — without one the timeout is a plain timer.

import type { ApprovalWaitGate } from './approval-wait-gate.js'

export type PausableTimeout = {
  /** Resolves when the (paused-aware) budget is spent; never rejects. */
  promise: Promise<void>
  /** Stop the clock for good — the promise then never resolves. */
  cancel: () => void
}

export function startPausableTimeout(
  timeoutMs: number,
  waitGate: ApprovalWaitGate | undefined,
): PausableTimeout {
  let handle: ReturnType<typeof setTimeout> | undefined
  let remainingMs = timeoutMs
  let armedAt: number | null = null
  let cancelled = false

  const promise = new Promise<void>((resolve) => {
    const arm = (): void => {
      if (cancelled) return
      armedAt = Date.now()
      handle = setTimeout(() => resolve(), remainingMs)
    }
    const disarm = (): void => {
      if (handle !== undefined) clearTimeout(handle)
      handle = undefined
      if (armedAt !== null) remainingMs = Math.max(0, remainingMs - (Date.now() - armedAt))
      armedAt = null
    }
    waitGate?.onParkedChange((parked) => (parked ? disarm() : arm()))
    if (!waitGate?.isParked) arm()
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      if (handle !== undefined) clearTimeout(handle)
    },
  }
}

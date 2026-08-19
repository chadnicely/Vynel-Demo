import { afterEach, describe, expect, it, vi } from 'vitest'
import { armTurnWatchdog } from './turn-watchdog.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('armTurnWatchdog', () => {
  it('stays quiet until its deadline, then fires and aborts the read', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(300_000)

    await vi.advanceTimersByTimeAsync(299_999)
    expect(watchdog.expired).toBe(false)
    expect(watchdog.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    expect(watchdog.expired).toBe(true)
    expect(watchdog.signal.aborted).toBe(true)
    await expect(watchdog.whenExpired).resolves.toBeUndefined()
  })

  it('never fires once disarmed — a turn that answered keeps its state', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(1_000)
    watchdog.disarm()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(watchdog.expired).toBe(false)
    expect(watchdog.signal.aborted).toBe(false)
  })

  it('is disabled at 0 — the pre-hardening unbounded wait stays reachable', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(0)

    await vi.advanceTimersByTimeAsync(10_000_000)
    expect(watchdog.expired).toBe(false)
    expect(watchdog.signal.aborted).toBe(false)
  })
})

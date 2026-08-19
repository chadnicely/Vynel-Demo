import { afterEach, describe, expect, it, vi } from 'vitest'
import { armTurnWatchdog } from './turn-watchdog.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('armTurnWatchdog', () => {
  it('stays quiet until its deadline, then fires', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(300_000)

    await vi.advanceTimersByTimeAsync(299_999)
    expect(watchdog.expired).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    expect(watchdog.expired).toBe(true)
    await expect(watchdog.whenExpired).resolves.toBeUndefined()
  })

  it('never fires once disarmed — a turn that answered keeps its state', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(1_000)
    watchdog.disarm()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(watchdog.expired).toBe(false)
  })

  it('touch restarts the silence clock — a turn that keeps talking never trips it', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(1_000)

    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(900)
      watchdog.touch()
    }
    expect(watchdog.expired).toBe(false) // 4.5 s in, never 1 s of silence

    await vi.advanceTimersByTimeAsync(1_001)
    expect(watchdog.expired).toBe(true)
    watchdog.touch() // past the fire, a touch changes nothing
    expect(watchdog.expired).toBe(true)
  })

  it('is disabled at 0 — the pre-hardening unbounded wait stays reachable', async () => {
    vi.useFakeTimers()
    const watchdog = armTurnWatchdog(0)

    await vi.advanceTimersByTimeAsync(10_000_000)
    watchdog.touch()
    await vi.advanceTimersByTimeAsync(10_000_000)
    expect(watchdog.expired).toBe(false)
  })
})

// The adaptive boot-check cadence: offline retries fast, settled verdicts
// re-check slowly, stop() ends the loop.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import pino from 'pino'
import type { HubSession } from '@vynel/hub-account'
import { startHubSessionService } from './hub-session-service.js'

const silentLogger = pino({ level: 'silent' })

function buildHubSession(restore: HubSession['restore']): HubSession {
  return {
    restore,
    getStatus: vi.fn().mockReturnValue({ kind: 'signed-out' }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startHubSessionService', () => {
  it('checks at boot, retries offline fast, then settles to the slow cadence', async () => {
    const restore = vi
      .fn<HubSession['restore']>()
      .mockResolvedValueOnce({ kind: 'offline', email: null, displayName: null })
      .mockResolvedValue({
        kind: 'signed-in',
        email: 'c@e.com',
        displayName: 'C',
        checkedAt: 'now',
      })
    const service = startHubSessionService({
      hubSession: buildHubSession(restore),
      logger: silentLogger,
      settledRecheckMs: 60_000,
      offlineRetryMs: 1_000,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(restore).toHaveBeenCalledTimes(1) // boot check → offline

    await vi.advanceTimersByTimeAsync(1_000)
    expect(restore).toHaveBeenCalledTimes(2) // fast offline retry → signed-in

    await vi.advanceTimersByTimeAsync(1_000)
    expect(restore).toHaveBeenCalledTimes(2) // settled: no fast retry anymore

    await vi.advanceTimersByTimeAsync(60_000)
    expect(restore).toHaveBeenCalledTimes(3) // the slow re-check

    service.stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(restore).toHaveBeenCalledTimes(3) // stopped: no further checks
  })

  it('treats a throwing restore as offline (keeps retrying fast)', async () => {
    const restore = vi.fn<HubSession['restore']>().mockRejectedValue(new Error('boom'))
    const service = startHubSessionService({
      hubSession: buildHubSession(restore),
      logger: silentLogger,
      settledRecheckMs: 60_000,
      offlineRetryMs: 1_000,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(restore).toHaveBeenCalledTimes(2)
    service.stop()
  })
})

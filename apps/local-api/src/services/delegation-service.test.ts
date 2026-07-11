// Unit test for the api-side delegation service. The claim-and-run tick + the orphan-count
// repo are mocked; we assert the ~1s poll wiring, the SERIAL in-flight guard (a slow tick
// is never re-entered), the startup orphan log, and that stop() halts the poll. Fake timers
// drive the cadence.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'

const { tickMock, reclaimMock } = vi.hoisted(() => ({
  tickMock: vi.fn(),
  reclaimMock: vi.fn(),
}))

// Spread the real barrel so a future VALUE import from it inside this test's
// module graph never silently resolves to undefined.
vi.mock('@vynel/session/delegation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runDelegationClaimAndRunTick: tickMock,
}))
vi.mock('@vynel/orchestration', () => ({
  failOrphanedClaimedDelegations: reclaimMock,
}))

import { startDelegationService } from './delegation-service.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    provider: {} as unknown as AiAgentProvider,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  reclaimMock.mockReturnValue(0)
  tickMock.mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startDelegationService', () => {
  it('runs the claim-and-run tick on the ~1s poll with db + provider + logger', async () => {
    const options = fakeOptions()
    const service = startDelegationService(options)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(tickMock).toHaveBeenCalledTimes(1)
    const [dbArg, depsArg] = tickMock.mock.calls[0]!
    expect(dbArg).toBe(options.db)
    expect(depsArg).toMatchObject({ provider: options.provider, logger: options.logger })
    service.stop()
  })

  it('is SERIAL — does not start a second tick while one is still in flight', async () => {
    // A tick that never resolves holds the in-flight flag.
    let resolveTick: (processed: boolean) => void = () => {}
    tickMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveTick = resolve
      }),
    )
    const service = startDelegationService(fakeOptions())

    await vi.advanceTimersByTimeAsync(1_000) // first tick starts (in flight)
    await vi.advanceTimersByTimeAsync(5_000) // 5 more intervals fire but must be SKIPPED
    expect(tickMock).toHaveBeenCalledTimes(1) // still once — the serial guard held

    resolveTick(false) // the in-flight tick completes → the flag clears
    await vi.advanceTimersByTimeAsync(1_000) // the next interval now runs
    expect(tickMock).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('reclaims orphaned "claimed" jobs at startup (marks them failed) + warns', () => {
    reclaimMock.mockReturnValue(3)
    const options = fakeOptions()
    const service = startDelegationService(options)

    expect(reclaimMock).toHaveBeenCalledWith(options.db, expect.any(Date))
    expect(options.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reclaimed: 3 }),
      expect.stringContaining('reclaimed'),
    )
    service.stop()
  })

  it('does not warn when there are no orphaned jobs to reclaim', () => {
    reclaimMock.mockReturnValue(0)
    const options = fakeOptions()
    const service = startDelegationService(options)

    expect(reclaimMock).toHaveBeenCalledOnce() // still checks, just finds nothing
    expect(options.logger.warn).not.toHaveBeenCalled()
    service.stop()
  })

  it('stop() halts the poll', async () => {
    const service = startDelegationService(fakeOptions())
    await vi.advanceTimersByTimeAsync(1_000)
    const callsBeforeStop = tickMock.mock.calls.length
    service.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tickMock.mock.calls.length).toBe(callsBeforeStop)
  })
})

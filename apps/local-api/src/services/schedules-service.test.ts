// Unit test for the api-side schedules service. The core poll op + @vynel/mcp
// are mocked; we assert the per-minute interval wiring with injected fire deps
// and ONE fire pool shared by every tick, the tick-summary logging, and that
// stop() halts the poll. Fake timers drive the cadence. The REAL
// `buildScheduleFireDeps` import chain is proven separately by
// `../sessions/build-schedule-fire-deps.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'

const { tickMock } = vi.hoisted(() => ({ tickMock: vi.fn() }))

// Only the tick is faked — the real `ScheduleFirePool` is what the service
// builds and shares, so the pool assertions below are against the real class.
vi.mock('@vynel/schedules', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runScheduleClaimAndFireTick: tickMock,
}))
// buildScheduleFireDeps binds composeSessionMcpServers to this descriptor; the
// closure is never invoked here (the tick is mocked), so a minimal stub
// satisfies vitest's strict mock-export check.
vi.mock('@vynel/mcp', () => ({
  vynelWorkspaceDescriptor: { serverName: 'vynel', build: () => ({}), mutatingToolNames: [] },
}))

import { ScheduleFirePool } from '@vynel/schedules'
import { startSchedulesService } from './schedules-service.js'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'

const CLEAN_TICK = { firedCount: 0, missedCount: 0, failedCount: 0, skippedCount: 0 }

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn() as unknown as HonoAppRequestFn,
    activityFeed: new SessionActivityFeed(),
    targetLocks: new SessionTargetLocks(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  tickMock.mockResolvedValue(CLEAN_TICK)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startSchedulesService', () => {
  it('runs the claim-and-fire tick on the per-minute interval with injected fire deps', async () => {
    const service = await startSchedulesService(fakeOptions())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tickMock).toHaveBeenCalledTimes(1)
    const depsArg = tickMock.mock.calls[0]?.[1] as {
      composeWorkspaceMcpServers: unknown
      composeSessionCapabilities: unknown
      startChatTurn: unknown
      startGlobalRootTurn: unknown
      resolveWorkspaceTurnSettings: unknown
    }
    expect(typeof depsArg.composeWorkspaceMcpServers).toBe('function')
    expect(typeof depsArg.composeSessionCapabilities).toBe('function')
    expect(typeof depsArg.startChatTurn).toBe('function')
    // Background-turns: the global runner + the settings resolver ride the same deps.
    expect(typeof depsArg.startGlobalRootTurn).toBe('function')
    expect(typeof depsArg.resolveWorkspaceTurnSettings).toBe('function')
    service.stop()
  })

  it('hands every tick the SAME fire pool, bounded by the delegation knob (one pool per process)', async () => {
    const service = await startSchedulesService({ ...fakeOptions(), maxConcurrentFires: 2 })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(tickMock).toHaveBeenCalledTimes(2)
    const firstPool = tickMock.mock.calls[0]?.[2] as ScheduleFirePool
    expect(firstPool).toBeInstanceOf(ScheduleFirePool)
    expect(firstPool.maxConcurrentFires).toBe(2)
    expect(tickMock.mock.calls[1]?.[2]).toBe(firstPool)
    service.stop()
  })

  it('defaults the pool bound to VYNEL_MAX_CONCURRENT_DELEGATIONS when the caller names none', async () => {
    const service = await startSchedulesService(fakeOptions())
    await vi.advanceTimersByTimeAsync(60_000)
    const pool = tickMock.mock.calls[0]?.[2] as ScheduleFirePool
    expect(pool.maxConcurrentFires).toBeGreaterThanOrEqual(1)
    service.stop()
  })

  it('logs a tick summary only when a fire threw out of the executor; a tick that rejects is logged once', async () => {
    const options = fakeOptions()
    const service = await startSchedulesService(options)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(options.logger.warn).not.toHaveBeenCalled() // a clean tick logs nothing

    tickMock.mockResolvedValueOnce({ ...CLEAN_TICK, firedCount: 2, failedCount: 1 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(options.logger.warn).toHaveBeenCalledWith(
      { ...CLEAN_TICK, firedCount: 2, failedCount: 1 },
      'schedule poll tick: fire(s) threw before a run row could record them',
    )

    tickMock.mockRejectedValueOnce(new Error('db gone'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(options.logger.error).toHaveBeenCalledTimes(1)
    expect(options.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'schedule poll tick failed',
    )
    service.stop()
  })

  it('stop() halts the poll', async () => {
    const service = await startSchedulesService(fakeOptions())
    await vi.advanceTimersByTimeAsync(60_000)
    const callsBeforeStop = tickMock.mock.calls.length
    service.stop()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(tickMock.mock.calls.length).toBe(callsBeforeStop)
  })
})

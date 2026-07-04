// Unit test for the api-side schedules service. The core poll op + @vynel/mcp
// are mocked; we assert the per-minute interval wiring with injected fire deps
// and that stop() halts the poll. Fake timers drive the cadence. The REAL
// `buildScheduleFireDeps` import chain is proven separately by
// `../sessions/build-schedule-fire-deps.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'

const { tickMock } = vi.hoisted(() => ({ tickMock: vi.fn() }))

vi.mock('@vynel/schedules', () => ({ runScheduleClaimAndFireTick: tickMock }))
// buildScheduleFireDeps binds composeSessionMcpServers to this descriptor; the
// closure is never invoked here (the tick is mocked), so a minimal stub
// satisfies vitest's strict mock-export check.
vi.mock('@vynel/mcp', () => ({
  vynelWorkspaceDescriptor: { serverName: 'vynel', build: () => ({}), mutatingToolNames: [] },
}))

import { startSchedulesService } from './schedules-service.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn() as unknown as HonoAppRequestFn,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  tickMock.mockResolvedValue({ firedCount: 0, missedCount: 0 })
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
    }
    expect(typeof depsArg.composeWorkspaceMcpServers).toBe('function')
    expect(typeof depsArg.composeSessionCapabilities).toBe('function')
    expect(typeof depsArg.startChatTurn).toBe('function')
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

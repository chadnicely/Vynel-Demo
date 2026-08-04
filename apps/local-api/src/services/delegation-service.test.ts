// Unit test for the api-side delegation service. The claim-and-run tick + the orphan-count
// repo are mocked; we assert the ~1s poll wiring, the BOUNDED POOL (capacity fill, the
// same-workspace exclusion set, slot release on settle), the startup orphan log, and that
// stop() halts the poll. Fake timers drive the cadence. A mock tick signals "claimed" by
// invoking deps.onRunStarted synchronously — exactly the real tick's contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'
import type { SessionActivityFeed } from '@vynel/session/runtime'

const { tickMock, reclaimMock, failureDeliveryMock } = vi.hoisted(() => ({
  tickMock: vi.fn(),
  reclaimMock: vi.fn(),
  failureDeliveryMock: vi.fn(),
}))

// Spread the real barrel so a future VALUE import from it inside this test's
// module graph never silently resolves to undefined.
vi.mock('@vynel/session/delegation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runDelegationClaimAndRunTick: tickMock,
  // The startup restart-parity push writes through the shared composer — pin it
  // so the unit stays DB-free (the composer's own behavior is repo-tested).
  enqueueJobFailureDelivery: failureDeliveryMock,
}))
vi.mock('@vynel/orchestration', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  failOrphanedClaimedDelegations: reclaimMock,
}))

import { SessionTargetLocks } from '@vynel/session/delegation'
import { startDelegationService } from './delegation-service.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    provider: {} as unknown as AiAgentProvider,
    activityFeed: {} as unknown as SessionActivityFeed,
    composeWorkspaceMcpServers: vi.fn(() => ({
      mcpServers: {},
      allowedMcpToolPatterns: [],
      deniedMcpToolPatterns: [],
      mutatingToolNames: [],
      askModeApprovalToolNames: [],
      systemPromptAppend: '',
    })),
    // The global notify runner (session-comms) — required so a report-delivery
    // job targeting the global root can run its turn.
    runGlobalRootReportTurn: vi.fn(async () => ({ sessionId: 'g-1', resultText: 'ok' })),
    // The REAL lock registry (Slice ③a — the shared single-writer state the
    // pool now holds its target keys in); pure in-memory, so no mock needed.
    targetLocks: new SessionTargetLocks(),
  }
}

/** The deps object the service passed to a given tick call. */
// test: correct expectation — Slice ④ generalized the pool contract from
// workspaceId/excludeWorkspaceIds to targetKey/excludeTargetKeys (a target key
// is a workspace id OR a spawned primary id).
type TickDeps = {
  onRunStarted?: (run: { jobId: string; targetKey: string }) => void
  excludeTargetKeys?: ReadonlySet<string>
}

function tickDepsOfCall(callIndex: number): TickDeps {
  return tickMock.mock.calls[callIndex]![1] as TickDeps
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  reclaimMock.mockReturnValue([])
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
    expect(depsArg).toMatchObject({
      provider: options.provider,
      logger: options.logger,
      // The background MCP composition must reach every tick — a routed turn
      // without it strips the resumed session's deferred tools.
      composeWorkspaceMcpServers: options.composeWorkspaceMcpServers,
      // The global notify runner must reach every tick — a report-delivery
      // job targeting the global root runs its turn through it (session-comms).
      runGlobalRootReportTurn: options.runGlobalRootReportTurn,
    })
    service.stop()
  })

  it('fills capacity in one tick, caps at 3 live runs, and frees a slot on settle', async () => {
    // Every claim succeeds (a distinct workspace each) and never settles until
    // released — the pool must launch exactly MAX_CONCURRENT_DELEGATIONS.
    const resolvers: Array<(processed: boolean) => void> = []
    let nextWorkspace = 0
    tickMock.mockImplementation((_db: unknown, deps: TickDeps) => {
      deps.onRunStarted?.({ jobId: `job-${nextWorkspace}`, targetKey: `ws-${nextWorkspace}` })
      nextWorkspace += 1
      return new Promise<boolean>((resolve) => resolvers.push(resolve))
    })
    const service = startDelegationService(fakeOptions())

    await vi.advanceTimersByTimeAsync(1_000) // ONE tick fills the whole pool
    expect(tickMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5_000) // pool full — later intervals launch nothing
    expect(tickMock).toHaveBeenCalledTimes(3)

    resolvers[0]!(true) // one run settles → one slot frees
    await vi.advanceTimersByTimeAsync(1_000)
    expect(tickMock).toHaveBeenCalledTimes(4)
    service.stop()
  })

  it('passes the live target keys as the claim exclusion set (never two runs per target)', async () => {
    // First claim holds ws-A and never settles; the second call claims nothing
    // (simulating "the only pending job's workspace is busy").
    const exclusionSeenByCall: string[][] = []
    tickMock.mockImplementation((_db: unknown, deps: TickDeps) => {
      exclusionSeenByCall.push([...(deps.excludeTargetKeys ?? [])])
      if (exclusionSeenByCall.length === 1) {
        deps.onRunStarted?.({ jobId: 'job-a', targetKey: 'ws-A' })
        return new Promise<boolean>(() => {})
      }
      return Promise.resolve(false)
    })
    const service = startDelegationService(fakeOptions())

    await vi.advanceTimersByTimeAsync(1_000)
    // Call 1 claimed with nothing excluded; call 2 (same tick, second slot) must
    // already see ws-A in the exclusion set.
    expect(exclusionSeenByCall[0]).toEqual([])
    expect(exclusionSeenByCall[1]).toEqual(['ws-A'])
    service.stop()
  })

  it('a claimed run holds its target lock in the SHARED registry for the run’s life', async () => {
    // Slice ③a: the held-target state is the injected SessionTargetLocks — the
    // session-turn route queues on the same keys, so a run must hold its key
    // from claim to settle and free it after.
    const resolvers: Array<(processed: boolean) => void> = []
    tickMock.mockImplementation((_db: unknown, deps: TickDeps) => {
      if (resolvers.length === 0) {
        deps.onRunStarted?.({ jobId: 'job-a', targetKey: 'ws-A' })
        return new Promise<boolean>((resolve) => resolvers.push(resolve))
      }
      return Promise.resolve(false)
    })
    const options = fakeOptions()
    const service = startDelegationService(options)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(options.targetLocks.isBusy('ws-A')).toBe(true)

    resolvers[0]!(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(options.targetLocks.isBusy('ws-A')).toBe(false)
    service.stop()
  })

  it('a target held EXTERNALLY (a user turn on that session) is excluded from the claim', async () => {
    const exclusionSeenByCall: string[][] = []
    tickMock.mockImplementation((_db: unknown, deps: TickDeps) => {
      exclusionSeenByCall.push([...(deps.excludeTargetKeys ?? [])])
      return Promise.resolve(false)
    })
    const options = fakeOptions()
    const releaseUserTurn = await options.targetLocks.acquire('spawned-primary-1')
    const service = startDelegationService(options)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(exclusionSeenByCall[0]).toEqual(['spawned-primary-1'])

    releaseUserTurn()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exclusionSeenByCall[1]).toEqual([])
    service.stop()
  })

  it('an empty queue launches exactly one probe per poll (no busy loop)', async () => {
    tickMock.mockResolvedValue(false) // no claim → no onRunStarted → break
    const service = startDelegationService(fakeOptions())
    await vi.advanceTimersByTimeAsync(3_000)
    expect(tickMock).toHaveBeenCalledTimes(3)
    service.stop()
  })

  it('a rejecting run still frees its slot and target key', async () => {
    let call = 0
    tickMock.mockImplementation((_db: unknown, deps: TickDeps) => {
      call += 1
      if (call === 1) {
        deps.onRunStarted?.({ jobId: 'job-a', targetKey: 'ws-A' })
        return Promise.reject(new Error('turn exploded'))
      }
      return Promise.resolve(false)
    })
    const options = fakeOptions()
    const service = startDelegationService(options)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(options.logger.error).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    // The slot freed: the next poll probes again with ws-A no longer excluded.
    const lastDeps = tickDepsOfCall(tickMock.mock.calls.length - 1)
    expect([...(lastDeps.excludeTargetKeys ?? [])]).toEqual([])
    service.stop()
  })

  it('reclaims orphaned "claimed" jobs at startup, warns, and pushes failure deliveries for WORK rows only', () => {
    // Two orphaned WORK rows + one delivery orphan (anti-cascade: no push).
    const orphan = (overrides: Record<string, unknown>) => ({
      id: 'j-default',
      userId: 'u-1',
      parentSessionId: 'sdk-parent',
      workspaceId: null,
      workspaceName: 'Nova',
      targetPrimarySessionId: null,
      taskText: 'do the thing',
      partialSessionId: 'p-1',
      threadId: 't-1',
      jobKind: null,
      agentSlug: null,
      requesterWorkspaceId: null,
      ...overrides,
    })
    reclaimMock.mockReturnValue([
      orphan({ id: 'j-task', jobKind: null }),
      orphan({ id: 'j-agent', jobKind: 'agent-run', agentSlug: 'researcher' }),
      orphan({ id: 'j-delivery', jobKind: 'report-delivery' }),
    ])
    const options = fakeOptions()
    const service = startDelegationService(options)

    expect(reclaimMock).toHaveBeenCalledWith(options.db, expect.any(Date))
    expect(options.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reclaimed: 3 }),
      expect.stringContaining('reclaimed'),
    )
    // The restart-parity push: one delivery per WORK orphan, none for the
    // delivery orphan (anti-cascade), each telling the requester it died —
    // with the kind-aware retry hint (a colleague is re-mentioned).
    expect(failureDeliveryMock).toHaveBeenCalledTimes(2)
    expect(failureDeliveryMock).toHaveBeenCalledWith(
      options.db,
      expect.objectContaining({ id: 'j-task' }),
      expect.stringContaining('interrupted by a restart'),
    )
    expect(failureDeliveryMock).toHaveBeenCalledWith(
      options.db,
      expect.objectContaining({ id: 'j-agent' }),
      expect.stringContaining('mention the agent again'),
    )
    service.stop()
  })

  it('does not warn when there are no orphaned jobs to reclaim', () => {
    reclaimMock.mockReturnValue([])
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

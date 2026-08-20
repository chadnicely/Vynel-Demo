// The suspend guard on the delegation lease sweeper (audit R2-L). Real DB, real
// settlement — the mechanism is only worth anything if the thing it fronts is
// the thing that would actually reap. Fake clock: `vi.setSystemTime` moves the
// WALL clock the way a laptop suspend does (timers frozen, `Date.now()` jumped).

import { describe, expect, it, vi, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  claimNextPendingDelegationJob,
  enqueueWorkspaceDelegation,
  findDelegationJobById,
  heartbeatDelegationJob,
} from '@vynel/orchestration'
import { settleOrphanedDelegationClaims } from './delegation-orphan-settlement.js'
import { createSuspendAwareSweep } from './suspend-aware-lease-sweep.js'

const SWEEP_INTERVAL_MS = 60_000
const LEASE_MS = 180_000

function silentLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

/** A claimed job holding a live lease, as the pool leaves it while it runs. */
function claimOneRunningJob(db: Parameters<typeof insertUser>[0], claimedAt: Date): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: `root-sess-${randomUUID()}`,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: 'Reconcile July',
  })
  const claimed = claimNextPendingDelegationJob(db, claimedAt, { leaseMs: LEASE_MS })
  if (claimed === null) throw new Error('the fixture job was not claimed')
  return claimed.id
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createSuspendAwareSweep', () => {
  it('skips the first tick after a clock jump, then reaps the run that stayed stale', async () => {
    await withTestDatabase(async (db) => {
      vi.useFakeTimers()
      const wokeAt = new Date('2026-08-20T09:00:00Z')
      vi.setSystemTime(wokeAt)
      const logger = silentLogger()
      const jobId = claimOneRunningJob(db, wokeAt)
      const sweep = createSuspendAwareSweep({
        intervalMs: SWEEP_INTERVAL_MS,
        sweep: () => settleOrphanedDelegationClaims(db, logger, { onlyExpiredLeases: true }),
        logger,
      })

      // The lid closes for an hour: timers never fired, the wall clock ran.
      vi.setSystemTime(new Date(wokeAt.getTime() + 60 * 60_000))
      sweep.tick()
      expect(findDelegationJobById(db, jobId)?.status).toBe('claimed')

      // Next tick, one normal interval later: this run never heartbeated, so
      // it really is dead and gets settled.
      vi.setSystemTime(new Date(wokeAt.getTime() + 60 * 60_000 + SWEEP_INTERVAL_MS))
      sweep.tick()
      expect(findDelegationJobById(db, jobId)?.status).toBe('failed')
    })
  })

  it('a live run that resumed heartbeating after the wake survives the next tick', async () => {
    await withTestDatabase(async (db) => {
      vi.useFakeTimers()
      const wokeAt = new Date('2026-08-20T09:00:00Z')
      vi.setSystemTime(wokeAt)
      const logger = silentLogger()
      const jobId = claimOneRunningJob(db, wokeAt)
      const sweep = createSuspendAwareSweep({
        intervalMs: SWEEP_INTERVAL_MS,
        sweep: () => settleOrphanedDelegationClaims(db, logger, { onlyExpiredLeases: true }),
        logger,
      })

      const afterSuspend = new Date(wokeAt.getTime() + 60 * 60_000)
      vi.setSystemTime(afterSuspend)
      sweep.tick()
      expect(findDelegationJobById(db, jobId)?.status).toBe('claimed')

      // The grace beat is exactly what it is for: the run was alive all along
      // and its heartbeat lands within seconds of the wake.
      const heartbeatAt = new Date(afterSuspend.getTime() + 5_000)
      expect(heartbeatDelegationJob(db, jobId, heartbeatAt, LEASE_MS)).toBe(true)

      vi.setSystemTime(new Date(afterSuspend.getTime() + SWEEP_INTERVAL_MS))
      sweep.tick()
      expect(findDelegationJobById(db, jobId)?.status).toBe('claimed')
    })
  })

  it('sweeps normally when ticks arrive on cadence — the guard costs nothing at rest', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00Z'))
    const sweptAt: number[] = []
    const sweep = createSuspendAwareSweep({
      intervalMs: SWEEP_INTERVAL_MS,
      sweep: () => sweptAt.push(Date.now()),
      logger: silentLogger(),
    })

    for (let tick = 1; tick <= 3; tick += 1) {
      vi.setSystemTime(new Date(Date.now() + SWEEP_INTERVAL_MS))
      sweep.tick()
    }
    expect(sweptAt).toHaveLength(3)
  })
})

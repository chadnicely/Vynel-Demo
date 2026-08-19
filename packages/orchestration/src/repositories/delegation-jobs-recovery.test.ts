// Recovery repository tests — the ONE orphaned-claim policy behind the boot
// pass and the lease sweeper (session-hardening A2). Real migrated SQLite via
// `@vynel/testing`, no mocking. Pins: the by-kind split (message kinds requeue,
// work + update fail), the lease scope (only lapsed leases; NULL-lease claims
// belong to the boot pass), and that neither pass touches a pending row.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import {
  claimNextPendingDelegationJob,
  findDelegationJobById,
  insertDelegationJob,
  type DelegationJobKind,
  type NewDelegationJob,
} from './delegation-jobs.js'
import {
  failOrphanedClaimedDelegations,
  ORPHAN_REQUEUE_JOB_KINDS,
  requeueOrphanedClaimedDeliveries,
} from './delegation-jobs-recovery.js'

function seedUserAndWorkspace(db: Database) {
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
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function jobRow(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewDelegationJob> = {},
): NewDelegationJob {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    parentSessionId: `root-sess-${randomUUID()}`,
    workspaceId,
    workspacePath: '/tmp/vynel/acme',
    workspaceName: 'Acme',
    taskText: 'Summarize the quarterly report',
    partialSessionId: null,
    status: 'pending',
    claimedAt: null,
    completedAt: null,
    resultText: null,
    errorMessage: null,
    createdAt: now,
    ...overrides,
  }
}

describe('the orphaned-claim policy (boot pass + lease sweeper)', () => {
  it('the message kinds are exactly report-delivery / direct-delivery / note', () => {
    expect([...ORPHAN_REQUEUE_JOB_KINDS].sort()).toEqual(
      ['direct-delivery', 'note', 'report-delivery'].sort(),
    )
  })

  it('the boot pass splits by kind: report / direct / note claims REQUEUE, task / agent-run / update fail — pending rows untouched', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const claimedOf = (jobKind: DelegationJobKind | null) =>
        insertDelegationJob(
          db,
          jobRow(user.id, workspace.id, { status: 'claimed', jobKind, attemptCount: 1 }),
        )
      const report = claimedOf('report-delivery')
      const direct = claimedOf('direct-delivery')
      const note = claimedOf('note')
      const update = claimedOf('update-delivery')
      const task = claimedOf(null)
      const agentRun = claimedOf('agent-run')
      const pendingReport = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, { jobKind: 'report-delivery' }),
      )
      // Inserted terminal: the completion writer is a CAS on a claim.
      const completed = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, { status: 'completed', resultText: 'ok', completedAt: new Date() }),
      )

      const requeued = requeueOrphanedClaimedDeliveries(db, new Date())
      expect(requeued.map((job) => job.id).sort()).toEqual([report.id, direct.id, note.id].sort())
      for (const id of [report.id, direct.id, note.id]) {
        const revived = findDelegationJobById(db, id)!
        // The body is the ONLY copy — revived, immediately due, never destroyed.
        expect(revived.status).toBe('pending')
        expect(revived.claimedAt).toBeNull()
        expect(revived.leaseExpiresAt).toBeNull()
        expect(revived.surfacedToRootAt).toBeNull()
        expect(revived.nextAttemptAt).not.toBeNull()
        // Orphaning is the process's failure, not the message's — no attempt burned.
        expect(revived.attemptCount).toBe(1)
        expect(revived.errorMessage).toContain('restarted')
      }

      const failed = failOrphanedClaimedDelegations(db, new Date())
      expect(failed.map((job) => job.id).sort()).toEqual([update.id, task.id, agentRun.id].sort())
      for (const id of [update.id, task.id, agentRun.id]) {
        const row = findDelegationJobById(db, id)!
        expect(row.status).toBe('failed')
        expect(row.errorMessage).toContain('restarted')
        // Surfaced → no restart spam through the root's catch-up net.
        expect(row.surfacedToRootAt).not.toBeNull()
      }
      // Neither pass touches what it does not own.
      expect(findDelegationJobById(db, report.id)!.status).toBe('pending')
      expect(findDelegationJobById(db, pendingReport.id)!.status).toBe('pending')
      expect(findDelegationJobById(db, pendingReport.id)!.errorMessage).toBeNull()
      expect(findDelegationJobById(db, completed.id)!.status).toBe('completed')
    })
  })

  it('the lease scope reaps ONLY claims whose lease lapsed — a live lease and a NULL (legacy) lease are left to their owners', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const now = new Date('2026-08-19T12:00:00Z')
      const lapsedTask = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, {
          status: 'claimed',
          leaseExpiresAt: new Date(now.getTime() - 1),
        }),
      )
      const lapsedNote = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, {
          status: 'claimed',
          jobKind: 'note',
          leaseExpiresAt: new Date(now.getTime() - 60_000),
        }),
      )
      const liveTask = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, {
          status: 'claimed',
          leaseExpiresAt: new Date(now.getTime() + 120_000),
        }),
      )
      // A claim without a lease (a pre-lease process claimed it) — the boot
      // pass's, never the sweeper's.
      const legacyClaim = insertDelegationJob(
        db,
        jobRow(user.id, workspace.id, { status: 'claimed' }),
      )

      const requeued = requeueOrphanedClaimedDeliveries(db, now, { onlyExpiredLeases: true })
      expect(requeued.map((job) => job.id)).toEqual([lapsedNote.id])
      expect(findDelegationJobById(db, lapsedNote.id)!.errorMessage).toContain('lease expired')

      const failed = failOrphanedClaimedDelegations(db, now, { onlyExpiredLeases: true })
      expect(failed.map((job) => job.id)).toEqual([lapsedTask.id])
      expect(findDelegationJobById(db, lapsedTask.id)!.errorMessage).toContain('lease expired')

      expect(findDelegationJobById(db, liveTask.id)!.status).toBe('claimed')
      expect(findDelegationJobById(db, legacyClaim.id)!.status).toBe('claimed')

      // The boot pass then takes the legacy claim (and the live one — at boot
      // nothing runs, every claim is an orphan).
      const bootFailed = failOrphanedClaimedDelegations(db, now)
      expect(bootFailed.map((job) => job.id).sort()).toEqual([liveTask.id, legacyClaim.id].sort())
    })
  })

  it('a leased claim that is swept and then re-claimed carries a FRESH lease', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      insertDelegationJob(db, jobRow(user.id, workspace.id, { jobKind: 'report-delivery' }))
      const firstClaimAt = new Date('2026-08-19T12:00:00Z')
      const first = claimNextPendingDelegationJob(db, firstClaimAt, { leaseMs: 1000 })!
      const sweepAt = new Date(firstClaimAt.getTime() + 5000)
      expect(
        requeueOrphanedClaimedDeliveries(db, sweepAt, { onlyExpiredLeases: true }).map((j) => j.id),
      ).toEqual([first.id])
      const second = claimNextPendingDelegationJob(db, sweepAt, { leaseMs: 1000 })!
      expect(second.id).toBe(first.id)
      expect(second.leaseExpiresAt?.getTime()).toBe(sweepAt.getTime() + 1000)
    })
  })
})

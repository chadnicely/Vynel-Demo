// Repository tests for the `delegation_jobs` table. Real migrated SQLite via
// `@vynel/testing`, no mocking. Inserts real users + workspaces FK parents
// first (the schedules.test.ts factory precedent).
//
// FIFO-ordering tests use explicit increasing `createdAt` ISO dates — two
// back-to-back `new Date()` inserts collide at `timestamp_ms` resolution and
// the claim's single `asc(createdAt)` key has no tiebreaker, so "oldest" would
// be undefined without distinct timestamps.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertDelegationJob,
  findDelegationJobById,
  claimNextPendingDelegationJob,
  completeDelegationJob,
  failDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
  listPendingDelegationJobsForUser,
  listUnsurfacedTerminalDelegationsForUser,
  failOrphanedClaimedDelegations,
  type NewDelegationJob,
} from './delegation-jobs.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeDelegationJob(
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

describe('delegation_jobs repository', () => {
  it('insertDelegationJob + findDelegationJobById round-trips every column (nullables null)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const createdAt = new Date('2026-06-01T08:00:00Z')
      const job = makeDelegationJob(user.id, workspace.id, { createdAt })
      const inserted = insertDelegationJob(db, job)
      const found = findDelegationJobById(db, inserted.id)
      expect(found).not.toBeNull()
      expect(found?.id).toBe(job.id)
      expect(found?.userId).toBe(user.id)
      expect(found?.parentSessionId).toBe(job.parentSessionId)
      expect(found?.workspaceId).toBe(workspace.id)
      expect(found?.workspacePath).toBe(job.workspacePath)
      expect(found?.workspaceName).toBe(job.workspaceName)
      expect(found?.taskText).toBe(job.taskText)
      expect(found?.partialSessionId).toBeNull()
      expect(found?.status).toBe('pending')
      expect(found?.claimedAt).toBeNull()
      expect(found?.completedAt).toBeNull()
      expect(found?.resultText).toBeNull()
      expect(found?.errorMessage).toBeNull()
      expect(found?.createdAt.getTime()).toBe(createdAt.getTime())
    })
  })

  it('findDelegationJobById returns null when absent', async () => {
    await withTestDatabase(async (db) => {
      expect(findDelegationJobById(db, randomUUID())).toBeNull()
    })
  })

  it('claimNextPendingDelegationJob claims the OLDEST by createdAt even when it was inserted LAST (FIFO by time, not rowid)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // Insert the NEWER row FIRST so insertion/rowid order contradicts
      // chronological order — this proves the claim honors `asc(createdAt)`
      // rather than physical row order. Deleting the orderBy clause fails here.
      insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { createdAt: new Date('2026-06-01T00:01:00Z') }),
      )
      const older = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { createdAt: new Date('2026-06-01T00:00:00Z') }),
      )
      const claimedAt = new Date('2026-06-02T12:00:00Z')
      const claimed = claimNextPendingDelegationJob(db, claimedAt)
      expect(claimed?.id).toBe(older.id)
      expect(claimed?.status).toBe('claimed')
      expect(claimed?.claimedAt?.getTime()).toBe(claimedAt.getTime())
      // persisted, not just returned
      expect(findDelegationJobById(db, older.id)?.status).toBe('claimed')
    })
  })

  it('claim with excludeTargetKeys skips busy workspaces but keeps FIFO among the rest', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const busyWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      const freeWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      // The OLDEST pending job targets the busy workspace — without the
      // exclusion it would win the FIFO claim.
      insertDelegationJob(
        db,
        makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:00:00Z'),
        }),
      )
      const freeJob = insertDelegationJob(
        db,
        makeDelegationJob(user.id, freeWorkspace.id, {
          createdAt: new Date('2026-06-01T00:01:00Z'),
        }),
      )

      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [busyWorkspace.id],
      })
      expect(claimed?.id).toBe(freeJob.id)

      // Every pending workspace busy → nothing claimable; the busy job stays pending.
      const none = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [busyWorkspace.id, freeWorkspace.id],
      })
      expect(none).toBeNull()

      // Empty exclusion = today's behavior — the busy-workspace job now wins FIFO.
      const next = claimNextPendingDelegationJob(db, new Date(), { excludeTargetKeys: [] })
      expect(next?.workspaceId).toBe(busyWorkspace.id)
    })
  })

  it("an AGENT-RUN row claims through its workspace's busy key (chat-mentions — no starvation); task/session rows still hold", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const busyWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      // Oldest: a normal TASK row on the busy workspace — must keep holding.
      const heldTask = insertDelegationJob(
        db,
        makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:00:00Z'),
        }),
      )
      // Newer: an agent-run GROUNDED in the same workspace — its workspaceId is
      // the leaf's resolution scope, not a conversation it resumes, so the
      // busy slot must not starve it.
      const agentRun = insertDelegationJob(
        db,
        makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:01:00Z'),
          jobKind: 'agent-run',
          agentSlug: 'code-reviewer',
        }),
      )

      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [busyWorkspace.id],
      })
      expect(claimed?.id).toBe(agentRun.id)

      // The task row is still held by the exclusion…
      expect(
        claimNextPendingDelegationJob(db, new Date(), {
          excludeTargetKeys: [busyWorkspace.id],
        }),
      ).toBeNull()
      // …and claims once the key frees.
      expect(claimNextPendingDelegationJob(db, new Date())?.id).toBe(heldTask.id)
    })
  })

  it('an agent-run row still honors the retry-backoff gate while exempt from the workspace exclusion', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, {
          createdAt: new Date('2026-06-01T00:00:00Z'),
          jobKind: 'agent-run',
          agentSlug: 'code-reviewer',
          // Requeued with backoff — not due yet at claim time.
          nextAttemptAt: new Date('2026-06-02T00:00:00Z'),
        }),
      )
      expect(
        claimNextPendingDelegationJob(db, new Date('2026-06-01T12:00:00Z'), {
          excludeTargetKeys: [workspace.id],
        }),
      ).toBeNull()
      expect(
        claimNextPendingDelegationJob(db, new Date('2026-06-02T12:00:00Z'), {
          excludeTargetKeys: [workspace.id],
        })?.agentSlug,
      ).toBe('code-reviewer')
    })
  })

  it('exclusion is NULL-safe across BOTH target columns (Slice ④): a busy workspace never hides a session-target job, and vice versa', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const busyWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      const spawnedPrimaryId = randomUUID()
      // Oldest: a workspace job on the busy workspace. Newer: a SESSION-target
      // job (workspaceId NULL — a bare NOT IN would silently drop it).
      insertDelegationJob(
        db,
        makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:00:00Z'),
        }),
      )
      const sessionJob = insertDelegationJob(db, {
        ...makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:01:00Z'),
        }),
        workspaceId: null,
        workspaceName: null,
        workspacePath: '/tmp/vynel/global-root',
        targetPrimarySessionId: spawnedPrimaryId,
      })

      // The busy workspace is excluded — the session job must still claim.
      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [busyWorkspace.id],
      })
      expect(claimed?.id).toBe(sessionJob.id)
      expect(claimed?.targetPrimarySessionId).toBe(spawnedPrimaryId)

      // Same-session exclusion: a second job for the SAME spawned session holds
      // while its key is live (FIFO per target)…
      const queuedSameSession = insertDelegationJob(db, {
        ...makeDelegationJob(user.id, busyWorkspace.id, {
          createdAt: new Date('2026-06-01T00:02:00Z'),
        }),
        workspaceId: null,
        workspaceName: null,
        workspacePath: '/tmp/vynel/global-root',
        targetPrimarySessionId: spawnedPrimaryId,
      })
      expect(
        claimNextPendingDelegationJob(db, new Date(), {
          excludeTargetKeys: [busyWorkspace.id, spawnedPrimaryId],
        }),
      ).toBeNull()
      // …and claims once the key frees (the workspace exclusion alone — a NULL
      // targetPrimarySessionId on the workspace row doesn't hide it either, but
      // FIFO gives the older busy-workspace job priority only when unexcluded).
      const next = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [busyWorkspace.id],
      })
      expect(next?.id).toBe(queuedSameSession.id)
    })
  })

  it('double-claim of a single pending job wins once; the second claim returns null', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const job = insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      const first = claimNextPendingDelegationJob(db, new Date())
      const second = claimNextPendingDelegationJob(db, new Date())
      expect(first?.id).toBe(job.id)
      expect(second).toBeNull() // the row is no longer pending
    })
  })

  it('two pending jobs: two claims return the two different jobs, oldest first', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const older = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { createdAt: new Date('2026-06-01T00:00:00Z') }),
      )
      const newer = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { createdAt: new Date('2026-06-01T00:01:00Z') }),
      )
      const first = claimNextPendingDelegationJob(db, new Date())
      const second = claimNextPendingDelegationJob(db, new Date())
      const third = claimNextPendingDelegationJob(db, new Date())
      expect(first?.id).toBe(older.id)
      expect(second?.id).toBe(newer.id)
      expect(third).toBeNull()
    })
  })

  it('claimNextPendingDelegationJob returns null when none pending', async () => {
    await withTestDatabase(async (db) => {
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })

  it('completeDelegationJob sets status + resultText + completedAt; findById reflects it; throws on missing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const job = insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      const completedAt = new Date('2026-06-03T09:30:00Z')
      const completed = completeDelegationJob(db, job.id, 'Done: 42 pages summarized', completedAt)
      expect(completed.status).toBe('completed')
      expect(completed.resultText).toBe('Done: 42 pages summarized')
      expect(completed.completedAt?.getTime()).toBe(completedAt.getTime())
      const found = findDelegationJobById(db, job.id)
      expect(found?.status).toBe('completed')
      expect(found?.resultText).toBe('Done: 42 pages summarized')
      expect(() => completeDelegationJob(db, randomUUID(), 'x', new Date())).toThrow()
    })
  })

  it('failDelegationJob sets status + errorMessage + completedAt; findById reflects it; throws on missing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const job = insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      const completedAt = new Date('2026-06-03T10:00:00Z')
      const failed = failDelegationJob(db, job.id, 'Provider timed out', completedAt)
      expect(failed.status).toBe('failed')
      expect(failed.errorMessage).toBe('Provider timed out')
      expect(failed.completedAt?.getTime()).toBe(completedAt.getTime())
      const found = findDelegationJobById(db, job.id)
      expect(found?.status).toBe('failed')
      expect(found?.errorMessage).toBe('Provider timed out')
      expect(() => failDelegationJob(db, randomUUID(), 'x', new Date())).toThrow()
    })
  })

  it('listPendingDelegationJobsForUser returns only that user\'s pending, oldest-first; excludes claimed + other users', async () => {
    await withTestDatabase(async (db) => {
      const userA = insertUser(db, makeUser())
      const userB = insertUser(db, makeUser())
      const workspaceA = insertWorkspace(db, makeWorkspace(userA.id))
      const workspaceB = insertWorkspace(db, makeWorkspace(userB.id))
      const a1 = insertDelegationJob(
        db,
        makeDelegationJob(userA.id, workspaceA.id, { createdAt: new Date('2026-06-01T00:00:00Z') }),
      )
      const a2 = insertDelegationJob(
        db,
        makeDelegationJob(userA.id, workspaceA.id, { createdAt: new Date('2026-06-01T00:01:00Z') }),
      )
      // userA non-pending — excluded by status
      insertDelegationJob(
        db,
        makeDelegationJob(userA.id, workspaceA.id, {
          status: 'claimed',
          createdAt: new Date('2026-06-01T00:02:00Z'),
        }),
      )
      // userB pending — excluded by user scope
      insertDelegationJob(db, makeDelegationJob(userB.id, workspaceB.id))
      expect(listPendingDelegationJobsForUser(db, userA.id).map((j) => j.id)).toEqual([a1.id, a2.id])
    })
  })

  it('listPendingDelegationJobsForUser respects an explicit limit and clamps to the max', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      for (let i = 0; i < 5; i++) {
        insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      }
      expect(listPendingDelegationJobsForUser(db, user.id, 2)).toHaveLength(2)
      // an over-max request is clamped, never amplified beyond the row count
      expect(listPendingDelegationJobsForUser(db, user.id, 1000).length).toBeLessThanOrEqual(5)
    })
  })

  it('failOrphanedClaimedDelegations marks claimed rows failed (surfaced) + leaves others', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // A completed job (terminal — must be untouched) + a pending job we then claim.
      const completed = insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      completeDelegationJob(db, completed.id, 'ok', new Date())
      insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      const claimed = claimNextPendingDelegationJob(db, new Date())

      expect(failOrphanedClaimedDelegations(db, new Date())).toBe(1) // only the claimed one

      const reclaimed = findDelegationJobById(db, claimed!.id)!
      expect(reclaimed.status).toBe('failed')
      expect(reclaimed.errorMessage).toContain('orphaned')
      expect(reclaimed.surfacedToRootAt).not.toBeNull() // marked surfaced → no restart spam to the root
      // The completed job is left alone.
      expect(findDelegationJobById(db, completed.id)!.status).toBe('completed')
    })
  })

  // ── session-comms: report-delivery rows on the shared queue ─────────

  it('claims a report-delivery row with BOTH targets null even when exclusion keys are active (NULL-safe claim)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // A GLOBAL-target report-delivery row: both target columns null.
      const delivery = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, {
          workspaceId: null,
          workspacePath: null,
          workspaceName: 'Mark · Acme',
          jobKind: 'report-delivery',
        }),
      )
      // Busy-key exclusion active — a bare NOT IN would silently drop the
      // NULL-column row; the isNull disjuncts must keep it claimable.
      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: ['some-busy-workspace'],
      })
      expect(claimed?.id).toBe(delivery.id)
      expect(claimed?.jobKind).toBe('report-delivery')
    })
  })

  it('the shared GLOBAL_ROOT_DELIVERY_TARGET_KEY excludes global-delivery rows from the claim while task rows still claim', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // The OLDER row is the global delivery — only the synthetic-key exclusion
      // (not FIFO order) can explain the task row claiming first.
      insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, {
          workspaceId: null,
          workspacePath: null,
          workspaceName: 'Mark · Acme',
          jobKind: 'report-delivery',
          createdAt: new Date('2026-07-22T00:00:00Z'),
        }),
      )
      const task = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { createdAt: new Date('2026-07-22T00:00:01Z') }),
      )

      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [GLOBAL_ROOT_DELIVERY_TARGET_KEY],
      })
      expect(claimed?.id).toBe(task.id)

      // With the key freed, the pending delivery claims normally.
      const next = claimNextPendingDelegationJob(db, new Date())
      expect(next?.jobKind).toBe('report-delivery')
    })
  })

  it('listUnsurfacedTerminalDelegationsForUser surfaces TASK rows only — never report-delivery rows (completed OR failed)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      // A legacy task row (NULL jobKind) — surfaces.
      const task = insertDelegationJob(db, makeDelegationJob(user.id, workspace.id))
      completeDelegationJob(db, task.id, 'the report', new Date())
      // A completed report-delivery row — its resultText is the notify turn's
      // own reply; injecting it as "a report from a workspace" would be a
      // false echo. Excluded.
      const completedDelivery = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { jobKind: 'report-delivery' }),
      )
      completeDelegationJob(db, completedDelivery.id, 'absorbed', new Date())
      // A failed report-delivery row — a delivery failure is not a task
      // failure; excluded too.
      const failedDelivery = insertDelegationJob(
        db,
        makeDelegationJob(user.id, workspace.id, { jobKind: 'report-delivery' }),
      )
      failDelegationJob(db, failedDelivery.id, 'notify turn failed', new Date())

      expect(listUnsurfacedTerminalDelegationsForUser(db, user.id).map((j) => j.id)).toEqual([
        task.id,
      ])
    })
  })
})

// `settleFailedDelegationAttempt` — the reported-then-failed gate (session-review
// B2) + the standing requeue/give-up split, pinned against the real queue ops on
// real SQLite. The gate exists because the tick hands settle its CLAIM-TIME row
// snapshot while `reportedAt` is stamped mid-run by dispatch-message — settle
// must re-read, or a reported task re-runs (duplicate report) or pushes a
// give-up that contradicts the result the requester already received.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import {
  claimNextPendingDelegationJob,
  enqueueReportDelivery,
  enqueueWorkspaceDelegation,
  findDelegationJobById,
  markDelegationJobReported,
} from '@vynel/orchestration'
import {
  hasDeliveredFinalReport,
  settleFailedDelegationAttempt,
} from './settle-failed-delegation-attempt.js'

const silentLogger = pino({ level: 'silent' })
const settleDeps = {
  logger: silentLogger,
  queueLabel: 'delegation',
  retryHint: 'suggest retrying.',
}

// Recoverable per RECOVERABLE_PATTERNS; the terminal message avoids every pattern.
const RECOVERABLE_ERROR = 'the routed turn errored (network): socket hang up'
const TERMINAL_ERROR = 'the routed turn errored (logic): bad input shape'

function seedClaimedJob(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
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
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: 'global-sdk-1',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: 'reconcile the June receipts',
  })
  const claimed = claimNextPendingDelegationJob(db, new Date())
  expect(claimed).not.toBeNull()
  return { user, workspace, claimed: claimed! }
}

/** Claim far past every retry backoff — how these tests detect what remains
 *  claimable (a requeued task, a pushed give-up delivery, or nothing). */
function claimAnythingDue(db: Database) {
  return claimNextPendingDelegationJob(db, new Date(Date.now() + 60 * 60 * 1000))
}

describe('settleFailedDelegationAttempt', () => {
  it('a REPORTED job never requeues on a recoverable error and never pushes a give-up', async () => {
    await withTestDatabase(async (db) => {
      const { claimed } = seedClaimedJob(db)
      // The turn spoke its final report mid-run; settle still holds the
      // claim-time snapshot (reportedAt null on it) — exactly the tick's shape.
      markDelegationJobReported(db, claimed.id, new Date())
      expect(claimed.reportedAt).toBeNull()

      settleFailedDelegationAttempt(db, claimed, RECOVERABLE_ERROR, settleDeps)

      const row = findDelegationJobById(db, claimed.id)!
      // Terminal — NOT pending: no re-run, no second report to the requester.
      expect(row.status).toBe('failed')
      // The pull net must never re-inject a "failed" contradiction.
      expect(row.surfacedToRootAt).not.toBeNull()
      expect(row.errorMessage).toBe(RECOVERABLE_ERROR)
      // No give-up delivery was enqueued — nothing claimable remains.
      expect(claimAnythingDue(db)).toBeNull()
    })
  })

  it('a REPORTED job on a terminal error records the failure without a give-up push', async () => {
    await withTestDatabase(async (db) => {
      const { claimed } = seedClaimedJob(db)
      markDelegationJobReported(db, claimed.id, new Date())

      settleFailedDelegationAttempt(db, claimed, TERMINAL_ERROR, settleDeps)

      const row = findDelegationJobById(db, claimed.id)!
      expect(row.status).toBe('failed')
      expect(row.errorCode).toBe('logic')
      expect(row.surfacedToRootAt).not.toBeNull()
      expect(claimAnythingDue(db)).toBeNull()
    })
  })

  it('an UNREPORTED job still requeues on a recoverable error (standing behavior)', async () => {
    await withTestDatabase(async (db) => {
      const { claimed } = seedClaimedJob(db)

      settleFailedDelegationAttempt(db, claimed, RECOVERABLE_ERROR, settleDeps)

      const row = findDelegationJobById(db, claimed.id)!
      expect(row.status).toBe('pending')
      expect(row.attemptCount).toBe(1)
      expect(row.nextAttemptAt).not.toBeNull()
      // The SAME job is claimable once its backoff elapses — no give-up row.
      expect(claimAnythingDue(db)?.id).toBe(claimed.id)
    })
  })

  it('an UNREPORTED job on a terminal error fails AND pushes the give-up delivery (standing behavior)', async () => {
    await withTestDatabase(async (db) => {
      const { claimed } = seedClaimedJob(db)

      settleFailedDelegationAttempt(db, claimed, TERMINAL_ERROR, settleDeps)

      const row = findDelegationJobById(db, claimed.id)!
      expect(row.status).toBe('failed')
      // Surfaced via the push path — the give-up delivery carries the story.
      expect(row.surfacedToRootAt).not.toBeNull()
      const push = claimAnythingDue(db)
      expect(push).not.toBeNull()
      expect(push!.jobKind).toBe('report-delivery')
      expect(push!.taskText).toContain('failed')
    })
  })
})

describe('hasDeliveredFinalReport (the shared gate the timed-out branches also use)', () => {
  it('answers from the FRESH read, not the claim-time snapshot', async () => {
    await withTestDatabase(async (db) => {
      const { claimed } = seedClaimedJob(db)
      expect(hasDeliveredFinalReport(db, claimed)).toBe(false)

      markDelegationJobReported(db, claimed.id, new Date())
      // The snapshot is stale (reportedAt null) — the fresh read decides.
      expect(claimed.reportedAt).toBeNull()
      expect(hasDeliveredFinalReport(db, claimed)).toBe(true)
    })
  })

  it('a delivery row never gates — even with a stamp on it', async () => {
    await withTestDatabase(async (db) => {
      const { user } = seedClaimedJob(db)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'reporter-1',
        reporterLabel: 'Acme research',
        reportBody: 'done — 4 items reconciled.',
        requester: { kind: 'global-root' },
      })
      // The work job is already claimed, so the delivery is the one due row.
      const delivery = claimAnythingDue(db)!
      expect(delivery.jobKind).toBe('report-delivery')

      markDelegationJobReported(db, delivery.id, new Date())
      expect(hasDeliveredFinalReport(db, delivery)).toBe(false)
    })
  })
})

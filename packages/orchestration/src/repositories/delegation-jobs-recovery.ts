// Recovery repository for `delegation_jobs` — how an ORPHANED claim is settled
// (session-hardening A2). Split from `delegation-jobs.ts` (the queue's
// claim/complete/list surface) so each file keeps one reading: that one is
// "the queue", this one is "what happens to a claim whose run is gone". Same
// discipline: functional, db-first, Phase-1 SYNC, no Drizzle outside repos.

import { and, eq, inArray, isNotNull, isNull, lte, notInArray, or } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { delegationJobs, type DelegationJob } from '../schema/delegation-jobs.js'

// A claimed row whose run is gone is settled BY KIND, ONE policy for both
// readers (session-hardening A2): at BOOT every claimed row is an orphan
// (nothing runs yet); at RUNTIME the 60 s sweeper reaps only claims whose
// LEASE lapsed (the run stopped heartbeating — a crash the boot pass has not
// seen yet, or a wedged process). Rows with a NULL lease are legacy claims and
// belong to the boot pass alone.
//
// The kinds that carry a MESSAGE requeue — the body is the only copy of what
// it says: a report is a child's result, a note is a handed-over thought, a
// direct-delivery is a final answer addressed to the user (Kafi 2026-08-19:
// "never destroy them"). The attempt counter is deliberately NOT bumped:
// orphaning is the process's failure, not the delivery's, and a bounded
// counter here would eventually destroy a message on a crash-looping machine —
// the one outcome this exists to prevent. `update-delivery` stays terminal
// (ephemeral status, never requeued); work rows (task / agent-run) FAIL —
// exactly-once (the Ch1 decision was no-RE-EXECUTE, not no-cleanup) — with
// `surfacedToRootAt` set so a restart doesn't spam the root with "couldn't
// complete" (the caller pushes ONE honest failure delivery per work orphan).
export const ORPHAN_REQUEUE_JOB_KINDS = ['report-delivery', 'direct-delivery', 'note'] as const

export type OrphanedClaimScope = {
  /** True = only claims whose lease lapsed at `at` (the sweeper); false/absent
   *  = every claimed row (the boot pass). */
  onlyExpiredLeases?: boolean
}

function orphanedClaimPredicate(at: Date, scope: OrphanedClaimScope) {
  return scope.onlyExpiredLeases === true
    ? and(
        eq(delegationJobs.status, 'claimed'),
        isNotNull(delegationJobs.leaseExpiresAt),
        lte(delegationJobs.leaseExpiresAt, at),
      )
    : eq(delegationJobs.status, 'claimed')
}

/** Settle the orphaned WORK-and-update claims FAILED + surfaced; returns the
 *  full rows so the caller can push the per-orphan failure delivery. */
export function failOrphanedClaimedDelegations(
  db: Database,
  at: Date,
  scope: OrphanedClaimScope = {},
): DelegationJob[] {
  return db
    .update(delegationJobs)
    .set({
      status: 'failed',
      errorMessage:
        scope.onlyExpiredLeases === true
          ? 'orphaned — its claim lease expired while this task was running (the run stopped heartbeating)'
          : 'orphaned — the server restarted while this task was running',
      completedAt: at,
      surfacedToRootAt: at,
    })
    .where(
      and(
        orphanedClaimPredicate(at, scope),
        // NULL-safe kind gate (legacy NULL jobKind = task): everything but the
        // message kinds, which the requeue pass below owns.
        or(
          isNull(delegationJobs.jobKind),
          notInArray(delegationJobs.jobKind, [...ORPHAN_REQUEUE_JOB_KINDS]),
        ),
      ),
    )
    .returning()
    .all()
}

/** Requeue the orphaned MESSAGE claims (report / direct / note): back to
 *  `pending`, immediately due, lease cleared, attempts untouched. */
export function requeueOrphanedClaimedDeliveries(
  db: Database,
  at: Date,
  scope: OrphanedClaimScope = {},
): DelegationJob[] {
  return db
    .update(delegationJobs)
    .set({
      status: 'pending',
      claimedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      errorMessage:
        scope.onlyExpiredLeases === true
          ? 'requeued — its claim lease expired while this message was being delivered'
          : 'requeued — the server restarted while this message was being delivered',
      nextAttemptAt: at,
    })
    .where(
      and(
        orphanedClaimPredicate(at, scope),
        inArray(delegationJobs.jobKind, [...ORPHAN_REQUEUE_JOB_KINDS]),
      ),
    )
    .returning()
    .all()
}

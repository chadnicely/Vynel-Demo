// Functional repository for the `delegation_jobs` table — the durable FIFO
// work queue for delegated background tasks. `db` is the first argument (per
// `docs/foundation.md §2 row 3`); Phase 1 SYNC returns per
// `.claude/memory/decisions/phase-1-sync-transactions.md`. The atomic claim
// (`claimNextPendingDelegationJob`) holds the load-bearing concurrency guard —
// the guarded UPDATE that makes concurrent workers safe. No raw SQL or Drizzle
// queries outside this repo.
//
// Spec: the `orchestration` domain (Chapter 1 — async core).

import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  delegationJobs,
  type DelegationJob,
  type NewDelegationJob,
} from '../schema/delegation-jobs.js'

// Re-export row + union types so the orchestration logic imports them from the
// co-located `../repositories/index.js` barrel (vertical-slice — the repo lives
// beside its callers now, no longer via the `@vynel/db` kernel subpath).
export type {
  DelegationJob,
  NewDelegationJob,
  DelegationJobStatus,
} from '../schema/delegation-jobs.js'

// Bounded pending list, capped defensively per coding-standard.md
// "Structure / patterns".
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

export function insertDelegationJob(db: Database, row: NewDelegationJob): DelegationJob {
  const [inserted] = db.insert(delegationJobs).values(row).returning().all()
  if (!inserted) throw new Error('insertDelegationJob: no row returned')
  return inserted
}

export function findDelegationJobById(db: Database, id: string): DelegationJob | null {
  const [row] = db.select().from(delegationJobs).where(eq(delegationJobs.id, id)).limit(1).all()
  return row ?? null
}

// The job that minted a given correlation key (brain-tree Chapter 2) — the ownership
// anchor for `resolveDelegationTrace`. partialSessionId is a per-request UUID, so this
// is a point lookup; null when the key is unknown.
export function findDelegationJobByPartialSessionId(
  db: Database,
  partialSessionId: string,
): DelegationJob | null {
  const [row] = db
    .select()
    .from(delegationJobs)
    .where(eq(delegationJobs.partialSessionId, partialSessionId))
    .limit(1)
    .all()
  return row ?? null
}

// The delegation enqueued by ONE global-root turn (brain-tree Ch3.5) — the job whose
// `parentSessionId` is that turn's session AND whose `createdAt` falls in the turn's
// window. Used to stamp the turn's acknowledgement message with the delegation's
// `partialSessionId` (the "link at the delegation moment"). `since` = the turn's start
// (server clock) disambiguates this turn's delegation from earlier ones on the SAME
// session; the latest in the window wins if a turn delegated more than once. Returns
// null when the turn didn't delegate — the caller degrades to NO link (never a wrong one).
export function findLatestDelegationJobForParentSince(
  db: Database,
  parentSessionId: string,
  since: Date,
): DelegationJob | null {
  const [row] = db
    .select()
    .from(delegationJobs)
    .where(and(eq(delegationJobs.parentSessionId, parentSessionId), gte(delegationJobs.createdAt, since)))
    .orderBy(desc(delegationJobs.createdAt), desc(delegationJobs.id))
    .limit(1)
    .all()
  return row ?? null
}

// Atomic FIFO claim: SELECT the oldest pending row (ordered by createdAt, then
// id as a stable tiebreaker for same-millisecond enqueues — timestamp_ms
// resolution can collide), then flip it to `claimed` with a guarded
// compare-and-swap UPDATE (WHERE id = ? AND status = 'pending'). better-sqlite3
// runs the single-statement UPDATE atomically, so if a concurrent worker
// claimed the row between the SELECT and the UPDATE the WHERE no longer matches
// and `.returning().all()` comes back empty — we lost the race and return null
// (mirrors claimDueSchedule's `changes > 0` semantics, returning the row
// instead of a boolean). This is the ONLY concurrency guard; no explicit
// transaction is needed.
export function claimNextPendingDelegationJob(db: Database, claimedAt: Date): DelegationJob | null {
  const [candidate] = db
    .select()
    .from(delegationJobs)
    .where(eq(delegationJobs.status, 'pending'))
    .orderBy(asc(delegationJobs.createdAt), asc(delegationJobs.id))
    .limit(1)
    .all()
  if (!candidate) return null
  const [claimed] = db
    .update(delegationJobs)
    .set({ status: 'claimed', claimedAt })
    .where(and(eq(delegationJobs.id, candidate.id), eq(delegationJobs.status, 'pending')))
    .returning()
    .all()
  return claimed ?? null
}

export function completeDelegationJob(
  db: Database,
  id: string,
  resultText: string,
  completedAt: Date,
): DelegationJob {
  const [updated] = db
    .update(delegationJobs)
    .set({ status: 'completed', resultText, completedAt })
    .where(eq(delegationJobs.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`completeDelegationJob: no row for ${id}`)
  return updated
}

export function failDelegationJob(
  db: Database,
  id: string,
  errorMessage: string,
  completedAt: Date,
): DelegationJob {
  const [updated] = db
    .update(delegationJobs)
    .set({ status: 'failed', errorMessage, completedAt })
    .where(eq(delegationJobs.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`failDelegationJob: no row for ${id}`)
  return updated
}

export function listPendingDelegationJobsForUser(
  db: Database,
  userId: string,
  limit?: number,
): DelegationJob[] {
  const cappedLimit = Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(delegationJobs)
    .where(and(eq(delegationJobs.userId, userId), eq(delegationJobs.status, 'pending')))
    .orderBy(asc(delegationJobs.createdAt), asc(delegationJobs.id))
    .limit(cappedLimit)
    .all()
}

// Terminal delegations the global root hasn't been made aware of yet (brain-tree Ch3.5,
// the root-awareness fix). `completed` AND `failed` both surface — a failed task must not
// leave the root thinking it's "still working". Filtered by `surfacedToRootAt IS NULL` +
// the owning user (one global root per user → no session/swap reasoning). Ordered oldest-
// first so the report block reads chronologically.
export function listUnsurfacedTerminalDelegationsForUser(
  db: Database,
  userId: string,
): DelegationJob[] {
  return db
    .select()
    .from(delegationJobs)
    .where(
      and(
        eq(delegationJobs.userId, userId),
        isNull(delegationJobs.surfacedToRootAt),
        inArray(delegationJobs.status, ['completed', 'failed']),
      ),
    )
    .orderBy(asc(delegationJobs.createdAt), asc(delegationJobs.id))
    .all()
}

// The user's IN-FLIGHT delegations (`pending` + `claimed`) — drives the /global "Vynel is
// processing…" indicator (Ch3.5). Superset of listPendingDelegationJobsForUser, so it carries
// the SAME defensive cap (a user can enqueue faster than the serial service drains); the
// indicator only needs enough rows to detect non-empty + the distinct workspace names.
export function listInFlightDelegationsForUser(
  db: Database,
  userId: string,
  limit?: number,
): DelegationJob[] {
  const cappedLimit = Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(delegationJobs)
    .where(
      and(eq(delegationJobs.userId, userId), inArray(delegationJobs.status, ['pending', 'claimed'])),
    )
    .orderBy(asc(delegationJobs.createdAt), asc(delegationJobs.id))
    .limit(cappedLimit)
    .all()
}

// Mark delegations as surfaced into the root's context (exactly-once — a later turn won't
// re-inject them). Idempotent + a no-op on an empty list.
export function markDelegationsSurfacedToRoot(
  db: Database,
  jobIds: string[],
  surfacedAt: Date,
): void {
  if (jobIds.length === 0) return
  db.update(delegationJobs)
    .set({ surfacedToRootAt: surfacedAt })
    .where(inArray(delegationJobs.id, jobIds))
    .run()
}

// Reclaim jobs orphaned in `claimed` by a server crash/restart mid-run — mark them FAILED
// (NOT re-run: exactly-once is preserved; the Ch1 decision was no-RE-EXECUTE, not no-cleanup).
// Called at service startup, where nothing is running yet, so every `claimed` row is orphaned;
// leaving them claimed made them linger forever as "in-flight" (visible in the Ch3.5 processing
// indicator). `surfacedToRootAt` is set so a restart doesn't spam the root with "couldn't
// complete" — an orphan is a system artifact, not a real task outcome. Returns the count reclaimed.
export function failOrphanedClaimedDelegations(db: Database, at: Date): number {
  const reclaimed = db
    .update(delegationJobs)
    .set({
      status: 'failed',
      errorMessage: 'orphaned — the server restarted while this task was running',
      completedAt: at,
      surfacedToRootAt: at,
    })
    .where(eq(delegationJobs.status, 'claimed'))
    .returning({ id: delegationJobs.id })
    .all()
  return reclaimed.length
}

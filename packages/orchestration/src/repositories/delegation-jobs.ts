// Functional repository for the `delegation_jobs` table — the durable FIFO
// work queue for delegated background tasks. `db` is the first argument (per
// `docs/foundation.md §2 row 3`); Phase 1 SYNC returns per
// `.claude/memory/decisions/phase-1-sync-transactions.md`. The atomic claim
// (`claimNextPendingDelegationJob`) holds the load-bearing concurrency guard —
// the guarded UPDATE that makes concurrent workers safe. No raw SQL or Drizzle
// queries outside this repo.
//
// Spec: the `orchestration` domain (Chapter 1 — async core).

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
} from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  DELIVERY_JOB_KINDS,
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
  DelegationJobKind,
} from '../schema/delegation-jobs.js'

// Bounded pending list, capped defensively per coding-standard.md
// "Structure / patterns".
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

/** The SYNTHETIC exclusion key every GLOBAL-requester DELIVERY job (report or
 *  update — session-comms + persona-sessions) shares: a both-targets-null row
 *  has no natural key, and the global root is ONE conversation — at most one
 *  notify turn should run at a time (the rest stay pending; no budget burned
 *  waiting in the root-lock queue, no failed-delivery report loss). The tick
 *  reports it as the claimed run's targetKey; the claim below excludes
 *  global-delivery rows whenever the key is busy. Workspace ids are UUIDs, so
 *  the constant can never collide. */
export const GLOBAL_ROOT_DELIVERY_TARGET_KEY = 'global-root-delivery'

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
export function claimNextPendingDelegationJob(
  db: Database,
  claimedAt: Date,
  options: {
    /** Targets with a LIVE run — a target key is the job's `workspaceId` OR its
     *  `targetPrimarySessionId` (Slice ④), OR the shared
     *  `GLOBAL_ROOT_DELIVERY_TARGET_KEY` for a global-requester
     *  report-delivery row (session-comms). Skipped so the pool never resumes
     *  the same conversation twice concurrently (single-writer invariant).
     *  FIFO still holds per target; parallelism is across targets only.
     *  NULL-safe: `NOT IN` alone would silently drop every row whose column is
     *  NULL (a session-target job has a NULL workspaceId and vice versa), so
     *  each column's filter passes NULL explicitly. */
    excludeTargetKeys?: readonly string[]
  } = {},
): DelegationJob | null {
  const excludeTargetKeys = options.excludeTargetKeys ?? []
  // A GLOBAL-requester delivery row (both targets null + kind report-delivery)
  // has no natural column key — when the shared synthetic key is busy, exclude
  // those rows explicitly: a row passes only if it has SOME target column, or
  // isn't a report-delivery row at all (legacy NULL kind = task).
  const globalDeliveryHeld = excludeTargetKeys.includes(GLOBAL_ROOT_DELIVERY_TARGET_KEY)
  // Retry backoff gate: a requeued row waits out its `nextAttemptAt` before it
  // is claimable again; NULL (legacy/first attempt) is always due.
  const dueNow = or(
    isNull(delegationJobs.nextAttemptAt),
    lte(delegationJobs.nextAttemptAt, claimedAt),
  )
  const [candidate] = db
    .select()
    .from(delegationJobs)
    .where(
      excludeTargetKeys.length > 0
        ? and(
            eq(delegationJobs.status, 'pending'),
            dueNow,
            // An AGENT-RUN row (chat-mentions) is exempt from the workspace
            // exclusion: its `workspaceId` is the leaf's GROUNDING, not a
            // conversation it resumes — its pool key is its own job id, so a
            // busy workspace slot must not starve it (a 600s task delegation
            // would otherwise skip a pending mention run every tick). The
            // retry-backoff gate above still applies.
            or(
              isNull(delegationJobs.workspaceId),
              notInArray(delegationJobs.workspaceId, [...excludeTargetKeys]),
              eq(delegationJobs.jobKind, 'agent-run'),
            ),
            or(
              isNull(delegationJobs.targetPrimarySessionId),
              notInArray(delegationJobs.targetPrimarySessionId, [...excludeTargetKeys]),
            ),
            ...(globalDeliveryHeld
              ? [
                  or(
                    isNotNull(delegationJobs.workspaceId),
                    isNotNull(delegationJobs.targetPrimarySessionId),
                    isNull(delegationJobs.jobKind),
                    // Both delivery kinds share the synthetic global key — an
                    // update notify turn holds the root conversation exactly
                    // like a report notify turn does (persona-sessions).
                    notInArray(delegationJobs.jobKind, [...DELIVERY_JOB_KINDS]),
                  ),
                ]
              : []),
          )
        : and(eq(delegationJobs.status, 'pending'), dueNow),
    )
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

export type FindPendingUpdateDeliveryInput = {
  userId: string
  /** The requester target — a workspace primary's id, or null for the global root. */
  requesterWorkspaceId: string | null
  threadId: string
}

// The still-PENDING update-delivery row for one (user, requester target,
// thread) — the coalesce anchor (persona-sessions): at most one exists by
// construction (`enqueueUpdateDelivery` replaces instead of inserting while
// one is pending). Claimed rows never match — they are already being spoken.
export function findPendingUpdateDelivery(
  db: Database,
  input: FindPendingUpdateDeliveryInput,
): DelegationJob | null {
  const [row] = db
    .select()
    .from(delegationJobs)
    .where(
      and(
        eq(delegationJobs.userId, input.userId),
        eq(delegationJobs.status, 'pending'),
        eq(delegationJobs.jobKind, 'update-delivery'),
        input.requesterWorkspaceId === null
          ? isNull(delegationJobs.workspaceId)
          : eq(delegationJobs.workspaceId, input.requesterWorkspaceId),
        eq(delegationJobs.threadId, input.threadId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type ReplacePendingDelegationJobBodyInput = {
  taskText: string
  parentSessionId: string
  workspaceName: string
}

// Replace a still-pending row's spoken content IN PLACE (the update coalesce):
// body, reporter provenance, and label move; `createdAt` (the FIFO position)
// and `partialSessionId` (the delivery hop's trace key) deliberately do NOT.
// Compare-and-swap on status='pending' — if a worker claimed the row between
// the caller's find and this update, the WHERE misses and null tells the
// caller to insert a fresh row instead (the same race shape as the claim).
export function replacePendingDelegationJobBody(
  db: Database,
  id: string,
  input: ReplacePendingDelegationJobBodyInput,
): DelegationJob | null {
  const [updated] = db
    .update(delegationJobs)
    .set({
      taskText: input.taskText,
      parentSessionId: input.parentSessionId,
      workspaceName: input.workspaceName,
    })
    .where(and(eq(delegationJobs.id, id), eq(delegationJobs.status, 'pending')))
    .returning()
    .all()
  return updated ?? null
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
  options: { errorCode?: string } = {},
): DelegationJob {
  const [updated] = db
    .update(delegationJobs)
    .set({
      status: 'failed',
      errorMessage,
      completedAt,
      ...(options.errorCode !== undefined ? { errorCode: options.errorCode } : {}),
    })
    .where(eq(delegationJobs.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`failDelegationJob: no row for ${id}`)
  return updated
}

/** Requeue a claimed job for another attempt (recoverable failure — rate limit,
 *  network, provider start timeout): back to `pending` with the attempt counter
 *  bumped and a backoff deadline the claim gates on. The channels outbound
 *  retry shape, applied to delegation. The tick owns the row (claimed), so this
 *  is a plain update, not a CAS. */
export function requeueDelegationJob(
  db: Database,
  id: string,
  input: {
    errorMessage: string
    errorCode: string | null
    attemptCount: number
    nextAttemptAt: Date
  },
): DelegationJob {
  const [updated] = db
    .update(delegationJobs)
    .set({
      status: 'pending',
      claimedAt: null,
      errorMessage: input.errorMessage,
      errorCode: input.errorCode,
      attemptCount: input.attemptCount,
      nextAttemptAt: input.nextAttemptAt,
    })
    .where(eq(delegationJobs.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`requeueDelegationJob: no row for ${id}`)
  return updated
}

/** Fail a job ONLY while it is still `pending` — the user-stop path's CAS.
 *  Unlike `failDelegationJob` (the tick's terminal write on a job it OWNS),
 *  this guards against the claim race: a stop landing after the tick claimed
 *  the row must not flip a RUNNING job to failed under it (the claimed path
 *  stops via the cancel registry instead). Returns false when the guard bit. */
export function failPendingDelegationJob(
  db: Database,
  id: string,
  errorMessage: string,
  completedAt: Date,
): boolean {
  const updated = db
    .update(delegationJobs)
    .set({ status: 'failed', errorMessage, completedAt })
    .where(and(eq(delegationJobs.id, id), eq(delegationJobs.status, 'pending')))
    .returning()
    .all()
  return updated.length > 0
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
//
// TASK rows only (NULL-safe — legacy rows have a NULL jobKind): a
// 'report-delivery' row IS the awareness mechanism, never a task the root
// awaits — injecting a completed notify turn's own reply (or a failed
// delivery's error) as "a report from a workspace" would be a false echo.
// Since the no-harvest pipeline (Chad, locked 2026-07-27) the completion path
// marks EVERY completed task surfaced unconditionally — a completed reply is
// never captured, so only FAILED tasks reach this net (a failure note is
// status, not capture).
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
        or(isNull(delegationJobs.jobKind), eq(delegationJobs.jobKind, 'task')),
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

// The user's delegated work, newest-first, across EVERY status — what the agent
// that enqueued a task can read back about it (`list_background_runs`). The
// in-flight and unsurfaced-terminal queries above each answer one narrow
// question for one consumer; this one answers "what did I hand off, and where
// did it get to", so it spans queued → running → finished in a single list.
//
// TASK rows only, matching `listUnsurfacedTerminalDelegationsForUser`: a
// 'report-delivery' row is the notify MECHANISM, not work anyone handed off —
// listing it would show the agent its own report being delivered as if it were
// another task. NULL-safe for legacy rows (NULL jobKind means 'task').
export function listRecentDelegationJobsForUser(
  db: Database,
  userId: string,
  limit?: number,
): DelegationJob[] {
  const cappedLimit = Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(delegationJobs)
    .where(
      and(
        eq(delegationJobs.userId, userId),
        or(isNull(delegationJobs.jobKind), eq(delegationJobs.jobKind, 'task')),
      ),
    )
    .orderBy(desc(delegationJobs.createdAt), desc(delegationJobs.id))
    .limit(cappedLimit)
    .all()
}

// Every hop of ONE chain, oldest first — the read `partialSessionId` cannot
// answer (it is per-hop by design). Matches on the stored `threadId` OR on a
// row whose own `partialSessionId` IS the thread: a chain-starting hop seeds the
// thread from its own key, and a legacy row (threadId NULL, written before the
// column existed) is its own thread — the `or` is what lets the migration skip a
// backfill entirely.
export function listDelegationJobsByThread(
  db: Database,
  input: { userId: string; threadId: string; limit?: number },
): DelegationJob[] {
  const cappedLimit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(delegationJobs)
    .where(
      and(
        eq(delegationJobs.userId, input.userId),
        or(
          eq(delegationJobs.threadId, input.threadId),
          and(
            isNull(delegationJobs.threadId),
            eq(delegationJobs.partialSessionId, input.threadId),
          ),
        ),
      ),
    )
    .orderBy(asc(delegationJobs.createdAt), asc(delegationJobs.id))
    .limit(cappedLimit)
    .all()
}

// Record that the running turn reported through the tool. Idempotent — a turn
// that reports twice keeps the FIRST stamp (the tick only cares whether one
// happened at all, and the first is the truthful moment).
export function markDelegationJobReported(db: Database, jobId: string, at: Date): void {
  db.update(delegationJobs)
    .set({ reportedAt: at })
    .where(and(eq(delegationJobs.id, jobId), isNull(delegationJobs.reportedAt)))
    .run()
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
// complete" — an orphan is a system artifact, not a real task outcome. Returns the FULL rows
// (persona-sessions): with acknowledge-first, a child that said "will report when done" and
// then silently vanished breaks the spoken contract — the startup pass pushes an honest
// failure delivery for orphaned WORK rows (the caller filters; deliveries stay anti-cascade).
// `report-delivery` rows are EXCLUDED — they requeue instead
// (`requeueOrphanedClaimedReportDeliveries` below): the report body is the only
// copy of a child's result, so an orphaned delivery is retried, never destroyed.
export function failOrphanedClaimedDelegations(db: Database, at: Date): DelegationJob[] {
  return db
    .update(delegationJobs)
    .set({
      status: 'failed',
      errorMessage: 'orphaned — the server restarted while this task was running',
      completedAt: at,
      surfacedToRootAt: at,
    })
    .where(
      and(
        eq(delegationJobs.status, 'claimed'),
        // NULL-safe kind gate (legacy NULL jobKind = task): everything but the
        // report deliveries, which the requeue pass below owns.
        or(isNull(delegationJobs.jobKind), ne(delegationJobs.jobKind, 'report-delivery')),
      ),
    )
    .returning()
    .all()
}

// The report-delivery half of the boot reap: a claimed delivery orphaned by a
// crash goes back to `pending` (claimedAt cleared, immediately due) instead of
// dying — the report body is the ONLY copy of the child's result, and at boot
// nothing is running, so re-delivery is safe at-least-once (a turn that died
// AFTER persisting its inbound row re-delivers a duplicate marker message; the
// recorded delivery-retry trade). The attempt counter is deliberately NOT
// bumped: orphaning is the process's failure, not the delivery's, and a
// bounded counter here would eventually destroy a report on a crash-looping
// machine — the one outcome this function exists to prevent. `update-delivery`
// rows stay on the terminal-drop path above (ephemeral status, never requeued).
export function requeueOrphanedClaimedReportDeliveries(db: Database, at: Date): DelegationJob[] {
  return db
    .update(delegationJobs)
    .set({
      status: 'pending',
      claimedAt: null,
      errorMessage: 'requeued — the server restarted while this report was being delivered',
      nextAttemptAt: at,
    })
    .where(
      and(eq(delegationJobs.status, 'claimed'), eq(delegationJobs.jobKind, 'report-delivery')),
    )
    .returning()
    .all()
}

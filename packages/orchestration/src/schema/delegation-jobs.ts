// `delegation_jobs` table for the `orchestration` domain — one row per delegated
// background task: a durable FIFO work queue. A worker claims the oldest
// pending row atomically (the compare-and-swap UPDATE in the repo), runs the
// task, then marks it completed/failed. No `deletedAt`: terminal rows are
// pruned by a future retention job, not soft-deleted.
//
// Spec: the `orchestration` domain (Chapter 1 — async core).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope (FK-with-cascade, mirroring `schedules.workspaceId`).
// `parentSessionId` + `partialSessionId` are LOOSE `text()` cross-system refs
// (the global-root / partial sdk session ids) — NOT FKs, mirroring
// `schedule_runs.chatSessionId`. Indexes via the `index()` helper. Phase 1
// SYNC repo discipline applies.

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { DelegationPermissionMode } from '../orchestration-types.js'

export type DelegationJobStatus = 'pending' | 'claimed' | 'completed' | 'failed'

// What a queue row IS (session-comms, the revert flow): a 'task' row runs the
// delegated work; a 'report-delivery' row runs a NOTIFY turn on the REQUESTER's
// conversation with a child's report as the attributed inbound message; an
// 'update-delivery' row (persona-sessions) is the interim sibling — the child's
// spoken ack/progress, same notify machinery, but it NEVER marks the task
// reported and coalesces while pending (one in-flight update per thread); an
// 'agent-run' row (chat-mentions) runs ONE agent leaf on the user's message and
// delivers its result deterministically as a report; a 'direct-delivery' row
// (kind `direct_to_user`) carries a final answer addressed to the USER — it
// persists straight onto the requester's transcript with NO notify turn, and
// the requester absorbs it silently via the catch-up net. Stored nullable —
// NULL means 'task' (every legacy row), so the migration is a pure additive
// ALTER.
export type DelegationJobKind =
  | 'task'
  | 'report-delivery'
  | 'update-delivery'
  | 'direct-delivery'
  | 'agent-run'

// The DELIVERY kinds — rows that carry a child's message to a requester rather
// than handed-off work. ONE home for the membership so every "is this a
// delivery / is this work" predicate stays mechanical when a kind is added
// (the claim gate + queries take the array; TS branches take the predicates).
export const DELIVERY_JOB_KINDS = ['report-delivery', 'update-delivery', 'direct-delivery'] as const

export function isDeliveryJobKind(
  kind: DelegationJobKind | null,
): kind is (typeof DELIVERY_JOB_KINDS)[number] {
  return kind !== null && (DELIVERY_JOB_KINDS as readonly string[]).includes(kind)
}

/** A WORK row — delegated/handed-off work the run views may show. NULL reads
 *  as 'task' (the additive-migration contract). */
export function isWorkJobKind(kind: DelegationJobKind | null): boolean {
  return kind === null || kind === 'task' || kind === 'agent-run'
}

export const delegationJobs = table(
  'delegation_jobs',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Loose cross-system ref — NOT a FK. The enqueue-time global-root sdk
    // session id; used later for a monitor edge. Same treatment as
    // schedule_runs.chatSessionId.
    parentSessionId: text().notNull(),
    // TARGET (the enqueue ops enforce the row invariant): a WORKSPACE target
    // carries the three workspace columns; a SESSION target (session-library
    // Slice ④) carries `targetPrimarySessionId` instead — exactly one set for a
    // 'task' row. A DELIVERY row (report/update) targets the REQUESTER
    // conversation: `workspaceId` set = that workspace's primary; BOTH targets
    // null = the global root (permitted for the delivery kinds ONLY —
    // session-comms). Nullable FK via `text().references(...)` — `id()` is NOT
    // NULL by dialect contract (the primary_sessions.workspaceId precedent).
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // The RUN CWD, not strictly "the workspace's folder": a workspace target
    // stores the workspace path; a SESSION target stores the spawned session's
    // cwd (v1: the global root's hidden user-data dir). One column, one
    // reading — "where this job's turn runs". Never null on rows the enqueue
    // ops write; nullable because a session target has no workspace to demand it.
    workspacePath: text(),
    // The enqueue-time workspace name — null for a session target (the tick
    // labels those by the spawned session's name, read fresh at run time). On a
    // 'report-delivery' row this column carries the CHILD's composed source
    // label instead ("Mark · Acme" / the session name) — the notify turn's
    // inbound attribution; the requester is already identified by the target
    // columns (session-comms; the notes bless column reuse over a new column).
    workspaceName: text(),
    // A SESSION target: the spawned primary this job's turn resumes. LOOSE
    // cross-feature ref — NOT a FK (`primary_sessions` is another package's
    // table; loose-ref + outbox is the cross-feature contract).
    targetPrimarySessionId: text(),
    taskText: text().notNull(),
    // Loose cross-system ref — NOT a FK. Reserved for Chapter 2 (the partial
    // sdk session id). Nullable until then.
    partialSessionId: text(),
    status: text().$type<DelegationJobStatus>().notNull(),
    claimedAt: timestamp(),
    completedAt: timestamp(),
    resultText: text(),
    errorMessage: text(),
    // When the global root was made aware of this (terminal) delegation's outcome —
    // its `resultText`/failure surfaced into the root's next turn context (brain-tree
    // Ch3.5, the root-awareness fix). Null until surfaced; the "unseen reports" query
    // filters on it. Closes the Ch1-loop gap (the async push reached the transcript but
    // not the root's SDK session).
    surfacedToRootAt: timestamp(),
    // The ORIGIN CHANNEL this delegation was requested from (brain-tree Ch4, channel-aware I/O).
    // Loose cross-system refs — NOT FKs (channels is another domain; mirrors parentSessionId). All
    // null = a non-channel origin (web/voice text). When set, the claim-and-run tick delivers the
    // report back to this channel + recipient (graceful skip if the channel is gone, like the
    // schedule→channel consumer). `chatContextId` is the delivery address; `senderId` is who asked.
    originChannelId: text(),
    originExternalSenderId: text(),
    originExternalChatContextId: text(),
    // The permission mode the routed turn runs under (surface-up approval, step 1) —
    // threaded from the delegating turn's user-facing mode. Null = the pre-mode
    // default (`bypass-with-behavior-gate`: only the irreversible floor cards).
    permissionMode: text().$type<DelegationPermissionMode>(),
    // The delegating root's MODEL + THINKING-EFFORT picks for the routed turn —
    // threaded into the provider's startChatSession by the claim-and-run tick.
    // Null = the provider defaults (today's behavior, byte-for-byte).
    model: text(),
    thinkingEffort: text().$type<ThinkingEffortLevel>(),
    // What this row IS — see the `DelegationJobKind` union doc above. Nullable
    // so migration 0015 stays a pure additive ALTER — legacy NULL rows read as
    // tasks byte-for-byte.
    jobKind: text().$type<DelegationJobKind>(),
    // The CHAIN key: one task and everything it caused, across every hop.
    //
    // `partialSessionId` is per-HOP by design — a fresh key per enqueue, so each
    // hop is independently watchable. That means a two-hop chain (global → ws →
    // spawned, then reports back up) produced FOUR unrelated keys with nothing
    // linking them. `threadId` is the outer envelope: minted once when a task
    // first leaves a session, then carried through every continuation — the task
    // down, the report up, a re-delegation.
    //
    // Nullable so the migration stays a pure additive ALTER. A NULL row reads as
    // its own thread (see `resolveThreadId`), which is exactly right for legacy
    // rows: before this existed, every hop WAS its own chain.
    threadId: text(),
    // Set when the running turn reported through the tool instead of leaving
    // its reply to be harvested. The tick reads it to decide whether to
    // auto-report at completion — without it a turn that reported explicitly
    // would ALSO have its chat reply scraped and sent, waking the requester
    // twice with overlapping content.
    reportedAt: timestamp(),
    // 'agent-run' rows only (chat-mentions): the agent to run, resolved FRESH
    // at claim time (workspace scope preferred, then user scope — the
    // `createLeafSession` rule). Null on every other kind.
    agentSlug: text(),
    // WHERE this job's report should land (chat-mentions): the ORIGINATING
    // chat's workspace primary; null = the global root (the pre-mentions
    // behavior, byte-for-byte). LOOSE ref — NOT a FK: a deleted originating
    // workspace must fail the report over to the global root, never cascade
    // the job away. Read by 'task' rows (the delegated turn's
    // report_to_requester + the give-up failure push) and 'agent-run' rows
    // (the deterministic result delivery). Distinct from `workspaceId`, which
    // stays "the TARGET/grounding" — one column, one reading each.
    requesterWorkspaceId: text(),
    // RETRY bookkeeping (recoverable-failure requeue — the channels outbound
    // shape). All nullable so the migration stays a pure additive ALTER:
    // NULL attemptCount reads as 0; NULL nextAttemptAt reads as "due now".
    attemptCount: integer(),
    // When a requeued row becomes claimable again (backoff). The claim gates on
    // it; legacy/first-attempt rows carry NULL and are always due.
    nextAttemptAt: timestamp(),
    // The structured failure code from the last attempt (the provider's
    // session-errored errorCode / 'provider_start_timeout' / an Error name) —
    // what the retry classifier decided on; errorMessage stays the prose.
    errorCode: text(),
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    // FIFO claim: oldest pending first (status filter + createdAt order).
    statusCreatedIdx: index('idx_delegation_jobs_status_created').on(t.status, t.createdAt),
    userIdx: index('idx_delegation_jobs_user').on(t.userId),
    // The chain read: every hop of one thread, oldest first.
    threadIdx: index('idx_delegation_jobs_thread').on(t.threadId, t.createdAt),
    // The retry claim: due-time gate rides beside the status filter.
    readyIdx: index('idx_delegation_jobs_ready').on(t.status, t.nextAttemptAt),
  }),
)

export type DelegationJob = typeof delegationJobs.$inferSelect
export type NewDelegationJob = typeof delegationJobs.$inferInsert

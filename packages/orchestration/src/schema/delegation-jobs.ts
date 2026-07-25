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

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { DelegationPermissionMode } from '../orchestration-types.js'

export type DelegationJobStatus = 'pending' | 'claimed' | 'completed' | 'failed'

// What a queue row IS (session-comms, the revert flow): a 'task' row runs the
// delegated work; a 'report-delivery' row runs a NOTIFY turn on the REQUESTER's
// conversation with a child's report as the attributed inbound message. Stored
// nullable — NULL means 'task' (every legacy row), so the migration is a pure
// additive ALTER.
export type DelegationJobKind = 'task' | 'report-delivery'

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
    // 'task' row. A 'report-delivery' row targets the REQUESTER conversation:
    // `workspaceId` set = that workspace's primary; BOTH targets null = the
    // global root (permitted for kind 'report-delivery' ONLY — session-comms).
    // Nullable FK via `text().references(...)` — `id()` is NOT NULL by dialect
    // contract (the primary_sessions.workspaceId precedent).
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
    // What this row IS (session-comms): NULL/'task' = delegated work;
    // 'report-delivery' = a notify turn delivering `taskText` (the child's
    // report) to the requester. Nullable so migration 0015 stays a pure
    // additive ALTER — legacy rows read as tasks byte-for-byte.
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
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    // FIFO claim: oldest pending first (status filter + createdAt order).
    statusCreatedIdx: index('idx_delegation_jobs_status_created').on(t.status, t.createdAt),
    userIdx: index('idx_delegation_jobs_user').on(t.userId),
    // The chain read: every hop of one thread, oldest first.
    threadIdx: index('idx_delegation_jobs_thread').on(t.threadId, t.createdAt),
  }),
)

export type DelegationJob = typeof delegationJobs.$inferSelect
export type NewDelegationJob = typeof delegationJobs.$inferInsert

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

export type DelegationJobStatus = 'pending' | 'claimed' | 'completed' | 'failed'

export const delegationJobs = table(
  'delegation_jobs',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Loose cross-system ref — NOT a FK. The enqueue-time global-root sdk
    // session id; used later for a monitor edge. Same treatment as
    // schedule_runs.chatSessionId.
    parentSessionId: text().notNull(),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    workspacePath: text().notNull(),
    workspaceName: text().notNull(),
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
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    // FIFO claim: oldest pending first (status filter + createdAt order).
    statusCreatedIdx: index('idx_delegation_jobs_status_created').on(t.status, t.createdAt),
    userIdx: index('idx_delegation_jobs_user').on(t.userId),
  }),
)

export type DelegationJob = typeof delegationJobs.$inferSelect
export type NewDelegationJob = typeof delegationJobs.$inferInsert

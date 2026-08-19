// The `session_turns` table — the DURABLE turn envelope (persona-sessions):
// one row per AI turn, begun/ended through the `SessionActivityFeed`'s
// recorder seam, so the live picture survives a refresh or an api restart
// (the in-process feed snapshot alone dies with the process). The envelope
// ONLY — everything else derives honestly at read time:
//   - queued tasks per session = `delegation_jobs` (already per-task),
//   - the current step = the latest 'started' `chat_tool_calls` row for the
//     turn's sessionId (+ open approval rows),
//   - the step history = the chat rows themselves.
// No step columns here, and DELIBERATELY no per-row outbox event: this is
// high-churn runtime liveness (the `chat_tool_calls` eventless precedent),
// not domain state another feature consumes.
//
// `userId`/`workspaceId` are real FKs (tenant boundary + scope, cascade); the
// correlation columns are LOOSE text refs — cross-feature ids (`delegation_jobs`,
// SDK session ids) never FK across leaves. Rows are reaped to
// `endedReason:'orphaned'` at boot (the tool-call reap precedent) and purged by
// age (the scheduled purge caller is a follow-up unit, the primary-sessions
// precedent); neither path is user-visible history.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import type { SessionTurnOrigin, SessionTurnScopeKind } from '@vynel/contracts/chat/session-activity'

// 'failed' = the drain saw a terminal `session-errored` or threw — the
// "stuck on an error" signal the workspace status vocabulary reads. A user
// interrupt stays 'ended' (stopping work is not a problem).
export type SessionTurnEndedReason = 'ended' | 'orphaned' | 'failed'

export const sessionTurns = table(
  'session_turns',
  {
    /** The feed's turnId — one identity across the live stream and this row. */
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    scopeKind: text().$type<SessionTurnScopeKind>().notNull(),
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    origin: text().$type<SessionTurnOrigin>().notNull(),
    // The SDK session the turn runs on — null until the runtime resolves it
    // (a fresh conversation learns its id mid-turn). LOOSE ref.
    sessionId: text(),
    // Correlation (A8 enriches the producers): the continuing identity, the
    // queue row, the chain, and the per-hop trace key. All LOOSE + nullable.
    primarySessionId: text(),
    jobId: text(),
    threadId: text(),
    partialSessionId: text(),
    startedAt: timestamp().notNull(),
    // Null while running — the liveness predicate.
    endedAt: timestamp(),
    // 'ended' = the producer's finally ran; 'orphaned' = the boot reap closed
    // a row the previous process left running.
    endedReason: text().$type<SessionTurnEndedReason>(),
  },
  (t) => ({
    // The running-turns read: endedAt IS NULL per user.
    userEndedIdx: index('idx_session_turns_user_ended').on(t.userId, t.endedAt),
    // The per-task link (a session holding multiple tasks reads per-job).
    jobIdx: index('idx_session_turns_job').on(t.jobId),
    // A continuing identity's turn history, newest-first reads.
    primaryStartedIdx: index('idx_session_turns_primary_started').on(
      t.primarySessionId,
      t.startedAt,
    ),
  }),
)

export type SessionTurnRow = typeof sessionTurns.$inferSelect
export type NewSessionTurnRow = typeof sessionTurns.$inferInsert

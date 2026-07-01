// The `chat_messages` table for the `chat` domain — one row per user-sent or
// assistant-sent message. See `docs/blueprints/chat/blueprint.md §3.2`.
//
// id is `text()` because PK source is mixed by role per D15:
//   - assistant rows: provider's messageId (lets the SSE consumer group chunks)
//   - user rows: Vynel UUID via crypto.randomUUID()
//   - (tool-call rows live in chat_tool_calls — see that file)
//
// Phase 1 SYNC discipline applies.
//
// JSON shape interface (AttachedImageMetadata) + the ChatMessageRole union
// live in this file per data-standard.md "JSONB / JSON shape interfaces
// colocate with the column".
//
// `attachedImagesMetadata` uses `json<T>()` (D25); the image files
// themselves live in `<workspace.path>/.vynel/transcripts/<sessionId>/
// images/<filename>` per D22.

import { table, text, timestamp, integer, json, index } from '@vynel/db/dialect'
import { chatSessions } from './chat-sessions.js'

export type ChatMessageRole = 'user' | 'assistant' | 'system'

// Source identity for a message in the GLOBAL-ROOT transcript (brain-tree).
// Refines `role` so a report bubbling up the session tree is attributed to its
// origin rather than flattened to 'assistant'. Null on workspace-chat rows
// (read `role` there — unchanged). P0.1 populates 'user' + 'global-root'; the
// brain-tree phases populate 'workspace-manager' + 'agent' (with `sourceLabel`
// = the workspace / agent name).
export type ChatMessageSourceKind = 'user' | 'global-root' | 'workspace-manager' | 'agent'

export type AttachedImageMetadata = {
  /** Relative to <workspace.path>/.vynel/transcripts/<sessionId>/images/. */
  filename: string
  /** e.g. 'image/png'. */
  mimeType: string
  sizeBytes: number
}

export const chatMessages = table(
  'chat_messages',
  {
    id: text().primaryKey(), // mixed source per role — D15
    sessionId: text()
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text().$type<ChatMessageRole>().notNull(),
    body: text().notNull(),
    // Brain-tree source attribution (P0.1) — who produced this message in the
    // session tree. Additive + nullable: workspace-chat rows leave both null and
    // render from `role`; the global-root transcript populates them.
    sourceKind: text().$type<ChatMessageSourceKind>(),
    sourceLabel: text(), // the workspace / agent name for 'workspace-manager'/'agent'
    // Brain-tree Chapter 2 correlation key — ties ONE delegation request's whole
    // chain (the global→workspace task, the workspace reply, the pushed report)
    // under a single id so it's queryable as a condensed trace without loading the
    // heavy sessions. Minted at enqueue; stamped by the delegation taggers. Additive
    // + nullable: every non-delegation message leaves it null.
    partialSessionId: text(),
    thinkingBody: text(), // optional thinking content; D7
    // On an assistant row: the turn's context-window occupancy (uncached input +
    // cache read + cache creation), set from the usage report. NOT the same as
    // chat_sessions.totalInputTokens, which sums billed-input-only across turns.
    // Null for user messages (and assistant rows before usage is reported).
    inputTokens: integer(),
    outputTokens: integer(),
    attachedImagesMetadata: json<AttachedImageMetadata[]>(), // opaque-never-filtered; D25
    errorCode: text(), // non-null only if message errored mid-stream
    errorMessage: text(),
    startedAt: timestamp().notNull(),
    completedAt: timestamp(), // null while streaming; set on completion
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    sessionStartedIdx: index('idx_chat_messages_session_started').on(t.sessionId, t.startedAt),
    sessionRoleIdx: index('idx_chat_messages_session_role').on(t.sessionId, t.role),
    // The trace read filters by partialSessionId and orders by startedAt — the
    // composite serves both (mirrors the sessionStartedIdx precedent).
    partialSessionStartedIdx: index('idx_chat_messages_partial_started').on(
      t.partialSessionId,
      t.startedAt,
    ),
  }),
)

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

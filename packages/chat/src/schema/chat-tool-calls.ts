// The `chat_tool_calls` table for the `chat` domain — one row per tool
// invocation, child of an assistant message. See
// `docs/blueprints/chat/blueprint.md §3.3`.
//
// Tool calls are persisted as children of the assistant message that triggered
// them (D3 — separate table, FK to parent). The frontend renders them inline
// nested under the parent message.
//
// id() is the Vynel UUID; the provider's toolUseId lives in its own column
// for correlation between tool-use-started and tool-use-completed events.
//
// Phase 1 SYNC discipline applies.
//
// ToolCallStatus + ApprovalStatus unions live in this file (colocate with the
// column they type). `toolInput` / `toolOutput` use the `json<T>()` helper
// (D25) — opaque-never-filtered (the shape is tool-name-specific).

import { table, id, text, timestamp, boolean, json, index } from '@vynel/db/dialect'
import { chatMessages } from './chat-messages.js'

export type ToolCallStatus =
  | 'started' // tool-use-started event received, no result yet
  | 'completed' // tool-use-completed event received, success
  | 'failed' // tool-use-completed event received, isError: true
  | 'denied' // approval-resolved with kind 'denied' — the user refused, the tool never ran
  | 'cancelled' // stream/session ended before completion (interrupt, disconnect, crash reap)

export type ApprovalStatus = 'approved' | 'denied' | 'timed-out' | 'cancelled'

/** One tool call a SUBAGENT made, persisted on its spawning Agent call's row.
 *  Lean by design: no output (the activity pane renders name + input + status;
 *  the subagent's outputs stay out of the DB — the Agent call's own toolOutput
 *  carries the final report). Timestamps are ISO-8601 strings (JSON column). */
export type SubagentToolCall = {
  toolUseId: string
  toolName: string
  toolInput: unknown
  status: 'started' | 'completed' | 'failed'
  startedAt: string
  completedAt: string | null
}

export const chatToolCalls = table(
  'chat_tool_calls',
  {
    id: id().primaryKey(),
    parentMessageId: text()
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    toolUseId: text().notNull(), // provider-supplied
    toolName: text().notNull(),
    toolInput: json<unknown>().notNull(), // opaque-never-filtered; D25
    toolOutput: json<unknown>(), // null while running
    status: text().$type<ToolCallStatus>().notNull(),
    approvalStatus: text().$type<ApprovalStatus>(), // null if approval wasn't required
    isErrorResult: boolean().notNull(),
    // A spawning Agent/Task call's persisted subagent activity — the agent's
    // streamed narrative (appended per chunk) + its tool calls (lean, no
    // outputs). Null on ordinary calls. Makes the nested activity pane
    // survive settle/reload, the same way the delegation trace's rows do.
    subagentNarrative: text(),
    subagentToolCalls: json<SubagentToolCall[]>(),
    startedAt: timestamp().notNull(),
    completedAt: timestamp(),
  },
  (t) => ({
    parentMessageIdx: index('idx_chat_tool_calls_parent_message').on(t.parentMessageId),
    parentMessageStartedIdx: index('idx_chat_tool_calls_parent_message_started').on(
      t.parentMessageId,
      t.startedAt,
    ),
    toolUseIdIdx: index('idx_chat_tool_calls_tool_use_id').on(t.toolUseId),
  }),
)

export type ChatToolCall = typeof chatToolCalls.$inferSelect
export type NewChatToolCall = typeof chatToolCalls.$inferInsert

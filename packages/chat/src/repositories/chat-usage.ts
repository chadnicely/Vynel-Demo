// Functional repository read behind the dashboard's "models over time" usage
// statistics — every assistant message that reported usage, joined to its
// session for model + provider attribution. Messages, not the session's
// denormalized counters, because only per-message rows carry a time axis
// (`createdAt`). Soft-deleted, archived, and hidden sessions are INCLUDED:
// the tokens were spent regardless; the retention purge job is the only
// eraser of usage history.
//
// Phase 1 SYNC return values — per the better-sqlite3 transaction contract.

import { and, eq, gte, isNotNull } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { chatMessages } from '../schema/chat-messages.js'
import { chatSessions } from '../schema/chat-sessions.js'

export type AssistantUsageRow = {
  createdAt: Date
  /** Session model at read time (e.g. 'claude-opus-4-8'); null for sessions
   * that never captured one. */
  model: string | null
  providerId: string
  /** Context-window occupancy of the turn (uncached input + cache read +
   * cache creation) — see the `chat_messages.inputTokens` column note. */
  inputTokens: number | null
  outputTokens: number | null
}

export type ListAssistantUsageRowsSinceInput = {
  userId: string
  since: Date
  /** Restrict to one workspace's sessions; omit for the user's whole set
   * (global root + every workspace). */
  workspaceId?: string
}

export function listAssistantUsageRowsSince(
  db: Database,
  input: ListAssistantUsageRowsSinceInput,
): AssistantUsageRow[] {
  return db
    .select({
      createdAt: chatMessages.createdAt,
      model: chatSessions.model,
      providerId: chatSessions.providerId,
      inputTokens: chatMessages.inputTokens,
      outputTokens: chatMessages.outputTokens,
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, input.userId),
        eq(chatMessages.role, 'assistant'),
        // Rows before their usage report carry null tokens — not usage yet.
        isNotNull(chatMessages.outputTokens),
        gte(chatMessages.createdAt, input.since),
        ...(input.workspaceId !== undefined
          ? [eq(chatSessions.workspaceId, input.workspaceId)]
          : []),
      ),
    )
    .all()
}

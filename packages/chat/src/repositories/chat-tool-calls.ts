// Functional repository for the `chat_tool_calls` table. Spec:
// `docs/blueprints/chat/blueprint.md §4.3`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  chatToolCalls,
  type ChatToolCall,
  type NewChatToolCall,
} from '../schema/chat-tool-calls.js'
import { chatMessages } from '../schema/chat-messages.js'

// Re-export row types + the status unions per the workspaces repo precedent.
export type {
  ChatToolCall,
  NewChatToolCall,
  ToolCallStatus,
  ApprovalStatus,
  SubagentToolCall,
} from '../schema/chat-tool-calls.js'

export function findChatToolCallById(db: Database, toolCallId: string): ChatToolCall | null {
  const [row] = db
    .select()
    .from(chatToolCalls)
    .where(eq(chatToolCalls.id, toolCallId))
    .limit(1)
    .all()
  return row ?? null
}

// Used by the SSE consumer for tool-use-completed correlation against the
// provider-supplied toolUseId.
export function findChatToolCallByToolUseId(db: Database, toolUseId: string): ChatToolCall | null {
  const [row] = db
    .select()
    .from(chatToolCalls)
    .where(eq(chatToolCalls.toolUseId, toolUseId))
    .limit(1)
    .all()
  return row ?? null
}

export function listChatToolCallsForMessage(db: Database, parentMessageId: string): ChatToolCall[] {
  return db
    .select()
    .from(chatToolCalls)
    .where(eq(chatToolCalls.parentMessageId, parentMessageId))
    .orderBy(asc(chatToolCalls.startedAt))
    .all()
}

// JOIN through chat_messages by sessionId — used by getChatSessionDetail to
// fetch every tool call in a session in one query.
export function listChatToolCallsForSession(db: Database, sessionId: string): ChatToolCall[] {
  const rows = db
    .select({ toolCall: chatToolCalls })
    .from(chatToolCalls)
    .innerJoin(chatMessages, eq(chatToolCalls.parentMessageId, chatMessages.id))
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatToolCalls.startedAt))
    .all()
  return rows.map((r) => r.toolCall)
}

export function insertChatToolCall(db: Database, newToolCall: NewChatToolCall): ChatToolCall {
  const [inserted] = db.insert(chatToolCalls).values(newToolCall).returning().all()
  if (!inserted) throw new Error('insertChatToolCall: no row returned')
  return inserted
}

// COALESCE handles the first chunk (column starts null). SQL-side concat —
// no read-modify-write — mirroring appendToChatMessageBody.
export function appendToChatToolCallSubagentNarrative(
  db: Database,
  toolCallId: string,
  narrativeDelta: string,
): void {
  db.update(chatToolCalls)
    .set({
      subagentNarrative: sql`COALESCE(${chatToolCalls.subagentNarrative}, '') || ${narrativeDelta}`,
    })
    .where(eq(chatToolCalls.id, toolCallId))
    .run()
}

// Teardown reap — settle a turn's still-open rows as `cancelled` when its
// stream ends without their completion events (interrupt, disconnect, error).
// Guarded on `status = 'started'` so a completion that raced the teardown
// keeps its terminal status.
export function cancelStartedChatToolCalls(
  db: Database,
  toolCallIds: string[],
  completedAt: Date,
): ChatToolCall[] {
  if (toolCallIds.length === 0) return []
  return db
    .update(chatToolCalls)
    .set({ status: 'cancelled', completedAt })
    .where(and(inArray(chatToolCalls.id, toolCallIds), eq(chatToolCalls.status, 'started')))
    .returning()
    .all()
}

// BOOT reap — at boot no turn is live, so EVERY `started` row is an orphan
// whose completion event died with the previous process; without this a crash
// or app exit mid-tool leaves its card "running" forever (the approvals
// `reapAllPending` reasoning).
export function reapAllStartedChatToolCalls(db: Database, completedAt: Date): number {
  return db
    .update(chatToolCalls)
    .set({ status: 'cancelled', completedAt })
    .where(eq(chatToolCalls.status, 'started'))
    .returning({ id: chatToolCalls.id })
    .all().length
}

export function updateChatToolCall(
  db: Database,
  toolCallId: string,
  patch: Partial<Omit<ChatToolCall, 'id' | 'parentMessageId' | 'startedAt'>>,
): ChatToolCall | null {
  const [updated] = db
    .update(chatToolCalls)
    .set(patch)
    .where(eq(chatToolCalls.id, toolCallId))
    .returning()
    .all()
  return updated ?? null
}

// Functional repository for the `chat_tool_calls` table. Spec:
// `docs/blueprints/chat/blueprint.md §4.3`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.

import { asc, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  chatToolCalls,
  type ChatToolCall,
  type NewChatToolCall,
} from '../../schema/chat/chat-tool-calls.js'
import { chatMessages } from '../../schema/chat/chat-messages.js'

// Re-export row types + the status unions per the workspaces repo precedent.
export type {
  ChatToolCall,
  NewChatToolCall,
  ToolCallStatus,
  ApprovalStatus,
} from '../../schema/chat/chat-tool-calls.js'

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

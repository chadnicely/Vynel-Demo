// Functional repository for the `chat_messages` table. Spec:
// `docs/blueprints/chat/blueprint.md §4.2`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// No `delete*ChatMessage` — messages are deleted by cascade when their
// session is hard-deleted by the purge job.

import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  chatMessages,
  type ChatMessage,
  type NewChatMessage,
} from '../../schema/chat/chat-messages.js'

// Re-export row types + the AttachedImageMetadata JSON shape per the
// workspaces repo precedent.
export type {
  ChatMessage,
  NewChatMessage,
  ChatMessageRole,
  ChatMessageSourceKind,
  AttachedImageMetadata,
} from '../../schema/chat/chat-messages.js'

export function findChatMessageById(db: Database, messageId: string): ChatMessage | null {
  const [row] = db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1).all()
  return row ?? null
}

export function listChatMessagesForSession(db: Database, sessionId: string): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.startedAt))
    .all()
}

// Every message tagged with one delegation request's `partialSessionId` (brain-tree
// Chapter 2) — the chain across the global + workspace transcripts, in chronological
// order. The trace read (`resolveDelegationTrace`) builds the condensed trace from this.
//
// Order is `startedAt` ASC ONLY — NOT a (createdAt, id) tiebreak. The delegated task and
// the workspace reply are co-committed with one shared `startedAt`; `chat_messages.id` is
// a random UUID, so an id tiebreak would scramble task-before-reply. Insertion (rowid)
// order already yields task→reply within the shared instant; the pushed report's
// `startedAt` is strictly later. Mirrors `listChatMessagesForSession`.
export function listChatMessagesByPartialSessionId(
  db: Database,
  partialSessionId: string,
): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.partialSessionId, partialSessionId))
    .orderBy(asc(chatMessages.startedAt))
    .all()
}

// The latest `limit` messages of a session, returned in chronological (asc) order.
// The DB read is bounded (DESC + LIMIT) — the defensive cap for the global-root
// transcript, which is one ever-growing thread (D16: growth-scaling lists carry a
// Phase-1 cap; keyset cursor defers to 1.5).
export function listRecentChatMessagesForSession(
  db: Database,
  sessionId: string,
  limit: number,
): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.startedAt))
    .limit(limit)
    .all()
    .reverse()
}

export function insertChatMessage(db: Database, newMessage: NewChatMessage): ChatMessage {
  const [inserted] = db.insert(chatMessages).values(newMessage).returning().all()
  if (!inserted) throw new Error('insertChatMessage: no row returned')
  return inserted
}

export function updateChatMessage(
  db: Database,
  messageId: string,
  patch: Partial<Omit<ChatMessage, 'id' | 'sessionId' | 'createdAt'>>,
): ChatMessage | null {
  const [updated] = db
    .update(chatMessages)
    .set(patch)
    .where(eq(chatMessages.id, messageId))
    .returning()
    .all()
  return updated ?? null
}

// SQL-side concat — atomic; safe under concurrent chunk arrivals (coding §1.3).
// Read-modify-write would race itself.
export function appendToChatMessageBody(db: Database, messageId: string, bodyDelta: string): void {
  db.update(chatMessages)
    .set({ body: sql`${chatMessages.body} || ${bodyDelta}` })
    .where(eq(chatMessages.id, messageId))
    .run()
}

// COALESCE handles null thinkingBody (first chunk for a message).
export function appendToChatMessageThinking(
  db: Database,
  messageId: string,
  thinkingDelta: string,
): void {
  db.update(chatMessages)
    .set({ thinkingBody: sql`COALESCE(${chatMessages.thinkingBody}, '') || ${thinkingDelta}` })
    .where(eq(chatMessages.id, messageId))
    .run()
}

// Note: a `stampChatMessageSessionId` helper was briefly added during chat's
// Cluster 6 build to support a "persist user message first; re-stamp
// sessionId on session-started" flow — but the FK on chat_messages.session_id
// (enforced via PRAGMA foreign_keys = ON in client.ts) rejected the pending-
// session-id pattern at insert time. The refactor moved user-message
// insertion into the consume-session-event-stream session-started transaction
// (co-committed with the chat_sessions row); the helper became unnecessary
// and was removed.

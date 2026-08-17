// Functional repository for the `chat_messages` table. Spec:
// `docs/blueprints/chat/blueprint.md §4.2`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// No `delete*ChatMessage` — messages are deleted by cascade when their
// session is hard-deleted by the purge job.

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@vynel/db";
import {
  chatMessages,
  type ChatMessage,
  type NewChatMessage,
} from "../schema/chat-messages.js";

// Re-export row types + the AttachedImageMetadata JSON shape per the
// workspaces repo precedent.
export type {
  ChatMessage,
  NewChatMessage,
  ChatMessageRole,
  ChatMessageSourceKind,
  ChatMessageOriginChannel,
  AttachedImageMetadata,
} from "../schema/chat-messages.js";

export function findChatMessageById(
  db: Database,
  messageId: string,
): ChatMessage | null {
  const [row] = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1)
    .all();
  return row ?? null;
}

export function listChatMessagesForSession(
  db: Database,
  sessionId: string,
): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.startedAt))
    .all();
}

/** The session-status derivation's message-side facts (Move 3, 2026-08-17):
 *  the latest ASSISTANT message's error columns — "the last thing that
 *  happened errored", self-clearing when a later reply succeeds — and the
 *  latest USER message's start (the set-status supersession anchor).
 *
 *  Asked over the WHOLE CHAIN, never one segment: a continuity swap mints a
 *  fresh segment with no messages on it, so a tail-only read reported "the
 *  user has never spoken" and every superseded `completed`/`problem` came back
 *  from the dead (a swap made the row lie exactly where this feature exists to
 *  stop it lying). The same read also keeps an error visible when a MID-TURN
 *  swap left it stamped on the predecessor. Two indexed lookups on
 *  `(session_id, started_at)`. */
export interface SessionStatusMessageFacts {
  lastAssistantError: {
    code: string | null;
    message: string;
    at: Date;
  } | null;
  latestUserMessageAt: Date | null;
}

export function findSessionStatusMessageFacts(
  db: Database,
  sessionIds: readonly string[],
): SessionStatusMessageFacts {
  if (sessionIds.length === 0) {
    return { lastAssistantError: null, latestUserMessageAt: null };
  }
  const ids = [...sessionIds];
  const [latestAssistant] = db
    .select({
      errorCode: chatMessages.errorCode,
      errorMessage: chatMessages.errorMessage,
      startedAt: chatMessages.startedAt,
    })
    .from(chatMessages)
    .where(
      and(inArray(chatMessages.sessionId, ids), eq(chatMessages.role, "assistant")),
    )
    .orderBy(desc(chatMessages.startedAt))
    .limit(1)
    .all();
  const [latestUser] = db
    .select({ startedAt: chatMessages.startedAt })
    .from(chatMessages)
    .where(and(inArray(chatMessages.sessionId, ids), eq(chatMessages.role, "user")))
    .orderBy(desc(chatMessages.startedAt))
    .limit(1)
    .all();
  return {
    lastAssistantError:
      latestAssistant !== undefined && latestAssistant.errorMessage !== null
        ? {
            code: latestAssistant.errorCode,
            message: latestAssistant.errorMessage,
            at: latestAssistant.startedAt,
          }
        : null,
    latestUserMessageAt: latestUser?.startedAt ?? null,
  };
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
    .all();
}

/** The latest assistant row's context occupancy in a session strictly BEFORE
 *  a moment — the baseline for a run's fresh-input delta (occupancy is the
 *  request's WHOLE context, so "what this run added" = its last occupancy
 *  minus this baseline). Null = no prior usage (the run opened the session). */
export function findPriorContextOccupancy(
  db: Database,
  sessionId: string,
  before: Date,
): number | null {
  const [row] = db
    .select({ inputTokens: chatMessages.inputTokens })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.role, "assistant"),
        isNotNull(chatMessages.inputTokens),
        lt(chatMessages.startedAt, before),
      ),
    )
    .orderBy(desc(chatMessages.startedAt))
    .limit(1)
    .all();
  return row?.inputTokens ?? null;
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
    .reverse();
}

// Stamp the turn's OWN user row with a delegation trace key (redesign
// Phase-2b: a mention hand-off grows a thread pointer). The newest unstamped
// user row on the session IS the mention message — the dispatch runs inside
// that turn, which holds its target's single-writer lock, so no concurrent
// writer exists; the isNull guard keeps attributed inbound rows (which carry
// their own keys) untouched, and a re-stamp can never overwrite.
export function stampNewestUserMessageTraceKey(
  db: Database,
  input: { sessionId: string; partialSessionId: string },
): void {
  const [newest] = db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, "user"),
        isNull(chatMessages.partialSessionId),
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(1)
    .all();
  if (newest === undefined) return;
  db.update(chatMessages)
    .set({ partialSessionId: input.partialSessionId })
    .where(eq(chatMessages.id, newest.id))
    .run();
}

export function insertChatMessage(
  db: Database,
  newMessage: NewChatMessage,
): ChatMessage {
  const [inserted] = db
    .insert(chatMessages)
    .values(newMessage)
    .returning()
    .all();
  if (!inserted) throw new Error("insertChatMessage: no row returned");
  return inserted;
}

export function updateChatMessage(
  db: Database,
  messageId: string,
  patch: Partial<Omit<ChatMessage, "id" | "sessionId" | "createdAt">>,
): ChatMessage | null {
  const [updated] = db
    .update(chatMessages)
    .set(patch)
    .where(eq(chatMessages.id, messageId))
    .returning()
    .all();
  return updated ?? null;
}

// SQL-side concat — atomic; safe under concurrent chunk arrivals (coding §1.3).
// Read-modify-write would race itself.
export function appendToChatMessageBody(
  db: Database,
  messageId: string,
  bodyDelta: string,
): void {
  db.update(chatMessages)
    .set({ body: sql`${chatMessages.body} || ${bodyDelta}` })
    .where(eq(chatMessages.id, messageId))
    .run();
}

// COALESCE handles null thinkingBody (first chunk for a message).
export function appendToChatMessageThinking(
  db: Database,
  messageId: string,
  thinkingDelta: string,
): void {
  db.update(chatMessages)
    .set({
      thinkingBody: sql`COALESCE(${chatMessages.thinkingBody}, '') || ${thinkingDelta}`,
    })
    .where(eq(chatMessages.id, messageId))
    .run();
}

// Note: a `stampChatMessageSessionId` helper was briefly added during chat's
// Cluster 6 build to support a "persist user message first; re-stamp
// sessionId on session-started" flow — but the FK on chat_messages.session_id
// (enforced via PRAGMA foreign_keys = ON in client.ts) rejected the pending-
// session-id pattern at insert time. The refactor moved user-message
// insertion into the consume-session-event-stream session-started transaction
// (co-committed with the chat_sessions row); the helper became unnecessary
// and was removed.

// Functional repository for the `chat_sessions` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/chat/blueprint.md §4.1`.
//
// Phase 1 SYNC return values — required by the better-sqlite3 transaction
// contract per `.claude/memory/decisions/phase-1-sync-transactions.md`.
// Phase 2 Postgres flips signatures to async; call sites already use
// `await` which is harmless on sync return values.

import { and, eq, getTableColumns, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  chatSessions,
  type ChatSession,
  type NewChatSession,
} from '../schema/chat-sessions.js'

// Re-export the row types (workspaces repo precedent) so chat's ops import
// them from the repository barrel (`./index.js`), not the schema files.
export type {
  ChatSession,
  NewChatSession,
  ChatSessionVisibility,
  ChatSessionScope,
  ChatSessionSelectedMode,
  ChatSessionSetStatus,
} from '../schema/chat-sessions.js'

/**
 * Row shape returned by listChatSessionsForWorkspace — the chat_sessions
 * row plus a derived `lastMessagePreview` (up to 120 chars of the most
 * recent message body, NULL when the session has no messages yet).
 * Computed via a correlated subquery in the same SELECT — no per-row
 * round-trip. Added 2026-05-28 as a follow-up to macos-ui-redesign so
 * the conversation list can show real preview text.
 */
export type ChatSessionListItem = ChatSession & {
  lastMessagePreview: string | null
}

/** Max preview length — matches the contract comment. Tuned for a
 * single ellipsized line in the ConversationListItem.vue card. */
const PREVIEW_CHARS = 120

// Defensive caps on listChatSessionsForWorkspace per coding-standard.md
// "Structure / patterns" — every list* that scales with tenant data is
// capped at the repo layer too (the Zod schema clamps at the HTTP boundary
// independently). Per D16.
const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 100

export function findChatSessionById(db: Database, sessionId: string): ChatSession | null {
  const [row] = db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1).all()
  return row ?? null
}

// Correlated subquery — for each session, fetch the most recent message body
// truncated to PREVIEW_CHARS. The idx_chat_messages_session_started index
// (session_id, started_at) makes this one indexed lookup per row, not a full
// scan. Bare identifiers are deliberate: Drizzle's `${chatMessages.x}`
// template interpolation generates qualified column refs that don't resolve
// inside a correlated subquery (the inner table ref gets ambiguous with the
// outer alias); raw `chat_messages.x` reads exactly as the SQL would.
// Snake-case column names are stable per Drizzle's default casing (verified
// against `migrations-sqlite/0004_*.sql`). SQLite's `substr(text, 1, n)` is
// dialect-portable to Postgres — identical semantics. Shared by every list op
// that needs the derived preview column (listChatSessionsForWorkspace +
// listRecentChatSessionsForUser) — one definition, no drift.
function lastMessagePreviewSql() {
  return sql<string | null>`(
    SELECT substr(body, 1, ${PREVIEW_CHARS})
    FROM chat_messages
    WHERE chat_messages.session_id = chat_sessions.id
    ORDER BY chat_messages.started_at DESC
    LIMIT 1
  )`
}

export function listChatSessionsForWorkspace(
  db: Database,
  workspaceId: string,
  options: {
    includeArchived?: boolean
    includeDeleted?: boolean
    /** Include `visibility: 'hidden'` sessions (root-as-thread swap segments).
     *  Default false — the curated sidebar shows only `'listed'`. The future
     *  monitor / a direct fetch passes true to see the full recorded trail. */
    includeHidden?: boolean
    limit?: number
  } = {},
): ChatSessionListItem[] {
  const filters = [eq(chatSessions.workspaceId, workspaceId)]
  if (!options.includeArchived) filters.push(eq(chatSessions.isArchived, false))
  if (!options.includeDeleted) filters.push(isNull(chatSessions.deletedAt))
  // Sidebar curation (Slice 2): hide swap segments + the root's own segments so
  // the continuing brain shows as ONE entry. Pre-existing rows backfilled to
  // 'listed' (migration 0027), so this is byte-for-byte unchanged for non-swap data.
  if (!options.includeHidden) filters.push(eq(chatSessions.visibility, 'listed'))

  const cap = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const whereClause = filters.length === 1 ? filters[0] : and(...filters)

  return db
    .select({
      ...getTableColumns(chatSessions),
      lastMessagePreview: lastMessagePreviewSql(),
    })
    .from(chatSessions)
    .where(whereClause)
    .orderBy(sql`${chatSessions.lastMessageAt} desc`)
    .limit(cap)
    .all()
}

/**
 * Newest-first across EVERY scope (global root + every workspace) for one
 * user — the dashboard's recent-activity feed (added for the dashboard
 * aggregate; no prior op spans scopes). Same default filtering as
 * listChatSessionsForWorkspace (excludes archived, soft-deleted, and hidden
 * swap segments) but scoped by userId instead of workspaceId.
 */
export function listRecentChatSessionsForUser(
  db: Database,
  input: { userId: string; limit: number },
): ChatSessionListItem[] {
  return db
    .select({
      ...getTableColumns(chatSessions),
      lastMessagePreview: lastMessagePreviewSql(),
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, input.userId),
        eq(chatSessions.isArchived, false),
        isNull(chatSessions.deletedAt),
        eq(chatSessions.visibility, 'listed'),
      ),
    )
    .orderBy(sql`${chatSessions.lastMessageAt} desc`)
    .limit(input.limit)
    .all()
}

// Every session the sessions-overview reads: BOTH visibilities (hidden swap
// segments become chain MEMBERS there, never standalone entries), archived +
// soft-deleted excluded. Larger cap than the sidebar lists — chains consume
// rows here but collapse into single entries in the overview.
const OVERVIEW_LIST_LIMIT = 500

export function listAllChatSessionsForUser(
  db: Database,
  input: { userId: string; limit?: number },
): ChatSession[] {
  const cap = Math.min(input.limit ?? OVERVIEW_LIST_LIMIT, OVERVIEW_LIST_LIMIT)
  return db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, input.userId),
        eq(chatSessions.isArchived, false),
        isNull(chatSessions.deletedAt),
      ),
    )
    .orderBy(sql`${chatSessions.lastMessageAt} desc`)
    .limit(cap)
    .all()
}

export function insertChatSession(db: Database, newSession: NewChatSession): ChatSession {
  const [inserted] = db.insert(chatSessions).values(newSession).returning().all()
  if (!inserted) throw new Error('insertChatSession: no row returned')
  return inserted
}

export function updateChatSession(
  db: Database,
  sessionId: string,
  patch: Partial<Omit<ChatSession, 'id' | 'userId' | 'workspaceId' | 'providerId' | 'startedAt'>>,
): ChatSession | null {
  const [updated] = db
    .update(chatSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning()
    .all()
  return updated ?? null
}

export function incrementChatSessionCounters(
  db: Database,
  sessionId: string,
  delta: { messageCountDelta: number; inputTokensDelta: number; outputTokensDelta: number },
): void {
  db.update(chatSessions)
    .set({
      totalMessageCount: sql`${chatSessions.totalMessageCount} + ${delta.messageCountDelta}`,
      totalInputTokens: sql`${chatSessions.totalInputTokens} + ${delta.inputTokensDelta}`,
      totalOutputTokens: sql`${chatSessions.totalOutputTokens} + ${delta.outputTokensDelta}`,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

// Idempotent: WHERE deletedAt IS NULL guard — second call returns null cleanly.
export function softDeleteChatSession(db: Database, sessionId: string): ChatSession | null {
  const [updated] = db
    .update(chatSessions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.deletedAt)))
    .returning()
    .all()
  return updated ?? null
}

// Exclusive cutoff per D14 (`deletedAt < cutoff`).
export function listChatSessionsDeletedBefore(db: Database, cutoff: Date): ChatSession[] {
  return db.select().from(chatSessions).where(lt(chatSessions.deletedAt, cutoff)).all()
}

export function hardDeleteChatSession(db: Database, sessionId: string): boolean {
  const result = db.delete(chatSessions).where(eq(chatSessions.id, sessionId)).run()
  return (result.changes ?? 0) > 0
}

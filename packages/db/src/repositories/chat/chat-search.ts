// Dialect-agnostic FTS5 search repository for chat messages. Spec:
// `docs/blueprints/chat/blueprint.md §4.4` + D17 (external-content FTS5).
//
// Phase 1: SQLite branch — external-content FTS5 + minimal triggers (rowid-
// only). Joins chat_messages_fts → chat_messages → chat_sessions for
// workspace scoping + soft-delete filtering.
//
// Phase 2: Postgres branch — tsvector + ts_rank. Signature flips to async
// when the Postgres migration baseline ships.

import { sql } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { activeDialect } from '../../dialect.js'

export type ChatMessageSearchResult = {
  messageId: string
  sessionId: string
  /** Body with `<mark>` highlight markers (FTS5 `snippet()` output). */
  snippet: string
  /** FTS5 rank (lower = better) or Postgres ts_rank. */
  rank: number
}

export type SearchChatMessagesInput = {
  workspaceId: string
  query: string
  limit?: number
}

const DEFAULT_LIMIT = 50
// Belt-and-braces cap matching listChatSessionsForWorkspace's MAX_LIMIT
// pattern. The HTTP Zod schema also caps at 100; the repo-level clamp
// guards every non-HTTP caller (future MCP / CLI / internal tests). Per
// Gate 3 finding S1 (2026-05-23).
const MAX_LIMIT = 100

export function searchChatMessages(
  db: Database,
  input: SearchChatMessagesInput,
): ChatMessageSearchResult[] {
  if (activeDialect === 'postgres') return searchChatMessagesPostgres(db, input)
  return searchChatMessagesSqlite(db, input)
}

function searchChatMessagesSqlite(
  db: Database,
  input: SearchChatMessagesInput,
): ChatMessageSearchResult[] {
  // External-content FTS5: search returns rowid + rank; JOIN back to
  // chat_messages for the body snippet. JOIN against chat_sessions filters
  // by workspaceId AND excludes soft-deleted sessions.
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return db.all<ChatMessageSearchResult>(sql`
    SELECT
      m.id AS messageId,
      m.session_id AS sessionId,
      snippet(chat_messages_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet,
      chat_messages_fts.rank AS rank
    FROM chat_messages_fts
      JOIN chat_messages m ON m.rowid = chat_messages_fts.rowid
      JOIN chat_sessions s ON s.id = m.session_id
    WHERE chat_messages_fts MATCH ${input.query}
      AND s.workspace_id = ${input.workspaceId}
      AND s.deleted_at IS NULL
    ORDER BY chat_messages_fts.rank
    LIMIT ${limit}
  `)
}

function searchChatMessagesPostgres(
  _db: Database,
  _input: SearchChatMessagesInput,
): ChatMessageSearchResult[] {
  // Phase 2 — implemented when the Postgres migration baseline ships.
  // Uses ts_rank against a tsvector + GIN index column on chat_messages.
  throw new Error('Postgres chat search not implemented yet — Phase 2 only')
}

// Dialect-agnostic FTS5 search repository for chat messages. Spec:
// `docs/blueprints/chat/blueprint.md §4.4` + D17 (external-content FTS5).
//
// Phase 1: SQLite branch — external-content FTS5 + minimal triggers (rowid-
// only). Joins chat_messages_fts → chat_messages → chat_sessions for
// user scoping + soft-delete filtering, with an optional workspace filter.
//
// The global root's own thread (`scope = 'global'`) is excluded by DEFAULT:
// this search feeds the cross-session MCP tool every workspace/session/agent
// turn carries, and the brain's private conversation must never surface through
// it to ANOTHER identity (Chad, 2026-08-10). The one exception is the brain
// reading ITSELF — the continuity carry points a fresh segment at its own
// earlier chain (session-continuity requirement 3), so the caller that IS the
// global root passes `includeGlobalScope` (the route resolves the caller from
// the server-stamped turn-session header, never from model input).
// Workspace-filtered calls never matched those rows anyway (their
// workspace_id is NULL), so the UI search is byte-for-byte.
//
// Phase 2: Postgres branch — tsvector + ts_rank. Signature flips to async
// when the Postgres migration baseline ships.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { activeDialect } from '@vynel/db/dialect'

export type ChatMessageSearchResult = {
  messageId: string
  sessionId: string
  /** Body with `<mark>` highlight markers (FTS5 `snippet()` output). */
  snippet: string
  /** FTS5 rank (lower = better) or Postgres ts_rank. */
  rank: number
}

export type SearchChatMessagesInput = {
  userId: string
  /** Restrict to one workspace's sessions; omitted = every session the user owns. */
  workspaceId?: string
  query: string
  limit?: number
  /** Include the global assistant's own thread — ONLY for the global root
   *  reading itself (the identity-aware exception to the scope wall). */
  includeGlobalScope?: boolean
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
  // by userId (+ optional workspace), excludes soft-deleted sessions and the
  // global root's own thread (see the file header).
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const workspaceFilter =
    input.workspaceId !== undefined ? sql`AND s.workspace_id = ${input.workspaceId}` : sql``
  // The scope wall (file header) — lifted only for the brain reading itself.
  // 'voice' walls with 'global' (voice-session arc): the spoken thread is the
  // brain's private conversation in another area, not searchable content.
  const scopeFilter =
    input.includeGlobalScope === true ? sql`` : sql`AND s.scope NOT IN ('global', 'voice')`
  try {
    return runSqliteSearch(db, input, sql`${scopeFilter} ${workspaceFilter}`, limit)
  } catch (error) {
    // FTS5 parses the query STRING itself (`"unbalanced`, `NEAR(`, `foo:bar`
    // where foo is read as a column) — malformed input is a no-match, not a
    // server error. Anything else (a real schema/SQL bug) still throws.
    if (isFts5QueryInputError(error)) return []
    throw error
  }
}

// The FTS5 query-parser failure modes for user-typed input. `no such column`
// is included because `term:rest` makes FTS5 read `term` as a column filter —
// our own column refs are fixed and test-covered, so a runtime hit here can
// only come from the query string.
function isFts5QueryInputError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /fts5: syntax error|unterminated string|unknown special query|no such column|malformed MATCH/.test(
      error.message,
    )
  )
}

function runSqliteSearch(
  db: Database,
  input: SearchChatMessagesInput,
  filters: SQL,
  limit: number,
): ChatMessageSearchResult[] {
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
      AND s.user_id = ${input.userId}
      AND s.deleted_at IS NULL
      ${filters}
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

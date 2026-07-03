// Core op — full-text search over a workspace's chat messages. Returns
// message-level hits (per D6) — UI groups by sessionId in
// SearchResults.vue.
//
// Defense-in-depth on the minimum query length: the Zod schema enforces
// min(2) at the HTTP boundary; this guard catches non-HTTP callers (CLI,
// MCP, internal tests). Per coding.md §1.x + D17.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import { searchChatMessages, type ChatMessageSearchResult } from '../repositories/index.js'
import type { Database } from '@vynel/db'

const MIN_QUERY_LENGTH = 2
// Match listChatSessionsForWorkspace's belt-and-braces shape (Zod caps at
// 100 too; the core-layer clamp guards non-HTTP callers). Per Gate 3
// finding S1 (2026-05-23).
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export type SearchChatSessionsInput = {
  workspaceId: string
  query: string
  limit?: number
}

export function searchChatSessions(
  db: Database,
  input: SearchChatSessionsInput,
): ChatMessageSearchResult[] {
  const trimmed = input.query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return searchChatMessages(db, {
    workspaceId: input.workspaceId,
    query: trimmed,
    limit,
  })
}

export type { ChatMessageSearchResult }

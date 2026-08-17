// Core op — full-text search over the user's chat messages, optionally
// narrowed to one workspace. Returns message-level hits (per D6) — UI groups
// by sessionId in SearchResults.vue. The global root's own thread is excluded
// at the repo layer (the cross-session MCP wall — see chat-search.ts) unless
// the caller IS the global root reading itself (`includeGlobalThread`).
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
  userId: string
  /** Restrict to one workspace's sessions; omitted = every session the user owns. */
  workspaceId?: string
  query: string
  limit?: number
  /** The identity-aware exception to the scope wall — the global root reading
   *  its own chain (the route resolves the caller; never model input). */
  includeGlobalThread?: boolean
}

export function searchChatSessions(
  db: Database,
  input: SearchChatSessionsInput,
): ChatMessageSearchResult[] {
  const trimmed = input.query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return searchChatMessages(db, {
    userId: input.userId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    query: trimmed,
    limit,
    ...(input.includeGlobalThread === true ? { includeGlobalScope: true } : {}),
  })
}

export type { ChatMessageSearchResult }

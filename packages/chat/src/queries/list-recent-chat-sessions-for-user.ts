// Core op — list a user's most-recently-active chat sessions across EVERY
// scope (the global root + every workspace) in one feed. Added for the
// dashboard's recent-activity read: no prior op spans scopes (existing reads
// are workspace-scoped only), so there is no source equivalent to port.
// Mirrors listChatSessionsForWorkspace's shape (defensive cap at the core
// layer too — the HTTP boundary clamps independently; D16 precedent).

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { ChatSessionListItem } from '../repositories/index.js'

export type ListRecentChatSessionsForUserInput = {
  userId: string
  limit?: number
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export function listRecentChatSessionsForUser(
  db: Database,
  input: ListRecentChatSessionsForUserInput,
): ChatSessionListItem[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return chatRepository.listRecentChatSessionsForUser(db, { userId: input.userId, limit })
}

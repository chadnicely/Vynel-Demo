// Core op — list a workspace's chat sessions (owner-scoped at the route
// layer via sessionScoped triple-check; this op trusts its caller).
//
// Defensive cap at the core layer too (clamps to MAX_LIMIT=100 per D16) —
// the Zod schema clamps at the HTTP boundary independently. Belt + braces.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { ChatSessionListItem } from '../repositories/index.js'

export type ListChatSessionsForWorkspaceInput = {
  workspaceId: string
  includeArchived?: boolean
  limit?: number
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export function listChatSessionsForWorkspace(
  db: Database,
  input: ListChatSessionsForWorkspaceInput,
): ChatSessionListItem[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const options: { includeArchived?: boolean; limit: number } = { limit }
  if (input.includeArchived !== undefined) options.includeArchived = input.includeArchived
  return chatRepository.listChatSessionsForWorkspace(db, input.workspaceId, options)
}

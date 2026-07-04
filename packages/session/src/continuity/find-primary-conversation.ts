// `findPrimaryConversation` — read-only resolve of a continuing primary conversation
// (Slice 2). Unlike `getOrCreatePrimarySession`, this NEVER creates a row: it answers
// "is there a continuing conversation yet, and what SDK session is it currently
// on?" for the client landing on the continue view. The primary is created lazily by
// the FIRST continue-mode turn (the turn flow's `resolvePrimaryConversationTarget` /
// `resolveGlobalPrimaryConversationTarget` get-or-creates), so a plain landing GET
// stays side-effect-free.
//
// Two scopes (agent-base Slice 3b): omit `workspaceId` (or pass null) for the
// GLOBAL primary; a workspace id resolves that workspace's primary.
//
// Workspace ownership is the caller's responsibility (verified upstream at the
// route via `workspaceScoped`), matching the `getOrCreatePrimarySession` precedent.

import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'

export type FindPrimaryConversationInput = {
  userId: string
  /** Omit or null = the GLOBAL primary; a workspace id = that workspace's primary. */
  workspaceId?: string | null
}

export function findPrimaryConversation(
  db: Database,
  input: FindPrimaryConversationInput,
): PrimarySessionRow | null {
  const workspaceId = input.workspaceId ?? null
  return workspaceId === null
    ? primarySessionsRepository.findGlobalPrimarySessionForUser(db, input.userId)
    : primarySessionsRepository.findPrimarySessionForWorkspace(db, { userId: input.userId, workspaceId })
}

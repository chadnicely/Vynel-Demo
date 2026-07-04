// `getOrCreatePrimarySession` — the primary wrapper over the generic
// `getOrCreateContinuingSession` (voice-jarvis piece 1). Primaries are the manager
// identities; scope is derived from `workspaceId` (null = the single GLOBAL primary,
// a workspace id = that workspace's primary). Creation, idempotency, and the
// partial-unique race retry live in the generic op; this wrapper only maps the
// two primary scopes — so the existing route callers (resolve-primary-conversation /
// resolve-global-primary-conversation) stay byte-for-byte unchanged. Spec:
// `docs/agent-base/session-continuity.md` "Core operations".

import type { Database } from '@vynel/db'
import type { PrimarySessionRow } from '../repositories/index.js'
import { getOrCreateContinuingSession } from './get-or-create-continuing-session.js'

export type GetOrCreatePrimarySessionInput = {
  userId: string
  /** Omit or null = the GLOBAL primary; a workspace id = that workspace's primary. */
  workspaceId?: string | null
}

export async function getOrCreatePrimarySession(
  db: Database,
  input: GetOrCreatePrimarySessionInput,
): Promise<PrimarySessionRow> {
  const workspaceId = input.workspaceId ?? null
  return getOrCreateContinuingSession(db, {
    userId: input.userId,
    scope: workspaceId === null ? 'global' : 'workspace',
    workspaceId,
  })
}

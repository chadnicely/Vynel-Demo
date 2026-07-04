// `getOrCreateContinuingSession` — the GENERIC continuing-session identity getter
// (voice-jarvis piece 1). Returns the stable identity for a (user, scope) — creating
// it on first use — so ANY caller (a primary, the voice session, later an agent) can make
// its session continuous by resolving an identity here and running the seed-fresh swap
// over it. The continuity MECHANISM (detect-pressure + bridge) is already scope-agnostic;
// this op generalizes the IDENTITY half. `getOrCreatePrimarySession` is the thin primary wrapper.
//
// Scope → identity key (the liveness model — one partial-unique index per singleton scope):
//   - 'workspace' : one live per (user, workspace) — `workspaceId` REQUIRED
//   - 'global'    : one live per user — no workspace
//   - 'voice'     : one live per user — no workspace
// (Agents — many-per-user, keyed by a future `scopeRef` — are a later kind, not handled here.)
//
// Idempotent + race-safe: a concurrent create that wins the partial-unique race throws
// on insert; we re-read the winner's row. Workspace OWNERSHIP is the caller's
// responsibility (verified upstream at the route — the agents/skills precedent).

import { randomUUID } from 'node:crypto'
import { ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow, PrimarySessionScope } from '../repositories/index.js'

export type GetOrCreateContinuingSessionInput = {
  userId: string
  scope: PrimarySessionScope
  /** REQUIRED for scope 'workspace'; must be null/omitted for 'global' and 'voice'. */
  workspaceId?: string | null
}

type FindLiveSession = () => PrimarySessionRow | null

// Shared get-or-insert with the partial-unique race retry (the same shape the primary +
// global paths used): find the live row; else insert; if a concurrent create won the
// unique race, re-read the winner's row.
function getOrInsertContinuingSession(
  db: Database,
  row: { userId: string; scope: PrimarySessionScope; workspaceId: string | null },
  findLive: FindLiveSession,
): PrimarySessionRow {
  const existing = findLive()
  if (existing) return existing

  const now = new Date()
  try {
    return primarySessionsRepository.insertPrimarySession(db, {
      id: randomUUID(),
      userId: row.userId,
      workspaceId: row.workspaceId,
      scope: row.scope,
      currentSdkSessionId: null,
      supersededFromSdkSessionId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  } catch (error) {
    const raced = findLive()
    if (raced) return raced
    throw error
  }
}

export async function getOrCreateContinuingSession(
  db: Database,
  input: GetOrCreateContinuingSessionInput,
): Promise<PrimarySessionRow> {
  const { userId, scope } = input
  const workspaceId = input.workspaceId ?? null

  if (scope === 'workspace') {
    if (workspaceId === null) {
      throw new ValidationError("A 'workspace' continuing session requires a workspaceId.")
    }
    return getOrInsertContinuingSession(db, { userId, scope, workspaceId }, () =>
      primarySessionsRepository.findPrimarySessionForWorkspace(db, { userId, workspaceId }),
    )
  }

  // 'global' + 'voice' are per-user singletons with no workspace.
  if (workspaceId !== null) {
    throw new ValidationError(`A '${scope}' continuing session must not carry a workspaceId.`)
  }
  const findLive: FindLiveSession =
    scope === 'global'
      ? () => primarySessionsRepository.findGlobalPrimarySessionForUser(db, userId)
      : () => primarySessionsRepository.findVoicePrimarySessionForUser(db, userId)
  return getOrInsertContinuingSession(db, { userId, scope, workspaceId: null }, findLive)
}

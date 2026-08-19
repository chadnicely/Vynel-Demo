// `createSpawnedSession` — the session-library `create_session` core (Slice ④).
// The root creates a NORMAL session as a tool: memory, instructions, its own
// continuity — not a throwaway agent. Three existing rails, reused:
//
//   1. `runSeededSwapSession` mints a PRIMED SDK session — the purpose text is
//      the seed (the priming turn absorbs it and waits; the swap machinery's
//      one-turn drain guarantees it is flushed to the runtime's own storage,
//      so the first delegated task resumes with the purpose as carried context).
//   2. `insertPrimarySession` + `linkPrimarySessionToSdkSession` give it a
//      continuing identity (scope 'spawned' — MANY per user, no liveness
//      index; the 0.85 pressure-swap applies unchanged, like any primary).
//   3. `recordSpawnedSessionSegment` (chat) records the LISTED, NAMED first
//      segment — the session lists, meters, and chains from birth; the FIRST
//      segment's title IS the session's name.
//
// Grounding (locked fork 1, extended by Slice ④b): a spawned session inherits
// its creator's scope. A GLOBAL-root creation passes no `workspaceId` and the
// global root's hidden user-data cwd as `workspacePath` (the same
// memory/settings ground as the brain); a WORKSPACE creation passes its
// workspace id + that workspace's path (its memory/skills/CLAUDE.md ground).
// The caller (the route) resolves both together.

import type { Database } from '@vynel/db'
import type { AiAgentProvider } from '@vynel/providers'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { recordSpawnedSessionSegment } from '@vynel/chat'
import type { ChatSessionSettingsPatch } from '@vynel/chat'
import type { Logger } from 'pino'
import { runSeededSwapSession } from '../runtime/run-seeded-swap-session.js'
import { linkPrimarySessionToSdkSession } from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'

export type CreateSpawnedSessionInput = {
  userId: string
  /** The session's display name — becomes the first segment's title (the identity). */
  name: string
  /** What this session is for — seeded into the priming turn as carried context. */
  purpose: string
  /** The session's SDK cwd — the creator's ground: the global root's hidden
   *  user-data dir, or the creating workspace's path (the caller resolves it). */
  workspacePath: string
  /** The creating workspace (Slice ④b) — absent = global-grounded (v1 behavior). */
  workspaceId?: string
  /** The CREATOR's resolved composer settings (session-hardening D4) — the
   *  child is born running what its parent runs, instead of a NULL row that
   *  silently resolves the bare default on its first turn. The route reads
   *  them off the ambient turn's session; a create with no creating turn
   *  (a CLI, the voice call leg) omits them and the row stays "never set". */
  settings?: ChatSessionSettingsPatch
  logger?: Logger
}

export type CreateSpawnedSessionResult = {
  /** The spawned session's stable continuing identity. */
  primarySessionId: string
  /** The SDK session id the priming turn minted — the first segment's id. */
  sessionId: string
  name: string
}

export async function createSpawnedSession(
  db: Database,
  provider: AiAgentProvider,
  input: CreateSpawnedSessionInput,
): Promise<CreateSpawnedSessionResult> {
  // 1. Mint the primed SDK session (async, no DB writes yet — a priming
  //    failure leaves nothing behind).
  const sessionId = await runSeededSwapSession(provider, {
    workspacePath: input.workspacePath,
    carry: input.purpose,
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 2. The continuing identity: insert the primary, then link it to the minted
  //    session via the continuity op (same first-link path every primary uses).
  const now = new Date()
  const primary = primarySessionsRepository.insertPrimarySession(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    scope: 'spawned',
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: primary.id,
    userId: input.userId,
    sdkSessionId: sessionId,
  })

  // 3. The listed, named first segment — the session exists in the panel from
  //    birth, carrying the creator's settings (D4).
  recordSpawnedSessionSegment(db, {
    sessionId,
    userId: input.userId,
    providerId: DEFAULT_PROVIDER_ID,
    name: input.name,
    workspaceId: input.workspaceId ?? null,
    ...(input.settings !== undefined ? { settings: input.settings } : {}),
  })

  return { primarySessionId: primary.id, sessionId, name: input.name }
}

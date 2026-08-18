// `resolveGlobalRootConversationTarget` — the no-workspace sibling of
// `resolvePrimaryConversationTarget` (session runtime). When a turn runs on the
// GLOBAL root (the brain ABOVE all workspaces, agent-base Slice 3b), resolve the
// stable global primary (creating it on first use), the SDK session the turn should
// resume, and the hidden user-data directory the global root runs in (its SDK cwd —
// it has no workspace folder).
//
// Phase 1 is single-user with one global primary per user, so (userId) uniquely
// identifies it (`getOrCreatePrimarySession` with no workspaceId → the single GLOBAL
// primary; the partial-unique index pins one live one per user) — no id crosses the
// wire. When the SDK session swaps underneath, the next call resolves the new
// `currentSdkSessionId` here, invisibly — exactly like the workspace-primary path.
//
// The `root → primary` rename (Slice 1) landed the continuity table as
// `primary_sessions`; the returned shape uses `primarySessionId`, matching the
// runtime core's `GlobalRootTarget`.

import type { Database } from '@vynel/db'
import { getOrCreatePrimarySession, getOrCreateContinuingSession } from '@vynel/session/continuity'
import { resolveGlobalRootWorkspacePath } from './global-root-workspace.js'

export type GlobalRootConversationTarget = {
  primarySessionId: string
  /**
   * The SDK session the global root currently runs on — resume this. `null` on
   * the first-ever global-root turn (start a fresh session, then link it).
   */
  resumeSdkSessionId: string | null
  /** The global root's SDK cwd — the hidden user-data dir (NOT a workspace). */
  workspacePath: string
}

export async function resolveGlobalRootConversationTarget(
  db: Database,
  input: { userId: string },
): Promise<GlobalRootConversationTarget> {
  // `workspaceId` omitted → the global primary (scope 'global', workspaceId null).
  const primary = await getOrCreatePrimarySession(db, { userId: input.userId })
  return {
    primarySessionId: primary.id,
    resumeSdkSessionId: primary.currentSdkSessionId,
    workspacePath: resolveGlobalRootWorkspacePath(),
  }
}

/** The VOICE sibling (voice-session arc, 2026-08-19): the spoken twin thread —
 *  its own continuing session above all workspaces (`scope 'voice'`, one live
 *  per user), grounded in the SAME hidden user-data cwd as the global root so
 *  memory/settings ground is shared while the conversation is not. Same shape
 *  as the global resolver so `runGlobalRootTurnCore` consumes either. */
export async function resolveVoiceConversationTarget(
  db: Database,
  input: { userId: string },
): Promise<GlobalRootConversationTarget> {
  const voiceSession = await getOrCreateContinuingSession(db, {
    userId: input.userId,
    scope: 'voice',
  })
  return {
    primarySessionId: voiceSession.id,
    resumeSdkSessionId: voiceSession.currentSdkSessionId,
    workspacePath: resolveGlobalRootWorkspacePath(),
  }
}

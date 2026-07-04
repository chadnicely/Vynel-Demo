// `resolvePrimaryConversationTarget` — the PRE-turn half of primary-as-thread. When a
// turn runs on a workspace's continuing "primary" conversation (build brief Slice 1
// §2.3), resolve the stable primary (creating it on first use) and return the SDK
// session the turn should resume. The active conversation FOLLOWS the primary, so
// the client never names a session id for the primary path — it asks for "this
// workspace's continuing conversation" and the primary resolves the rest. When the
// SDK session swaps underneath (the post-turn bridge), the next call resolves
// the new `currentSdkSessionId` here — invisibly.
//
// Phase 1 is single-user with one primary per workspace, so (userId, workspaceId)
// uniquely identifies the primary — no separate primary id needs to cross the wire.

import type { Database } from '@vynel/db'
import { getOrCreatePrimarySession } from '../continuity/index.js'

export type PrimaryConversationTarget = {
  primarySessionId: string
  /**
   * The SDK session the primary currently runs on — resume this. `null` on the
   * first-ever primary turn (start a fresh session, then link it via
   * `applyPrimaryTurnContinuity`).
   */
  resumeSdkSessionId: string | null
}

export async function resolvePrimaryConversationTarget(
  db: Database,
  input: { userId: string; workspaceId: string },
): Promise<PrimaryConversationTarget> {
  const primary = await getOrCreatePrimarySession(db, input)
  return { primarySessionId: primary.id, resumeSdkSessionId: primary.currentSdkSessionId }
}

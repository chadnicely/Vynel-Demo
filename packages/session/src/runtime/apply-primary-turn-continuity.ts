// `applyPrimaryTurnContinuity` — the POST-turn half of primary-as-thread, run at the
// turn boundary (after a primary turn's stream finishes, before the next turn).
// Two steps, both invisible to the user:
//
//   1. LINK — ensure the primary points at the SDK session this turn actually ran
//      on. On the first primary turn the primary was created with no current session;
//      the turn minted a fresh one; this links it so later turns resume it (and
//      the swap has a `from` session). A no-op when already linked (resumed turn).
//   2. BRIDGE — measure the finished turn's context occupancy and, only if it
//      crossed the pressure threshold, seed-fresh swap BEFORE the next turn (the
//      next turn runs on the fresh session). Delegates to
//      `bridgePrimarySessionAfterTurn` (which owns the provider deps + segment row).
//
// Best-effort by contract: the user's turn already streamed and persisted. A
// failure here (link or bridge) is logged and swallowed by the caller — the next
// turn simply re-resolves the primary and re-evaluates pressure. This is the same
// path the live swap smoke drives (build brief Slice 1 §6), so the smoke and the
// HTTP route share one continuity implementation.

import type { Database } from '@vynel/db'
import {
  linkPrimarySessionToSdkSession,
  type BridgePrimarySessionResult,
} from '../continuity/index.js'
import { updateChatSession } from '@vynel/chat/repositories'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import type { AiAgentProviderId } from '@vynel/providers'
import {
  bridgePrimarySessionAfterTurn,
  type BridgePrimarySessionAfterTurnDeps,
} from './bridge-primary-session-after-turn.js'

export type ApplyPrimaryTurnContinuityInput = {
  primarySessionId: string
  /** What the primary pointed at BEFORE this turn — null on the first primary turn. */
  priorSdkSessionId: string | null
  /** The SDK session this turn actually ran on (resumed id, or the fresh id). */
  effectiveSdkSessionId: string
  userId: string
  workspaceId: string
  workspacePath: string
  providerId: AiAgentProviderId
  /** The finished turn's context occupancy (input + cache read + cache creation). */
  occupancyTokens: number
  /** The model the turn ran with — sets the pressure denominator (window size). */
  model: string | null
  /** Pressure threshold override (default 0.85). The live smoke lowers it. */
  threshold?: number
}

export async function applyPrimaryTurnContinuity(
  db: Database,
  input: ApplyPrimaryTurnContinuityInput,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  // 1. Link the primary to the session this turn ran on (first turn / reconcile).
  if (input.priorSdkSessionId !== input.effectiveSdkSessionId) {
    linkPrimarySessionToSdkSession(db, {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      sdkSessionId: input.effectiveSdkSessionId,
    })
    // First primary turn: the session was created via the normal new-session flow
    // (visibility 'listed'). Hide it from the curated sidebar so the continuing
    // brain shows as ONE pinned entry, not a duplicate "New session" row (Slice 2).
    // Swap segments are stamped 'hidden' at creation (recordSwapSegmentSession);
    // this covers the FIRST segment, which the normal flow created.
    if (input.priorSdkSessionId === null) {
      updateChatSession(db, input.effectiveSdkSessionId, { visibility: 'hidden' })
    }
  }

  // 2. Evaluate pressure + swap if over threshold.
  return bridgePrimarySessionAfterTurn(
    db,
    {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      providerId: input.providerId,
      measurement: {
        usedTokens: input.occupancyTokens,
        contextWindow: resolveContextWindow(input.model),
      },
      // The summary distill runs on the turn's model — its window provably
      // covers the session it just ran (the carry-fidelity rule).
      model: input.model,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    },
    deps,
  )
}

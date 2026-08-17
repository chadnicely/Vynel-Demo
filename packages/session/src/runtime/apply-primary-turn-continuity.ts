// `applyPrimaryTurnContinuity` — THE post-turn continuity step, one op for every
// continuing identity (workspace primary, global root, spawned session, agent
// colleague — any `primary_sessions` row). Every runner calls it once the
// turn's stream has drained, still inside that runner's serialization lock, so
// a swap is ordered ahead of the identity's next turn. Two steps, both
// invisible to the user:
//
//   1. LINK — ensure the primary points at the SDK session this turn actually
//      ran on. On an identity's first turn the primary was created with no
//      current session; the turn minted a fresh one; this links it so later
//      turns resume it (and the swap has a `from` session). A no-op when
//      already linked (resumed turn, or a runner that linked in-stream).
//   2. BRIDGE — read the finished turn's context occupancy and, only if it
//      crossed the pressure threshold, seed-fresh swap BEFORE the next turn.
//      Delegates to `bridgePrimarySessionAfterTurn` (provider deps + segment row).
//
// The identity DRIVES the step (no caller-supplied ground): the primary row
// supplies its own `workspaceId` (null = workspace-less) and its scope decides
// the first-segment presentation. A caller passing the wrong ground was a real
// bug class (a workspace-grounded spawned session filed as the brain's) — the
// op reads the truth instead of trusting an argument.
//
// Occupancy + model come from the ONE home that measures them — the shared
// consumer's `handle-usage-reported` writes the effective segment's
// `lastContextTokens` (the LAST usage report of a turn IS the current
// occupancy) and `model` (what actually ran) — so no runner re-derives the
// number from its own event loop.
//
// Best-effort by contract: the user's turn already streamed and persisted. A
// failure here (link or bridge) is logged and swallowed by the caller — the
// next turn simply re-resolves the primary and re-evaluates pressure.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import {
  linkPrimarySessionToSdkSession,
  type BridgePrimarySessionResult,
} from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionScope } from '../repositories/index.js'
import { findChatSessionById, updateChatSession } from '@vynel/chat/repositories'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import type { AiAgentProviderId } from '@vynel/providers'
import {
  bridgePrimarySessionAfterTurn,
  type BridgePrimarySessionAfterTurnDeps,
} from './bridge-primary-session-after-turn.js'

export type ApplyPrimaryTurnContinuityInput = {
  primarySessionId: string
  /** What the primary pointed at BEFORE this turn — null on the identity's first turn. */
  priorSdkSessionId: string | null
  /** The SDK session this turn actually ran on (resumed id, or the fresh id). */
  effectiveSdkSessionId: string
  userId: string
  /** The SDK cwd the turn ran in — the seeded fresh session runs there too. */
  workspacePath: string
  providerId: AiAgentProviderId
  /** Pressure threshold override (default 0.85). The live smoke lowers it. */
  threshold?: number
}

// A MANAGER primary's first segment (workspace brain, global root, the voice
// twin) is the continuing thread itself — created by the normal new-session
// flow as a listed "New session", it must hide so the thread shows as ONE
// pinned entry. A spawned session's or colleague's first segment is the
// opposite: it IS the listed identity row (its name in the sessions panel) and
// must stay visible.
function hidesFirstSegment(scope: PrimarySessionScope): boolean {
  return scope !== 'spawned' && scope !== 'agent'
}

export async function applyPrimaryTurnContinuity(
  db: Database,
  input: ApplyPrimaryTurnContinuityInput,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  // 1. Link the primary to the session this turn ran on (first turn / reconcile).
  if (input.priorSdkSessionId !== input.effectiveSdkSessionId) {
    linkPrimarySessionToSdkSession(db, {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      sdkSessionId: input.effectiveSdkSessionId,
    })
    if (input.priorSdkSessionId === null && hidesFirstSegment(primary.scope)) {
      updateChatSession(db, input.effectiveSdkSessionId, { visibility: 'hidden' })
    }
  }

  // 2. Evaluate pressure from the effective segment's persisted occupancy +
  //    swap if over threshold. No row / no usage yet → nothing measured →
  //    nothing to bridge (a fresh identity's very first turn, or a turn that
  //    failed before its first assistant message).
  const segment = findChatSessionById(db, input.effectiveSdkSessionId)
  const usedTokens = segment?.lastContextTokens ?? 0
  const model = segment?.model ?? null
  return bridgePrimarySessionAfterTurn(
    db,
    {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      workspaceId: primary.workspaceId,
      workspacePath: input.workspacePath,
      providerId: input.providerId,
      measurement: { usedTokens, contextWindow: resolveContextWindow(model) },
      // The summary distill runs on the turn's model — its window provably
      // covers the session it just ran (the carry-fidelity rule).
      model,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    },
    deps,
  )
}

/**
 * The best-effort form every runner calls at its turn boundary: the turn
 * already streamed and persisted, so a continuity failure (link or bridge) is
 * logged and swallowed — the next turn re-resolves the primary and re-evaluates
 * pressure. Returns the bridge result, or null (no pressure / aborted / failed).
 * One home for the contract, so no runner re-implements the guard.
 */
export async function applyPrimaryTurnContinuityBestEffort(
  db: Database,
  input: ApplyPrimaryTurnContinuityInput,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  try {
    return await applyPrimaryTurnContinuity(db, input, deps)
  } catch (err) {
    deps.logger?.warn(
      { err, primarySessionId: input.primarySessionId, sdkSessionId: input.effectiveSdkSessionId },
      'continuity failed after the turn — the next turn re-evaluates',
    )
    return null
  }
}

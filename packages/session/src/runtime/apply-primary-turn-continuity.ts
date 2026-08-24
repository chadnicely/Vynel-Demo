// `applyPrimaryTurnContinuity` — THE post-turn continuity step, one op for every
// continuing identity (workspace primary, global root, spawned session, agent
// colleague — any `primary_sessions` row). Every runner runs it once the
// turn's stream has drained, still inside that runner's serialization lock, so
// a swap is ordered ahead of the identity's next turn. Two steps, invisible in
// effect and VISIBLE in progress (the swap events the boundary wrapper yields
// — `with-boundary-continuity.ts`):
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
// Split in two phases so the boundary wrapper can announce a swap BEFORE it
// runs: `prepareTurnContinuity` (link + measure + detect — cheap, no provider
// call) yields a plan; `runTurnContinuitySwap` executes it. `apply…` composes
// both for callers that need no announcement.
//
// The identity DRIVES the step (no caller-supplied ground): the primary row
// supplies its own `workspaceId` (null = workspace-less) and its scope decides
// the first-segment presentation. A caller passing the wrong ground was a real
// bug class (a workspace-grounded spawned session filed as the brain's) — the
// op reads the truth instead of trusting an argument.
//
// Occupancy + model + denominator come from the ONE home that measures them —
// the shared consumer's `handle-usage-reported` writes the effective segment's
// `lastContextTokens` (the LAST usage report of a turn IS the current
// occupancy), `model` (what actually ran) and `lastContextWindow` (the window
// of the model the chain is DRIVEN on — chosen first, so a small-model visitor
// never lowers it) — so no runner re-derives the number from its own event
// loop. The denominator is read through `resolveSegmentContextWindow` (legacy
// rows fall back to the model that ran; a fresh swap segment to its chain).
//
// Best-effort by contract: the user's turn already streamed and persisted. A
// failure here (link or bridge) is logged and swallowed by the caller — the
// next turn simply re-resolves the primary and re-evaluates pressure.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import {
  detectContextPressure,
  linkPrimaryToTurnSegment,
  resolveSegmentContextWindow,
  type BridgePrimarySessionResult,
  type ContextMeasurement,
  type ContextPressure,
} from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'
import { findChatSessionById } from '@vynel/chat/repositories'
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

/** What `prepareTurnContinuity` decided — linked, measured, pressure detected.
 *  Everything `runTurnContinuitySwap` needs, and what an announcer reads. */
export type TurnContinuityPlan = {
  primarySessionId: string
  userId: string
  effectiveSdkSessionId: string
  /** The identity's OWN ground (null = workspace-less), from its primary row. */
  workspaceId: string | null
  workspacePath: string
  providerId: AiAgentProviderId
  measurement: ContextMeasurement
  model: string | null
  pressure: ContextPressure
  threshold?: number
}

/** Phase 1 — link the primary to the segment the turn ran on, read the
 *  segment's persisted occupancy, detect pressure. No provider call. */
export function prepareTurnContinuity(
  db: Database,
  input: ApplyPrimaryTurnContinuityInput,
): TurnContinuityPlan {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  // 1. Link the primary to the session this turn ran on (first turn /
  //    reconcile) — a no-op when the wrapper already linked it in-stream.
  linkPrimaryToTurnSegment(db, {
    primarySessionId: input.primarySessionId,
    userId: input.userId,
    priorSdkSessionId: input.priorSdkSessionId,
    sdkSessionId: input.effectiveSdkSessionId,
  })

  // 2. Measure from the effective segment's persisted occupancy against the
  //    chain's denominator. No row / no usage yet → nothing measured → nothing
  //    to bridge (a fresh identity's very first turn, or a turn that failed
  //    before its first assistant message). The distill model stays the
  //    segment's OWN last-ran model (its window provably covers what it just
  //    ran) — never a chain fallback.
  const segment = findChatSessionById(db, input.effectiveSdkSessionId)
  const usedTokens = segment?.lastContextTokens ?? 0
  const model = segment?.model ?? null
  const measurement: ContextMeasurement = {
    usedTokens,
    contextWindow: resolveSegmentContextWindow(db, input.effectiveSdkSessionId).contextWindow,
  }
  const pressure = detectContextPressure(
    measurement,
    input.threshold !== undefined ? { threshold: input.threshold } : {},
  )
  return {
    primarySessionId: input.primarySessionId,
    userId: input.userId,
    effectiveSdkSessionId: input.effectiveSdkSessionId,
    workspaceId: primary.workspaceId,
    workspacePath: input.workspacePath,
    providerId: input.providerId,
    measurement,
    model,
    pressure,
    ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
  }
}

/** Phase 2 — the seed-fresh swap for a plan that crossed the threshold. */
export async function runTurnContinuitySwap(
  db: Database,
  plan: TurnContinuityPlan,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  return bridgePrimarySessionAfterTurn(
    db,
    {
      primarySessionId: plan.primarySessionId,
      userId: plan.userId,
      workspaceId: plan.workspaceId,
      workspacePath: plan.workspacePath,
      providerId: plan.providerId,
      measurement: plan.measurement,
      // The summary distill runs on the turn's model — its window provably
      // covers the session it just ran (the carry-fidelity rule).
      model: plan.model,
      ...(plan.threshold !== undefined ? { threshold: plan.threshold } : {}),
    },
    deps,
  )
}

export async function applyPrimaryTurnContinuity(
  db: Database,
  input: ApplyPrimaryTurnContinuityInput,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  const plan = prepareTurnContinuity(db, input)
  if (!plan.pressure.isUnderPressure) return null
  return runTurnContinuitySwap(db, plan, deps)
}

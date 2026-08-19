// `fitPinnedModelToSession` — the pre-turn guard for a surface that PINS its
// model (the voice daemon's latency tier, a delegated job's model pick):
// resuming a session whose context occupancy already exceeds the pin's window
// guarantees the provider dies with "Prompt is too long" before doing anything
// — on a hands-free surface, with nobody watching an error row. Live incident
// 2026-08-19: the global brain sat at ~443k tokens (grown under 1M-window
// models, legitimately below the 0.85 swap threshold), and every haiku-pinned
// voice turn hard-failed.
//
// The decision is deliberately conservative and READ-only:
//   pin fits          -> run the pin (the surface's latency choice stands).
//   pin can't hold it -> run the model that GREW the chain — the segment's own
//                        last-ran model, or (a fresh swap segment that has not
//                        run yet) the newest one its chain knows — the context
//                        provably fits it.
//   that unknown too  -> undefined: the engine default decides.
// "Fits" reuses the continuity vocabulary (`detectContextPressure`, same
// threshold the boundary swap honors): a resume that would START at or past
// the swap threshold is not a fit. Each candidate is checked against ITS OWN
// window (a pin's fit is about the pin's ceiling, never the chain's
// denominator).
//
// The caller never persists the substitution — the voice no-write rule (pins
// must not stamp over the user's chosen settings) stands untouched.

import type { Database } from '@vynel/db'
import { findChatSessionById } from '@vynel/chat/repositories'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import { detectContextPressure, resolveSegmentContextWindow } from '../continuity/index.js'

export type FitPinnedModelToSessionInput = {
  /** The SDK session the turn is about to resume. */
  resumeSdkSessionId: string
  /** The surface's pinned model (e.g. the voice daemon's latency tier). */
  pinnedModel: string
  /** Pressure threshold override — the same env knob every continuity
   *  consumer honors, so "fits" and "will swap" never disagree. */
  threshold?: number
}

export type FitPinnedModelToSessionResult = {
  /** The model the turn should run — the pin when it fits, else the model
   *  that grew the chain, else undefined (the engine default). */
  model: string | undefined
  /** True when the pin was set aside for this turn. */
  wasReplaced: boolean
  /** The occupancy the decision was made on (0 = no row / never measured). */
  occupancyTokens: number
}

export function fitPinnedModelToSession(
  db: Database,
  input: FitPinnedModelToSessionInput,
): FitPinnedModelToSessionResult {
  const segment = findChatSessionById(db, input.resumeSdkSessionId)
  const occupancyTokens = segment?.lastContextTokens ?? 0
  const fits = (model: string): boolean =>
    !detectContextPressure(
      { usedTokens: occupancyTokens, contextWindow: resolveContextWindow(model) },
      input.threshold !== undefined ? { threshold: input.threshold } : {},
    ).isUnderPressure

  if (fits(input.pinnedModel)) {
    return { model: input.pinnedModel, wasReplaced: false, occupancyTokens }
  }
  // An unknown or unrecognized last-ran model resolves to the 200k floor and
  // simply fails the fit check too — the engine default is the honest fallback.
  const grewIt = resolveSegmentContextWindow(db, input.resumeSdkSessionId).lastRanModel
  return {
    model: grewIt !== null && fits(grewIt) ? grewIt : undefined,
    wasReplaced: true,
    occupancyTokens,
  }
}

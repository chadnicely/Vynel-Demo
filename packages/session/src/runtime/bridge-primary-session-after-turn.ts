// `bridgePrimarySessionAfterTurn` — the session-tier composition that fires the
// primary-as-thread SWAP at the turn boundary. It is the live-wiring of the
// already-built, validated `bridgePrimarySessionIfUnderPressure` (build brief
// Slice 1; the §9 primary-layer resolution of D15).
//
// Layering: `bridgePrimarySession` (session-continuity) stays pure — it never
// imports chat's repo. This composition layer (allowed to touch both domains)
// supplies the two SDK-facing deps and records the chat segment:
//   - `summarizeSession` — distill the just-finished SDK session into the carry
//     (provider read-op; cheap model; no tools).
//   - `startSeededSession` — mint a fresh seeded SDK session
//     (`runSeededSwapSession`) AND record it as a browsable chat segment
//     (`recordSwapSegmentSession`, chat-domain), returning the new id.
// `bridgePrimarySession` then repoints the primary + emits `session.swapped`
// atomically. The next primary turn resumes the fresh session — invisibly.
//
// Best-effort: a swap failure must never break the user's just-completed turn
// (it already streamed). The caller logs + continues; the next turn simply runs
// on the un-swapped session and re-evaluates pressure.

import type { Database } from '@vynel/db'
import {
  resolveAiAgentProvider,
  type AiAgentProvider,
  type AiAgentProviderId,
} from '@vynel/providers'
import {
  bridgePrimarySessionIfUnderPressure,
  type BridgePrimarySessionResult,
  type ContextMeasurement,
} from '../continuity/index.js'
import { recordSwapSegmentSession } from '@vynel/chat'
import type { Logger } from 'pino'
import { runSeededSwapSession } from './run-seeded-swap-session.js'

// The priming turn is a one-word acknowledgement over a short carry — a cheap
// model is right there. The SUMMARY distill is different: it RESUMES the
// pressure-crossing session, so the summarizing model's window must cover it —
// it runs on the turn's own model (see the input's `model`), never this one
// (a 200k-window Haiku resuming an 869k-token session degenerated the carry
// to 18 chars; tester-DB incident 2026-08-14).
const SWAP_PRIMING_MODEL = 'claude-haiku-4-5'

export type BridgePrimarySessionAfterTurnInput = {
  primarySessionId: string
  userId: string
  workspaceId: string
  workspacePath: string
  providerId: AiAgentProviderId
  /** The just-finished turn's context occupancy vs the model's window. */
  measurement: ContextMeasurement
  /** The just-finished turn's model — the summary distill runs on it, because
   *  it resumes the session and its window provably covers the content the
   *  turn just ran with. Null = the CLI default (the session's own default). */
  model: string | null
  /** Pressure threshold override (default `DEFAULT_CONTEXT_PRESSURE_THRESHOLD`,
   *  0.85). The live smoke lowers it to force a deterministic swap. */
  threshold?: number
}

export type BridgePrimarySessionAfterTurnDeps = {
  logger?: Logger
  /** Provider override — defaults to the registry singleton. Injected in tests
   *  to exercise the full swap orchestration without a live SDK. */
  provider?: AiAgentProvider
}

export async function bridgePrimarySessionAfterTurn(
  db: Database,
  input: BridgePrimarySessionAfterTurnInput,
  deps: BridgePrimarySessionAfterTurnDeps = {},
): Promise<BridgePrimarySessionResult | null> {
  const provider = deps.provider ?? resolveAiAgentProvider(input.providerId)
  const { logger } = deps

  return bridgePrimarySessionIfUnderPressure(
    db,
    {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      measurement: input.measurement,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    },
    {
      summarizeSession: (fromSdkSessionId) =>
        provider.summarizeSession({
          workspacePath: input.workspacePath,
          resumeSessionId: fromSdkSessionId,
          ...(input.model !== null ? { model: input.model } : {}),
          ...(logger !== undefined ? { logger } : {}),
        }),
      startSeededSession: async (carry, fromSdkSessionId) => {
        const seededSessionId = await runSeededSwapSession(provider, {
          workspacePath: input.workspacePath,
          carry,
          model: SWAP_PRIMING_MODEL,
          ...(logger !== undefined ? { logger } : {}),
        })
        // Record the fresh SDK session as a browsable chat segment (chat owns
        // chat_sessions). Done here, before bridgePrimarySession repoints the primary
        // at it, so a "current" primary always points at a listed segment.
        //
        // Trade-off (accepted): the segment insert + the repoint are separate
        // transactions. If the repoint failed after this insert (near-impossible
        // on Phase-1 local SQLite), an orphan empty segment would remain while the
        // primary kept the old session — self-healing (the next turn re-swaps) and
        // dormant until Slice 2 wires continuePrimary in the UI. A single
        // cross-domain transaction is a Slice 2 follow-up if it ever bites.
        recordSwapSegmentSession(db, {
          sessionId: seededSessionId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          // The continuity chain link — the sessions panel renders A ──%──▶ B
          // from this stamp (the superseded segment is the predecessor).
          continuedFromSessionId: fromSdkSessionId,
        })
        return seededSessionId
      },
      ...(logger !== undefined ? { logger } : {}),
    },
  )
}

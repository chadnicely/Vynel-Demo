// `bridgePrimarySession` — the Layer-2 SEED-FRESH swap (session-continuity's
// capstone): when a primary session nears the context limit, distill it, start a
// FRESH SDK session seeded with that carry, and repoint the primary at the new
// session (recording the superseded one). The primary identity is unchanged, so
// the user's thread is unbroken; the freed context window lets the brain keep
// going. Mechanism decided by the swap spike — see
// `.claude/ceo/agent-base/swap-mechanics-spike-finding.md`. Spec:
// `docs/agent-base/session-continuity.md` "The model" (Layer 2).
//
// The provider interactions are INJECTED (providers is a leaf — core can't
// import it here, and injecting keeps this op unit-testable with the SDK mocked
// at the boundary): `summarizeSession` (the provider distills its OWN
// transcript) and `startSeededSession` (start a fresh seeded session, resolving
// the new SDK id AFTER the turn runs — we never depend on a caller-supplied
// session id). The (already free) per-turn workspace-memory snapshot is
// re-injected by the normal turn composition, so the carry here is the rolling
// summary; "open todos" are folded into that summary (DONE / IN PROGRESS /
// NEXT) by the summarizer prompt.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as primarySessionsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { StructuralLogger } from './session-continuity-types.js'
import { detectContextPressure, type ContextMeasurement } from './detect-context-pressure.js'
import {
  SESSION_SWAP_ABORTED_EVENT_TYPE,
  SESSION_SWAPPED_EVENT_TYPE,
  SESSION_SWAPPING_EVENT_TYPE,
  type SessionSwapAbortedEventPayload,
  type SessionSwapAbortedReason,
  type SessionSwappedEventPayload,
  type SessionSwappingEventPayload,
} from './session-continuity-events.js'
import { clearPrimarySwapping, markPrimarySwapping } from './swapping-primaries.js'

export type BridgePrimarySessionInput = {
  primarySessionId: string
  userId: string
}

// The carry-fidelity floor (trimmed chars). The summarizer's labelled hand-off
// (GOAL/DONE/IN PROGRESS/NEXT/FACTS) can't legitimately compress a
// pressure-crossing session under this — shorter means the distill degenerated.
const MIN_CARRY_SUMMARY_LENGTH = 60

export type BridgePrimarySessionDeps = {
  /** Distill the pre-swap session into the carry summary (provider-owned). */
  summarizeSession: (sdkSessionId: string) => Promise<string | null>
  /** Start a fresh session seeded with the carry; resolves the NEW SDK session
   *  id. Receives the superseded session's id so the chat side can stamp the
   *  continuity chain link on the recorded segment. */
  startSeededSession: (carrySummary: string, fromSdkSessionId: string) => Promise<string>
  logger?: StructuralLogger
}

export type BridgePrimarySessionResult = {
  fromSdkSessionId: string
  toSdkSessionId: string
  summary: string
}

export async function bridgePrimarySession(
  db: Database,
  input: BridgePrimarySessionInput,
  deps: BridgePrimarySessionDeps,
): Promise<BridgePrimarySessionResult | null> {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  const fromSdkSessionId = primary.currentSdkSessionId
  if (fromSdkSessionId === null) {
    throw new ValidationError('Cannot bridge a primary session that has no current SDK session.')
  }

  // The swap is now IN PROGRESS: mark the process-wide register (a turn that
  // parks behind this identity's lock can say "patching context") and emit
  // the durable start signal (`session.swapping`) — the visible-swap half of
  // continuity. The mark lives INSIDE the try, so every exit — the outbox
  // insert throwing included — clears it; a stale mark would mislabel every
  // later park as "patching context" until restart. Every start signal gets
  // its end: `session.swapped` when it lands (co-committed with the repoint),
  // `session.swap-aborted` otherwise — a null return or a throw alike.
  let outcome: SessionSwapAbortedReason | 'landed' = 'failed'
  let failure: unknown = null
  try {
    markPrimarySwapping(primary.id)
    const startedPayload: SessionSwappingEventPayload = {
      primarySessionId: primary.id,
      userId: primary.userId,
      scope: primary.scope,
      workspaceId: primary.workspaceId,
      fromSdkSessionId,
      startedAt: new Date().toISOString(),
    }
    insertOutboxEvent(db, {
      id: randomUUID(),
      type: SESSION_SWAPPING_EVENT_TYPE,
      payload: startedPayload,
      createdAt: new Date(),
      processedAt: null,
    })
    const result = await runSwap(db, input, deps, primary, fromSdkSessionId)
    outcome = result === null ? 'no-usable-carry' : 'landed'
    return result
  } catch (err) {
    failure = err
    throw err
  } finally {
    clearPrimarySwapping(primary.id)
    if (outcome !== 'landed') {
      recordSwapAborted(db, deps, {
        primarySessionId: primary.id,
        userId: primary.userId,
        scope: primary.scope,
        workspaceId: primary.workspaceId,
        fromSdkSessionId,
        reason: outcome,
        errorMessage:
          outcome === 'failed'
            ? failure instanceof Error
              ? failure.message
              : String(failure)
            : null,
        abortedAt: new Date().toISOString(),
      })
    }
  }
}

/** The abort signal — best-effort: an outbox insert failing here must not
 *  mask the swap's own outcome (the caller already logs the abort). */
function recordSwapAborted(
  db: Database,
  deps: BridgePrimarySessionDeps,
  payload: SessionSwapAbortedEventPayload,
): void {
  try {
    insertOutboxEvent(db, {
      id: randomUUID(),
      type: SESSION_SWAP_ABORTED_EVENT_TYPE,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
  } catch (err) {
    deps.logger?.warn(
      { err, primarySessionId: payload.primarySessionId, reason: payload.reason },
      'failed to record session.swap-aborted',
    )
  }
}

async function runSwap(
  db: Database,
  input: BridgePrimarySessionInput,
  deps: BridgePrimarySessionDeps,
  primary: NonNullable<ReturnType<typeof primarySessionsRepository.findPrimarySessionById>>,
  fromSdkSessionId: string,
): Promise<BridgePrimarySessionResult | null> {
  // 1. Distill the live session into the carry.
  const summary = await deps.summarizeSession(fromSdkSessionId)
  if (summary === null || summary.trim().length < MIN_CARRY_SUMMARY_LENGTH) {
    // No usable carry → continuity can't be preserved; abort the swap (the
    // caller keeps the existing session and re-evaluates next turn; the
    // runtime's own compaction still backstops an ever-growing session). The
    // floor exists because a degenerate stub once passed the empty-only check
    // (tester-DB incident 2026-08-14: an 18-char "summary" of an 869k-token
    // session) — a real labelled hand-off can't legitimately fit under it.
    deps.logger?.warn(
      {
        primarySessionId: input.primarySessionId,
        fromSdkSessionId,
        summaryLength: summary?.length ?? 0,
      },
      'bridge aborted: no usable carry summary produced',
    )
    return null
  }

  // 2. Start a fresh session seeded with the carry; capture the new id AFTER it runs.
  //    (Async SDK call — stays OUTSIDE the transaction; a sync better-sqlite3
  //    txn cannot span an await.)
  const toSdkSessionId = await deps.startSeededSession(summary, fromSdkSessionId)

  const payload: SessionSwappedEventPayload = {
    primarySessionId: primary.id,
    userId: primary.userId,
    scope: primary.scope,
    workspaceId: primary.workspaceId,
    fromSdkSessionId,
    toSdkSessionId,
    swappedAt: new Date().toISOString(),
  }

  // 3+4. Repoint the primary + emit session.swapped ATOMICALLY — the event is
  // co-committed with the state change (data-standard "Cross-domain
  // communication"; the withTransaction idiom every state-change+event op uses).
  withTransaction(db, (tx) => {
    const repointed = primarySessionsRepository.repointPrimarySession(tx, {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      currentSdkSessionId: toSdkSessionId,
      supersededFromSdkSessionId: fromSdkSessionId,
    })
    if (repointed === null) {
      throw new NotFoundError('primary session', input.primarySessionId)
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SESSION_SWAPPED_EVENT_TYPE,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
  })

  deps.logger?.info(
    { primarySessionId: primary.id, fromSdkSessionId, toSdkSessionId, summaryLength: summary.length },
    'bridged primary session (seed-fresh swap)',
  )
  return { fromSdkSessionId, toSdkSessionId, summary }
}

export type BridgeOnPressureInput = BridgePrimarySessionInput & {
  /** The completed turn's context occupancy (used vs the model's window). */
  measurement: ContextMeasurement
  /** Override the pressure threshold (default `DEFAULT_CONTEXT_PRESSURE_THRESHOLD`). */
  threshold?: number
}

// The turn-boundary TRIGGER: evaluate context pressure from the just-finished
// turn's occupancy and, only if it crossed the threshold, bridge BEFORE the
// next turn (so the next turn runs on the fresh session). Returns the bridge
// result, or null when there is no pressure (the common case) or the bridge
// aborted. This composes the decided trigger; placing the CALL in the live
// turn loop needs the primary↔chat-session linkage (deferred — see the CEO
// question + session-continuity.md). Layer 2 owns this trigger; it does NOT
// depend on SDK auto-compaction (Q1).
export async function bridgePrimarySessionIfUnderPressure(
  db: Database,
  input: BridgeOnPressureInput,
  deps: BridgePrimarySessionDeps,
): Promise<BridgePrimarySessionResult | null> {
  const pressure = detectContextPressure(
    input.measurement,
    input.threshold !== undefined ? { threshold: input.threshold } : {},
  )
  if (!pressure.isUnderPressure) return null
  deps.logger?.info(
    { primarySessionId: input.primarySessionId, ratio: pressure.ratio, threshold: pressure.threshold },
    'context pressure crossed — bridging before the next turn',
  )
  return bridgePrimarySession(db, { primarySessionId: input.primarySessionId, userId: input.userId }, deps)
}

// `withBoundaryContinuity` — continuity that RIDES the turn's own event stream.
// Wrap a runner's `ChatTurnEvent` stream and the boundary step (link → measure
// → swap at pressure) runs when the stream drains, ANNOUNCING itself as two
// more events on the same stream:
//
//   …turn events… → `context-patching` → (the swap) → `context-patched` → end
//
// Why a wrapper and not a call after the loop: every consumer a runner already
// has — SSE frames, the drain sink, the observers, the activity-feed step tap,
// the session-channel tee (Watch) — receives these two events exactly like the
// turn's own, so the visible swap needs no per-surface plumbing and cannot be
// forgotten on a new runner. It also owns the ONE bookkeeping every runner
// duplicated: which segment the turn actually ran on (the resumed id, advanced
// by `session-created` on a fresh root or a mid-turn swap).
//
// Placement matters: wrap INSIDE the runner's lock (the runner already is) and
// BEFORE the session-channel tee, so the swap events reach the channel before
// it ends. A thrown inner stream propagates untouched — nothing reliable to
// measure, the next turn re-evaluates (the same rule the runners kept).
//
// Best-effort at every step: the turn already streamed and persisted; a
// failure to prepare or swap is logged, `context-patched` reports "stayed"
// (`toSessionId: null`), and the stream ends normally.

import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/chat'
import type { StructuralLogger } from '@vynel/logger'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import {
  prepareTurnContinuity,
  runTurnContinuitySwap,
  type TurnContinuityPlan,
} from './apply-primary-turn-continuity.js'
import { linkPrimaryToTurnSegment } from '../continuity/index.js'

export type BoundaryContinuityInput = {
  primarySessionId: string
  /** What the primary pointed at BEFORE this turn — null on the identity's first turn. */
  priorSdkSessionId: string | null
  userId: string
  /** The SDK cwd the turn ran in — the seeded fresh session runs there too. */
  workspacePath: string
  providerId: AiAgentProviderId
  /** Pressure threshold override (default 0.85). The live smoke lowers it. */
  threshold?: number
}

export type BoundaryContinuityDeps = {
  db: Database
  logger?: StructuralLogger
  /** Provider override — defaults to the registry singleton (tests inject). */
  provider?: AiAgentProvider
}

export async function* withBoundaryContinuity(
  turnStream: AsyncIterable<ChatTurnEvent>,
  input: BoundaryContinuityInput,
  deps: BoundaryContinuityDeps,
): AsyncIterable<ChatTurnEvent> {
  // The segment the turn actually ran on: the resumed id, advanced by a
  // `session-created` (a fresh root's first segment, or a mid-turn swap).
  let effectiveSdkSessionId: string | null = input.priorSdkSessionId
  for await (const event of turnStream) {
    if (event.kind === 'session-created') {
      effectiveSdkSessionId = event.session.id
      // Link NOW, not after the drain: the segment's row exists (the
      // consumer inserts before it yields), and a process that dies from
      // here on must not strand a conversation the primary never claimed
      // (2026-08-25 — a room's 24-message first turn, orphaned by an engine
      // restart, left the room on its welcome hero). Best-effort: the
      // post-drain step repeats it.
      linkInStream(input, event.session.id, deps)
    }
    yield event
  }
  if (effectiveSdkSessionId === null) return

  const plan = preparePlan(input, effectiveSdkSessionId, deps)
  if (plan === null || !plan.pressure.isUnderPressure) return

  yield {
    kind: 'context-patching',
    sessionId: effectiveSdkSessionId,
    primarySessionId: input.primarySessionId,
  }
  const toSessionId = await runSwap(plan, deps)
  yield {
    kind: 'context-patched',
    sessionId: effectiveSdkSessionId,
    primarySessionId: input.primarySessionId,
    toSessionId,
  }
}

function linkInStream(
  input: BoundaryContinuityInput,
  sdkSessionId: string,
  deps: BoundaryContinuityDeps,
): void {
  try {
    linkPrimaryToTurnSegment(deps.db, {
      primarySessionId: input.primarySessionId,
      userId: input.userId,
      priorSdkSessionId: input.priorSdkSessionId,
      sdkSessionId,
    })
  } catch (err) {
    deps.logger?.warn(
      { err, primarySessionId: input.primarySessionId, sdkSessionId },
      'the primary could not be linked in-stream — the post-turn step retries',
    )
  }
}

function preparePlan(
  input: BoundaryContinuityInput,
  effectiveSdkSessionId: string,
  deps: BoundaryContinuityDeps,
): TurnContinuityPlan | null {
  try {
    return prepareTurnContinuity(deps.db, {
      primarySessionId: input.primarySessionId,
      priorSdkSessionId: input.priorSdkSessionId,
      effectiveSdkSessionId,
      userId: input.userId,
      workspacePath: input.workspacePath,
      providerId: input.providerId,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    })
  } catch (err) {
    deps.logger?.warn(
      { err, primarySessionId: input.primarySessionId, sdkSessionId: effectiveSdkSessionId },
      'continuity could not be prepared after the turn — the next turn re-evaluates',
    )
    return null
  }
}

async function runSwap(plan: TurnContinuityPlan, deps: BoundaryContinuityDeps): Promise<string | null> {
  try {
    const result = await runTurnContinuitySwap(deps.db, plan, {
      ...(deps.provider !== undefined ? { provider: deps.provider } : {}),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    })
    return result?.toSdkSessionId ?? null
  } catch (err) {
    deps.logger?.warn(
      { err, primarySessionId: plan.primarySessionId, sdkSessionId: plan.effectiveSdkSessionId },
      'the context swap failed after the turn — the conversation stays on its segment; the next turn re-evaluates',
    )
    return null
  }
}

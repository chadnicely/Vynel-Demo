// `runTurnWithContinuations` — the AUTOMATIC continuation after a checkpoint
// (docs/module-notes/session-continuity.md §4.6): run the turn; if the model
// left a pending checkpoint ("I stopped here to swap; continue with this") AND
// the turn COMPLETED, run a continuation turn on the identity's CURRENT head —
// the fresh segment when the boundary swap landed, the same one when it did
// not — and keep going while checkpoints keep coming, up to the runaway cap.
// One generator, so the runner's single event loop (SSE frames, sink,
// observers, the feed tap) sees the continuation exactly like the first turn:
// `…first turn… → context-patching → context-patched → user-message-persisted
// (the continuation's own row) → …`.
//
// Why the runner passes a `runTurn(continuation)` closure: only the runner
// knows how to start ITS kind of turn (the workspace stream, the DM stream, the
// global core each compose differently); this owns only the loop, the
// consume-once checkpoint read, the terminal gate and the depth guard.
// Interactive streams use it in place (the composer shows the continuation as
// more of the same turn); the delegated runners enqueue a follow-up job
// instead — a queue turn is their unit of work.
//
// THE TERMINAL GATE: a continuation runs only after `session-completed`. An
// interrupted turn is the user's Stop — continuing would restart the work
// they just halted (the house rule: Stop always wins at terminal time); an
// errored turn would fire more turns into a failing engine. In both cases the
// pending checkpoint is dropped (logged), and the next real message drives.
//
// A GENUINE turn (the user's message, a delegated job) resets the depth guard
// and drops a stale pending checkpoint (one an earlier turn left behind without
// its continuation — a mid-turn disconnect); only automatic continuations
// deepen the guard. Past `MAX_CONSECUTIVE_CONTINUATIONS` the pending checkpoint
// is dropped and the loop stops — the next real message drives again.
//
// `autoContinue: false` is the delivery/notify turn's shape (a report or note
// absorbed by the identity — never work): the genuine turn runs, a checkpoint
// the model still leaves is dropped, nothing continues.

import type { ChatTurnEvent } from '@vynel/chat'
import type { StructuralLogger } from '@vynel/logger'
import {
  beginContinuation,
  beginGenuineTurn,
  takePendingCheckpoint,
  type PendingCheckpoint,
} from '../continuity/index.js'
import { composeContinuationTurn, type ContinuationTurn } from './continuation-turn.js'

export type RunTurnWithContinuationsInput = {
  primarySessionId: string
  /** Start one turn: the genuine turn when `continuation` is null, else the
   *  continuation (its persisted body, provider text and attribution). Called
   *  again after each checkpoint — the runner re-resolves the head inside. */
  runTurn: (continuation: ContinuationTurn | null) => AsyncIterable<ChatTurnEvent>
  /** False for a delivery/notify turn: never continues, drops a stray
   *  checkpoint. Default true. */
  autoContinue?: boolean
  logger?: StructuralLogger
}

type TurnTerminal = 'completed' | 'interrupted' | 'errored' | 'none'

export async function* runTurnWithContinuations(
  input: RunTurnWithContinuationsInput,
): AsyncIterable<ChatTurnEvent> {
  const stale = beginGenuineTurn(input.primarySessionId)
  if (stale !== null) {
    input.logger?.warn(
      { primarySessionId: input.primarySessionId, nextStep: stale.nextStep },
      'stale checkpoint dropped — an earlier turn ended without its continuation',
    )
  }
  let terminal = yield* runOneTurn(input.runTurn(null))
  for (;;) {
    const checkpoint = takePendingCheckpoint(input.primarySessionId)
    if (checkpoint === null) return
    if (input.autoContinue === false) {
      input.logger?.warn(
        { primarySessionId: input.primarySessionId, nextStep: checkpoint.nextStep },
        'checkpoint dropped — this turn kind never continues (a delivery, not work)',
      )
      return
    }
    if (terminal !== 'completed') {
      input.logger?.warn(
        { primarySessionId: input.primarySessionId, nextStep: checkpoint.nextStep, terminal },
        'checkpoint dropped — the turn did not complete (stopped or failed), so nothing continues',
      )
      return
    }
    if (!beginContinuation(checkpoint)) {
      input.logger?.warn(
        { primarySessionId: input.primarySessionId, depth: checkpoint.continuationDepth },
        'checkpoint dropped — the automatic continuation cap was reached; the next real message continues',
      )
      return
    }
    input.logger?.info(
      { primarySessionId: input.primarySessionId, depth: checkpoint.continuationDepth + 1 },
      'continuing after a checkpoint',
    )
    terminal = yield* runOneTurn(input.runTurn(composeContinuationTurn(checkpoint)))
  }
}

export type RunContinuingTurnInput = {
  /** The continuing identity — null for a plain conversation (opened by id /
   *  fresh), which runs its one turn and never continues. */
  primarySessionId: string | null
  /** The head the genuine turn resumes (undefined = a fresh conversation). */
  resumeSessionId: string | undefined
  /** Re-resolve the identity's CURRENT head for a continuation — the
   *  checkpoint's swap moved it. Undefined = the identity vanished meanwhile
   *  (a deleted spawned session): the continuation is skipped, logged. */
  resolveHead: () => Promise<string | undefined>
  /** Start ONE turn on `resumeSessionId` — the genuine turn (`continuation`
   *  null) or a continuation (its persisted body, provider text, attribution). */
  startOneTurn: (
    resumeSessionId: string | undefined,
    continuation: ContinuationTurn | null,
  ) => AsyncIterable<ChatTurnEvent>
  logger?: StructuralLogger
}

/**
 * The INTERACTIVE runners' shape over the loop — one home for the dance every
 * stream used to spell out itself: a plain conversation runs its single turn;
 * a continuing identity runs the genuine turn on the resolved head, then each
 * continuation on the head its swap produced.
 */
export function runContinuingTurn(input: RunContinuingTurnInput): AsyncIterable<ChatTurnEvent> {
  if (input.primarySessionId === null) return input.startOneTurn(input.resumeSessionId, null)
  const primarySessionId = input.primarySessionId
  return runTurnWithContinuations({
    primarySessionId,
    runTurn: async function* (continuation) {
      if (continuation === null) {
        yield* input.startOneTurn(input.resumeSessionId, null)
        return
      }
      const head = await input.resolveHead()
      if (head === undefined) {
        input.logger?.warn(
          { primarySessionId },
          'continuation skipped — the conversation disappeared after its checkpoint',
        )
        return
      }
      yield* input.startOneTurn(head, continuation)
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })
}

/** Yield one turn's events and report how it ended — the LAST terminal wins
 *  (a recoverable error followed by completion is a completed turn). */
async function* runOneTurn(
  turn: AsyncIterable<ChatTurnEvent>,
): AsyncGenerator<ChatTurnEvent, TurnTerminal, undefined> {
  let terminal: TurnTerminal = 'none'
  for await (const event of turn) {
    if (event.kind === 'session-completed') terminal = 'completed'
    else if (event.kind === 'session-interrupted') terminal = 'interrupted'
    else if (event.kind === 'session-errored' && !event.isRecoverable) terminal = 'errored'
    yield event
  }
  return terminal
}

export type { PendingCheckpoint }

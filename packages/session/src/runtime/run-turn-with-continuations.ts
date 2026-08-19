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
// pending checkpoint is DROPPED VISIBLY (`dropPendingCheckpoint` — a note on
// the thread, plus the log), and the next real message drives. The same drop
// fires when the stream is cut short (a client disconnect, a thrown runner)
// with a checkpoint still pending — nothing may hijack the next real turn.
//
// A GENUINE turn (the user's message, a delegated job) resets the depth guard.
// A checkpoint STILL PENDING when it starts is a survivor: the process died
// between the checkpoint and its continuation (the register is the identity's
// row — a restart forgets nothing). It is not dropped: this turn runs, and the
// survivor is continued after it — the promised continuation is kept. Only
// automatic continuations deepen the guard. Past `MAX_CONSECUTIVE_CONTINUATIONS`
// the pending checkpoint is dropped and the loop stops — the next real message
// drives again.
//
// `autoContinue: false` is the delivery/notify turn's shape (a report or note
// absorbed by the identity — never work): the genuine turn runs, a checkpoint
// the model still leaves DURING it is dropped, and a survivor from before it
// is left alone — it belongs to the identity's next real turn, not to a
// delivery.

import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/chat'
import type { StructuralLogger } from '@vynel/logger'
import {
  beginContinuation,
  beginGenuineTurn,
  dropPendingCheckpoint,
  peekPendingCheckpoint,
  takePendingCheckpoint,
  type DropPendingCheckpointReason,
  type PendingCheckpoint,
} from '../continuity/index.js'
import { composeContinuationTurn, type ContinuationTurn } from './continuation-turn.js'

export type RunTurnWithContinuationsInput = {
  db: Database
  primarySessionId: string
  /** Start one turn: the genuine turn when `continuation` is null, else the
   *  continuation (its persisted body, provider text and attribution). Called
   *  again after each checkpoint — the runner re-resolves the head inside. */
  runTurn: (continuation: ContinuationTurn | null) => AsyncIterable<ChatTurnEvent>
  /** False for a delivery/notify turn: never continues, drops a stray
   *  checkpoint. Default true. */
  autoContinue?: boolean
  logger?: StructuralLogger
  /** Injectable clock — the survivor/stray split reads it (tests). */
  now?: () => Date
}

type TurnTerminal = 'completed' | 'interrupted' | 'errored' | 'none'

export async function* runTurnWithContinuations(
  input: RunTurnWithContinuationsInput,
): AsyncIterable<ChatTurnEvent> {
  const { db, primarySessionId } = input
  const startedAt = (input.now ?? (() => new Date()))()
  const survivor = beginGenuineTurn(db, primarySessionId)
  if (survivor !== null) {
    input.logger?.info(
      { primarySessionId, nextStep: survivor.nextStep, checkpointedAt: survivor.checkpointedAt },
      'a pending checkpoint survived from before this turn — it continues after it',
    )
  }
  // A delivery turn owns only a checkpoint left DURING it; a survivor from
  // before belongs to the identity's next real turn and is left alone. Every
  // other turn owns whatever is pending (a survivor was going to be continued
  // after it — if this turn cannot, the survivor goes with it, visibly).
  const drop = (checkpoint: PendingCheckpoint, reason: DropPendingCheckpointReason): void => {
    if (input.autoContinue === false && checkpoint.checkpointedAt < startedAt) return
    dropPendingCheckpoint(db, primarySessionId, {
      reason,
      ...(input.logger !== undefined ? { logger: input.logger } : {}),
    })
  }
  let settled = false
  try {
    let terminal = yield* runOneTurn(input.runTurn(null))
    for (;;) {
      const checkpoint = peekPendingCheckpoint(db, primarySessionId)
      if (checkpoint === null) break
      if (input.autoContinue === false) {
        drop(checkpoint, 'never-continues')
        break
      }
      if (terminal !== 'completed') {
        drop(checkpoint, terminal === 'interrupted' ? 'turn-stopped' : 'turn-failed')
        break
      }
      // The cap check + depth bookkeeping first, the consume after: a refused
      // checkpoint is still on the row for the drop to note.
      if (!beginContinuation(db, checkpoint)) {
        drop(checkpoint, 'cap-reached')
        break
      }
      takePendingCheckpoint(db, primarySessionId)
      input.logger?.info(
        { primarySessionId, depth: checkpoint.continuationDepth + 1 },
        'continuing after a checkpoint',
      )
      terminal = yield* runOneTurn(input.runTurn(composeContinuationTurn(checkpoint)))
    }
    settled = true
  } finally {
    // Cut short (the consumer stopped reading, or a runner threw): whatever is
    // still pending would hijack the next real turn's end — drop it, visibly.
    if (!settled) {
      const orphan = peekPendingCheckpoint(db, primarySessionId)
      if (orphan !== null) drop(orphan, 'turn-cut-short')
    }
  }
}

export type RunContinuingTurnInput = {
  db: Database
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
    db: input.db,
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

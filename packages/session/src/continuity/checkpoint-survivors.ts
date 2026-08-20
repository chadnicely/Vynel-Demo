// THE RESTART SURVIVOR — one concept, one file (audit r2 R2-H).
//
// A survivor is a pending checkpoint written before this process started: the
// app died between `checkpoint()` and its continuation. The durable slot kept
// it (that was the hardening arc's win), but nothing ever SAID so: it waited
// invisibly for the next user message, the next `checkpoint()` overwrote it in
// silence, and on the spoken thread — which never continues work by itself —
// it waited forever.
//
// Kafi (2026-08-20): SURFACE ON BOOT, never auto-run. Vynel starting up must
// not start work nobody asked for at that moment. So three things happen here:
//
//   BOOT      — every survivor becomes a visible note on its own thread
//               ("interrupted before it could continue — the next step was …").
//               Idempotent: restarting three times before the user says
//               anything leaves ONE note. A VOICE-scope identity is dropped
//               instead — that thread never continues work, so a standing
//               promise there would be a lie.
//   NEXT TURN — the identity's next genuine turn carries a marker on its
//               PROVIDER INPUT ONLY (the voice-turn-marker precedent): the
//               model learns it owes a step and that Vynel picks it up right
//               after this turn, so it neither redoes the step nor drops it on
//               the floor. The persisted row keeps the clean user text.
//   SUPERSEDE — a `checkpoint()` landing on a survivor gives the old one up
//               OUT LOUD first. A same-life re-checkpoint (the model refining
//               its own next step mid-turn) stays silent — that is ordinary
//               supersession, and a note per call would be spam.
//
// The survivor boundary is this process's start, injectable (`survivorBefore`)
// so tests state it instead of racing the clock.

import type { Database } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'
import * as primarySessionsRepository from '../repositories/index.js'
import { dropPendingCheckpoint } from './drop-pending-checkpoint.js'
import { recordNoteOnPrimaryHead } from './primary-head-note.js'
import {
  markPendingCheckpoint,
  peekPendingCheckpoint,
  type PendingCheckpoint,
} from './pending-checkpoints.js'

/** When this process came up — anything checkpointed before it outlived a
 *  restart, so the turn running now has never seen it. */
const PROCESS_STARTED_AT = new Date()

export function isSurvivorCheckpoint(checkpoint: PendingCheckpoint, before?: Date): boolean {
  return checkpoint.checkpointedAt < (before ?? PROCESS_STARTED_AT)
}

/** The visible row's text — the sibling of the dropped-checkpoint note, so the
 *  two read as one mechanism. Deliberately neutral about WHO picks it up: the
 *  interactive rail continues it after the next turn, but a delegated job
 *  claiming the identity first drops it (`beginDelegatedTurn`), and a note may
 *  not promise what the next producer will not keep. */
export function composeSurvivedCheckpointNote(nextStep: string): string {
  return (
    `Vynel was interrupted mid-plan and never continued — the next step was: ${nextStep}. ` +
    'Ask to continue when you want it picked up.'
  )
}

/** What the MODEL reads on the next genuine turn (provider input only). */
export function composeSurvivorCheckpointMarker(checkpoint: PendingCheckpoint): string {
  return (
    'CHECKPOINT PENDING (this note is from Vynel, not the user): you checkpointed earlier and the ' +
    'continuation never ran — Vynel restarted, or that turn ended before it could. The next step ' +
    `you named was: ${checkpoint.nextStep}\n\n` +
    'Vynel continues you with that step automatically right after this turn. Answer the message in ' +
    'front of you now, do NOT redo that step here, and tell the user in one line that you are ' +
    'picking it up next.'
  )
}

/** The marker for `primarySessionId`'s next genuine turn, or null when nothing
 *  is pending. Called at COMPOSE time, where a continuation's checkpoint has
 *  already been consumed — so the marker rides the genuine turn exactly once. */
export function resolveSurvivorCheckpointMarker(
  db: Database,
  primarySessionId: string,
): string | null {
  const checkpoint = peekPendingCheckpoint(db, primarySessionId)
  return checkpoint === null ? null : composeSurvivorCheckpointMarker(checkpoint)
}

export type RecordCheckpointDeps = {
  logger?: StructuralLogger
  now?: () => Date
  /** The survivor boundary — default: this process's start. */
  survivorBefore?: Date
}

/** The `checkpoint` tool's write: a SURVIVOR under the slot is given up out
 *  loud before the new intent lands (never a silent loss); a same-life
 *  checkpoint is replaced quietly, as it always was. */
export function recordCheckpointSupersedingSurvivor(
  db: Database,
  primarySessionId: string,
  nextStep: string,
  deps: RecordCheckpointDeps = {},
): PendingCheckpoint {
  const existing = peekPendingCheckpoint(db, primarySessionId)
  if (existing !== null && isSurvivorCheckpoint(existing, deps.survivorBefore)) {
    dropPendingCheckpoint(db, primarySessionId, {
      reason: 'superseded',
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    })
  }
  return markPendingCheckpoint(db, primarySessionId, nextStep, deps.now !== undefined ? { now: deps.now } : {})
}

export type SurfaceCheckpointSurvivorsDeps = {
  logger?: StructuralLogger
  now?: () => Date
}

export type SurfaceCheckpointSurvivorsResult = {
  /** Survivors announced on their own thread — they still run after the next turn. */
  surfaced: number
  /** Survivors given up (a voice identity never continues work by itself). */
  dropped: number
}

/**
 * The BOOT pass — nothing is running yet, so every pending slot is a survivor.
 * Must run before any service can start a turn: a turn that consumed the
 * survivor first would make the note a lie.
 */
export function surfaceCheckpointSurvivors(
  db: Database,
  deps: SurfaceCheckpointSurvivorsDeps = {},
): SurfaceCheckpointSurvivorsResult {
  const now = (deps.now ?? (() => new Date()))()
  const result: SurfaceCheckpointSurvivorsResult = { surfaced: 0, dropped: 0 }
  for (const row of primarySessionsRepository.listPrimarySessionsWithPendingCheckpoint(db)) {
    const nextStep = row.pendingCheckpointNextStep
    if (nextStep === null) continue
    if (row.scope === 'voice') {
      dropPendingCheckpoint(db, row.id, {
        reason: 'restarted',
        now: () => now,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      })
      result.dropped += 1
      continue
    }
    // An identity with no linked head has no thread to say it on — the log
    // line is the trace, and the count stays honest.
    const written = recordNoteOnPrimaryHead(db, {
      primarySessionId: row.id,
      body: composeSurvivedCheckpointNote(nextStep),
      onlyIfNotLatest: true,
      now,
    })
    if (written) result.surfaced += 1
  }
  if (result.surfaced > 0 || result.dropped > 0) {
    deps.logger?.warn(
      result,
      'boot: checkpoints survived a restart — surfaced on their threads (the spoken thread drops its own)',
    )
  }
  return result
}

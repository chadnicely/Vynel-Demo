// Pending CHECKPOINTS — the model said "I am stopping here to swap; continue
// with this" (the `checkpoint` tool, docs/module-notes/session-continuity.md
// §4.6). Keyed by the continuing identity (the primary id); consumed exactly
// once by whoever runs the continuation after the boundary swap.
//
// DURABLE (session-hardening arc, 2026-08-19): the register IS the identity's
// own `primary_sessions` row — four nullable columns, one slot. It used to be a
// process-wide Map, and a restart between `checkpoint()` and its continuation
// silently dropped the work ("Vynel stopped mid-task and said nothing"). Now a
// checkpoint that outlives the process is still there for the next turn (the
// loop continues it) and a follow-up job that outlives the process still
// claims as a continuation. Nothing here holds state — every function reads
// and writes the row, `db` first, sync (Phase-1 SQLite).
//
// The slot has three states, told apart by the columns:
//   none        — nextStep NULL.
//   pending     — nextStep set, jobId NULL: the identity's next automatic
//                 continuation (peek/take see it; the carry quotes it).
//   handed over — nextStep set, jobId set: a delegated follow-up job owns it;
//                 invisible to peek/take (so a genuine turn in between cannot
//                 enqueue it twice), taken by that job's claim.
// A new checkpoint always writes a fresh PENDING slot (the latest intent wins,
// a queued follow-up's hand-over is superseded — its anchor row still names
// its step, it simply runs as a genuine turn).
//
// The continuation DEPTH guards the runaway case (a model that checkpoints
// every turn): each automatic continuation deepens it, a genuine (user- or
// job-started) turn resets it, and the runners refuse to continue past the cap.
// It lives on the same row (`pendingCheckpointDepth`, NULL = 0) so the cap
// keeps counting across a restart.

import type { Database } from '@vynel/db'
import { withTransaction } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'

export const MAX_CONSECUTIVE_CONTINUATIONS = 3

export type PendingCheckpoint = {
  primarySessionId: string
  /** The single next step the model named — what the continuation is asked to do. */
  nextStep: string
  /** How many automatic continuations preceded this checkpoint since the last genuine turn. */
  continuationDepth: number
  checkpointedAt: Date
}

/** The row's PENDING (unassigned) checkpoint, or null — one reading for every
 *  op: a handed-over slot belongs to its follow-up job, not to the identity. */
function pendingOf(row: PrimarySessionRow | null): PendingCheckpoint | null {
  if (
    row === null ||
    row.pendingCheckpointNextStep === null ||
    row.pendingCheckpointJobId !== null
  ) {
    return null
  }
  return checkpointOf(row, row.pendingCheckpointNextStep)
}

function checkpointOf(row: PrimarySessionRow, nextStep: string): PendingCheckpoint {
  return {
    primarySessionId: row.id,
    nextStep,
    continuationDepth: row.pendingCheckpointDepth ?? 0,
    checkpointedAt: row.pendingCheckpointAt ?? new Date(0),
  }
}

/** The model checkpointed: remember the next step for this identity (a second
 *  call before the swap replaces the first — the latest intent wins). Throws
 *  when the identity has no live row — the tool answers the model honestly. */
export function markPendingCheckpoint(
  db: Database,
  primarySessionId: string,
  nextStep: string,
  deps: { now?: () => Date } = {},
): PendingCheckpoint {
  const row = primarySessionsRepository.patchPendingCheckpoint(db, primarySessionId, {
    pendingCheckpointNextStep: nextStep,
    pendingCheckpointAt: (deps.now ?? (() => new Date()))(),
    pendingCheckpointJobId: null,
  })
  if (row === null) throw new NotFoundError('primary session', primarySessionId)
  return checkpointOf(row, nextStep)
}

export function peekPendingCheckpoint(db: Database, primarySessionId: string): PendingCheckpoint | null {
  return pendingOf(primarySessionsRepository.findPrimarySessionById(db, primarySessionId))
}

/** Consume the checkpoint (exactly once) — the caller is about to run the
 *  continuation, or decided not to. Null when none is pending. */
export function takePendingCheckpoint(db: Database, primarySessionId: string): PendingCheckpoint | null {
  return withTransaction(db, (tx) => {
    const checkpoint = peekPendingCheckpoint(tx, primarySessionId)
    if (checkpoint === null) return null
    primarySessionsRepository.patchPendingCheckpoint(tx, primarySessionId, {
      pendingCheckpointNextStep: null,
      pendingCheckpointAt: null,
    })
    return checkpoint
  })
}

/** Whether the pending checkpoint may run as an automatic continuation, and
 *  the depth bookkeeping if it does — decided BEFORE the caller consumes it, so
 *  a refusal leaves the checkpoint on the row for a visible drop. Past the cap
 *  the caller stops and lets the user (or the next job) drive — the guard
 *  against a model that checkpoints forever. */
export function beginContinuation(db: Database, checkpoint: PendingCheckpoint): boolean {
  if (checkpoint.continuationDepth >= MAX_CONSECUTIVE_CONTINUATIONS) return false
  const row = primarySessionsRepository.patchPendingCheckpoint(db, checkpoint.primarySessionId, {
    pendingCheckpointDepth: checkpoint.continuationDepth + 1,
  })
  // The identity vanished meanwhile (a deleted spawned session): nothing to continue.
  return row !== null
}

/** A GENUINE turn is starting on this identity (a user message, a new
 *  delegated job): the runaway guard starts over. Returns the checkpoint an
 *  EARLIER turn left pending without its continuation — a restart between a
 *  checkpoint and its continuation, a job that never enqueued its follow-up —
 *  and leaves it in place: the caller decides. The interactive loop continues
 *  it after this turn (the promised continuation must survive a restart); the
 *  delegated tick drops it visibly (its job's failure was already reported). */
export function beginGenuineTurn(db: Database, primarySessionId: string): PendingCheckpoint | null {
  return withTransaction(db, (tx) => {
    const leftover = peekPendingCheckpoint(tx, primarySessionId)
    primarySessionsRepository.patchPendingCheckpoint(tx, primarySessionId, { pendingCheckpointDepth: null })
    return leftover
  })
}

/** Reset seam — forget everything remembered for this identity (tests, and
 *  the identity's own teardown). */
export function clearPendingCheckpoint(db: Database, primarySessionId: string): void {
  primarySessionsRepository.patchPendingCheckpoint(db, primarySessionId, {
    pendingCheckpointNextStep: null,
    pendingCheckpointDepth: null,
    pendingCheckpointAt: null,
    pendingCheckpointJobId: null,
  })
}

// The DELEGATED half's follow-up jobs: a job that continues a checkpoint is a
// plain queue row (no column marks it), so its claim would read as a GENUINE
// turn — resetting the runaway guard on every hop and never engaging the cap.
// The enqueue HANDS the pending checkpoint to the follow-up (its id lands on
// the identity's row); the tick reads it once at claim time (the guard keeps
// counting, the run gets the continuation steer). Durable like the rest: a
// follow-up claimed after a restart still continues.

/** Hand `checkpoint` to the follow-up job `jobId`: the slot now belongs to
 *  that job (peek/take on the identity no longer see it) until its claim. */
export function markContinuationJob(db: Database, jobId: string, checkpoint: PendingCheckpoint): void {
  primarySessionsRepository.patchPendingCheckpoint(db, checkpoint.primarySessionId, {
    pendingCheckpointNextStep: checkpoint.nextStep,
    pendingCheckpointAt: checkpoint.checkpointedAt,
    pendingCheckpointJobId: jobId,
  })
}

/** The checkpoint a claimed job continues — consumed once; null for a genuine job. */
export function takeContinuationJob(db: Database, jobId: string): PendingCheckpoint | null {
  return withTransaction(db, (tx) => {
    const row = primarySessionsRepository.findPrimarySessionByPendingCheckpointJobId(tx, jobId)
    if (row === null) return null
    primarySessionsRepository.patchPendingCheckpoint(tx, row.id, {
      pendingCheckpointNextStep: null,
      pendingCheckpointAt: null,
      pendingCheckpointJobId: null,
    })
    // A hand-over always writes the step beside the job id; a slot with the id
    // and no step is not a checkpoint anyone can continue.
    return row.pendingCheckpointNextStep === null ? null : checkpointOf(row, row.pendingCheckpointNextStep)
  })
}

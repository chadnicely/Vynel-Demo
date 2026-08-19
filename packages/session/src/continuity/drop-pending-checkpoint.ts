// `dropPendingCheckpoint` — the ONE way a pending checkpoint is given up
// WITHOUT its continuation, and the user is told. The model promised "I'll
// continue after patching context"; when the runtime cannot keep that promise
// (the user stopped the turn, the turn failed or was cut short, the runaway cap
// was reached, a delivery turn never continues, a delegated run died before
// its follow-up), a log line alone leaves the thread ending mid-task with no
// explanation (audit 2026-08-19, agent 1 §4.1). So the drop persists ONE row on
// the identity's current head — the continuation anchor's own shape (a
// user-role row stamped `global-root`, no label: renders as the assistant
// noting, never as the user typing) — naming the step that was not continued
// and how to pick it up. Display-only: no turn is started, the model reads
// nothing; the next real turn drives.
//
// Take + note run in one transaction: a drop is a state change and its
// evidence lands with it or not at all.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { withTransaction } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'
import { findChatSessionById, insertChatMessage, updateChatSession } from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'
import { takePendingCheckpoint, type PendingCheckpoint } from './pending-checkpoints.js'

export type DropPendingCheckpointReason =
  /** The user stopped the turn — Stop always wins at terminal time. */
  | 'turn-stopped'
  /** The turn ended in a non-recoverable error — nothing continues into a failing engine. */
  | 'turn-failed'
  /** The turn's stream closed before it settled (a client disconnect, a thrown runner). */
  | 'turn-cut-short'
  /** `MAX_CONSECUTIVE_CONTINUATIONS` automatic continuations already ran. */
  | 'cap-reached'
  /** A turn kind that never continues work automatically (a delivery / notify
   *  turn absorbing a report, a note, a voice turn) left a checkpoint anyway. */
  | 'never-continues'
  /** An earlier turn left it pending without its continuation — a delegated
   *  run that ended before enqueuing its follow-up, a survivor another origin
   *  found first. */
  | 'left-behind'

const REASON_TEXT: Record<DropPendingCheckpointReason, string> = {
  'turn-stopped': 'the turn was stopped',
  'turn-failed': 'the turn failed',
  'turn-cut-short': 'the turn was cut short',
  'cap-reached': 'the automatic continuation limit was reached',
  'never-continues': 'this kind of turn never continues work automatically',
  'left-behind': 'an earlier turn ended without continuing it',
}

/** The visible row's text — the sibling of the anchor "Continuing after
 *  patching context — next: …", so the two read as one mechanism. */
export function composeDroppedCheckpointNote(nextStep: string, reason: DropPendingCheckpointReason): string {
  return `Not continued — the next step was: ${nextStep} (${REASON_TEXT[reason]}). Ask to continue when you want it picked up.`
}

export type DropPendingCheckpointInput = {
  reason: DropPendingCheckpointReason
  logger?: StructuralLogger
  now?: () => Date
}

/** Take the identity's pending checkpoint and leave the note on its head.
 *  Null when nothing was pending (nothing dropped, nothing written). */
export function dropPendingCheckpoint(
  db: Database,
  primarySessionId: string,
  input: DropPendingCheckpointInput,
): PendingCheckpoint | null {
  const dropped = withTransaction(db, (tx) => {
    const checkpoint = takePendingCheckpoint(tx, primarySessionId)
    if (checkpoint === null) return null
    recordDroppedCheckpointNote(tx, primarySessionId, checkpoint, input)
    return checkpoint
  })
  if (dropped !== null) {
    input.logger?.warn(
      { primarySessionId, nextStep: dropped.nextStep, reason: input.reason },
      'checkpoint dropped — its continuation will not run; the user sees a note on the thread',
    )
  }
  return dropped
}

// The head may not exist yet (an identity that never linked a segment) or may
// be gone (a purged segment) — then there is no thread to write on and the log
// line is the trace.
function recordDroppedCheckpointNote(
  db: Database,
  primarySessionId: string,
  checkpoint: PendingCheckpoint,
  input: DropPendingCheckpointInput,
): void {
  const primary = primarySessionsRepository.findPrimarySessionById(db, primarySessionId)
  const headSessionId = primary?.currentSdkSessionId ?? null
  if (headSessionId === null || findChatSessionById(db, headSessionId) === null) return
  const now = (input.now ?? (() => new Date()))()
  insertChatMessage(db, {
    id: randomUUID(),
    sessionId: headSessionId,
    role: 'user',
    body: composeDroppedCheckpointNote(checkpoint.nextStep, input.reason),
    sourceKind: 'global-root',
    sourceLabel: null,
    partialSessionId: null,
    threadId: null,
    originChannel: null,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  })
  updateChatSession(db, headSessionId, { lastMessageAt: now })
}

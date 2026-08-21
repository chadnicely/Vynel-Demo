// `settleCompletedTask` — the terminal bookkeeping of a TASK/NOTE job whose
// turn COMPLETED (split from the tick, session-hardening A6): the complete +
// surfaced co-commit, the checkpoint continuation, and the AUTO-REPORT that
// makes "a task always reports to its requester" true. Everything here is
// best-effort past the completion write: a finished turn can never flip to
// failed.
//
// THE CHANNEL SHORTCUT IS GONE (channel report protocol, Kafi 2026-08-22).
// This used to distill the reply and ship it straight to the origin channel
// milliseconds after completion, skipping the protocol entirely: the requester
// never learned the task had finished, and the user got a summary nobody had
// read. Now the report goes UP — to the requester — and the requester's notify
// turn is what answers the channel (it carries the origin, so `reply_to_channel`
// is addressed for it). The last-resort channel line lives at the ONE place
// that knows delivery failed: `run-report-delivery-tick.ts`.

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  completeDelegationJob,
  isWorkJobKind,
  markDelegationsSurfacedToRoot,
  type DelegationJob,
} from '@vynel/orchestration'
import {
  finalReportWentDirect,
  hasDeliveredFinalReport,
} from './settle-failed-delegation-attempt.js'
import { enqueueAutoReportDelivery } from './enqueue-job-report-delivery.js'
import { enqueueCheckpointContinuation } from './enqueue-checkpoint-continuation.js'

export interface SettleCompletedTaskInput {
  /** The turn's clean reply — the row's resultText. */
  result: string
  /** True for a 'note' row (never work: no direct-path exception, no report). */
  isNote: boolean
}

export function settleCompletedTask(
  db: Database,
  deps: { logger: Logger },
  claimed: DelegationJob,
  input: SettleCompletedTaskInput,
): void {
  // NO HARVEST (session-comms pipeline, Chad locked 2026-07-27, reversing
  // the earlier silence-is-worse stance): the chat reply is NEVER captured
  // and delivered as a report — reports travel exclusively via the
  // send_message tool, sent deliberately by the one who did the work. The
  // reply still lives on the job row (resultText — the trace/status truth)
  // and in the child's own transcript, one Watch-click away.
  //
  // complete + mark-surfaced CO-COMMIT (invariant 5): completed rows are
  // ALWAYS surfaced now — the root's catch-up net injects resultText,
  // which would be the capture leaking back through another door. FAILED
  // rows keep the catch-up: a failure note is status, not capture, and the
  // root must learn the task died. ONE exception (kind `direct_to_user`): a
  // final answer that went straight to the user runs NO notify turn, so the
  // row stays UNSURFACED — the net is how the root learns it (presented
  // "already shown — absorb silently", never an echo).
  // A NOTE never travels the direct path: it is always surfaced at
  // completion, so the root's catch-up can never narrate a peer's note
  // back as if it were a result.
  const wentDirect = input.isNote ? false : finalReportWentDirect(db, claimed)
  // Fresh-read, not the claim-time snapshot: the tool stamps `reportedAt`
  // mid-run. This is the ONE question the auto-report turns on. (A note row is
  // excluded by kind below — `isWorkJobKind` — never by this read.)
  const turnReported = hasDeliveredFinalReport(db, claimed)
  try {
    const completed = withTransaction(db, (tx) => {
      const row = completeDelegationJob(tx, claimed.id, input.result, new Date())
      if (row !== null && !wentDirect) markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
      return row
    })
    if (completed === null) {
      // The lease sweeper (or a stop) settled this row while the run was still
      // going — its verdict stands; this run's completion is a late echo, and
      // must enqueue NOTHING (a second auto-report would double-wake the
      // requester for one task).
      deps.logger.warn(
        { jobId: claimed.id },
        'delegation completed after its claim was settled elsewhere — standing down',
      )
      return
    }
  } catch (completionErr) {
    deps.logger.warn(
      { err: completionErr, jobId: claimed.id },
      'delegation completion co-commit failed — completing alone',
    )
    if (completeDelegationJob(db, claimed.id, input.result, new Date()) === null) return
    // Retry the mark ALONE: an unsurfaced completed row would let the
    // root's catch-up inject resultText — the capture leaking back. If
    // the mark itself is what keeps throwing, that one terminal window
    // accepts the echo (awareness over policy, logged loud).
    try {
      if (!wentDirect) markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
    } catch (markErr) {
      deps.logger.warn(
        { err: markErr, jobId: claimed.id },
        'delegation surfaced-mark retry failed — the next root turn may echo the reply',
      )
    }
  }

  // Auto-continue (session-continuity §4.6): the model checkpointed
  // because its context was nearly full — the boundary swap already ran
  // inside the turn; enqueue the follow-up job that continues the work
  // on the fresh head. Best-effort: the job is complete either way.
  // Its ANSWER gates the auto-report below, so it runs first: a checkpointed
  // task did not end, and "the task ended without reporting" would be a lie.
  let continuationJobId: string | null = null
  try {
    continuationJobId = enqueueCheckpointContinuation(db, claimed, { logger: deps.logger })
  } catch (err) {
    deps.logger.warn(
      { err, jobId: claimed.id },
      'failed to enqueue the checkpoint continuation (the job is still completed)',
    )
  }

  // THE GUARANTEE (channel report protocol): the steer tells every delegated
  // turn to end with a send_message report, but a steer is a request. When the
  // turn ended without one, the engine relays its final output as the report
  // itself — same queue, same notify turn, same A3c idempotent inbound row a
  // model-sent report takes, labelled so the requester knows who wrote it.
  // Best-effort past completion, like the continuation above.
  const shouldAutoReport =
    !turnReported && continuationJobId === null && isWorkJobKind(claimed.jobKind)
  if (shouldAutoReport) {
    try {
      const deliveryJobId = enqueueAutoReportDelivery(db, claimed, input.result)
      deps.logger.warn(
        { jobId: claimed.id, deliveryJobId },
        'delegation completed WITHOUT reporting — auto-report enqueued for the requester',
      )
    } catch (err) {
      deps.logger.error(
        { err, jobId: claimed.id },
        'failed to enqueue the auto-report (the job is still completed; the requester learns nothing)',
      )
    }
  }

  deps.logger.info(
    { jobId: claimed.id, resultPreview: input.result.slice(0, 120) },
    input.isNote
      ? 'note: delivered — the target absorbed it in its own turn'
      : 'delegation: completed',
  )
}

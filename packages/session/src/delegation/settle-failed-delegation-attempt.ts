// `settleFailedDelegationAttempt` — one home for "this delegation attempt
// failed": a transient failure requeues with backoff; the terminal failure is
// PUSHED to the requester as a report delivery — a real notify turn telling the
// user it failed and how to retry. Extracted from the claim-and-run tick when
// the 'agent-run' branch (chat-mentions) became its second caller.
//
// The push honors `requesterWorkspaceId` (chat-mentions): a job whose report
// belongs to a WORKSPACE chat fails back into THAT chat; a gone workspace (or
// none recorded) falls through to the global root — upward chains terminate
// there. Give-up pushes fire for WORK rows only ('task' / 'agent-run'); a
// failed 'report-delivery' must never spawn another delivery (the
// anti-cascade invariant).

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  failDelegationJob,
  findDelegationJobById,
  isDeliveryJobKind,
  markDelegationsSurfacedToRoot,
  type DelegationJob,
} from '@vynel/orchestration'
import { extractEmbeddedErrorCode, requeueIfRecoverable } from './classify-turn-failure.js'
import { enqueueJobFailureDelivery, previewTaskText } from './enqueue-job-failure-delivery.js'

/** Fresh-read whether this WORK job's turn already SPOKE its final report —
 *  the claim-time snapshot predates the mid-run `reportedAt` stamp
 *  (dispatch-message writes it while the turn runs), so callers must never
 *  trust the row they were handed. Delivery rows always answer false: they
 *  keep their standing requeue-then-drop flow regardless of any
 *  cascade-relay stamp. One home — the settle gate below and the runners'
 *  timed-out branches share it (session-review B2). */
export function hasDeliveredFinalReport(db: Database, claimed: DelegationJob): boolean {
  if (isDeliveryJobKind(claimed.jobKind)) return false
  return (findDelegationJobById(db, claimed.id)?.reportedAt ?? claimed.reportedAt) !== null
}

/** A failed (non-stopped) attempt: requeue if recoverable, else fail the row
 *  terminally and push a failure report to the requester. `retryHint` finishes
 *  the sentence "…it failed: <error>. Tell the user it failed, and <hint>".
 *  A turn that already SPOKE its final report settles terminally with neither
 *  — the requester has the result. */
export function settleFailedDelegationAttempt(
  db: Database,
  claimed: DelegationJob,
  errorMessage: string,
  deps: { logger: Logger; queueLabel: string; retryHint: string },
): void {
  const errorCode = extractEmbeddedErrorCode(errorMessage)
  const errorCodeOption = errorCode !== null ? { errorCode } : {}

  // A WORK turn that already delivered its final report must neither RE-RUN
  // (a requeue repeats the whole task and double-wakes the requester with a
  // second report) nor push a give-up ("it failed" — contradicting the result
  // they received). Terminal record + surfaced stamp: the requester HAS the
  // report, so the root's pull net must never re-inject this row as a failure.
  if (hasDeliveredFinalReport(db, claimed)) {
    failDelegationJob(db, claimed.id, errorMessage, new Date(), errorCodeOption)
    markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
    deps.logger.warn(
      { jobId: claimed.id, message: errorMessage },
      `${deps.queueLabel} turn failed AFTER its report was sent — recorded terminally (no requeue, no give-up push)`,
    )
    return
  }

  if (requeueIfRecoverable(db, claimed, errorMessage, deps.logger, deps.queueLabel)) return

  const attemptCount = (claimed.attemptCount ?? 0) + 1
  failDelegationJob(db, claimed.id, errorMessage, new Date(), errorCodeOption)
  deps.logger.warn(
    { jobId: claimed.id, attemptCount, message: errorMessage },
    `${deps.queueLabel} job failed terminally`,
  )

  // Give-up push for WORK rows only (see the anti-cascade note above) — a
  // failed delivery of EITHER kind must never spawn another delivery, and a
  // dropped update is deliberately terminal (ephemeral status, persona-sessions).
  if (isDeliveryJobKind(claimed.jobKind)) return
  try {
    enqueueJobFailureDelivery(
      db,
      claimed,
      `The background task "${previewTaskText(claimed.taskText)}" failed` +
        `${attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}: ${errorMessage}. ` +
        `Tell the user it failed, and ${deps.retryHint}`,
    )
    // Surfaced via the push — keep the pull net from repeating it next turn.
    markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
  } catch (err) {
    // The failed row stays in the root catch-up net — the user still learns of
    // it on their next turn even when the push could not be enqueued.
    deps.logger.error(
      { err, jobId: claimed.id },
      `failed to enqueue the ${deps.queueLabel}-failure report`,
    )
  }
}

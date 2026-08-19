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

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  failDelegationJob,
  findDelegationJobById,
  isDeliveryJobKind,
  isWorkJobKind,
  listDelegationJobsByThread,
  markDelegationsSurfacedToRoot,
  resolveThreadIdOf,
  type DelegationJob,
} from '@vynel/orchestration'
import { extractEmbeddedErrorCode, requeueIfRecoverable } from './classify-turn-failure.js'
import { enqueueJobFailureDelivery, previewTaskText } from './enqueue-job-failure-delivery.js'

/** Fresh-read whether this WORK job's turn already SPOKE its final report —
 *  the claim-time snapshot predates the mid-run `reportedAt` stamp
 *  (dispatch-message writes it while the turn runs), so callers must never
 *  trust the row they were handed. Delivery rows always answer false: they
 *  keep their standing requeue-then-drop flow regardless of any
 *  cascade-relay stamp. One home — the settle gate below and the tick's
 *  completion branch share it (session-review B2). */
export function hasDeliveredFinalReport(db: Database, claimed: DelegationJob): boolean {
  if (isDeliveryJobKind(claimed.jobKind)) return false
  return (findDelegationJobById(db, claimed.id)?.reportedAt ?? claimed.reportedAt) !== null
}

/** True when THIS work row's final report was sent kind `direct_to_user`: the
 *  row is reported AND a 'direct-delivery' hop exists in ITS OWN delivery
 *  window — after this hop, before the chain's NEXT work hop. A continued
 *  chain holds one work hop per task (the run-stats pairing rule), so a
 *  chain-wide scan would falsely absorb a LATER normally-narrated report just
 *  because an earlier task on the thread went direct (the Gate-3 catch). Such
 *  a row stays UNSURFACED at terminal time — the catch-up net is how the root
 *  learns of a reply that ran no notify turn (presented absorb-silently). */
export function finalReportWentDirect(db: Database, claimed: DelegationJob): boolean {
  if (!hasDeliveredFinalReport(db, claimed)) return false
  const threadId = resolveThreadIdOf(claimed)
  if (threadId === null) return false
  const chain = listDelegationJobsByThread(db, {
    userId: claimed.userId,
    threadId,
    unbounded: true,
  })
  const startsAt = claimed.createdAt.getTime()
  const nextWorkAt = chain.find(
    (job) =>
      job.id !== claimed.id &&
      isWorkJobKind(job.jobKind) &&
      job.createdAt.getTime() > startsAt,
  )?.createdAt
  return chain.some(
    (job) =>
      job.jobKind === 'direct-delivery' &&
      job.createdAt.getTime() >= startsAt &&
      (nextWorkAt === undefined || job.createdAt.getTime() < nextWorkAt.getTime()),
  )
}

export interface SettleFailedDelegationAttemptDeps {
  logger: Logger
  queueLabel: string
  retryHint: string
  /** True for a failure that must NOT go round again whatever its message —
   *  the hard cap: the turn already ran a full budget, and a retry would burn
   *  another one on the same target's lock. Default false (the classifier
   *  decides). */
  neverRequeue?: boolean
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
  deps: SettleFailedDelegationAttemptDeps,
): void {
  const errorCode = extractEmbeddedErrorCode(errorMessage)
  const errorCodeOption = errorCode !== null ? { errorCode } : {}

  // A WORK turn that already delivered its final report must neither RE-RUN
  // (a requeue repeats the whole task and double-wakes the requester with a
  // second report) nor push a give-up ("it failed" — contradicting the result
  // they received). Terminal record + surfaced stamp, ONE transaction (a
  // crash between them left a failed-but-unsurfaced row the root narrated as
  // "couldn't complete" for work already reported): the requester HAS the
  // report, so the pull net must never re-inject this row as a failure. The
  // one exception is a reply the user was ADDRESSED with — a `direct_to_user`
  // answer, or any colleague reply (mention chains always deliver direct):
  // it ran no notify turn, so the net is how the root learns it was shown.
  if (hasDeliveredFinalReport(db, claimed)) {
    const replyAlreadyShownToUser =
      claimed.jobKind === 'agent-run' || finalReportWentDirect(db, claimed)
    withTransaction(db, (tx) => {
      const row = failDelegationJob(tx, claimed.id, errorMessage, new Date(), errorCodeOption)
      if (row !== null && !replyAlreadyShownToUser) {
        markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
      }
    })
    deps.logger.warn(
      { jobId: claimed.id, message: errorMessage },
      `${deps.queueLabel} turn failed AFTER its report was sent — recorded terminally (no requeue, no give-up push)`,
    )
    return
  }

  if (
    deps.neverRequeue !== true &&
    requeueIfRecoverable(db, claimed, errorMessage, deps.logger, deps.queueLabel)
  ) {
    return
  }

  const attemptCount = (claimed.attemptCount ?? 0) + 1
  if (failDelegationJob(db, claimed.id, errorMessage, new Date(), errorCodeOption) === null) {
    // Settled elsewhere (the lease sweeper already failed + pushed for it, or a
    // stop) — a second give-up push would contradict or duplicate that story.
    deps.logger.warn(
      { jobId: claimed.id, message: errorMessage },
      `${deps.queueLabel} turn failed after its claim was settled elsewhere — standing down`,
    )
    return
  }
  deps.logger.warn(
    { jobId: claimed.id, attemptCount, message: errorMessage },
    `${deps.queueLabel} job failed terminally`,
  )

  // Give-up push for WORK rows only, POSITIVELY (see the anti-cascade note
  // above): a failed delivery of either kind must never spawn another
  // delivery, a dropped update is deliberately terminal (ephemeral status,
  // persona-sessions), and a failed NOTE is communication nobody awaits —
  // pushing "your note failed" would manufacture the very tracking the kind
  // refuses. `isWorkJobKind` keeps the membership mechanical for future kinds.
  if (!isWorkJobKind(claimed.jobKind)) return
  try {
    // Push + surfaced-mark CO-COMMIT (invariant 5): the mark exists because
    // the push carries the story; one without the other either repeats the
    // failure next turn or loses it.
    withTransaction(db, (tx) => {
      enqueueJobFailureDelivery(
        tx,
        claimed,
        `The background task "${previewTaskText(claimed.taskText)}" failed` +
          `${attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}: ${errorMessage}. ` +
          `Tell the user it failed, and ${deps.retryHint}`,
      )
      markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
    })
  } catch (err) {
    // The failed row stays in the root catch-up net — the user still learns of
    // it on their next turn even when the push could not be enqueued.
    deps.logger.error(
      { err, jobId: claimed.id },
      `failed to enqueue the ${deps.queueLabel}-failure report`,
    )
  }
}

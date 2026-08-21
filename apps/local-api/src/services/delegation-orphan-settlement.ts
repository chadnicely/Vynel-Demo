// `settleOrphanedDelegationClaims` — ONE policy for a claimed job whose run is
// gone, applied by BOTH the delegation service's boot pass (every claimed row
// — nothing runs yet) and its lease sweeper (only claims whose lease lapsed —
// the run stopped heartbeating; session-hardening A2). By kind: the MESSAGE
// kinds (report / direct-delivery / note) requeue — the body is the only copy
// of what they say; WORK rows (task / agent-run) fail exactly-once, and each
// gets ONE honest failure delivery so the requester's "will report when done"
// promise is not broken by silence (persona-sessions restart parity).
// Delivery orphans stay silent (anti-cascade: a delivery must never spawn one)
// and an orphaned NOTE is communication nobody awaits — pushing "your note
// failed" would manufacture the tracking the kind refuses. A push failure
// never blocks the pass. Last, both readers reconcile the CHECKPOINT hand-over
// slots (`reconcileContinuationJobs`): a follow-up job that settled without
// ever claiming its checkpoint would otherwise hold the identity's slot
// forever — invisible to peek/take, never continued, never dropped.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  failOrphanedClaimedDelegations,
  isWorkJobKind,
  requeueOrphanedClaimedDeliveries,
  type OrphanedClaimScope,
} from '@vynel/orchestration'
import {
  composeReportWithAssistantNotes,
  enqueueJobFailureDelivery,
  previewTaskText,
  jobRetryHint,
  reconcileContinuationJobs,
} from '@vynel/session/delegation'

export function settleOrphanedDelegationClaims(
  db: Database,
  logger: Logger,
  scope: OrphanedClaimScope,
): { requeued: number; failed: number; releasedCheckpoints: number } {
  const cause = scope.onlyExpiredLeases === true ? 'lease-expired' : 'boot'
  const now = new Date()
  const requeued = requeueOrphanedClaimedDeliveries(db, now, scope)
  if (requeued.length > 0) {
    logger.warn(
      { requeued: requeued.length, cause },
      'delegation service: requeued orphaned "claimed" message deliveries (re-delivery is at-least-once; the message is the only copy)',
    )
  }
  const failed = failOrphanedClaimedDelegations(db, now, scope)
  if (failed.length > 0) {
    logger.warn(
      { failed: failed.length, cause },
      'delegation service: settled orphaned "claimed" work jobs as failed (a crash/restart or a lapsed lease left them mid-run)',
    )
  }
  for (const orphan of failed) {
    if (!isWorkJobKind(orphan.jobKind)) continue
    try {
      enqueueJobFailureDelivery(
        db,
        orphan,
        composeReportWithAssistantNotes({
          senderSentence:
            `Sorry — "${previewTaskText(orphan.taskText)}" was interrupted and didn't finish. ` +
            'The details are in the app.',
          assistantNotes:
            `The background task "${previewTaskText(orphan.taskText)}" was interrupted ` +
            `${cause === 'boot' ? 'by a restart' : 'when its run stopped responding'} and did not finish. ` +
            `Tell the user, and ${jobRetryHint(orphan)}`,
        }),
      )
    } catch (err) {
      logger.error(
        { err, jobId: orphan.id },
        'delegation service: failed to enqueue the failure delivery for an orphaned job',
      )
    }
  }
  // A settled job may have been holding an identity's checkpoint slot (a
  // follow-up that never reached its own claim) — release it visibly, here,
  // where both readers pass (audit r2 R2-H(d)).
  const releasedCheckpoints = reconcileContinuationJobs(db, { logger })
  return { requeued: requeued.length, failed: failed.length, releasedCheckpoints }
}

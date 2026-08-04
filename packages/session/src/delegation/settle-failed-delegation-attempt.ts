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
  enqueueReportDelivery,
  failDelegationJob,
  isDeliveryJobKind,
  markDelegationsSurfacedToRoot,
  resolveThreadIdOf,
  type DelegationJob,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { findWorkspaceById } from '@vynel/workspaces'
import { extractEmbeddedErrorCode, requeueIfRecoverable } from './classify-turn-failure.js'

/** The requester a job's reports address: its recorded originating-chat
 *  workspace when it still exists, else the global root. */
export function resolveJobReportRequester(
  db: Database,
  claimed: DelegationJob,
): ReportDeliveryRequester {
  if (claimed.requesterWorkspaceId !== null) {
    const workspace = findWorkspaceById(db, claimed.requesterWorkspaceId)
    if (workspace !== null && workspace.userId === claimed.userId) {
      return {
        kind: 'workspace-primary',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
      }
    }
  }
  return { kind: 'global-root' }
}

/** A failed (non-stopped) attempt: requeue if recoverable, else fail the row
 *  terminally and push a failure report to the requester. `retryHint` finishes
 *  the sentence "…it failed: <error>. Tell the user it failed, and <hint>". */
export function settleFailedDelegationAttempt(
  db: Database,
  claimed: DelegationJob,
  errorMessage: string,
  deps: { logger: Logger; queueLabel: string; retryHint: string },
): void {
  if (requeueIfRecoverable(db, claimed, errorMessage, deps.logger, deps.queueLabel)) return

  const attemptCount = (claimed.attemptCount ?? 0) + 1
  failDelegationJob(db, claimed.id, errorMessage, new Date(), {
    ...(extractEmbeddedErrorCode(errorMessage) !== null
      ? { errorCode: extractEmbeddedErrorCode(errorMessage)! }
      : {}),
  })
  deps.logger.warn(
    { jobId: claimed.id, attemptCount, message: errorMessage },
    `${deps.queueLabel} job failed terminally`,
  )

  // Give-up push for WORK rows only (see the anti-cascade note above) — a
  // failed delivery of EITHER kind must never spawn another delivery, and a
  // dropped update is deliberately terminal (ephemeral status, persona-sessions).
  if (isDeliveryJobKind(claimed.jobKind)) return
  try {
    const taskPreview =
      claimed.taskText.length > 160 ? `${claimed.taskText.slice(0, 160)}…` : claimed.taskText
    const threadId = resolveThreadIdOf(claimed)
    enqueueReportDelivery(db, {
      ...(threadId !== null ? { threadId } : {}),
      userId: claimed.userId,
      reporterSessionId:
        claimed.targetPrimarySessionId ?? claimed.workspaceId ?? claimed.parentSessionId,
      reporterLabel: claimed.workspaceName ?? 'Background task',
      reportBody:
        `The background task "${taskPreview}" failed` +
        `${attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}: ${errorMessage}. ` +
        `Tell the user it failed, and ${deps.retryHint}`,
      requester: resolveJobReportRequester(db, claimed),
    })
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

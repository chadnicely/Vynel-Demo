// `settleCompletedTask` — the terminal bookkeeping of a TASK/NOTE job whose
// turn COMPLETED (split from the tick, session-hardening A6, behaviour-neutral):
// the channel distill + delivery, the complete + surfaced co-commit, and the
// checkpoint continuation. Everything here is best-effort past the completion
// write: a finished turn can never flip to failed.

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  completeDelegationJob,
  markDelegationsSurfacedToRoot,
  type DelegationJob,
} from '@vynel/orchestration'
import { enqueueChannelReply } from '@vynel/channels'
import type { AiAgentProvider } from '@vynel/providers'
import { finalReportWentDirect } from './settle-failed-delegation-attempt.js'
import { enqueueCheckpointContinuation } from './enqueue-checkpoint-continuation.js'
import { resolveDeliverableOrigin } from './resolve-task-target.js'

// A report at or under this length is already user-sized — deliver it as-is and skip
// the distill call (no wasted tokens on "Done, the file is fixed."-class reports).
const REPORT_DISTILL_MIN_LENGTH = 700

export interface SettleCompletedTaskInput {
  /** The turn's clean reply — the row's resultText. */
  result: string
  /** True for a 'note' row (never work: no direct-path exception, no report). */
  isNote: boolean
  /** The run cwd (the distill's workspacePath). */
  runCwdPath: string
  /** The target's display name (the distill speaks as it). */
  targetName: string
}

export async function settleCompletedTask(
  db: Database,
  deps: { provider: Pick<AiAgentProvider, 'summarizeReport'>; logger: Logger },
  claimed: DelegationJob,
  input: SettleCompletedTaskInput,
): Promise<void> {
  // Resolved FRESH at completion (not the claim-time resolve) — the channel may have
  // changed mid-run. Shared by the distill target below and the delivery further down.
  const reportOrigin =
    claimed.originChannelId !== null ? resolveDeliverableOrigin(db, claimed) : null

  // The distill serves the CHANNEL delivery ONLY (session-comms pipeline,
  // Chad locked 2026-07-27: the chat reply is never captured as a report —
  // reports travel exclusively via send_message). A channel user still
  // gets a short reply in the manager's voice; without a driving channel
  // there is nothing to distill FOR, so skip the model call entirely.
  // Fail-open: a failed/unsupported distill (or an already-short reply)
  // delivers the full text — the channel user never loses the answer.
  let userReply = input.result
  if (reportOrigin !== null && input.result.length > REPORT_DISTILL_MIN_LENGTH) {
    // The contract says never-throw, but fail-open must not depend on a
    // provider honoring it — a distill throw would otherwise fail a
    // COMPLETED job through the outer catch, losing the user's answer.
    const distilled = await deps.provider
      .summarizeReport({
        workspacePath: input.runCwdPath,
        taskText: claimed.taskText,
        reportText: input.result,
        // For a session target: the session's name (v1 — the distill and the
        // label both speak as the session).
        workspaceName: input.targetName,
        deliveryTarget: reportOrigin?.channel.channelKind ?? 'chat',
        logger: deps.logger,
      })
      .catch((err: unknown) => {
        deps.logger.warn({ err, jobId: claimed.id }, 'delegation report distill threw')
        return null
      })
    if (distilled !== null && distilled.length > 0) userReply = distilled
    else {
      deps.logger.warn(
        { jobId: claimed.id },
        'delegation report distill unavailable — delivering the full report',
      )
    }
  }

  // NO HARVEST (session-comms pipeline, Chad locked 2026-07-27, reversing
  // the earlier silence-is-worse stance): the chat reply is NEVER captured
  // and delivered as a report — reports travel exclusively via the
  // send_message tool, sent deliberately by the one who did the work. The
  // reply still lives on the job row (resultText — the trace/status truth)
  // and in the child's own transcript, one Watch-click away.
  //
  // complete + mark-surfaced CO-COMMIT (invariant 5): completed rows are
  // ALWAYS surfaced now — the root's catch-up net injects resultText,
  // which would be the capture leaking back through another door. A
  // silent child therefore delivers nothing; the chip settles and
  // get_delegated_task answers status pulls. FAILED rows keep the
  // catch-up: a failure note is status, not capture, and the root must
  // learn the task died. ONE exception (kind `direct_to_user`): a final
  // answer that went straight to the user runs NO notify turn, so the row
  // stays UNSURFACED — the net is how the root learns it (presented
  // "already shown — absorb silently", never an echo).
  // A NOTE never travels the direct path: it is always surfaced at
  // completion, so the root's catch-up can never narrate a peer's note
  // back as if it were a result.
  const wentDirect = input.isNote ? false : finalReportWentDirect(db, claimed)
  try {
    withTransaction(db, (tx) => {
      completeDelegationJob(tx, claimed.id, input.result, new Date())
      if (!wentDirect) markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
    })
  } catch (completionErr) {
    deps.logger.warn(
      { err: completionErr, jobId: claimed.id },
      'delegation completion co-commit failed — completing alone',
    )
    completeDelegationJob(db, claimed.id, input.result, new Date())
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
  try {
    enqueueCheckpointContinuation(db, claimed, { logger: deps.logger })
  } catch (err) {
    deps.logger.warn(
      { err, jobId: claimed.id },
      'failed to enqueue the checkpoint continuation (the job is still completed)',
    )
  }

  // Ch4 (channel-aware OUTPUT): if a CHANNEL drove this delegation, deliver the reply
  // back to that channel — closing the loop (channel → root → delegate → report → channel).
  // KEPT AT TASK COMPLETION (session-comms channel-delivery choice — the smaller safe
  // change): the channel user gets the distilled report immediately, on the path that is
  // already pinned end-to-end; the notify turn above is the chat/awareness path only and
  // never re-sends to channels (its steer says so). Best-effort: the job already
  // completed, so a delivery failure is logged, never re-fails the job.
  if (claimed.originChannelId !== null) {
    try {
      if (reportOrigin !== null) {
        enqueueChannelReply(db, {
          channel: reportOrigin.channel,
          message: {
            externalSenderId: reportOrigin.externalRecipientId,
            externalChatContextId: reportOrigin.externalChatContextId,
          },
          body: userReply,
        })
      } else {
        deps.logger.warn(
          { jobId: claimed.id, channelId: claimed.originChannelId },
          'delegation report channel delivery skipped — origin channel gone, disabled, or not owned',
        )
      }
    } catch (err) {
      deps.logger.warn(
        { err, jobId: claimed.id },
        'delegation report channel delivery failed (the job is still completed)',
      )
    }
  }

  deps.logger.info(
    { jobId: claimed.id, resultPreview: userReply.slice(0, 120) },
    input.isNote
      ? 'note: delivered — the target absorbed it in its own turn'
      : 'delegation: completed — report delivery enqueued for the creator conversation',
  )
}

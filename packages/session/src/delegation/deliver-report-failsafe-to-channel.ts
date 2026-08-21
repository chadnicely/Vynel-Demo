// THE LAST RESORT (channel report protocol, Kafi 2026-08-22) — ONE home for the
// decision "report delivery itself died, and somebody on a channel is still
// waiting".
//
// The protocol is: the delegate reports to its requester, and the requester's
// notify turn answers the channel. That has one failure mode the protocol cannot
// fix from inside — the notify turn never completes (it errors, caps out on
// every attempt, or its requester conversation cannot be reached). The report
// body is the only copy of the result at that point, so rather than let the
// sender hear nothing, the engine ships it to the channel directly.
//
// DELIBERATELY NOT DISTILLED. Task completion used to run a `summarizeReport`
// call before shipping to the channel; this path fires when the machinery is
// already failing, and a provider round trip is one more thing to fail. The
// report body goes out as written, trimmed to the tightest channel limit.
//
// Fires ONLY on a TERMINAL failure of a delivery row that carries an origin
// channel — never on a requeue (the next attempt may well succeed, and two
// copies of one answer is its own bug).

import type { Database } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'
import type { DelegationJob } from '@vynel/orchestration'
import { enqueueChannelReply } from '@vynel/channels'
import { resolveDeliverableOrigin } from './resolve-task-target.js'

// Telegram rejects a message over 4096 characters outright; no adapter splits
// today, so the failsafe stays inside the tightest limit rather than trading
// silence for a delivery failure.
const CHANNEL_MESSAGE_LIMIT = 4096

/** Ship a terminally-undelivered report to the channel that asked for the work.
 *  Returns true if a line was queued. Best-effort by contract — the caller has
 *  already settled the row and must not fail it again over this. */
export function deliverReportFailsafeToChannel(
  db: Database,
  claimed: DelegationJob,
  deps: { logger: StructuralLogger },
): boolean {
  if (claimed.originChannelId === null) return false
  const origin = resolveDeliverableOrigin(db, claimed)
  if (origin === null) {
    deps.logger.warn(
      { jobId: claimed.id, channelId: claimed.originChannelId },
      'report-delivery failsafe skipped — the origin channel is gone, disabled, or not owned',
    )
    return false
  }
  const body = claimed.taskText.trim()
  if (body === '') return false
  try {
    enqueueChannelReply(db, {
      channel: origin.channel,
      message: {
        externalSenderId: origin.externalRecipientId,
        externalChatContextId: origin.externalChatContextId,
      },
      body:
        body.length <= CHANNEL_MESSAGE_LIMIT
          ? body
          : `${body.slice(0, CHANNEL_MESSAGE_LIMIT - 1)}…`,
    })
  } catch (err) {
    deps.logger.error(
      { err, jobId: claimed.id },
      'report-delivery failsafe could not be enqueued — the channel sender hears nothing',
    )
    return false
  }
  deps.logger.warn(
    { jobId: claimed.id, channelId: claimed.originChannelId },
    'report delivery failed terminally — shipped the report to the origin channel as a last resort',
  )
  return true
}

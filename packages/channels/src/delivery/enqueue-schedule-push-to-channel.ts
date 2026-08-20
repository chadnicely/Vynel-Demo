// The ONE home for a schedule's PUSH onto a channel — the outbound row shape
// every schedule-originated channel message wears. Two legs enqueue through
// it: a fired schedule's result (`consume-schedule-run-completed-event.ts`)
// and a missed slot's notice (`enqueue-missed-schedule-channel-notice.ts`).
//
// WHY one home: the two legs differ only in the words they push. Everything
// else — who receives it, the pending/retry columns, the `scheduled-message`
// payload kind — is the same decision, and a second copy of it drifts the
// moment either leg gains a column.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'

export interface SchedulePushToChannelInput {
  channelId: string
  /** The finished text, composed by the caller — enqueued verbatim. */
  messageBody: string
}

/** Queue one schedule push to the channel's owner. A removed or paused
 *  channel, or one with nobody on its allowlist, drops quietly — there is
 *  nobody to tell and a schedule must not fail over it. sync. */
export function enqueueSchedulePushToChannel(
  db: Database,
  input: SchedulePushToChannelInput,
): void {
  const channel = channelsRepository.findChannelById(db, input.channelId)
  if (!channel || !channel.isEnabled) return

  // A schedule notice is a push TO the user, so the recipient is the
  // channel's first allowed sender (the owner).
  const recipient = channelsRepository.listAllowedSenders(db, channel.id)[0]
  if (!recipient) return

  const now = new Date()
  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalRecipientId: recipient.externalSenderId,
    externalChatContextId: recipient.scopeContextId ?? recipient.externalSenderId,
    messageBody: input.messageBody,
    messageStructure: JSON.stringify({ parseMode: 'plain' }),
    payloadKind: 'scheduled-message',
    status: 'pending',
    statusMessage: null,
    attemptCount: 0,
    lastAttemptedAt: null,
    nextAttemptAt: now,
    externalSentMessageId: null,
    enqueuedAt: now,
    sentAt: null,
  })
}

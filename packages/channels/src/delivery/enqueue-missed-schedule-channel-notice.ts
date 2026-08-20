// The CHANNEL leg of a missed schedule slot (schedule-gaps G1). A schedule
// whose destination is chat-and-channel pushes every fire to its channel; a
// slot Vynel was not running for is exactly the moment the user is waiting on
// that channel for something that never arrived — so it says so there too.
//
// Not a second "consumer": `schedule.run-missed` has ONE registry entry (core's
// only composite) that calls the chat notice and this. `schedules` never writes
// into channels' tables — it publishes the event; this reacts. sync.

import { randomUUID } from 'node:crypto'
import { composeMissedScheduleNotice } from '@vynel/contracts/schedules/missed-schedule-notice'
import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'

// The fields of the `schedule.run-missed` payload this leg reads — the loose
// cross-domain contract, re-declared field-for-field with the producer.
export interface MissedScheduleChannelNoticeInput {
  /** The channel to tell. Null (chat-only, or none bound) never reaches here. */
  channelId: string
  scheduleDisplayName: string
  missedAtLocal: string
  nextFireAtLocal: string | null
}

export function enqueueMissedScheduleChannelNotice(
  db: Database,
  input: MissedScheduleChannelNoticeInput,
): void {
  const channel = channelsRepository.findChannelById(db, input.channelId)
  if (!channel || !channel.isEnabled) return // removed/paused channel — drop quietly

  // A schedule notice is a push TO the user: the channel's first allowed
  // sender (the owner) — the same recipient a fired schedule's result gets.
  const recipient = channelsRepository.listAllowedSenders(db, channel.id)[0]
  if (!recipient) return

  const now = new Date()
  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalRecipientId: recipient.externalSenderId,
    externalChatContextId: recipient.scopeContextId ?? recipient.externalSenderId,
    // The SAME words the chat notice carries (one home, in contracts).
    messageBody: composeMissedScheduleNotice({
      scheduleDisplayName: input.scheduleDisplayName,
      missedAtLocal: input.missedAtLocal,
      nextFireAtLocal: input.nextFireAtLocal,
    }),
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

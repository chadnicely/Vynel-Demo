// The `schedule.run-completed` outbox CONSUMER (the locked schedules ↔
// channels contract — §9). When `schedules` publishes a fired schedule
// destined for a channel, channels enqueues a `scheduled-message` outbound
// row to the channel's owner. `schedules` NEVER writes into channels'
// tables — it publishes the event; this function reacts. sync.
//
// SCOPE (OQ-5 / D19): this domain owns ONLY the consumer function + the
// payload shape + the `scheduled-message` payload kind. The generic outbox
// DISPATCH/RELAY (unprocessed-query + mark-processed + the poll-and-invoke
// loop + the event-type→consumer registry) is shared infrastructure wired
// when `schedules` builds — it is deliberately NOT fabricated here (no such
// infra exists on disk yet; inventing it would trip the "don't invent
// cross-cutting infra" Gate-1).
//
// Spec: `docs/blueprints/channels/blueprint.md §9`.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelUserLink } from '../repositories/index.js'

// Field-for-field the payload `schedules` publishes (the 📅 header is baked
// into `renderedOutput`; channels enqueues it verbatim).
export interface ScheduleRunCompletedPayload {
  scheduleId: string
  userId: string
  workspaceId: string
  channelId: string
  // The chat session the fired turn produced — carried for traceability, not
  // used for delivery. Null for a verbatim reminder (no LLM turn, no session).
  chatSessionId: string | null
  renderedOutput: string
  firedAt: string // ISO
}

// A fired schedule is a push TO the user, so the recipient is the channel's
// first allowed sender (the owner).
function resolveScheduleRecipient(db: Database, channel: Channel): ChannelUserLink | null {
  const senders = channelsRepository.listAllowedSenders(db, channel.id)
  return senders[0] ?? null
}

export function consumeScheduleRunCompletedEvent(
  db: Database,
  payload: ScheduleRunCompletedPayload,
): void {
  const channel = channelsRepository.findChannelById(db, payload.channelId)
  if (!channel || !channel.isEnabled) return // schedule targets a removed/paused channel — drop quietly

  const recipient = resolveScheduleRecipient(db, channel)
  if (!recipient) return

  const now = new Date()
  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalRecipientId: recipient.externalSenderId,
    externalChatContextId: recipient.scopeContextId ?? recipient.externalSenderId,
    messageBody: payload.renderedOutput,
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

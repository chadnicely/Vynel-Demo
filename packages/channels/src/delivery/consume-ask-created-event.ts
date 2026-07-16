// The `ask.created` outbox CONSUMER (the asks ↔ channels loose contract).
// When `asks` records a pending ask_user form, channels enqueues a plain-
// language NUDGE to the user's channel — "Claude needs your input" — so a
// user away from the app knows a turn is waiting on them. The ANSWER stays
// in-app (v1); this is notification only. `asks` never writes into channels'
// tables — it publishes the event; this function reacts. sync.
//
// Channel resolution: the ask's own workspace channel first, then a global
// (null-workspace) channel, then any other enabled channel the user has —
// disabled channels never nudge. No channel at all → drop quietly (the
// in-app notifier is still there).

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelUserLink } from '../repositories/index.js'

// Field-for-field the payload `asks` publishes (the loose cross-domain
// contract — re-declared here like ScheduleRunCompletedPayload).
export interface AskCreatedPayload {
  askId: string
  userId: string
  workspaceId: string | null // null = a global-root turn's ask
  questionCount: number
  firstQuestionLabel: string
  createdAt: string // ISO
}

function resolveNudgeChannel(db: Database, payload: AskCreatedPayload): Channel | null {
  const enabled = channelsRepository
    .listChannelsForUser(db, payload.userId)
    .filter((channel) => channel.isEnabled)
  return (
    enabled.find((channel) => channel.workspaceId === payload.workspaceId) ??
    enabled.find((channel) => channel.workspaceId === null) ??
    enabled[0] ??
    null
  )
}

// A nudge is a push TO the user, so the recipient is the channel's first
// allowed sender (the owner) — the scheduled-message precedent.
function resolveNudgeRecipient(db: Database, channel: Channel): ChannelUserLink | null {
  const senders = channelsRepository.listAllowedSenders(db, channel.id)
  return senders[0] ?? null
}

export function consumeAskCreatedEvent(db: Database, payload: AskCreatedPayload): void {
  const channel = resolveNudgeChannel(db, payload)
  if (!channel) return

  const recipient = resolveNudgeRecipient(db, channel)
  if (!recipient) return

  const remainder = payload.questionCount - 1
  const messageBody =
    `🙋 Claude needs your input: ${payload.firstQuestionLabel}` +
    (remainder > 0 ? ` (+${remainder} more question${remainder === 1 ? '' : 's'})` : '') +
    ' — open Vynel to answer.'

  const now = new Date()
  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalRecipientId: recipient.externalSenderId,
    externalChatContextId: recipient.scopeContextId ?? recipient.externalSenderId,
    messageBody,
    messageStructure: JSON.stringify({ parseMode: 'plain' }),
    payloadKind: 'ask-nudge',
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

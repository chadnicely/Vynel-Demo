// `channel_message_queue` table for the `channels` domain — outbound
// messages awaiting delivery (handles offline / rate limits / capped
// retries). The single egress for chat replies, approvals, status
// updates, AND fired schedules (payloadKind 'scheduled-message').
//
// Spec: `docs/blueprints/channels/blueprint.md §3.4`.
//
// `attemptCount` uses the plain `integer()` dialect helper. Capped
// exponential backoff [1s,5s,30s,5m,30m] then failed-give-up after the
// 6th attempt (coding.md §1.5).

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { channels } from './channels.js'

export type OutboundPayloadKind =
  | 'chat-stream-final' // the buffered assistant reply for a turn (Phase 1: one message at completion)
  | 'approval-request' // surfacing an approval
  | 'approval-resolved' // post-resolution confirmation
  | 'status-update' // error / "timed out" notices
  | 'scheduled-message' // a fired schedule's rendered output (schedules contract, §9)
  | 'ask-nudge' // "Claude needs your input" — an ask went pending (asks contract; answer stays in-app)

export type OutboundMessageStatus =
  | 'pending' // not yet attempted
  | 'sending' // delivery loop has it; in-flight
  | 'sent' // successfully delivered
  | 'failed-retry' // failed; will retry per backoff
  | 'failed-give-up' // failed too many times; abandoned

export const channelMessageQueue = table(
  'channel_message_queue',
  {
    id: id().primaryKey(),
    channelId: id().references(() => channels.id, { onDelete: 'cascade' }),
    externalRecipientId: text().notNull(), // replies go back to who sent
    externalChatContextId: text().notNull(),
    messageBody: text().notNull(), // text content (may contain product emoji)
    messageStructure: text().notNull(), // JSON: buttons, reply_to, parseMode
    payloadKind: text().$type<OutboundPayloadKind>().notNull(),
    status: text().$type<OutboundMessageStatus>().notNull(),
    statusMessage: text(),
    attemptCount: integer().notNull(),
    lastAttemptedAt: timestamp(),
    nextAttemptAt: timestamp().notNull(), // retry backoff anchor
    externalSentMessageId: text(), // set on successful send
    enqueuedAt: timestamp().notNull(),
    sentAt: timestamp(),
  },
  (t) => ({
    readyIdx: index('idx_channel_queue_ready').on(t.status, t.nextAttemptAt),
    channelChatIdx: index('idx_channel_queue_channel_chat').on(
      t.channelId,
      t.externalChatContextId,
      t.enqueuedAt,
    ),
  }),
)

export type ChannelMessageQueueEntry = typeof channelMessageQueue.$inferSelect
export type NewChannelMessageQueueEntry = typeof channelMessageQueue.$inferInsert

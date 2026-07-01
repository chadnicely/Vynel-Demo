// `channel_inbound_messages` table for the `channels` domain — inbound
// messages received from the channel, with a claim-based status
// lifecycle (pending -> routed -> completed/failed/ignored).
//
// Spec: `docs/blueprints/channels/blueprint.md §3.3`.
//
// `routedToChatSessionId` / `routedToApprovalRequestId` are LOOSE
// cross-system `text()` refs — NOT FKs — because the chat session /
// approval row live in other domains' tables; a real FK + cross-schema
// import would couple channels to those schema files (data-standard.md
// "Cross-domain communication"). The claim (pending -> routed) is what
// makes concurrent processing safe (coding.md §1.2).

import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { channels } from './channels.js'

export type InboundIntentKind =
  | 'chat-turn' // a regular message that becomes a chat turn
  | 'approval-reply' // matches a pending approval (approve / deny <reason>)
  | 'channel-command' // /help, /status, /sessions — Phase 1.5
  | 'ignored' // from a non-allowed sender; logged but not processed

export type InboundMessageStatus =
  | 'pending' // received, not yet claimed for processing
  | 'routed' // CLAIMED + handed off to chat or approvals (in-flight)
  | 'completed' // routing's downstream work finished (chat turn ended)
  | 'failed' // processing errored; statusMessage explains
  | 'ignored' // sender not in allowlist

export const channelInboundMessages = table(
  'channel_inbound_messages',
  {
    id: id().primaryKey(),
    channelId: id().references(() => channels.id, { onDelete: 'cascade' }),
    externalMessageId: text().notNull(), // channel-assigned message ID
    externalSenderId: text().notNull(),
    externalChatContextId: text().notNull(), // chat/conversation ID in the channel
    messageBody: text().notNull(),
    messageMetadata: text().notNull(), // JSON: attachments, reply-to, etc.
    intentKind: text().$type<InboundIntentKind>().notNull(),
    routedToChatSessionId: text(), // loose cross-system ref (NOT a FK)
    routedToApprovalRequestId: text(), // provider request id; cross-system (NOT a FK)
    status: text().$type<InboundMessageStatus>().notNull(),
    statusMessage: text(),
    receivedAt: timestamp().notNull(),
    processedAt: timestamp(),
  },
  (t) => ({
    channelStatusIdx: index('idx_channel_inbound_channel_status').on(t.channelId, t.status),
    pendingIdx: index('idx_channel_inbound_pending').on(t.status, t.receivedAt),
    // UNIQUE — the dedup mechanism (channel APIs redeliver across reconnects;
    // each externalMessageId is accepted once per channel).
    externalUniqueIdx: uniqueIndex('uniq_channel_inbound_external').on(
      t.channelId,
      t.externalMessageId,
    ),
    // The one growth-scaling history list (§6 GET /:channelId/history),
    // keyset-paginated on (channelId, receivedAt DESC, id DESC).
    historyKeysetIdx: index('idx_channel_inbound_history').on(t.channelId, t.receivedAt, t.id),
  }),
)

export type ChannelInboundMessage = typeof channelInboundMessages.$inferSelect
export type NewChannelInboundMessage = typeof channelInboundMessages.$inferInsert

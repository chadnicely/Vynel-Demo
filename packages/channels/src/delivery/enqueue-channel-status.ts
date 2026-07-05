// `enqueueChannelStatus` — queue a short status/notice back to a channel sender
// (an error apology, a "timed out" notice, an approval confirmation). The single
// home for the "status message" outbound shape: the inbound routers
// (route-as-chat-turn's failure path, route-as-approval-reply's every branch)
// all enqueue through here, and the 2s delivery tick ships it via the adapter.
//
// Distinct from `enqueueChannelReply` (a successful assistant turn reply,
// `payloadKind: 'chat-stream-final'`): a status defaults to `'status-update'`
// — "error / timed out notices" per the OutboundPayloadKind union. Plain text
// (`parseMode: 'plain'`) — safe against Telegram Markdown-escaping pitfalls.

import { randomUUID } from 'node:crypto'
import { insertOutboundMessage } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type {
  Channel,
  ChannelInboundMessage,
  OutboundPayloadKind,
} from '../repositories/index.js'

export interface EnqueueChannelStatusContext {
  channel: Channel
  /** The inbound message being reacted to — its sender + chat context are the delivery address. */
  message: Pick<ChannelInboundMessage, 'externalSenderId' | 'externalChatContextId'>
}

export function enqueueChannelStatus(
  db: Database,
  context: EnqueueChannelStatusContext,
  body: string,
  payloadKind: OutboundPayloadKind = 'status-update',
): void {
  const now = new Date()
  insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: context.channel.id,
    externalRecipientId: context.message.externalSenderId,
    externalChatContextId: context.message.externalChatContextId,
    messageBody: body,
    messageStructure: JSON.stringify({ parseMode: 'plain' }),
    payloadKind,
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

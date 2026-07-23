// `enqueueChannelReply` — queue a plain-text reply to a channel sender (brain-tree Ch4). The
// outbound primitive the channel-aware loop delivers through: the global-root turn's direct
// answer (route-as-chat-turn) and, later, a delegation's report (the claim-and-run tick) both
// enqueue here, and the existing 2s delivery tick ships it via the adapter. The reply goes back
// to WHO asked (`externalSenderId`) in the conversation they asked from (`externalChatContextId`).
//
// `payloadKind: 'chat-stream-final'` — the kind for "the buffered assistant reply for a turn"; a
// global-root turn IS a turn, delivered as one message at completion. Plain text (no parseMode):
// safe against Telegram Markdown-escaping pitfalls — functionality first.

import { randomUUID } from 'node:crypto'
import { insertOutboundMessage } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'

export interface EnqueueChannelReplyInput {
  channel: Channel
  /** The inbound message being replied to — its sender + chat context are the delivery address. */
  message: Pick<ChannelInboundMessage, 'externalSenderId' | 'externalChatContextId'>
  body: string
  /** Thread the reply onto this message (group rooms — the answer must
   *  visibly attach to whoever asked). Absent = a plain send (DMs). */
  replyToExternalMessageId?: string
}

export function enqueueChannelReply(db: Database, input: EnqueueChannelReplyInput): void {
  insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: input.channel.id,
    externalRecipientId: input.message.externalSenderId,
    externalChatContextId: input.message.externalChatContextId,
    messageBody: input.body,
    messageStructure:
      input.replyToExternalMessageId !== undefined
        ? JSON.stringify({ replyToExternalMessageId: input.replyToExternalMessageId })
        : '{}', // plain text — no buttons/parseMode
    payloadKind: 'chat-stream-final',
    status: 'pending',
    statusMessage: null,
    attemptCount: 0,
    lastAttemptedAt: null,
    nextAttemptAt: new Date(),
    externalSentMessageId: null,
    enqueuedAt: new Date(),
    sentAt: null,
  })
}

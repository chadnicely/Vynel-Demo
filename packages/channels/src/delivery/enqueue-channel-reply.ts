// `enqueueChannelReply` — queue a plain-text reply to a channel sender (brain-tree Ch4). The
// outbound primitive the channel-aware loop delivers through: the reply_to_channel tool's op
// (replyToChannelOrigin — the model's own deliberate reply, the channel pipeline locked
// 2026-07-27), a delegation's report (the claim-and-run tick's channel block), and the proactive
// send_to_channel all enqueue here; the existing 2s delivery tick ships it via the adapter. The
// reply goes to the conversation that asked (`externalChatContextId` is the address; the
// adapter sends by chat context, never by recipient id).
//
// `payloadKind: 'chat-stream-final'` — the kind for "the buffered assistant reply for a turn"; a
// global-root turn IS a turn, delivered as one message at completion. Plain text (no parseMode):
// safe against Telegram Markdown-escaping pitfalls — functionality first.

import { randomUUID } from 'node:crypto'
import { insertOutboundMessage } from '../repositories/index.js'
import { buildOutboundMessageStructure } from '../schema/channel-message-queue.js'
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
  /** The TURN this reply answers for (channel report protocol) — recorded on
   *  the row so the zero-reply fallback counts only its own turn's replies.
   *  Absent for a queue outside a turn (a proactive push, a failsafe). */
  turnCorrelationId?: string
}

export function enqueueChannelReply(db: Database, input: EnqueueChannelReplyInput): void {
  insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: input.channel.id,
    externalRecipientId: input.message.externalSenderId,
    externalChatContextId: input.message.externalChatContextId,
    messageBody: input.body,
    // Plain text — no buttons/parseMode; the blob carries only routing facts.
    messageStructure: buildOutboundMessageStructure({
      ...(input.replyToExternalMessageId !== undefined
        ? { replyToExternalMessageId: input.replyToExternalMessageId }
        : {}),
      ...(input.turnCorrelationId !== undefined
        ? { turnCorrelationId: input.turnCorrelationId }
        : {}),
    }),
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

// `replyToChannelOrigin` — the channel turn's REPLY path (the `reply_to_channel`
// MCP tool; channel pipeline, Chad locked 2026-07-27). The model calls the tool
// with NOTHING but its answer; WHERE it goes — which channel, which sender,
// group room or DM, and the group message to thread onto — is the AMBIENT
// origin the server stamped on the turn (the delegation-origin-header pattern:
// a mis-addressed message is unrecoverable once enqueued, so the address is
// never model input). The reply lands exactly where the request came from.
//
// AUTO (uncarded) — replying to the conversation that just asked is the point
// of the turn, the same risk posture as the old automatic reply it replaces.

import type { Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { findChannelById } from '../repositories/index.js'
import { enqueueChannelReply } from './enqueue-channel-reply.js'

export interface ReplyToChannelOriginInput {
  userId: string
  /** The turn's server-stamped origin — who asked, from where. */
  origin: {
    channelId: string
    externalSenderId: string
    externalChatContextId: string
    /** Present for GROUP messages — the reply threads onto the asking message. */
    externalMessageId?: string
  }
  body: string
}

/** Returns the channel's display name — the tool's "deliveredTo" answer. */
export function replyToChannelOrigin(db: Database, input: ReplyToChannelOriginInput): string {
  const channel = findChannelById(db, input.origin.channelId)
  // userId guard — never deliver through a channel another user owns.
  if (!channel || channel.userId !== input.userId) {
    throw new NotFoundError('channel', input.origin.channelId)
  }
  if (!channel.isEnabled) {
    throw new ValidationError(
      'This channel was disabled after the message arrived — the reply cannot be delivered.',
    )
  }
  enqueueChannelReply(db, {
    channel,
    message: {
      externalSenderId: input.origin.externalSenderId,
      externalChatContextId: input.origin.externalChatContextId,
    },
    body: input.body,
    ...(input.origin.externalMessageId !== undefined
      ? { replyToExternalMessageId: input.origin.externalMessageId }
      : {}),
  })
  return channel.displayName
}

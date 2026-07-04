// `sendToChannel` — the global root's PROACTIVE channel push (brain-tree Ch4 §D,
// the `send_to_channel` MCP tool). Resolves + ownership-guards the channel,
// resolves the recipient (the channel's first allowed sender — the owner; a
// proactive push has NO inbound origin, so `senders[0]` is right, like
// `resolveScheduleRecipient`), and enqueues the message; the existing 2s delivery
// tick ships it.
//
// AUTO (uncarded) in Phase 1 — consistent with the channel auto-reply, which already
// messages the user's own channels without approval (a proactive send to the user's
// OWN channels is not a new risk category). A per-send approval card is a deferred
// follow-up that needs a global-root approval surface (completion plan Item 1).

import { findChannelById, listAllowedSenders } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { enqueueChannelReply } from './enqueue-channel-reply.js'

export interface SendToChannelInput {
  userId: string
  channelId: string
  body: string
}

export function sendToChannel(db: Database, input: SendToChannelInput): void {
  const channel = findChannelById(db, input.channelId)
  // userId guard — never leak/send to a channel another user owns (the Ch4 M2 lesson).
  if (!channel || channel.userId !== input.userId) {
    throw new NotFoundError('channel', input.channelId)
  }
  if (!channel.isEnabled) {
    throw new ValidationError('This channel is disabled. Enable it before sending a message.')
  }
  const [recipient] = listAllowedSenders(db, channel.id)
  if (!recipient) {
    throw new ValidationError(
      'This channel has no allowed recipient to deliver to. Add an allowed sender to it first.',
    )
  }
  enqueueChannelReply(db, {
    channel,
    message: {
      externalSenderId: recipient.externalSenderId,
      externalChatContextId: recipient.scopeContextId ?? recipient.externalSenderId,
    },
    body: input.body,
  })
}

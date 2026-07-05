// Surface an approval into the channel: enqueue an outbound `approval-request`
// message (with inline ✅/❌ buttons whose payloads carry the explicit
// approvalRequestId). One home for the outbound-card build, serving BOTH producers:
//   - a channel-driven CHAT TURN (`enqueueApprovalRequest`): full inbound context —
//     the card replies to the triggering message, and the pending approval id is
//     recorded on that inbound so a typed "approve"/"deny" from the same sender
//     correlates (§5.7 text path);
//   - a channel-origin DELEGATION (`enqueueApprovalRequestForRecipient`): only the
//     job's origin address exists (no inbound row) — buttons carry the explicit id,
//     so a tap always correlates; a typed reply has nothing to stamp (noted improve).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.7`.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { summarizeApprovalForChannel } from './summarize-approval-for-channel.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type { NormalizedMessageStructure } from '../channels-types.js'

/** The card's substance — what both producers share. */
export interface ChannelApprovalCard {
  approvalRequestId: string
  toolName: string
  toolInput: unknown
  /** The workspace acting — shown on a routed delegation's card ("Write — in vynel").
   *  Absent for a brain-turn card (no workspace). */
  workspaceName?: string
}

function insertApprovalRequestOutbound(
  db: Database,
  input: {
    channel: Channel
    externalRecipientId: string
    externalChatContextId: string
    replyToExternalMessageId?: string
    card: ChannelApprovalCard
  },
): void {
  const adapter = resolveChannelAdapter(input.channel.channelKind)
  const summary = summarizeApprovalForChannel(input.card)

  const structure: NormalizedMessageStructure = {
    ...(input.replyToExternalMessageId !== undefined
      ? { replyToExternalMessageId: input.replyToExternalMessageId }
      : {}),
    parseMode: 'plain',
  }
  if (adapter.supportsInlineButtons()) {
    structure.inlineButtons = [
      { label: '✅ Approve', payload: `approval:approve:${input.card.approvalRequestId}` },
      { label: '❌ Deny', payload: `approval:deny:${input.card.approvalRequestId}` },
    ]
  }

  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: input.channel.id,
    externalRecipientId: input.externalRecipientId,
    externalChatContextId: input.externalChatContextId,
    messageBody: summary,
    messageStructure: JSON.stringify(structure),
    payloadKind: 'approval-request',
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

/** Chat-turn producer: full inbound context (reply-to + typed-reply correlation).
 *  `card` is the structural substance of an `approval-requested` event — the
 *  chat-turn translator and the brain-turn callback both satisfy it. */
export function enqueueApprovalRequest(
  db: Database,
  input: { channel: Channel; inboundMessage: ChannelInboundMessage; card: ChannelApprovalCard },
): void {
  insertApprovalRequestOutbound(db, {
    channel: input.channel,
    externalRecipientId: input.inboundMessage.externalSenderId,
    externalChatContextId: input.inboundMessage.externalChatContextId,
    replyToExternalMessageId: input.inboundMessage.externalMessageId,
    card: input.card,
  })

  // Correlate a future typed reply (§5.7) — record the pending approval id
  // on the inbound that triggered this turn.
  channelsRepository.updateInboundMessage(db, input.inboundMessage.id, {
    routedToApprovalRequestId: input.card.approvalRequestId,
  })
}

/** Delegation-origin producer: address the job's origin recipient directly (surface-up).
 *  No inbound row exists here, so there is no reply-to and no typed-reply stamp —
 *  the inline buttons carry the explicit approval id. */
export function enqueueApprovalRequestForRecipient(
  db: Database,
  input: {
    channel: Channel
    externalRecipientId: string
    externalChatContextId: string
    card: ChannelApprovalCard
  },
): void {
  insertApprovalRequestOutbound(db, input)
}

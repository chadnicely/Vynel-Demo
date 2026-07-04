// Surface a chat-turn approval into the channel: enqueue an outbound
// `approval-request` message (with inline ✅/❌ buttons whose payloads
// carry the explicit approvalRequestId) and record the pending approval id
// on the triggering inbound so a typed "approve"/"deny" reply from the same
// sender can be correlated (§5.7 text path). sync.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.7`.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { summarizeApprovalForChannel } from './summarize-approval-for-channel.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'
import type { NormalizedMessageStructure } from '../channels-types.js'

type ApprovalRequestedEvent = Extract<ChatTurnEvent, { kind: 'approval-requested' }>

export function enqueueApprovalRequest(
  db: Database,
  input: { channel: Channel; inboundMessage: ChannelInboundMessage; chatEvent: ApprovalRequestedEvent },
): void {
  const adapter = resolveChannelAdapter(input.channel.channelKind)
  const summary = summarizeApprovalForChannel(input.chatEvent)

  const structure: NormalizedMessageStructure = {
    replyToExternalMessageId: input.inboundMessage.externalMessageId,
    parseMode: 'plain',
  }
  if (adapter.supportsInlineButtons()) {
    structure.inlineButtons = [
      { label: '✅ Approve', payload: `approval:approve:${input.chatEvent.approvalRequestId}` },
      { label: '❌ Deny', payload: `approval:deny:${input.chatEvent.approvalRequestId}` },
    ]
  }

  channelsRepository.insertOutboundMessage(db, {
    id: randomUUID(),
    channelId: input.channel.id,
    externalRecipientId: input.inboundMessage.externalSenderId,
    externalChatContextId: input.inboundMessage.externalChatContextId,
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

  // Correlate a future typed reply (§5.7) — record the pending approval id
  // on the inbound that triggered this turn.
  channelsRepository.updateInboundMessage(db, input.inboundMessage.id, {
    routedToApprovalRequestId: input.chatEvent.approvalRequestId,
  })
}

// Translates a chat turn's `ChatTurnEvent` stream into channel outbound
// rows. A per-turn CLOSURE (created once per turn by routeAsChatTurn) owns
// the text buffer — concurrency-safe without module-global state (each
// concurrent turn has its own buffer; no shared Map keyed by inbound id).
//
// Phase 1: buffers text chunks and flushes ONE outbound at
// `session-completed` (the terminal flush — there is NO `text-chunk-final`
// event; coding.md §10 #10). Records the session id for continuity,
// surfaces approvals, and reports errors. Tool/thinking/usage/etc. events
// are intentionally skipped (too noisy for a channel — coding.md §8).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.6`.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import { enqueueApprovalRequest } from './enqueue-approval-request.js'
import type { Database } from '@vynel/db'
import type {
  Channel,
  ChannelInboundMessage,
  NewChannelMessageQueueEntry,
  OutboundPayloadKind,
} from '../repositories/index.js'
import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'

function makeOutboundReply(
  context: { channel: Channel; inboundMessage: ChannelInboundMessage },
  messageBody: string,
  payloadKind: OutboundPayloadKind,
): NewChannelMessageQueueEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    channelId: context.channel.id,
    externalRecipientId: context.inboundMessage.externalSenderId,
    externalChatContextId: context.inboundMessage.externalChatContextId,
    messageBody,
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
  }
}

export function createChannelEventTranslator(
  db: Database,
  context: { channel: Channel; inboundMessage: ChannelInboundMessage },
): (event: ChatTurnEvent) => void {
  let textBuffer = ''

  return function translate(event: ChatTurnEvent): void {
    switch (event.kind) {
      case 'session-created':
        // Record the session for continuity + resume (§5.5).
        channelsRepository.updateInboundMessage(db, context.inboundMessage.id, {
          routedToChatSessionId: event.session.id,
        })
        return
      case 'text-chunk':
        textBuffer += event.textDelta
        return
      case 'approval-requested':
        enqueueApprovalRequest(db, {
          channel: context.channel,
          inboundMessage: context.inboundMessage,
          card: {
            approvalRequestId: event.approvalRequestId,
            toolName: event.toolName,
            toolInput: event.toolInput,
          },
        })
        return
      case 'session-completed': {
        const body = textBuffer.trim()
        if (body.length > 0) {
          channelsRepository.insertOutboundMessage(
            db,
            makeOutboundReply(context, body, 'chat-stream-final'),
          )
        }
        return
      }
      case 'session-errored':
        channelsRepository.insertOutboundMessage(
          db,
          makeOutboundReply(context, `⚠️ Something went wrong: ${event.errorMessage}`, 'status-update'),
        )
        return
      default:
        // Phase 1: thinking-chunk, tool-call-*, usage-reported, session-titled,
        // session-interrupted, approval-resolved, approval-auto-resolved,
        // user-message-persisted — no channel surface yet.
        return
    }
  }
}

// Core op — poll every enabled channel for inbound messages, dedup,
// allowlist-check, write inbound rows, and advance the per-channel
// `lastPolledCursor`. async (each adapter poll is a network call). One
// channel's failure must NOT abort the loop — per-channel try/catch
// downgrades that channel's status and continues.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.3` + `coding.md §1.4`.

import { randomUUID } from 'node:crypto'
import * as channelsRepository from '../repositories/index.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import { deriveIntentKind } from './derive-intent-kind.js'
import type { Database } from '@vynel/db'
import type { ChannelConnectionStatus } from '../repositories/index.js'
import type { StructuralLogger, BotCredentials } from '../channels-types.js'

function derivePollFailureStatus(message: string): ChannelConnectionStatus {
  if (/401|unauthor|forbidden|invalid token/i.test(message)) return 'auth-failed'
  if (/429|rate.?limit|too many/i.test(message)) return 'rate-limited'
  return 'network-error'
}

export async function runChannelPollingTick(
  db: Database,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ polledChannelCount: number; insertedMessageCount: number }> {
  const channels = channelsRepository.listEnabledChannels(db)
  let insertedMessageCount = 0

  for (const channel of channels) {
    try {
      const adapter = resolveChannelAdapter(channel.channelKind)
      const credentials = JSON.parse(channel.botCredentials) as BotCredentials
      const { messages, nextCursor } = await adapter.pollForInboundMessages({
        channelId: channel.id,
        botCredentials: credentials,
        ...(channel.lastPolledCursor !== null ? { sinceCursor: channel.lastPolledCursor } : {}),
      })

      let lastInboundAt = channel.lastInboundAt
      for (const message of messages) {
        // Explicit dedup (primary defense; the unique index is the net) — §1.4.
        if (channelsRepository.findInboundMessageByExternalId(db, channel.id, message.externalMessageId)) {
          continue
        }
        const isAllowed =
          channelsRepository.findAllowedSender(db, {
            channelId: channel.id,
            externalSenderId: message.externalSenderId,
            scopeContextId: message.externalChatContextId,
          }) !== null

        channelsRepository.insertInboundMessage(db, {
          id: randomUUID(),
          channelId: channel.id,
          externalMessageId: message.externalMessageId,
          externalSenderId: message.externalSenderId,
          externalChatContextId: message.externalChatContextId,
          messageBody: message.messageBody,
          messageMetadata: JSON.stringify(message.messageMetadata),
          // Non-allowed senders are stored as 'ignored' for the audit trail.
          intentKind: isAllowed ? deriveIntentKind(message.messageBody) : 'ignored',
          routedToChatSessionId: null,
          routedToApprovalRequestId: null,
          status: isAllowed ? 'pending' : 'ignored',
          statusMessage: null,
          receivedAt: message.receivedAt,
          processedAt: null,
        })
        insertedMessageCount++
        if (!lastInboundAt || message.receivedAt > lastInboundAt) lastInboundAt = message.receivedAt
      }

      channelsRepository.updateChannel(db, channel.id, {
        lastPolledCursor: nextCursor,
        lastPolledAt: new Date(),
        lastInboundAt,
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
      })
    } catch (err) {
      const reason = extractErrorMessage(err)
      channelsRepository.updateChannel(db, channel.id, {
        connectionStatus: derivePollFailureStatus(reason),
        connectionStatusMessage: reason,
      })
      // Log the SCRUBBED message — a raw telegraf `err` can embed the bot
      // token in its request URL (coding.md §1.1 / Gate-3 C1).
      deps.logger?.warn({ error: reason, channelId: channel.id }, 'channel polling tick failed')
    }
  }

  return { polledChannelCount: channels.length, insertedMessageCount }
}

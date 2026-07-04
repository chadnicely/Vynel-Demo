// Core op — drain ready outbound rows to the channel via the adapter, with
// capped exponential backoff. async (the send is a network call). Per-entry
// try/catch so one failed send doesn't abort the drain. Every repo call is
// sync; only `adapter.sendMessage` is awaited.
//
// Spec: `docs/blueprints/channels/blueprint.md §5` + `coding.md §1.5` + §6.

import * as channelsRepository from '../repositories/index.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger, BotCredentials, NormalizedMessageStructure } from '../channels-types.js'

// 1s, 5s, 30s, 5m, 30m — then failed-give-up after the 6th attempt.
const RETRY_BACKOFF_SECONDS = [1, 5, 30, 300, 1800] as const
const MAX_ATTEMPTS = 6

export async function runChannelDeliveryTick(
  db: Database,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ sentCount: number; failedCount: number }> {
  const ready = channelsRepository.listReadyOutboundMessages(db, { limit: 50 })
  let sentCount = 0
  let failedCount = 0

  for (const entry of ready) {
    const channel = channelsRepository.findChannelById(db, entry.channelId)
    if (!channel || !channel.isEnabled) continue

    const nextAttempt = entry.attemptCount + 1
    channelsRepository.updateOutboundMessage(db, entry.id, {
      status: 'sending',
      lastAttemptedAt: new Date(),
      attemptCount: nextAttempt,
    })

    try {
      const adapter = resolveChannelAdapter(channel.channelKind)
      const credentials = JSON.parse(channel.botCredentials) as BotCredentials
      const structure = JSON.parse(entry.messageStructure) as NormalizedMessageStructure
      const { externalSentMessageId } = await adapter.sendMessage({
        botCredentials: credentials,
        recipientId: entry.externalRecipientId,
        chatContextId: entry.externalChatContextId,
        messageBody: entry.messageBody,
        messageStructure: structure,
      })
      channelsRepository.updateOutboundMessage(db, entry.id, {
        status: 'sent',
        externalSentMessageId,
        sentAt: new Date(),
      })
      sentCount++
    } catch (err) {
      if (nextAttempt >= MAX_ATTEMPTS) {
        channelsRepository.updateOutboundMessage(db, entry.id, {
          status: 'failed-give-up',
          statusMessage: extractErrorMessage(err),
        })
        failedCount++
      } else {
        const backoffSeconds = RETRY_BACKOFF_SECONDS[nextAttempt - 1] ?? 1800
        channelsRepository.updateOutboundMessage(db, entry.id, {
          status: 'failed-retry',
          statusMessage: extractErrorMessage(err),
          nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
        })
      }
      // Log the SCRUBBED message — a raw telegraf `err` can embed the bot
      // token in its request URL (coding.md §1.1 / Gate-3 C1).
      deps.logger?.warn(
        { error: extractErrorMessage(err), queueEntryId: entry.id, attemptCount: nextAttempt },
        'channel send failed',
      )
    }
  }

  return { sentCount, failedCount }
}

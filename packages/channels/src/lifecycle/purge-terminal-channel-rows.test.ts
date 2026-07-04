import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import {
  insertInboundMessage,
  insertOutboundMessage,
  listInboundMessagesForChannel,
  type NewChannelInboundMessage,
  type NewChannelMessageQueueEntry,
} from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { purgeTerminalChannelRows } from './purge-terminal-channel-rows.js'

const OLD = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
const RECENT = new Date()

function inbound(
  channelId: string,
  overrides: Partial<NewChannelInboundMessage>,
): NewChannelInboundMessage {
  return {
    id: randomUUID(),
    channelId,
    externalMessageId: `m-${randomUUID()}`,
    externalSenderId: '7',
    externalChatContextId: '7',
    messageBody: 'x',
    messageMetadata: '{}',
    intentKind: 'chat-turn',
    routedToChatSessionId: null,
    routedToApprovalRequestId: null,
    status: 'pending',
    statusMessage: null,
    receivedAt: new Date(),
    processedAt: null,
    ...overrides,
  }
}

function entry(
  channelId: string,
  overrides: Partial<NewChannelMessageQueueEntry>,
): NewChannelMessageQueueEntry {
  return {
    id: randomUUID(),
    channelId,
    externalRecipientId: '7',
    externalChatContextId: '7',
    messageBody: 'r',
    messageStructure: '{}',
    payloadKind: 'chat-stream-final',
    status: 'pending',
    statusMessage: null,
    attemptCount: 0,
    lastAttemptedAt: null,
    nextAttemptAt: new Date(),
    externalSentMessageId: null,
    enqueuedAt: new Date(),
    sentAt: null,
    ...overrides,
  }
}

describe('purgeTerminalChannelRows', () => {
  it('deletes terminal rows older than 30 days; keeps active + recent', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)

      // inbound
      insertInboundMessage(db, inbound(channel.id, { status: 'completed', receivedAt: OLD })) // purge
      insertInboundMessage(db, inbound(channel.id, { status: 'ignored', receivedAt: OLD })) // purge
      insertInboundMessage(db, inbound(channel.id, { status: 'pending', receivedAt: OLD })) // keep (active)
      insertInboundMessage(db, inbound(channel.id, { status: 'completed', receivedAt: RECENT })) // keep (recent)

      // queue
      insertOutboundMessage(db, entry(channel.id, { status: 'sent', enqueuedAt: OLD })) // purge
      insertOutboundMessage(db, entry(channel.id, { status: 'failed-give-up', enqueuedAt: OLD })) // purge
      insertOutboundMessage(db, entry(channel.id, { status: 'pending', enqueuedAt: OLD })) // keep (active)
      insertOutboundMessage(db, entry(channel.id, { status: 'sent', enqueuedAt: RECENT })) // keep (recent)

      const result = purgeTerminalChannelRows(db, {})
      expect(result.inboundDeleted).toBe(2)
      expect(result.outboundDeleted).toBe(2)
      // inbound remaining: old-pending + recent-completed
      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(2)
    })
  })

  it('respects a custom retention window', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      // 5 days old — purged only under a <5-day window.
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      insertInboundMessage(db, inbound(channel.id, { status: 'completed', receivedAt: fiveDaysAgo }))
      expect(purgeTerminalChannelRows(db, { retentionDays: 30 }).inboundDeleted).toBe(0)
      expect(purgeTerminalChannelRows(db, { retentionDays: 1 }).inboundDeleted).toBe(1)
    })
  })
})

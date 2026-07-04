import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertInboundMessage, updateInboundMessage } from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import { findRecentChannelSessionId } from './find-recent-channel-session-id.js'

const SENDER = '123456'

describe('findRecentChannelSessionId', () => {
  it('returns null for a first-time sender', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      expect(
        findRecentChannelSessionId(db, { channelId: channel.id, externalSenderId: SENDER }),
      ).toBeNull()
    })
  })

  it('returns the most-recent attached session for the sender', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const m = insertInboundMessage(db, {
        id: randomUUID(),
        channelId: channel.id,
        externalMessageId: randomUUID(),
        externalSenderId: SENDER,
        externalChatContextId: SENDER,
        messageBody: 'hi',
        messageMetadata: '{}',
        intentKind: 'chat-turn',
        routedToChatSessionId: null,
        routedToApprovalRequestId: null,
        status: 'completed',
        statusMessage: null,
        receivedAt: new Date(),
        processedAt: new Date(),
      })
      updateInboundMessage(db, m.id, { routedToChatSessionId: 'sess-abc' })
      expect(
        findRecentChannelSessionId(db, { channelId: channel.id, externalSenderId: SENDER }),
      ).toBe('sess-abc')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  findChannelById,
  insertOutboundMessage,
  listOutboundMessagesForChannel,
  listAllowedSenders,
  listInboundMessagesForChannel,
} from '../repositories/index.js'
import {
  makeUser,
  seedChannelWithAllowedSender,
  insertPendingChatTurnMessage,
} from '../test-support.js'
import { disconnectChannelForUser } from './disconnect-channel-for-user.js'
import { CHANNEL_DISCONNECTED } from '../channels-events.js'

function insertQueuedMessage(db: Parameters<typeof insertOutboundMessage>[0], channelId: string) {
  return insertOutboundMessage(db, {
    id: randomUUID(),
    channelId,
    externalRecipientId: '123456',
    externalChatContextId: '123456',
    messageBody: 'pending reply',
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
  })
}

describe('disconnectChannelForUser', () => {
  it('hard-deletes the channel and cascades queue / allowlist / inbound rows (D16 — no orphans)', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannelWithAllowedSender(db)
      insertPendingChatTurnMessage(db, channel.id)
      insertQueuedMessage(db, channel.id)

      disconnectChannelForUser(db, { channelId: channel.id, userId: user.id })

      expect(findChannelById(db, channel.id)).toBeNull()
      expect(listOutboundMessagesForChannel(db, channel.id)).toEqual([])
      expect(listAllowedSenders(db, channel.id)).toEqual([])
      expect(listInboundMessagesForChannel(db, channel.id)).toEqual([])

      // Outbox event co-committed with the delete — records what was
      // severed, exact key set (toEqual rejects extra fields).
      const events = listOutboxEventsByType(db, CHANNEL_DISCONNECTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        channelId: channel.id,
        userId: user.id,
        workspaceId: channel.workspaceId,
        channelKind: 'telegram',
        disconnectedAt: expect.any(String),
      })
      // The seeded bot token NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('secret-token')
    })
  })

  it('throws the same NotFoundError for another user’s channel as for a missing one, deleting nothing', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const attacker = insertUser(db, makeUser())
      insertQueuedMessage(db, channel.id)

      expect(() =>
        disconnectChannelForUser(db, { channelId: channel.id, userId: attacker.id }),
      ).toThrow(NotFoundError)
      expect(() =>
        disconnectChannelForUser(db, { channelId: randomUUID(), userId: attacker.id }),
      ).toThrow(NotFoundError)

      expect(findChannelById(db, channel.id)).not.toBeNull()
      expect(listOutboundMessagesForChannel(db, channel.id)).toHaveLength(1)
      // Ownership miss emits nothing.
      expect(listOutboxEventsByType(db, CHANNEL_DISCONNECTED)).toHaveLength(0)
    })
  })
})

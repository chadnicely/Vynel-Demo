// Repository tests for the `channel_message_queue` table. LOCAL
// test-support helper. Spec: blueprint §4 + coding §8.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertChannel } from './channels.js'
import {
  listReadyOutboundMessages,
  insertOutboundMessage,
  updateOutboundMessage,
  hardDeleteOutboundMessagesBefore,
  type NewChannelMessageQueueEntry,
} from './channel-message-queue.js'

async function seedChannel(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'U',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'W',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const channel = insertChannel(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    channelKind: 'telegram',
    displayName: 'Bot',
    botCredentials: '{}',
    botMetadata: '{}',
    connectionStatus: 'healthy',
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  })
  return { channel }
}

function makeEntry(
  channelId: string,
  overrides: Partial<NewChannelMessageQueueEntry> = {},
): NewChannelMessageQueueEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    channelId,
    externalRecipientId: '123',
    externalChatContextId: '123',
    messageBody: 'reply',
    messageStructure: '{}',
    payloadKind: 'chat-stream-final',
    status: 'pending',
    statusMessage: null,
    attemptCount: 0,
    lastAttemptedAt: null,
    nextAttemptAt: now,
    externalSentMessageId: null,
    enqueuedAt: now,
    sentAt: null,
    ...overrides,
  }
}

describe('channel_message_queue repository', () => {
  it('insertOutboundMessage enqueues a pending row', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const entry = insertOutboundMessage(db, makeEntry(channel.id))
      expect(entry.status).toBe('pending')
      expect(entry.attemptCount).toBe(0)
    })
  })

  it('listReadyOutboundMessages returns due pending + failed-retry, not future or terminal', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const past = new Date(Date.now() - 1000)
      const future = new Date(Date.now() + 60_000)
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'pending', nextAttemptAt: past }))
      insertOutboundMessage(
        db,
        makeEntry(channel.id, { status: 'failed-retry', nextAttemptAt: past }),
      )
      insertOutboundMessage(
        db,
        makeEntry(channel.id, { status: 'failed-retry', nextAttemptAt: future }),
      ) // not due yet
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'sent', nextAttemptAt: past })) // terminal
      const ready = listReadyOutboundMessages(db, {})
      expect(ready).toHaveLength(2)
    })
  })

  it('updateOutboundMessage records the send result', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const entry = insertOutboundMessage(db, makeEntry(channel.id))
      const sentAt = new Date()
      const updated = updateOutboundMessage(db, entry.id, {
        status: 'sent',
        externalSentMessageId: 'tg-555',
        sentAt,
      })
      expect(updated.status).toBe('sent')
      expect(updated.externalSentMessageId).toBe('tg-555')
    })
  })

  it('hardDeleteOutboundMessagesBefore deletes terminal rows past the window (by enqueuedAt)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const recent = new Date()
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'sent', enqueuedAt: old }))
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'failed-give-up', enqueuedAt: old }))
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'pending', enqueuedAt: old })) // active — keep
      insertOutboundMessage(db, makeEntry(channel.id, { status: 'sent', enqueuedAt: recent })) // recent — keep
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const deleted = hardDeleteOutboundMessagesBefore(db, {
        statuses: ['sent', 'failed-give-up'],
        before: cutoff,
      })
      expect(deleted).toBe(2)
    })
  })
})

// Repository tests for the `channel_inbound_messages` table. LOCAL
// test-support helper. Spec: blueprint §4 + coding §6 + §8. The claim
// race + keyset pagination are the critical cases.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertChannel } from './channels.js'
import {
  findInboundMessageByExternalId,
  findInboundMessageById,
  claimPendingInboundMessage,
  listPendingInboundMessages,
  listInboundMessagesForChannel,
  insertInboundMessage,
  updateInboundMessage,
  hardDeleteInboundMessagesBefore,
  findRecentSessionedInboundForSender,
  findRecentApprovalAwaitingInboundForSender,
  type NewChannelInboundMessage,
} from './channel-inbound-messages.js'

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

function makeInbound(
  channelId: string,
  overrides: Partial<NewChannelInboundMessage> = {},
): NewChannelInboundMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    channelId,
    externalMessageId: `m-${randomUUID()}`,
    externalSenderId: '123',
    externalChatContextId: '123',
    messageBody: 'hello',
    messageMetadata: '{}',
    intentKind: 'chat-turn',
    routedToChatSessionId: null,
    routedToApprovalRequestId: null,
    status: 'pending',
    statusMessage: null,
    receivedAt: now,
    processedAt: null,
    ...overrides,
  }
}

describe('channel_inbound_messages repository', () => {
  it('insertInboundMessage persists and findInboundMessageByExternalId dedups', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertInboundMessage(db, makeInbound(channel.id, { externalMessageId: 'm1' }))
      expect(findInboundMessageByExternalId(db, channel.id, 'm1')).not.toBeNull()
      expect(findInboundMessageByExternalId(db, channel.id, 'absent')).toBeNull()
    })
  })

  it('claimPendingInboundMessage flips pending->routed and wins exactly once', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const inbound = insertInboundMessage(db, makeInbound(channel.id))
      expect(claimPendingInboundMessage(db, inbound.id)).toBe(true)
      expect(claimPendingInboundMessage(db, inbound.id)).toBe(false)
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('routed')
    })
  })

  it('listPendingInboundMessages returns only pending, oldest-first', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const older = new Date(Date.now() - 10_000)
      const newer = new Date()
      insertInboundMessage(db, makeInbound(channel.id, { messageBody: 'new', receivedAt: newer }))
      insertInboundMessage(db, makeInbound(channel.id, { messageBody: 'old', receivedAt: older }))
      insertInboundMessage(db, makeInbound(channel.id, { status: 'completed' }))
      const pending = listPendingInboundMessages(db, {})
      expect(pending).toHaveLength(2)
      expect(pending[0]?.messageBody).toBe('old')
    })
  })

  it('listInboundMessagesForChannel paginates by keyset (receivedAt DESC, id DESC)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const base = Date.now()
      for (let i = 0; i < 3; i++) {
        insertInboundMessage(
          db,
          makeInbound(channel.id, { messageBody: `msg${i}`, receivedAt: new Date(base + i * 1000) }),
        )
      }
      const page1 = listInboundMessagesForChannel(db, channel.id, { limit: 2 })
      expect(page1).toHaveLength(2)
      expect(page1[0]?.messageBody).toBe('msg2') // newest first
      const last = page1[1]!
      const page2 = listInboundMessagesForChannel(db, channel.id, {
        limit: 2,
        cursor: { receivedAt: last.receivedAt, id: last.id },
      })
      expect(page2).toHaveLength(1)
      expect(page2[0]?.messageBody).toBe('msg0')
    })
  })

  it('updateInboundMessage transitions status and sets processedAt', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const inbound = insertInboundMessage(db, makeInbound(channel.id))
      const processedAt = new Date()
      const updated = updateInboundMessage(db, inbound.id, { status: 'completed', processedAt })
      expect(updated.status).toBe('completed')
      expect(updated.processedAt?.getTime()).toBe(processedAt.getTime())
    })
  })

  it('hardDeleteInboundMessagesBefore deletes terminal rows past the window', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) // 40 days ago
      const recent = new Date()
      insertInboundMessage(db, makeInbound(channel.id, { status: 'completed', receivedAt: old }))
      insertInboundMessage(db, makeInbound(channel.id, { status: 'ignored', receivedAt: old }))
      insertInboundMessage(db, makeInbound(channel.id, { status: 'pending', receivedAt: old })) // active — keep
      insertInboundMessage(db, makeInbound(channel.id, { status: 'completed', receivedAt: recent })) // recent — keep
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const deleted = hardDeleteInboundMessagesBefore(db, {
        statuses: ['completed', 'ignored'],
        before: cutoff,
      })
      expect(deleted).toBe(2)
      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(2)
    })
  })

  it('findRecentSessionedInboundForSender returns the latest inbound carrying a session ref', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertInboundMessage(db, makeInbound(channel.id, { externalSenderId: '7' })) // no session ref
      const withRef = insertInboundMessage(db, makeInbound(channel.id, { externalSenderId: '7' }))
      updateInboundMessage(db, withRef.id, { routedToChatSessionId: 'sess-1' })
      const found = findRecentSessionedInboundForSender(db, channel.id, '7')
      expect(found?.id).toBe(withRef.id)
      expect(findRecentSessionedInboundForSender(db, channel.id, 'absent')).toBeNull()
    })
  })

  it('findRecentApprovalAwaitingInboundForSender returns the latest inbound carrying an approval ref', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const withRef = insertInboundMessage(db, makeInbound(channel.id, { externalSenderId: '7' }))
      updateInboundMessage(db, withRef.id, { routedToApprovalRequestId: 'req-1' })
      const found = findRecentApprovalAwaitingInboundForSender(db, channel.id, '7')
      expect(found?.routedToApprovalRequestId).toBe('req-1')
    })
  })
})

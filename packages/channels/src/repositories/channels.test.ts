// Repository tests for the `channels` table. Uses the LOCAL test-support
// helper to avoid the `packages/db ↔ packages/testing` workspace cycle.
// Spec: `docs/blueprints/channels/blueprint.md §4` + coding §8.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChannelById,
  listChannelsForWorkspace,
  listChannelsForUser,
  listEnabledChannels,
  insertChannel,
  updateChannel,
  hardDeleteChannel,
  type NewChannel,
} from './channels.js'
import { insertAllowedSender, listAllowedSenders } from './channel-user-links.js'
import { findInboundMessageById, insertInboundMessage } from './channel-inbound-messages.js'
import { insertOutboundMessage, listReadyOutboundMessages } from './channel-message-queue.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeChannel(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewChannel> = {},
): NewChannel {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    channelKind: 'telegram',
    displayName: 'Bakery Bot',
    botCredentials: JSON.stringify({ botToken: 'secret-token' }),
    botMetadata: JSON.stringify({ username: 'bakery_bot', id: 42 }),
    connectionStatus: 'healthy',
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const user = insertUser(db, makeUser())
  const workspace = insertWorkspace(db, makeWorkspace(user.id))
  return { user, workspace }
}

describe('channels repository', () => {
  it('insertChannel persists the full row and findChannelById returns it', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const inserted = insertChannel(db, makeChannel(user.id, workspace.id))
      const found = findChannelById(db, inserted.id)
      expect(found).not.toBeNull()
      expect(found?.displayName).toBe('Bakery Bot')
      expect(found?.channelKind).toBe('telegram')
      expect(found?.isEnabled).toBe(true)
    })
  })

  it('findChannelById returns null when absent', async () => {
    await withTestDatabase(async (db) => {
      expect(findChannelById(db, randomUUID())).toBeNull()
    })
  })

  it('listChannelsForWorkspace is workspace-scoped', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const otherWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      insertChannel(db, makeChannel(user.id, workspace.id, { displayName: 'A' }))
      insertChannel(db, makeChannel(user.id, workspace.id, { displayName: 'B' }))
      insertChannel(db, makeChannel(user.id, otherWorkspace.id, { displayName: 'C' }))

      const list = listChannelsForWorkspace(db, workspace.id)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.displayName).sort()).toEqual(['A', 'B'])
    })
  })

  it('listChannelsForUser is user-scoped (the global root sees only its owner channels)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { user: otherUser, workspace: otherWorkspace } = await seed(db)
      insertChannel(db, makeChannel(user.id, workspace.id, { displayName: 'A' }))
      insertChannel(db, makeChannel(user.id, workspace.id, { displayName: 'B' }))
      insertChannel(db, makeChannel(otherUser.id, otherWorkspace.id, { displayName: 'C' }))

      const list = listChannelsForUser(db, user.id)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.displayName).sort()).toEqual(['A', 'B'])
    })
  })

  it('listEnabledChannels returns only enabled channels', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      insertChannel(db, makeChannel(user.id, workspace.id, { isEnabled: true }))
      insertChannel(db, makeChannel(user.id, workspace.id, { isEnabled: false }))
      const enabled = listEnabledChannels(db)
      expect(enabled).toHaveLength(1)
      expect(enabled[0]?.isEnabled).toBe(true)
    })
  })

  it('updateChannel patches fields and bumps updatedAt', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const created = insertChannel(
        db,
        makeChannel(user.id, workspace.id, { updatedAt: new Date(Date.now() - 60_000) }),
      )
      const updated = updateChannel(db, created.id, {
        isEnabled: false,
        connectionStatus: 'auth-failed',
        connectionStatusMessage: 'token rejected',
      })
      expect(updated.isEnabled).toBe(false)
      expect(updated.connectionStatus).toBe('auth-failed')
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
    })
  })

  it('updateChannel throws when the row is absent', async () => {
    await withTestDatabase(async (db) => {
      expect(() => updateChannel(db, randomUUID(), { isEnabled: false })).toThrow(/no row/)
    })
  })

  it('hardDeleteChannel cascades to all child tables', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const channel = insertChannel(db, makeChannel(user.id, workspace.id))
      const now = new Date()
      insertAllowedSender(db, {
        id: randomUUID(),
        channelId: channel.id,
        externalSenderId: '123',
        externalSenderHandle: null,
        externalSenderDisplayName: null,
        scopeContextId: '123',
        addedAt: now,
      })
      const inbound = insertInboundMessage(db, {
        id: randomUUID(),
        channelId: channel.id,
        externalMessageId: 'm1',
        externalSenderId: '123',
        externalChatContextId: '123',
        messageBody: 'hi',
        messageMetadata: '{}',
        intentKind: 'chat-turn',
        routedToChatSessionId: null,
        routedToApprovalRequestId: null,
        status: 'pending',
        statusMessage: null,
        receivedAt: now,
        processedAt: null,
      })
      insertOutboundMessage(db, {
        id: randomUUID(),
        channelId: channel.id,
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
      })

      hardDeleteChannel(db, channel.id)

      expect(findChannelById(db, channel.id)).toBeNull()
      expect(listAllowedSenders(db, channel.id)).toHaveLength(0)
      expect(findInboundMessageById(db, inbound.id)).toBeNull()
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})

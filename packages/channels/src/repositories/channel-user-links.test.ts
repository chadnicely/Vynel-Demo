// Repository tests for the `channel_user_links` table. LOCAL test-support
// helper (avoids the db↔testing cycle). Spec: blueprint §4 + coding §8.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChannel } from './channels.js'
import {
  findAllowedSender,
  listAllowedSenders,
  insertAllowedSender,
  deleteAllowedSender,
} from './channel-user-links.js'

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

function makeLink(channelId: string, externalSenderId: string, scopeContextId: string | null) {
  return {
    id: randomUUID(),
    channelId,
    externalSenderId,
    externalSenderHandle: `@user${externalSenderId}`,
    externalSenderDisplayName: 'A Person',
    scopeContextId,
    addedAt: new Date(),
  }
}

describe('channel_user_links repository', () => {
  it('insertAllowedSender persists and findAllowedSender matches the exact triple', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertAllowedSender(db, makeLink(channel.id, '123', '123'))
      const found = findAllowedSender(db, {
        channelId: channel.id,
        externalSenderId: '123',
        scopeContextId: '123',
      })
      expect(found).not.toBeNull()
      expect(found?.externalSenderId).toBe('123')
    })
  })

  it('findAllowedSender returns null for a non-allowed sender', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertAllowedSender(db, makeLink(channel.id, '123', '123'))
      const found = findAllowedSender(db, {
        channelId: channel.id,
        externalSenderId: '999',
        scopeContextId: '999',
      })
      expect(found).toBeNull()
    })
  })

  it('findAllowedSender matches a null scopeContextId via IS NULL', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertAllowedSender(db, makeLink(channel.id, '123', null))
      const found = findAllowedSender(db, {
        channelId: channel.id,
        externalSenderId: '123',
        scopeContextId: null,
      })
      expect(found).not.toBeNull()
    })
  })

  it('listAllowedSenders returns all links for the channel', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      insertAllowedSender(db, makeLink(channel.id, '1', '1'))
      insertAllowedSender(db, makeLink(channel.id, '2', '2'))
      expect(listAllowedSenders(db, channel.id)).toHaveLength(2)
    })
  })

  it('deleteAllowedSender removes the link', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = await seedChannel(db)
      const link = insertAllowedSender(db, makeLink(channel.id, '1', '1'))
      deleteAllowedSender(db, channel.id, link.id)
      expect(listAllowedSenders(db, channel.id)).toHaveLength(0)
    })
  })
})

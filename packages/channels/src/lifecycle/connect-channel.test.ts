import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  listChannelsForWorkspace,
  listChannelsForUser,
  listAllowedSenders,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { makeUser, makeWorkspace } from '../test-support.js'
import { connectChannel } from './connect-channel.js'
import { CHANNEL_CONNECTED } from '../channels-events.js'

const { getMe } = vi.hoisted(() => ({ getMe: vi.fn() }))
vi.mock('telegraf', () => ({ Telegram: vi.fn(() => ({ getMe })) }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('connectChannel', () => {
  it('verifies creds then inserts the channel + initial allowed sender', async () => {
    getMe.mockResolvedValue({ id: 42, first_name: 'Bakery', username: 'bakery_bot' })
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const channel = await connectChannel(db, {
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bakery Bot',
        botCredentials: { botToken: 'good-token' },
        initialAllowedSenderId: '999',
      })
      expect(channel.connectionStatus).toBe('healthy')
      expect(channel.botCredentials).toBe(JSON.stringify({ botToken: 'good-token' }))
      expect(listChannelsForWorkspace(db, workspace.id)).toHaveLength(1)
      const senders = listAllowedSenders(db, channel.id)
      expect(senders).toHaveLength(1)
      expect(senders[0]?.externalSenderId).toBe('999')

      // Outbox event co-committed with the insert — loose-ref facts
      // only, exact key set (toEqual rejects extra fields).
      const events = listOutboxEventsByType(db, CHANNEL_CONNECTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        channelId: channel.id,
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        connectedAt: channel.createdAt.toISOString(),
      })
      // The bot token NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('good-token')
    })
  })

  it('connects a GLOBAL channel (null workspace) and persists it with null workspaceId', async () => {
    getMe.mockResolvedValue({ id: 42, first_name: 'Bakery', username: 'bakery_bot' })
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = await connectChannel(db, {
        userId: user.id,
        workspaceId: null,
        channelKind: 'telegram',
        displayName: 'Global Bot',
        botCredentials: { botToken: 'good-token' },
      })
      expect(channel.workspaceId).toBeNull()
      const persisted = listChannelsForUser(db, user.id)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]?.workspaceId).toBeNull()
    })
  })

  it('throws ValidationError and persists nothing when creds are invalid', async () => {
    getMe.mockRejectedValue(new Error('401: Unauthorized'))
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await expect(
        connectChannel(db, {
          userId: user.id,
          workspaceId: workspace.id,
          channelKind: 'telegram',
          displayName: 'X',
          botCredentials: { botToken: 'bad' },
        }),
      ).rejects.toThrow(/Could not connect/)
      expect(listChannelsForWorkspace(db, workspace.id)).toHaveLength(0)
      // Failed connect emits nothing.
      expect(listOutboxEventsByType(db, CHANNEL_CONNECTED)).toHaveLength(0)
    })
  })

  it('throws for an unsupported channel kind (discord — Phase 1.5)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await expect(
        connectChannel(db, {
          userId: user.id,
          workspaceId: workspace.id,
          channelKind: 'discord',
          displayName: 'X',
          botCredentials: { botToken: 't' },
        }),
      ).rejects.toThrow(/Discord/)
      expect(getMe).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listChannelsForWorkspace, listAllowedSenders } from '../repositories/index.js'
import { makeUser, makeWorkspace } from '../test-support.js'
import { connectChannel } from './connect-channel.js'

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

// Integration tests for `renameChannelForUser` — the user-scoped rename
// op (userId is the tenant boundary, so a global null-workspace channel
// is reachable too). Real SQLite via `withTestDatabase` (no mocking).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { findChannelById } from '../repositories/index.js'
import { makeUser, seedChannel } from '../test-support.js'
import { renameChannelForUser } from './rename-channel-for-user.js'
import { CHANNEL_RENAMED } from '../channels-events.js'

describe('renameChannelForUser', () => {
  it('renames a global (null-workspace) channel and co-commits the outbox event', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db, { workspaceId: null })
      const updated = renameChannelForUser(db, {
        channelId: channel.id,
        userId: user.id,
        displayName: 'Family bot',
      })
      expect(updated.displayName).toBe('Family bot')

      // Loose-ref facts only, exact key set (toEqual rejects extra fields).
      const events = listOutboxEventsByType(db, CHANNEL_RENAMED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        channelId: channel.id,
        userId: user.id,
        workspaceId: null,
        channelKind: 'telegram',
        displayName: 'Family bot',
        renamedAt: updated.updatedAt.toISOString(),
      })
      // The seeded bot token NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('secret-token')
    })
  })

  it('throws NotFoundError for another user’s channel, changing nothing and emitting nothing', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const attacker = insertUser(db, makeUser())
      expect(() =>
        renameChannelForUser(db, {
          channelId: channel.id,
          userId: attacker.id,
          displayName: 'Hijacked',
        }),
      ).toThrow(NotFoundError)
      expect(() =>
        renameChannelForUser(db, {
          channelId: randomUUID(),
          userId: attacker.id,
          displayName: 'Hijacked',
        }),
      ).toThrow(NotFoundError)

      expect(findChannelById(db, channel.id)?.displayName).toBe(channel.displayName)
      expect(listOutboxEventsByType(db, CHANNEL_RENAMED)).toHaveLength(0)
    })
  })
})

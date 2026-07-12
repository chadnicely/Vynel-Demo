// Integration tests for `setChannelEnabledForUser` — the user-scoped
// enable-toggle twin (userId is the tenant boundary, so a global
// null-workspace channel is reachable too). Real SQLite via
// `withTestDatabase` (no mocking).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { findChannelById } from '../repositories/index.js'
import { makeUser, seedChannel } from '../test-support.js'
import { setChannelEnabledForUser } from './set-channel-enabled-for-user.js'
import { CHANNEL_ENABLED_CHANGED } from '../channels-events.js'

describe('setChannelEnabledForUser', () => {
  it('toggles isEnabled on a global (null-workspace) channel and co-commits the outbox event', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db, { workspaceId: null })
      const updated = setChannelEnabledForUser(db, {
        channelId: channel.id,
        userId: user.id,
        isEnabled: false,
      })
      expect(updated.isEnabled).toBe(false)

      // Loose-ref facts only, exact key set (toEqual rejects extra fields).
      const events = listOutboxEventsByType(db, CHANNEL_ENABLED_CHANGED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        channelId: channel.id,
        userId: user.id,
        workspaceId: null,
        channelKind: 'telegram',
        isEnabled: false,
        changedAt: updated.updatedAt.toISOString(),
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
        setChannelEnabledForUser(db, {
          channelId: channel.id,
          userId: attacker.id,
          isEnabled: false,
        }),
      ).toThrow(NotFoundError)
      expect(() =>
        setChannelEnabledForUser(db, {
          channelId: randomUUID(),
          userId: attacker.id,
          isEnabled: false,
        }),
      ).toThrow(NotFoundError)

      expect(findChannelById(db, channel.id)?.isEnabled).toBe(true)
      expect(listOutboxEventsByType(db, CHANNEL_ENABLED_CHANGED)).toHaveLength(0)
    })
  })
})

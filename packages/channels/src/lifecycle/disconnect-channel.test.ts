import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { findChannelById } from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { disconnectChannel } from './disconnect-channel.js'
import { CHANNEL_DISCONNECTED } from '../channels-events.js'

describe('disconnectChannel', () => {
  it('hard-deletes the channel when it belongs to the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace, channel } = seedChannel(db)
      disconnectChannel(db, { channelId: channel.id, workspaceId: workspace.id })
      expect(findChannelById(db, channel.id)).toBeNull()

      // Outbox event co-committed with the delete — records what was
      // severed, exact key set (toEqual rejects extra fields).
      const events = listOutboxEventsByType(db, CHANNEL_DISCONNECTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        channelId: channel.id,
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        disconnectedAt: expect.any(String),
      })
      // The seeded bot token NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('secret-token')

      // Second call misses (already deleted) and emits nothing more.
      expect(() =>
        disconnectChannel(db, { channelId: channel.id, workspaceId: workspace.id }),
      ).toThrow(NotFoundError)
      expect(listOutboxEventsByType(db, CHANNEL_DISCONNECTED)).toHaveLength(1)
    })
  })

  it('throws NotFoundError when the channel is in another workspace', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      expect(() =>
        disconnectChannel(db, { channelId: channel.id, workspaceId: randomUUID() }),
      ).toThrow(NotFoundError)
      // not deleted, nothing emitted
      expect(findChannelById(db, channel.id)).not.toBeNull()
      expect(listOutboxEventsByType(db, CHANNEL_DISCONNECTED)).toHaveLength(0)
    })
  })
})

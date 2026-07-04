import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { findChannelById } from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { disconnectChannel } from './disconnect-channel.js'

describe('disconnectChannel', () => {
  it('hard-deletes the channel when it belongs to the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      disconnectChannel(db, { channelId: channel.id, workspaceId: workspace.id })
      expect(findChannelById(db, channel.id)).toBeNull()
    })
  })

  it('throws NotFoundError when the channel is in another workspace', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      expect(() =>
        disconnectChannel(db, { channelId: channel.id, workspaceId: randomUUID() }),
      ).toThrow(NotFoundError)
      // not deleted
      expect(findChannelById(db, channel.id)).not.toBeNull()
    })
  })
})

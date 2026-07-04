import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { seedChannel } from '../test-support.js'
import { setChannelEnabled } from './set-channel-enabled.js'

describe('setChannelEnabled', () => {
  it('toggles isEnabled', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      const updated = setChannelEnabled(db, {
        channelId: channel.id,
        workspaceId: workspace.id,
        isEnabled: false,
      })
      expect(updated.isEnabled).toBe(false)
    })
  })

  it('throws NotFoundError for a channel outside the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      expect(() =>
        setChannelEnabled(db, {
          channelId: channel.id,
          workspaceId: randomUUID(),
          isEnabled: false,
        }),
      ).toThrow(NotFoundError)
    })
  })
})

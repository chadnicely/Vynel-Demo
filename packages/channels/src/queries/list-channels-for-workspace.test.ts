import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedChannel } from '../test-support.js'
import { listChannelsForWorkspace } from './list-channels-for-workspace.js'

describe('listChannelsForWorkspace', () => {
  it('returns the channels for the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      const list = listChannelsForWorkspace(db, workspace.id)
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(channel.id)
    })
  })
})

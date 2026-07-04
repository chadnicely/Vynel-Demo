import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listAllowedSenders } from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import { removeAllowedSender } from './remove-allowed-sender.js'

describe('removeAllowedSender', () => {
  it('removes the sender when scoped to the right channel + workspace', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel, sender } = seedChannelWithAllowedSender(db)
      removeAllowedSender(db, {
        channelId: channel.id,
        workspaceId: workspace.id,
        senderLinkId: sender.id,
      })
      expect(listAllowedSenders(db, channel.id)).toHaveLength(0)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { listAllowedSenders } from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { addAllowedSender } from './add-allowed-sender.js'

describe('addAllowedSender', () => {
  it('adds a sender, defaulting scopeContextId to the sender id', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, channel } = seedChannel(db)
      const link = addAllowedSender(db, {
        channelId: channel.id,
        workspaceId: workspace.id,
        externalSenderId: '555',
      })
      expect(link.scopeContextId).toBe('555')
      expect(listAllowedSenders(db, channel.id)).toHaveLength(1)
    })
  })

  it('throws NotFoundError for a channel outside the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      expect(() =>
        addAllowedSender(db, {
          channelId: channel.id,
          workspaceId: randomUUID(),
          externalSenderId: '5',
        }),
      ).toThrow(NotFoundError)
    })
  })
})

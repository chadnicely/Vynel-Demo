import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedChannel } from '../test-support.js'
import { listChannelsForUser } from './list-channels-for-user.js'

describe('listChannelsForUser', () => {
  it('returns the channels the user owns', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db)
      const list = listChannelsForUser(db, user.id)
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(channel.id)
    })
  })

  it('returns empty for a user that owns no channels (tenant isolation)', async () => {
    await withTestDatabase(async (db) => {
      seedChannel(db) // a different user's channel
      expect(listChannelsForUser(db, 'a-different-user')).toHaveLength(0)
    })
  })
})

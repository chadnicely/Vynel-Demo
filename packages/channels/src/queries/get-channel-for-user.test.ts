// The PRIMARY tenant-isolation proof for the user-scoped `/channels` surface:
// `getChannelForUserOrThrow` authorizes by (userId, channelId) — the guard every
// user-scoped single-channel op runs first. Order-independent (unlike the HTTP
// test, which depends on which user the Phase-1 resolver picks). Not-found and
// not-owned MUST return the identical error (no enumeration leak).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { seedChannel } from '../test-support.js'
import { getChannelForUserOrThrow } from './get-channel-for-user.js'

describe('getChannelForUserOrThrow', () => {
  it('returns the channel when it belongs to the user', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db)
      expect(getChannelForUserOrThrow(db, channel.id, user.id).id).toBe(channel.id)
    })
  })

  it('resolves a GLOBAL (null-workspace) channel by userId alone', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db, { workspaceId: null })
      expect(channel.workspaceId).toBeNull()
      expect(getChannelForUserOrThrow(db, channel.id, user.id).id).toBe(channel.id)
    })
  })

  it("throws NotFoundError when the channel belongs to ANOTHER user (cross-tenant)", async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db) // owned by user A
      expect(() => getChannelForUserOrThrow(db, channel.id, 'another-user')).toThrow(NotFoundError)
    })
  })

  it('throws NotFoundError for a missing channel — same error as not-owned (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      const { user } = seedChannel(db)
      expect(() => getChannelForUserOrThrow(db, randomUUID(), user.id)).toThrow(NotFoundError)
    })
  })
})

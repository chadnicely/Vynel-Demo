// The platform-event applier over a real Postgres dialect (PGlite): the
// idempotent lifecycle + the email-conflict path + unknown-user ignore.

import { describe, it, expect } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import {
  findAccountByEmail,
  findAccountByPlatformUserId,
} from '@vynel/cloud-db/repositories/accounts'
import { applyPlatformEvent } from './apply-platform-event.js'

const linkDeps = { mail: { sendSetPasswordLink: async () => {} }, linkBaseUrl: 'https://hub.test' }

describe('applyPlatformEvent', () => {
  it('creates, updates profile+email+tier, and removes', async () => {
    await withTestCloudDatabase(async (db) => {
      const created = await applyPlatformEvent(
        db,
        { type: 'user.created', platformUserId: 'p1', email: 'a@ex.com', displayName: 'A', tier: 'pro' },
        linkDeps,
      )
      expect(created.outcome).toBe('created')
      expect((await findAccountByPlatformUserId(db, 'p1'))?.tier).toBe('pro')

      await applyPlatformEvent(
        db,
        { type: 'user.updated', platformUserId: 'p1', displayName: 'A2', email: 'a2@ex.com', tier: 'basic' },
        linkDeps,
      )
      const updated = await findAccountByPlatformUserId(db, 'p1')
      expect(updated?.displayName).toBe('A2')
      expect(updated?.tier).toBe('basic')
      expect(await findAccountByEmail(db, 'a2@ex.com')).not.toBeNull()

      const removed = await applyPlatformEvent(db, { type: 'user.removed', platformUserId: 'p1' }, linkDeps)
      expect(removed.outcome).toBe('removed')
      expect((await findAccountByPlatformUserId(db, 'p1'))?.status).toBe('disabled')
    })
  })

  it('converges a duplicate user.created and ignores unknown users', async () => {
    await withTestCloudDatabase(async (db) => {
      await applyPlatformEvent(
        db,
        { type: 'user.created', platformUserId: 'p2', email: 'b@ex.com', displayName: 'B' },
        linkDeps,
      )
      const again = await applyPlatformEvent(
        db,
        { type: 'user.created', platformUserId: 'p2', email: 'b@ex.com', displayName: 'B Renamed' },
        linkDeps,
      )
      expect(again.outcome).toBe('updated')
      expect((await findAccountByPlatformUserId(db, 'p2'))?.displayName).toBe('B Renamed')

      const ghost = await applyPlatformEvent(
        db,
        { type: 'tier.updated', platformUserId: 'ghost', tier: 'pro' },
        linkDeps,
      )
      expect(ghost.outcome).toBe('ignored')
    })
  })

  it('rejects an email update that collides with another account', async () => {
    await withTestCloudDatabase(async (db) => {
      await applyPlatformEvent(
        db,
        { type: 'user.created', platformUserId: 'p3', email: 'taken@ex.com', displayName: 'T' },
        linkDeps,
      )
      await applyPlatformEvent(
        db,
        { type: 'user.created', platformUserId: 'p4', email: 'other@ex.com', displayName: 'O' },
        linkDeps,
      )
      await expect(
        applyPlatformEvent(
          db,
          { type: 'user.updated', platformUserId: 'p4', email: 'taken@ex.com' },
          linkDeps,
        ),
      ).rejects.toMatchObject({ code: 'conflict' })
    })
  })
})

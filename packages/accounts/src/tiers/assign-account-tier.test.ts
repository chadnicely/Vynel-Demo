// The admin tier override at the leaf: lands on a real row (with and without
// an expiry), resolves through the same fresh-read the entitlement uses, and
// 404s an unknown account instead of silently doing nothing.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { insertAccount } from '@vynel/cloud-db/repositories/accounts'
import { assignAccountTier } from './assign-account-tier.js'
import { resolveActiveAccountTier } from './resolve-active-account-tier.js'

describe('assignAccountTier', () => {
  it('upgrades and downgrades a real account, honoring the expiry', async () => {
    await withTestCloudDatabase(async (db) => {
      const now = new Date('2026-07-13T12:00:00Z')
      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'tiered@example.com',
        displayName: 'Tiered',
      })

      await assignAccountTier(db, { accountId: account.id, tier: 'pro', tierExpiresAt: null })
      expect(await resolveActiveAccountTier(db, account.id, now)).toBe('pro')

      // A lapsed expiry means the effective tier falls back to basic.
      await assignAccountTier(db, {
        accountId: account.id,
        tier: 'pro',
        tierExpiresAt: new Date('2026-01-01T00:00:00Z'),
      })
      expect(await resolveActiveAccountTier(db, account.id, now)).toBe('basic')

      await assignAccountTier(db, { accountId: account.id, tier: 'basic', tierExpiresAt: null })
      expect(await resolveActiveAccountTier(db, account.id, now)).toBe('basic')
    })
  })

  it('404s an unknown account instead of silently doing nothing', async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        assignAccountTier(db, { accountId: randomUUID(), tier: 'pro', tierExpiresAt: null }),
      ).rejects.toMatchObject({ httpStatus: 404 })
    })
  })
})

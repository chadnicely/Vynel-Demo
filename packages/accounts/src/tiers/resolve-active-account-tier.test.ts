// The live-tier read at the leaf, over PGlite: null for unknown/disabled
// accounts (the caller's fail-open/fail-closed choice), the effective tier for
// active ones — including the lapsed-pro downgrade (a stale token must never
// out-vouch the accounts table).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import {
  insertAccount,
  setAccountStatus,
  setAccountTier,
} from '@vynel/cloud-db/repositories/accounts'
import { resolveActiveAccountTier } from './resolve-active-account-tier.js'

const NOW = new Date('2026-07-12T00:00:00Z')

describe('resolveActiveAccountTier', () => {
  it('returns null for an unknown account and for a disabled one', async () => {
    await withTestCloudDatabase(async (db) => {
      expect(await resolveActiveAccountTier(db, randomUUID(), NOW)).toBeNull()

      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'gone@example.com',
        displayName: 'Gone',
      })
      await setAccountStatus(db, { accountId: account.id, status: 'disabled' })
      expect(await resolveActiveAccountTier(db, account.id, NOW)).toBeNull()
    })
  })

  it('returns the effective tier for an active account, downgrading a lapsed pro', async () => {
    await withTestCloudDatabase(async (db) => {
      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'live@example.com',
        displayName: 'Live',
      })
      expect(await resolveActiveAccountTier(db, account.id, NOW)).toBe('basic')

      await setAccountTier(db, { accountId: account.id, tier: 'pro', tierExpiresAt: null })
      expect(await resolveActiveAccountTier(db, account.id, NOW)).toBe('pro')

      const lapsed = new Date(NOW.getTime() - 1)
      await setAccountTier(db, { accountId: account.id, tier: 'pro', tierExpiresAt: lapsed })
      expect(await resolveActiveAccountTier(db, account.id, NOW)).toBe('basic')
    })
  })
})

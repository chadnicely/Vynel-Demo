// The disable rule at the leaf: disabling kills authority (fresh role read
// answers null) AND every device session — re-enabling restores authority but
// never resurrects revoked tokens. Unknown accounts 404.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { insertAccount } from '@vynel/cloud-db/repositories/accounts'
import {
  insertRefreshToken,
  listActiveRefreshTokensForAccount,
} from '../repositories/refresh-tokens/index.js'
import { resolveActiveAccountRole } from '../roles/resolve-active-account-role.js'
import { setAccountLifecycleStatus } from './set-account-lifecycle-status.js'

const NOW = new Date('2026-07-13T12:00:00Z')

describe('setAccountLifecycleStatus', () => {
  it('disable revokes every device session; re-enable restores authority only', async () => {
    await withTestCloudDatabase(async (db) => {
      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'toggled@example.com',
        displayName: 'Toggled',
      })
      await insertRefreshToken(db, {
        id: randomUUID(),
        accountId: account.id,
        familyId: randomUUID(),
        tokenHash: 'h'.repeat(64),
        deviceName: 'Chad-PC',
        devicePlatform: 'windows',
        appVersion: '0.1.0',
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      })
      expect(await listActiveRefreshTokensForAccount(db, { accountId: account.id, now: NOW })).toHaveLength(1)

      await setAccountLifecycleStatus(db, { accountId: account.id, status: 'disabled', now: NOW })
      expect(await resolveActiveAccountRole(db, account.id)).toBeNull()
      expect(await listActiveRefreshTokensForAccount(db, { accountId: account.id, now: NOW })).toHaveLength(0)

      // Re-enable: the account can act again, but old sessions stay dead —
      // the user signs in fresh.
      await setAccountLifecycleStatus(db, { accountId: account.id, status: 'active', now: NOW })
      expect(await resolveActiveAccountRole(db, account.id)).toBe('member')
      expect(await listActiveRefreshTokensForAccount(db, { accountId: account.id, now: NOW })).toHaveLength(0)
    })
  })

  it('404s an unknown account instead of silently doing nothing', async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        setAccountLifecycleStatus(db, { accountId: randomUUID(), status: 'disabled' }),
      ).rejects.toMatchObject({ httpStatus: 404 })
    })
  })
})

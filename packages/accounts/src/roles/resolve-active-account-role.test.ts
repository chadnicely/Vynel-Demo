// The live-role read at the leaf, over PGlite: null for unknown/disabled
// accounts, 'member' by default, 'admin' after promotion — and a DISABLED
// admin loses authority immediately (the fresh-read rule this fn exists for).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import {
  insertAccount,
  setAccountRole,
  setAccountStatus,
} from '@vynel/cloud-db/repositories/accounts'
import { resolveActiveAccountRole } from './resolve-active-account-role.js'

describe('resolveActiveAccountRole', () => {
  it('returns null for an unknown account, member by default, admin after promotion', async () => {
    await withTestCloudDatabase(async (db) => {
      expect(await resolveActiveAccountRole(db, randomUUID())).toBeNull()

      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'admin@example.com',
        displayName: 'Admin',
      })
      expect(await resolveActiveAccountRole(db, account.id)).toBe('member')

      await setAccountRole(db, { accountId: account.id, role: 'admin' })
      expect(await resolveActiveAccountRole(db, account.id)).toBe('admin')
    })
  })

  it('a disabled admin has no role at all (fresh-read revocation)', async () => {
    await withTestCloudDatabase(async (db) => {
      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'revoked@example.com',
        displayName: 'Revoked',
      })
      await setAccountRole(db, { accountId: account.id, role: 'admin' })
      await setAccountStatus(db, { accountId: account.id, status: 'disabled' })
      expect(await resolveActiveAccountRole(db, account.id)).toBeNull()
    })
  })
})

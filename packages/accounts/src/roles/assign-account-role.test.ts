// The role-grant op at the leaf: assigns and revokes on a real row, 404s an
// unknown account. The self-grant threat lives at the HTTP layer and is
// covered by apps/cloud-api/src/routes/admin.test.ts (the dual door).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { insertAccount } from '@vynel/cloud-db/repositories/accounts'
import { assignAccountRole } from './assign-account-role.js'
import { resolveActiveAccountRole } from './resolve-active-account-role.js'

describe('assignAccountRole', () => {
  it('assigns and revokes the admin role on a real account', async () => {
    await withTestCloudDatabase(async (db) => {
      const account = await insertAccount(db, {
        id: randomUUID(),
        email: 'promote@example.com',
        displayName: 'Promote',
      })
      await assignAccountRole(db, { accountId: account.id, role: 'admin' })
      expect(await resolveActiveAccountRole(db, account.id)).toBe('admin')

      await assignAccountRole(db, { accountId: account.id, role: 'member' })
      expect(await resolveActiveAccountRole(db, account.id)).toBe('member')
    })
  })

  it('404s an unknown account instead of silently doing nothing', async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        assignAccountRole(db, { accountId: randomUUID(), role: 'admin' }),
      ).rejects.toMatchObject({ httpStatus: 404 })
    })
  })
})

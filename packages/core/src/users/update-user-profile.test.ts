// Tests for updateUserProfile. Verifies the typed error contract.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/core/errors'
import { getOrCreateLocalUser } from './get-or-create-local-user.js'
import { updateUserProfile } from './update-user-profile.js'

describe('updateUserProfile', () => {
  it('updates the displayName and returns the new row', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      const updated = updateUserProfile(db, user.id, { displayName: 'Renamed' })
      expect(updated.displayName).toBe('Renamed')
      expect(updated.id).toBe(user.id)
    })
  })

  it('throws NotFoundError when the user does not exist', async () => {
    await withTestDatabase((db) => {
      expect(() => updateUserProfile(db, randomUUID(), { displayName: 'x' })).toThrow(NotFoundError)
    })
  })
})

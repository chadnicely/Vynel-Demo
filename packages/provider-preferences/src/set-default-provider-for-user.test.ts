// Integration test for the default-provider write op — verifies the "exactly
// one default per user" invariant holds across set / re-set, the upsert (no
// duplicate row), and isolation between users. Real SQLite via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listProviderPreferencesForUser } from '@vynel/db/repositories/providers'
import { setDefaultProviderForUser } from './set-default-provider-for-user.js'
import { findDefaultProviderForUser } from './find-default-provider-for-user.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('setDefaultProviderForUser', () => {
  it('leaves exactly one row with isDefault true', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      setDefaultProviderForUser(db, { userId: user.id, providerId: 'claude' })

      const preferences = listProviderPreferencesForUser(db, user.id)
      expect(preferences).toHaveLength(1)
      expect(preferences.filter((preference) => preference.isDefault)).toHaveLength(1)
      expect(preferences[0]?.providerId).toBe('claude')
    })
  })

  it('re-setting the default to a different provider flips isDefault across rows', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      setDefaultProviderForUser(db, { userId: user.id, providerId: 'claude' })
      setDefaultProviderForUser(db, { userId: user.id, providerId: 'codex' })

      const preferences = listProviderPreferencesForUser(db, user.id)
      expect(preferences).toHaveLength(2)
      const defaults = preferences.filter((preference) => preference.isDefault)
      expect(defaults).toHaveLength(1)
      expect(defaults[0]?.providerId).toBe('codex')
      expect(findDefaultProviderForUser(db, user.id)).toBe('codex')
    })
  })

  it('re-selecting a previously-set provider updates its row rather than duplicating it', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      setDefaultProviderForUser(db, { userId: user.id, providerId: 'claude' })
      setDefaultProviderForUser(db, { userId: user.id, providerId: 'codex' })
      setDefaultProviderForUser(db, { userId: user.id, providerId: 'claude' })

      const preferences = listProviderPreferencesForUser(db, user.id)
      expect(preferences).toHaveLength(2) // no duplicate row for claude
      expect(findDefaultProviderForUser(db, user.id)).toBe('claude')
    })
  })

  it('findDefaultProviderForUser returns null when the user has no preference', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(findDefaultProviderForUser(db, user.id)).toBeNull()
    })
  })

  it('setting a default for one user does not affect another user', async () => {
    await withTestDatabase(async (db) => {
      const userA = makeUser()
      const userB = makeUser()
      insertUser(db, userA)
      insertUser(db, userB)

      setDefaultProviderForUser(db, { userId: userA.id, providerId: 'claude' })
      setDefaultProviderForUser(db, { userId: userB.id, providerId: 'codex' })

      expect(findDefaultProviderForUser(db, userA.id)).toBe('claude')
      expect(findDefaultProviderForUser(db, userB.id)).toBe('codex')
      expect(listProviderPreferencesForUser(db, userA.id)).toHaveLength(1)
    })
  })
})

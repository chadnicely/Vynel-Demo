// getDefaultProviderForUser resolves to the user's explicit choice, or falls
// back to DEFAULT_PROVIDER_ID ('claude') when they have none. Real SQLite via
// `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { getDefaultProviderForUser } from './get-default-provider-for-user.js'
import { setDefaultProviderForUser } from './set-default-provider-for-user.js'

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

describe('getDefaultProviderForUser', () => {
  it("falls back to 'claude' when the user has no preference", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(getDefaultProviderForUser(db, user.id)).toBe('claude')
    })
  })

  it('returns the explicitly-set default when the user has chosen one', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      setDefaultProviderForUser(db, { userId: user.id, providerId: 'codex' })
      expect(getDefaultProviderForUser(db, user.id)).toBe('codex')
    })
  })
})

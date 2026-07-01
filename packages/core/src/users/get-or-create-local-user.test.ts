// Tests for getOrCreateLocalUser. Uses @vynel/testing's withTestDatabase
// (core depends on db; the cycle does not form here).

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from './get-or-create-local-user.js'
import { listPreferencesForUser, listAllUsers } from '@vynel/db/repositories/users'

describe('getOrCreateLocalUser', () => {
  it('creates a user on first call', async () => {
    await withTestDatabase((db) => {
      expect(listAllUsers(db)).toEqual([])
      const user = getOrCreateLocalUser(db)
      expect(user.id).toBeTruthy()
      expect(user.displayName).toBeTruthy()
      expect(user.hasCompletedOnboarding).toBe(false)
      expect(listAllUsers(db)).toHaveLength(1)
    })
  })

  it('returns the same user on second call (idempotent)', async () => {
    await withTestDatabase((db) => {
      const first = getOrCreateLocalUser(db)
      const second = getOrCreateLocalUser(db)
      expect(second.id).toBe(first.id)
      expect(second.createdAt).toEqual(first.createdAt)
      expect(listAllUsers(db)).toHaveLength(1)
    })
  })

  it('seeds the three default preferences (theme + chatStreamingEnabled + reducedMotion)', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      const prefs = listPreferencesForUser(db, user.id)
      const keys = prefs.map((p) => p.preferenceKey).sort()
      expect(keys).toEqual(['chatStreamingEnabled', 'reducedMotion', 'theme'])
    })
  })

  it('logs creation via the optional logger', async () => {
    await withTestDatabase((db) => {
      const calls: Array<{ obj: object; msg: string }> = []
      const logger = { info: (obj: object, msg: string) => calls.push({ obj, msg }) }
      getOrCreateLocalUser(db, { logger })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.msg).toMatch(/local user created/i)
    })
  })
})

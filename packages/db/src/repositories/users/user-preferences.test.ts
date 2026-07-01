// Repository tests for the `user_preferences` table. Uses the LOCAL
// test-support helper. Bodies match the contract in
// `docs/blueprints/users/blueprint.md §4.2`.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from './users.js'
import {
  listPreferencesForUser,
  findPreferenceForUser,
  upsertPreferenceForUser,
  deletePreferenceForUser,
} from './user-preferences.js'

function makeUserId(db: Parameters<typeof insertUser>[0]): string {
  const id = randomUUID()
  insertUser(db, {
    id,
    displayName: 'P',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe('user_preferences repository', () => {
  it('listPreferencesForUser returns rows for the user', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(listPreferencesForUser(db, userId)).toEqual([])
      upsertPreferenceForUser(db, userId, 'theme', JSON.stringify('dark'))
      upsertPreferenceForUser(db, userId, 'reducedMotion', JSON.stringify(true))
      const rows = listPreferencesForUser(db, userId)
      expect(rows).toHaveLength(2)
      const keys = rows.map((r) => r.preferenceKey).sort()
      expect(keys).toEqual(['reducedMotion', 'theme'])
    })
  })

  it('findPreferenceForUser returns the row when present, null when absent', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(findPreferenceForUser(db, userId, 'theme')).toBeNull()
      upsertPreferenceForUser(db, userId, 'theme', JSON.stringify('light'))
      const row = findPreferenceForUser(db, userId, 'theme')
      expect(row?.preferenceValue).toBe(JSON.stringify('light'))
    })
  })

  it('upsertPreferenceForUser inserts on first call, updates on second', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      const first = upsertPreferenceForUser(db, userId, 'theme', JSON.stringify('dark'))
      const firstAt = first.updatedAt.getTime()
      // bump the clock by sleeping a millisecond
      const tick = new Promise((r) => setTimeout(r, 2))
      return tick.then(() => {
        const second = upsertPreferenceForUser(db, userId, 'theme', JSON.stringify('light'))
        expect(second.preferenceValue).toBe(JSON.stringify('light'))
        expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(firstAt)
        expect(listPreferencesForUser(db, userId)).toHaveLength(1)
      })
    })
  })

  it('deletePreferenceForUser returns true on hit, false on miss', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(deletePreferenceForUser(db, userId, 'theme')).toBe(false)
      upsertPreferenceForUser(db, userId, 'theme', JSON.stringify('dark'))
      expect(deletePreferenceForUser(db, userId, 'theme')).toBe(true)
      expect(findPreferenceForUser(db, userId, 'theme')).toBeNull()
    })
  })

  // FK cascade (ON DELETE CASCADE on user_preferences.userId → users.id)
  // is verified structurally by the generated migration SQL +
  // `dialect.test.ts`. A behavioral test lands in Phase 2 when the
  // user-deletion path ships (D11 says no Phase 1 delete-user flow).
})

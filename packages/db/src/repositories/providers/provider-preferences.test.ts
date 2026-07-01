// Repository tests for the `provider_preferences` table. Uses the LOCAL
// test-support helper to avoid the `packages/db <-> packages/testing`
// workspace cycle (per `.claude/rules/structure-standard.md`
// "packages/db/src/"). Spec: `docs/blueprints/providers/blueprint.md §17.8`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  findProviderPreferenceForUserAndProvider,
  findDefaultProviderPreferenceForUser,
  listProviderPreferencesForUser,
  insertProviderPreference,
  updateProviderPreference,
  clearDefaultProviderPreferenceForUser,
  type NewProviderPreference,
} from './provider-preferences.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeProviderPreference(
  userId: string,
  overrides: Partial<NewProviderPreference> = {},
): NewProviderPreference {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    providerId: 'claude',
    isDefault: true,
    defaultSettings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('provider-preferences repository', () => {
  it('findProviderPreferenceForUserAndProvider returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertProviderPreference(
        db,
        makeProviderPreference(user.id, { providerId: 'claude' }),
      )
      const found = findProviderPreferenceForUserAndProvider(db, user.id, 'claude')
      expect(found?.id).toBe(inserted.id)
    })
  })

  it('findProviderPreferenceForUserAndProvider returns null when absent', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(findProviderPreferenceForUserAndProvider(db, user.id, 'claude')).toBeNull()
    })
  })

  it('findDefaultProviderPreferenceForUser returns the row flagged isDefault', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertProviderPreference(
        db,
        makeProviderPreference(user.id, { providerId: 'codex', isDefault: false }),
      )
      const def = insertProviderPreference(
        db,
        makeProviderPreference(user.id, { providerId: 'claude', isDefault: true }),
      )
      expect(findDefaultProviderPreferenceForUser(db, user.id)?.id).toBe(def.id)
    })
  })

  it('findDefaultProviderPreferenceForUser returns null when the user has no default', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertProviderPreference(db, makeProviderPreference(user.id, { isDefault: false }))
      expect(findDefaultProviderPreferenceForUser(db, user.id)).toBeNull()
    })
  })

  it("listProviderPreferencesForUser returns all the user's rows", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertProviderPreference(db, makeProviderPreference(user.id, { providerId: 'claude' }))
      insertProviderPreference(
        db,
        makeProviderPreference(user.id, { providerId: 'codex', isDefault: false }),
      )
      expect(listProviderPreferencesForUser(db, user.id)).toHaveLength(2)
    })
  })

  it('listProviderPreferencesForUser returns an empty array for an unknown user', async () => {
    await withTestDatabase((db) => {
      expect(listProviderPreferencesForUser(db, randomUUID())).toEqual([])
    })
  })

  it('listProviderPreferencesForUser is scoped to the user', async () => {
    await withTestDatabase((db) => {
      const userA = makeUser()
      const userB = makeUser()
      insertUser(db, userA)
      insertUser(db, userB)
      insertProviderPreference(db, makeProviderPreference(userA.id))
      insertProviderPreference(db, makeProviderPreference(userB.id))
      expect(listProviderPreferencesForUser(db, userA.id)).toHaveLength(1)
    })
  })

  it('insertProviderPreference returns the inserted row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const row = makeProviderPreference(user.id, {
        defaultSettings: { permissionMode: 'plan-only' },
      })
      const inserted = insertProviderPreference(db, row)
      expect(inserted.id).toBe(row.id)
      expect(inserted.defaultSettings).toEqual({ permissionMode: 'plan-only' })
    })
  })

  it('updateProviderPreference updates the row and bumps updatedAt', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const insertedAt = new Date(Date.now() - 60_000)
      const inserted = insertProviderPreference(
        db,
        makeProviderPreference(user.id, { isDefault: false, updatedAt: insertedAt }),
      )
      const beforeUpdate = Date.now()
      const updated = updateProviderPreference(db, inserted.id, { isDefault: true })
      expect(updated).not.toBeNull()
      expect(updated?.isDefault).toBe(true)
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate)
    })
  })

  it('updateProviderPreference returns null when the id is not found', async () => {
    await withTestDatabase((db) => {
      expect(updateProviderPreference(db, randomUUID(), { isDefault: true })).toBeNull()
    })
  })

  it("clearDefaultProviderPreferenceForUser flips the user's isDefault rows to false", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertProviderPreference(
        db,
        makeProviderPreference(user.id, { providerId: 'claude', isDefault: true }),
      )
      clearDefaultProviderPreferenceForUser(db, user.id)
      expect(findDefaultProviderPreferenceForUser(db, user.id)).toBeNull()
    })
  })

  it("clearDefaultProviderPreferenceForUser leaves another user's rows untouched", async () => {
    await withTestDatabase((db) => {
      const userA = makeUser()
      const userB = makeUser()
      insertUser(db, userA)
      insertUser(db, userB)
      insertProviderPreference(db, makeProviderPreference(userA.id, { isDefault: true }))
      insertProviderPreference(db, makeProviderPreference(userB.id, { isDefault: true }))
      clearDefaultProviderPreferenceForUser(db, userA.id)
      expect(findDefaultProviderPreferenceForUser(db, userA.id)).toBeNull()
      expect(findDefaultProviderPreferenceForUser(db, userB.id)).not.toBeNull()
    })
  })
})

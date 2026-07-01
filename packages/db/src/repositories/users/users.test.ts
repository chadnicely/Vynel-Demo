// Repository tests for the `users` table. Uses the LOCAL test-support
// helper to avoid the `packages/db ↔ packages/testing` workspace cycle
// (per `.claude/rules/structure-standard.md` "packages/db/src/").

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import {
  findUserById,
  getUserByIdOrThrow,
  findSingleLocalUser,
  listAllUsers,
  insertUser,
  updateUser,
  type NewUser,
} from './users.js'

function makeNewUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    id: randomUUID(),
    displayName: 'Alex',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('users repository', () => {
  it('findUserById returns the row when present', async () => {
    await withTestDatabase((db) => {
      const inserted = insertUser(db, makeNewUser())
      const found = findUserById(db, inserted.id)
      expect(found?.id).toBe(inserted.id)
      expect(found?.displayName).toBe('Alex')
    })
  })

  it('findUserById returns null when the user is absent', async () => {
    await withTestDatabase((db) => {
      const found = findUserById(db, randomUUID())
      expect(found).toBeNull()
    })
  })

  it('getUserByIdOrThrow throws when the user is absent', async () => {
    await withTestDatabase((db) => {
      expect(() => getUserByIdOrThrow(db, randomUUID())).toThrow(/not found/)
    })
  })

  it('findSingleLocalUser returns the only row in Phase 1', async () => {
    await withTestDatabase((db) => {
      expect(findSingleLocalUser(db)).toBeNull()
      const inserted = insertUser(db, makeNewUser({ displayName: 'Solo' }))
      const found = findSingleLocalUser(db)
      expect(found?.id).toBe(inserted.id)
    })
  })

  it('listAllUsers returns the users present', async () => {
    await withTestDatabase((db) => {
      expect(listAllUsers(db)).toEqual([])
      insertUser(db, makeNewUser({ displayName: 'One' }))
      const rows = listAllUsers(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.displayName).toBe('One')
    })
  })

  it('insertUser returns the inserted row with timestamps', async () => {
    await withTestDatabase((db) => {
      const newUser = makeNewUser({ displayName: 'Pat' })
      const inserted = insertUser(db, newUser)
      expect(inserted.id).toBe(newUser.id)
      expect(inserted.displayName).toBe('Pat')
      expect(inserted.createdAt).toBeInstanceOf(Date)
      expect(inserted.updatedAt).toBeInstanceOf(Date)
    })
  })

  it('updateUser bumps updatedAt and applies the patch', async () => {
    await withTestDatabase((db) => {
      const originalUpdatedAt = new Date(Date.now() - 60_000)
      const inserted = insertUser(
        db,
        makeNewUser({
          displayName: 'Original',
          updatedAt: originalUpdatedAt,
        }),
      )
      const updated = updateUser(db, inserted.id, { displayName: 'Renamed' })
      expect(updated?.displayName).toBe('Renamed')
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })
  })

  it('updateUser returns null when the user does not exist', async () => {
    await withTestDatabase((db) => {
      const result = updateUser(db, randomUUID(), { displayName: 'ghost' })
      expect(result).toBeNull()
    })
  })
})

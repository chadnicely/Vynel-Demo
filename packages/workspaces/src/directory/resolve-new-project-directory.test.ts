import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser, updateUser } from '@vynel/db/repositories/users'
import { resolveNewProjectDirectory } from './resolve-new-project-directory.js'

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

describe('resolveNewProjectDirectory', () => {
  it("returns the user's own projects folder when one is set", async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      updateUser(db, userId, { projectsDirectory: 'D:\\Work\\Projects' })

      expect(await resolveNewProjectDirectory(db, userId)).toBe('D:\\Work\\Projects')
    })
  })

  it('falls back to the shared default (creating it) when none is set', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      // Null projectsDirectory → the default home; it is a real path under the
      // user's Documents, which the fallback creates on the spot.
      const resolved = await resolveNewProjectDirectory(db, userId)
      expect(resolved.replace(/\\/g, '/')).toMatch(/\/Documents\/Vynel$/)
    })
  })
})

// Tests for listWorkspacesForUser core op. Thin wrapper; one happy-path
// test + the includeArchived toggle suffice (repo tests already cover
// the ordering, limit clamp, and edge cases).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listWorkspacesForUser } from './list-workspaces-for-user.js'

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

function makeWorkspace(userId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    ...overrides,
  }
}

describe('listWorkspacesForUser', () => {
  it("returns the user's workspaces", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      insertWorkspace(db, makeWorkspace(user.id))
      insertWorkspace(db, makeWorkspace(user.id))
      const list = await listWorkspacesForUser(db, { userId: user.id })
      expect(list).toHaveLength(2)
    })
  })

  it('respects includeArchived', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: true }))
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: false }))

      const defaultList = await listWorkspacesForUser(db, { userId: user.id })
      expect(defaultList).toHaveLength(1)

      const allList = await listWorkspacesForUser(db, { userId: user.id, includeArchived: true })
      expect(allList).toHaveLength(2)
    })
  })
})

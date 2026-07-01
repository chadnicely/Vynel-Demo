// Tests for getWorkspaceById core op.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/core/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { getWorkspaceById } from './get-workspace-by-id.js'

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

function makeWorkspace(userId: string) {
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
  }
}

describe('getWorkspaceById', () => {
  it('returns the workspace when owned by the user', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      const got = await getWorkspaceById(db, inserted.id, user.id)
      expect(got.id).toBe(inserted.id)
    })
  })

  it('throws NotFoundError when the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      await expect(getWorkspaceById(db, randomUUID(), user.id)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  it('throws NotFoundError (not ForbiddenError) when the workspace belongs to another user — no enumeration leak', async () => {
    await withTestDatabase(async (db) => {
      const owner = makeUser()
      const other = makeUser()
      insertUser(db, owner)
      insertUser(db, other)
      const ownersWorkspace = insertWorkspace(db, makeWorkspace(owner.id))
      await expect(getWorkspaceById(db, ownersWorkspace.id, other.id)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })
})

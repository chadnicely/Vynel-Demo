// Tests for updateWorkspaceMetadata core op.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { updateWorkspaceMetadata } from './update-workspace-metadata.js'

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

describe('updateWorkspaceMetadata', () => {
  it('updates the name and returns the updated workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      const updated = await updateWorkspaceMetadata(db, inserted.id, { name: 'Renamed Inc.' })
      expect(updated.name).toBe('Renamed Inc.')
    })
  })

  it('updates the managerName (the Ch5 manager persona)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      const updated = await updateWorkspaceMetadata(db, inserted.id, { managerName: 'Sarah' })
      expect(updated.managerName).toBe('Sarah')
    })
  })

  it('throws NotFoundError when the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      await expect(updateWorkspaceMetadata(db, randomUUID(), { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  it('toggles continueEnabled; a workspace inserted without it defaults to enabled (additive guard)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      // makeWorkspace omits continueEnabled — the pre-migration row shape.
      // It must backfill to enabled (default-on is the product thesis).
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      expect(inserted.continueEnabled).toBe(true)

      const off = await updateWorkspaceMetadata(db, inserted.id, { continueEnabled: false })
      expect(off.continueEnabled).toBe(false)

      const on = await updateWorkspaceMetadata(db, inserted.id, { continueEnabled: true })
      expect(on.continueEnabled).toBe(true)
    })
  })
})

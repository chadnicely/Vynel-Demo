// Tests for archiveWorkspace + unarchiveWorkspace core ops.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { archiveWorkspace, unarchiveWorkspace } from './archive-workspace.js'
import { WORKSPACE_ARCHIVED_EVENT } from './workspaces-events.js'

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

describe('archiveWorkspace', () => {
  it('sets isArchived to true and returns the updated workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      const updated = await archiveWorkspace(db, inserted.id)
      expect(updated.isArchived).toBe(true)
    })
  })

  it('publishes workspace.archived to the outbox in the same transaction', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      await archiveWorkspace(db, inserted.id)
      const events = listOutboxEventsByType(db, WORKSPACE_ARCHIVED_EVENT)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        workspaceId: inserted.id,
        userId: user.id,
      })
    })
  })

  it('throws NotFoundError when the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      await expect(archiveWorkspace(db, randomUUID())).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

describe('unarchiveWorkspace', () => {
  it('sets isArchived to false and returns the updated workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, { ...makeWorkspace(user.id), isArchived: true })
      const updated = await unarchiveWorkspace(db, inserted.id)
      expect(updated.isArchived).toBe(false)
    })
  })

  it('does NOT publish an outbox event (deliberate asymmetry per D14)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, { ...makeWorkspace(user.id), isArchived: true })
      await unarchiveWorkspace(db, inserted.id)
      // No workspace.unarchived event exists by design.
      const archivedEvents = listOutboxEventsByType(db, WORKSPACE_ARCHIVED_EVENT)
      expect(archivedEvents).toHaveLength(0)
    })
  })

  it('throws NotFoundError when the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      await expect(unarchiveWorkspace(db, randomUUID())).rejects.toBeInstanceOf(NotFoundError)
      // Sanity check
      expect(findWorkspaceById(db, randomUUID())).toBeNull()
    })
  })
})

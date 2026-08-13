// Tests for deleteWorkspaceGroup — the one-transaction detach + delete +
// outbox co-commit, and the owner-scoped 404 semantics.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import {
  insertWorkspace,
  insertWorkspaceGroup,
  findWorkspaceById,
  findWorkspaceGroupById,
} from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { deleteWorkspaceGroup } from './delete-workspace-group.js'
import { WORKSPACE_GROUP_DELETED_EVENT } from '../workspaces-events.js'

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

function makeGroup(userId: string) {
  const now = new Date()
  return { id: randomUUID(), userId, name: 'Development', createdAt: now, updatedAt: now }
}

function makeWorkspace(userId: string, groupId: string | null) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'project' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    groupId,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('deleteWorkspaceGroup', () => {
  it('detaches members, deletes the row, co-commits workspace-group.deleted', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const group = insertWorkspaceGroup(db, makeGroup(user.id))
      const member = insertWorkspace(db, makeWorkspace(user.id, group.id))
      const rootRow = insertWorkspace(db, makeWorkspace(user.id, null))

      await deleteWorkspaceGroup(db, { userId: user.id, groupId: group.id })

      expect(findWorkspaceGroupById(db, group.id)).toBeNull()
      expect(findWorkspaceById(db, member.id)?.groupId).toBeNull()
      expect(findWorkspaceById(db, rootRow.id)?.groupId).toBeNull()

      const events = listOutboxEventsByType(db, WORKSPACE_GROUP_DELETED_EVENT)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        groupId: group.id,
        userId: user.id,
        name: 'Development',
        detachedWorkspaceCount: 1,
      })
    })
  })

  it("404s a foreign user's group without touching it", async () => {
    await withTestDatabase(async (db) => {
      const owner = makeUser()
      const intruder = makeUser()
      insertUser(db, owner)
      insertUser(db, intruder)
      const group = insertWorkspaceGroup(db, makeGroup(owner.id))

      await expect(
        deleteWorkspaceGroup(db, { userId: intruder.id, groupId: group.id }),
      ).rejects.toThrow(NotFoundError)
      expect(findWorkspaceGroupById(db, group.id)).not.toBeNull()
    })
  })
})

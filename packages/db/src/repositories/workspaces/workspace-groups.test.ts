// Repository tests for the `workspace_groups` table + the loose-ref detach
// helper on `workspaces`. Uses the LOCAL test-support helper to avoid the
// `packages/db ↔ packages/testing` workspace cycle.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  insertWorkspace,
  findWorkspaceById,
  detachWorkspacesFromGroup,
  type NewWorkspace,
} from './workspaces.js'
import {
  insertWorkspaceGroup,
  findWorkspaceGroupById,
  listWorkspaceGroupsForUser,
  updateWorkspaceGroup,
  deleteWorkspaceGroup,
  type NewWorkspaceGroup,
} from './workspace-groups.js'

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

function makeGroup(userId: string, overrides: Partial<NewWorkspaceGroup> = {}): NewWorkspaceGroup {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Development',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeWorkspace(userId: string, overrides: Partial<NewWorkspace> = {}): NewWorkspace {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    ...overrides,
  }
}

describe('workspace-groups repository', () => {
  it('insert + find round-trips a group', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspaceGroup(db, makeGroup(user.id))
      const found = findWorkspaceGroupById(db, inserted.id)
      expect(found?.name).toBe('Development')
      expect(found?.userId).toBe(user.id)
    })
  })

  it('listWorkspaceGroupsForUser returns only that user, in creation order', async () => {
    await withTestDatabase((db) => {
      const owner = makeUser()
      const other = makeUser()
      insertUser(db, owner)
      insertUser(db, other)
      const early = new Date('2026-08-01T00:00:00.000Z')
      const late = new Date('2026-08-02T00:00:00.000Z')
      insertWorkspaceGroup(db, makeGroup(owner.id, { name: 'Second', createdAt: late }))
      insertWorkspaceGroup(db, makeGroup(owner.id, { name: 'First', createdAt: early }))
      insertWorkspaceGroup(db, makeGroup(other.id, { name: 'Foreign' }))

      const listed = listWorkspaceGroupsForUser(db, owner.id)
      expect(listed.map((group) => group.name)).toEqual(['First', 'Second'])
    })
  })

  it('updateWorkspaceGroup renames and stamps updatedAt; null on missing', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const group = insertWorkspaceGroup(
        db,
        makeGroup(user.id, { updatedAt: new Date('2026-08-01T00:00:00.000Z') }),
      )

      const renamed = updateWorkspaceGroup(db, group.id, { name: 'Clients' })
      expect(renamed?.name).toBe('Clients')
      expect(renamed!.updatedAt.getTime()).toBeGreaterThan(group.createdAt.getTime() - 1)
      expect(updateWorkspaceGroup(db, randomUUID(), { name: 'x' })).toBeNull()
    })
  })

  it('deleteWorkspaceGroup reports whether a row died', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const group = insertWorkspaceGroup(db, makeGroup(user.id))
      expect(deleteWorkspaceGroup(db, group.id)).toBe(true)
      expect(deleteWorkspaceGroup(db, group.id)).toBe(false)
      expect(findWorkspaceGroupById(db, group.id)).toBeNull()
    })
  })

  it("detachWorkspacesFromGroup clears exactly that group's members", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const group = insertWorkspaceGroup(db, makeGroup(user.id))
      const otherGroup = insertWorkspaceGroup(db, makeGroup(user.id, { name: 'Other' }))
      const member = insertWorkspace(db, makeWorkspace(user.id, { groupId: group.id }))
      const bystander = insertWorkspace(db, makeWorkspace(user.id, { groupId: otherGroup.id }))

      expect(detachWorkspacesFromGroup(db, group.id)).toBe(1)
      expect(findWorkspaceById(db, member.id)?.groupId).toBeNull()
      expect(findWorkspaceById(db, bystander.id)?.groupId).toBe(otherGroup.id)
    })
  })
})

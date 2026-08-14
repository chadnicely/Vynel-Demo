// Tests for setWorkspaceGroup (+ renameWorkspaceGroup's owner scoping) —
// assign, clear, and the no-enumeration-leak 404s.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import {
  insertWorkspace,
  insertWorkspaceGroup,
  findWorkspaceGroupById,
} from '@vynel/db/repositories/workspaces'
import { setWorkspaceGroup } from './set-workspace-group.js'
import { renameWorkspaceGroup } from './rename-workspace-group.js'

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

function makeGroup(userId: string, name = 'Development') {
  const now = new Date()
  return { id: randomUUID(), userId, name, createdAt: now, updatedAt: now }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'project' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('setWorkspaceGroup', () => {
  it('moves a workspace into a folder and back to the root', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const group = insertWorkspaceGroup(db, makeGroup(user.id))
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const inFolder = await setWorkspaceGroup(db, {
        userId: user.id,
        workspaceId: workspace.id,
        groupId: group.id,
      })
      expect(inFolder.groupId).toBe(group.id)

      const atRoot = await setWorkspaceGroup(db, {
        userId: user.id,
        workspaceId: workspace.id,
        groupId: null,
      })
      expect(atRoot.groupId).toBeNull()
    })
  })

  it("404s a foreign user's group exactly like a missing one", async () => {
    await withTestDatabase(async (db) => {
      const owner = makeUser()
      const intruder = makeUser()
      insertUser(db, owner)
      insertUser(db, intruder)
      const foreignGroup = insertWorkspaceGroup(db, makeGroup(owner.id))
      const workspace = insertWorkspace(db, makeWorkspace(intruder.id))

      await expect(
        setWorkspaceGroup(db, {
          userId: intruder.id,
          workspaceId: workspace.id,
          groupId: foreignGroup.id,
        }),
      ).rejects.toThrow(NotFoundError)
      await expect(
        setWorkspaceGroup(db, {
          userId: intruder.id,
          workspaceId: workspace.id,
          groupId: randomUUID(),
        }),
      ).rejects.toThrow(NotFoundError)
    })
  })

  it('404s a missing workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      await expect(
        setWorkspaceGroup(db, { userId: user.id, workspaceId: randomUUID(), groupId: null }),
      ).rejects.toThrow(NotFoundError)
    })
  })
})

describe('renameWorkspaceGroup', () => {
  it('renames with trimming; owner-scoped; validates', async () => {
    await withTestDatabase(async (db) => {
      const owner = makeUser()
      const intruder = makeUser()
      insertUser(db, owner)
      insertUser(db, intruder)
      const group = insertWorkspaceGroup(db, makeGroup(owner.id))

      const renamed = await renameWorkspaceGroup(db, {
        userId: owner.id,
        groupId: group.id,
        name: '  Clients  ',
      })
      expect(renamed.name).toBe('Clients')
      expect(findWorkspaceGroupById(db, group.id)?.name).toBe('Clients')

      await expect(
        renameWorkspaceGroup(db, { userId: intruder.id, groupId: group.id, name: 'Mine' }),
      ).rejects.toThrow(NotFoundError)
      await expect(
        renameWorkspaceGroup(db, { userId: owner.id, groupId: group.id, name: ' ' }),
      ).rejects.toThrow(ValidationError)
    })
  })
})

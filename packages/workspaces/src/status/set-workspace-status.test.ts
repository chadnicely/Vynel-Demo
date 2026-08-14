// Tests for setWorkspaceStatus — the set writes all three columns + the
// outbox event in one transaction; owner scoping 404s a foreign workspace
// exactly like a missing one.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { setWorkspaceStatus } from './set-workspace-status.js'
import { WORKSPACE_STATUS_SET_EVENT } from '../workspaces-events.js'

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
    kind: 'project' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('setWorkspaceStatus', () => {
  it('writes status + note + setAt and co-commits the outbox event', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const updated = await setWorkspaceStatus(db, {
        userId: user.id,
        workspaceId: workspace.id,
        status: 'completed',
        note: 'All 5 tasks shipped',
      })

      expect(updated.status).toBe('completed')
      expect(updated.statusNote).toBe('All 5 tasks shipped')
      expect(updated.statusSetAt).toBeInstanceOf(Date)

      const persisted = findWorkspaceById(db, workspace.id)
      expect(persisted?.status).toBe('completed')

      const statusEvents = listOutboxEventsByType(db, WORKSPACE_STATUS_SET_EVENT)
      expect(statusEvents).toHaveLength(1)
      expect(statusEvents[0]!.payload).toMatchObject({
        workspaceId: workspace.id,
        userId: user.id,
        status: 'completed',
        note: 'All 5 tasks shipped',
      })
    })
  })

  it('a later set replaces the earlier one (last write wins)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      await setWorkspaceStatus(db, {
        userId: user.id,
        workspaceId: workspace.id,
        status: 'problem',
        note: 'Build is red',
      })
      const second = await setWorkspaceStatus(db, {
        userId: user.id,
        workspaceId: workspace.id,
        status: 'needs_input',
      })

      expect(second.status).toBe('needs_input')
      expect(second.statusNote).toBeNull()
    })
  })

  it("404s a foreign user's workspace exactly like a missing one", async () => {
    await withTestDatabase(async (db) => {
      const owner = makeUser()
      const stranger = makeUser()
      insertUser(db, owner)
      insertUser(db, stranger)
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))

      await expect(
        setWorkspaceStatus(db, {
          userId: stranger.id,
          workspaceId: workspace.id,
          status: 'completed',
        }),
      ).rejects.toThrow(NotFoundError)

      await expect(
        setWorkspaceStatus(db, {
          userId: owner.id,
          workspaceId: randomUUID(),
          status: 'completed',
        }),
      ).rejects.toThrow(NotFoundError)

      expect(findWorkspaceById(db, workspace.id)?.status).toBeNull()
    })
  })
})

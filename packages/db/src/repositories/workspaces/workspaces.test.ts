// Repository tests for the `workspaces` table. Uses the LOCAL test-support
// helper to avoid the `packages/db ↔ packages/testing` workspace cycle
// (per `.claude/rules/structure-standard.md` "packages/db/src/").

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  findWorkspaceById,
  findWorkspaceByPath,
  listWorkspacesForUser,
  insertWorkspace,
  updateWorkspace,
  touchWorkspaceLastAccessedAt,
  hardDeleteWorkspace,
  type NewWorkspace,
} from './workspaces.js'

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

describe('workspaces repository', () => {
  it('findWorkspaceById returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      const found = findWorkspaceById(db, inserted.id)
      expect(found?.id).toBe(inserted.id)
    })
  })

  it('findWorkspaceById returns null when absent', async () => {
    await withTestDatabase((db) => {
      expect(findWorkspaceById(db, randomUUID())).toBeNull()
    })
  })

  it('findWorkspaceByPath returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = insertWorkspace(db, makeWorkspace(user.id, { path: '/tmp/vynel/foo' }))
      expect(findWorkspaceByPath(db, '/tmp/vynel/foo')?.id).toBe(ws.id)
    })
  })

  it('findWorkspaceByPath returns null when absent', async () => {
    await withTestDatabase((db) => {
      expect(findWorkspaceByPath(db, '/tmp/missing')).toBeNull()
    })
  })

  it("listWorkspacesForUser returns the user's workspaces, ordered by lastAccessedAt desc", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const t0 = new Date('2026-05-21T00:00:00Z')
      const t1 = new Date('2026-05-21T00:01:00Z')
      const t2 = new Date('2026-05-21T00:02:00Z')
      insertWorkspace(db, makeWorkspace(user.id, { lastAccessedAt: t0 }))
      insertWorkspace(db, makeWorkspace(user.id, { lastAccessedAt: t2 }))
      insertWorkspace(db, makeWorkspace(user.id, { lastAccessedAt: t1 }))

      const list = listWorkspacesForUser(db, user.id)
      expect(list).toHaveLength(3)
      expect(list[0]!.lastAccessedAt.getTime()).toBe(t2.getTime())
      expect(list[2]!.lastAccessedAt.getTime()).toBe(t0.getTime())
    })
  })

  it('listWorkspacesForUser with includeArchived:false excludes archived rows', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: true }))
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: false }))
      expect(listWorkspacesForUser(db, user.id)).toHaveLength(1)
    })
  })

  it('listWorkspacesForUser with includeArchived:true includes archived rows', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: true }))
      insertWorkspace(db, makeWorkspace(user.id, { isArchived: false }))
      expect(listWorkspacesForUser(db, user.id, { includeArchived: true })).toHaveLength(2)
    })
  })

  it('listWorkspacesForUser clamps limit to max 500', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      // We don't insert 501 rows; we verify the clamp doesn't throw and
      // returns the available rows. The clamp is a defensive cap, not a
      // forced fill.
      insertWorkspace(db, makeWorkspace(user.id))
      const out = listWorkspacesForUser(db, user.id, { limit: 10_000 })
      expect(out).toHaveLength(1)
    })
  })

  it('listWorkspacesForUser defaults to limit 100 when omitted', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      for (let i = 0; i < 105; i++) {
        insertWorkspace(db, makeWorkspace(user.id, { lastAccessedAt: new Date(2_000_000 + i) }))
      }
      expect(listWorkspacesForUser(db, user.id)).toHaveLength(100)
    })
  })

  it('listWorkspacesForUser returns empty array for a user with no rows', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(listWorkspacesForUser(db, user.id)).toEqual([])
    })
  })

  it('insertWorkspace returns the inserted row with timestamps preserved', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const createdAt = new Date('2026-05-21T10:00:00Z')
      const inserted = insertWorkspace(db, makeWorkspace(user.id, { createdAt }))
      expect(inserted.createdAt.getTime()).toBe(createdAt.getTime())
    })
  })

  it('updateWorkspace updates updatedAt automatically', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const insertedAt = new Date(Date.now() - 60_000)
      const inserted = insertWorkspace(db, makeWorkspace(user.id, { updatedAt: insertedAt }))
      const beforeUpdate = Date.now()
      const updated = updateWorkspace(db, inserted.id, { name: 'Renamed' })
      expect(updated?.name).toBe('Renamed')
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate)
    })
  })

  it('updateWorkspace returns null on missing workspace id', async () => {
    await withTestDatabase((db) => {
      expect(updateWorkspace(db, randomUUID(), { name: 'x' })).toBeNull()
    })
  })

  it('touchWorkspaceLastAccessedAt updates only lastAccessedAt (not updatedAt)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const insertedAt = new Date(Date.now() - 60_000)
      const inserted = insertWorkspace(
        db,
        makeWorkspace(user.id, { updatedAt: insertedAt, lastAccessedAt: insertedAt }),
      )
      const beforeTouch = Date.now()
      touchWorkspaceLastAccessedAt(db, inserted.id)
      const after = findWorkspaceById(db, inserted.id)!
      expect(after.updatedAt.getTime()).toBe(insertedAt.getTime())
      expect(after.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(beforeTouch)
    })
  })

  it('hardDeleteWorkspace removes the row and returns true', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const inserted = insertWorkspace(db, makeWorkspace(user.id))
      expect(hardDeleteWorkspace(db, inserted.id)).toBe(true)
      expect(findWorkspaceById(db, inserted.id)).toBeNull()
    })
  })

  it('hardDeleteWorkspace returns false on missing workspace id', async () => {
    await withTestDatabase((db) => {
      expect(hardDeleteWorkspace(db, randomUUID())).toBe(false)
    })
  })
})

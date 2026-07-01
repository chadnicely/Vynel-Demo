// Repository integration tests for `workspace_capabilities`. Real SQLite via
// the local `withTestDatabase` helper (foundation §2 row 12 — no DB mocking).
// Spec: `.claude/plans/capability-platform.md` (Gate 1).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  findWorkspaceCapability,
  listWorkspaceCapabilities,
  insertWorkspaceCapability,
  updateWorkspaceCapabilityEnabled,
  type NewWorkspaceCapabilityRow,
} from './workspace-capabilities.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeWorkspaceCapability(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewWorkspaceCapabilityRow> = {},
): NewWorkspaceCapabilityRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    capabilityId: 'memory',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('workspace-capabilities repository', () => {
  describe('findWorkspaceCapability', () => {
    it('returns the row when present', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertWorkspaceCapability(db, makeWorkspaceCapability(user.id, workspace.id))
        const found = findWorkspaceCapability(db, {
          workspaceId: workspace.id,
          capabilityId: 'memory',
        })
        expect(found?.id).toBe(inserted.id)
        expect(found?.isEnabled).toBe(true)
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(
          findWorkspaceCapability(db, { workspaceId: workspace.id, capabilityId: 'memory' }),
        ).toBeNull()
      })
    })
  })

  describe('listWorkspaceCapabilities', () => {
    it('returns all rows for the workspace (enabled and disabled)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspace.id, { capabilityId: 'memory' }),
        )
        insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspace.id, {
            capabilityId: 'knowledge',
            isEnabled: false,
          }),
        )
        const list = listWorkspaceCapabilities(db, workspace.id)
        expect(list.map((r) => r.capabilityId).sort()).toEqual(['knowledge', 'memory'])
      })
    })

    it('excludes rows from other workspaces', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspaceA = insertWorkspace(db, makeWorkspace(user.id))
        const workspaceB = insertWorkspace(db, makeWorkspace(user.id))
        insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspaceA.id, { capabilityId: 'memory' }),
        )
        insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspaceB.id, { capabilityId: 'knowledge' }),
        )
        const list = listWorkspaceCapabilities(db, workspaceA.id)
        expect(list.map((r) => r.capabilityId)).toEqual(['memory'])
      })
    })

    it('returns an empty array when none exist', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(listWorkspaceCapabilities(db, workspace.id)).toEqual([])
      })
    })
  })

  describe('updateWorkspaceCapabilityEnabled', () => {
    it('flips isEnabled for the owner', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspace.id, { isEnabled: true }),
        )
        const updated = updateWorkspaceCapabilityEnabled(db, inserted.id, user.id, false)
        expect(updated?.isEnabled).toBe(false)
        expect(findWorkspaceCapability(db, { workspaceId: workspace.id, capabilityId: 'memory' })?.isEnabled).toBe(false)
      })
    })

    it('returns null for a non-owner (tenant filter)', async () => {
      await withTestDatabase((db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(owner.id))
        const inserted = insertWorkspaceCapability(db, makeWorkspaceCapability(owner.id, workspace.id))
        expect(updateWorkspaceCapabilityEnabled(db, inserted.id, other.id, false)).toBeNull()
      })
    })
  })

  describe('unique (workspace, capability)', () => {
    it('rejects a duplicate capability in the same workspace', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertWorkspaceCapability(
          db,
          makeWorkspaceCapability(user.id, workspace.id, { capabilityId: 'memory' }),
        )
        expect(() =>
          insertWorkspaceCapability(
            db,
            makeWorkspaceCapability(user.id, workspace.id, { capabilityId: 'memory' }),
          ),
        ).toThrow()
      })
    })
  })
})

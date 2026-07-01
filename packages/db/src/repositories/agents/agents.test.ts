// Repository integration tests for the `agents` table. Real SQLite via
// the local `withTestDatabase` helper (per `foundation.md §2 row 12` —
// no DB mocking). Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  findAgentById,
  findAgentBySlug,
  listAgentsForUserAndWorkspace,
  listEnabledAgentsForUserAndWorkspace,
  insertAgent,
  updateAgent,
  softDeleteAgent,
  hardDeleteAgentsDeletedBefore,
  type NewAgentRow,
} from './agents.js'

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

function makeAgent(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewAgentRow> = {},
): NewAgentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    slug: 'researcher',
    name: 'Researcher',
    description: 'Researches topics and summarizes findings.',
    icon: null,
    prompt: 'You are a careful researcher.',
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: workspaceId === null ? 'user' : 'workspace',
    source: 'vynel',
    trustTier: 'verified',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

describe('agents repository', () => {
  describe('findAgentById', () => {
    it('returns the row when present', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertAgent(db, makeAgent(user.id, workspace.id))
        const found = findAgentById(db, inserted.id)
        expect(found?.id).toBe(inserted.id)
        expect(found?.slug).toBe('researcher')
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findAgentById(db, 'nonexistent')).toBeNull()
      })
    })

    it('returns null for a soft-deleted agent', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        softDeleteAgent(db, inserted.id, user.id)
        expect(findAgentById(db, inserted.id)).toBeNull()
      })
    })
  })

  describe('findAgentBySlug', () => {
    it('finds the user-scope agent when workspaceId is null', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        const found = findAgentBySlug(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'researcher',
        })
        expect(found?.id).toBe(inserted.id)
        expect(found?.workspaceId).toBeNull()
      })
    })

    it('finds the workspace-scope agent when workspaceId is provided', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertAgent(db, makeAgent(user.id, workspace.id))
        const found = findAgentBySlug(db, {
          userId: user.id,
          workspaceId: workspace.id,
          slug: 'researcher',
        })
        expect(found?.id).toBe(inserted.id)
        expect(found?.workspaceId).toBe(workspace.id)
      })
    })

    it('distinguishes user-scope from workspace-scope for the same (user, slug)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const userScope = insertAgent(db, makeAgent(user.id, null, { slug: 'shared' }))
        const wsScope = insertAgent(db, makeAgent(user.id, workspace.id, { slug: 'shared' }))

        expect(
          findAgentBySlug(db, { userId: user.id, workspaceId: null, slug: 'shared' })?.id,
        ).toBe(userScope.id)
        expect(
          findAgentBySlug(db, { userId: user.id, workspaceId: workspace.id, slug: 'shared' })?.id,
        ).toBe(wsScope.id)
      })
    })

    it('returns null for a soft-deleted agent', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        softDeleteAgent(db, inserted.id, user.id)
        expect(
          findAgentBySlug(db, { userId: user.id, workspaceId: null, slug: 'researcher' }),
        ).toBeNull()
      })
    })
  })

  describe('listAgentsForUserAndWorkspace', () => {
    it('returns user-scope + workspace-scope agents for the given workspace', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertAgent(db, makeAgent(user.id, null, { slug: 'a' }))
        insertAgent(db, makeAgent(user.id, workspace.id, { slug: 'b' }))

        const list = listAgentsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.slug).sort()).toEqual(['a', 'b'])
      })
    })

    it('excludes workspace-scope agents from other workspaces', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspaceA = insertWorkspace(db, makeWorkspace(user.id))
        const workspaceB = insertWorkspace(db, makeWorkspace(user.id))
        insertAgent(db, makeAgent(user.id, workspaceA.id, { slug: 'a' }))
        insertAgent(db, makeAgent(user.id, workspaceB.id, { slug: 'b' }))

        const list = listAgentsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspaceA.id,
        })
        expect(list.map((r) => r.slug)).toEqual(['a'])
      })
    })

    it('excludes agents owned by other users', async () => {
      await withTestDatabase((db) => {
        const userA = insertUser(db, makeUser())
        const userB = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(userA.id))
        insertAgent(db, makeAgent(userA.id, null, { slug: 'a' }))
        insertAgent(db, makeAgent(userB.id, null, { slug: 'b' }))

        const list = listAgentsForUserAndWorkspace(db, {
          userId: userA.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.slug)).toEqual(['a'])
      })
    })

    it('excludes soft-deleted agents', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const live = insertAgent(db, makeAgent(user.id, null, { slug: 'live' }))
        const gone = insertAgent(db, makeAgent(user.id, null, { slug: 'gone' }))
        softDeleteAgent(db, gone.id, user.id)

        const list = listAgentsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.id)).toEqual([live.id])
      })
    })

    it('orders by createdAt DESC', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t0 = new Date(2026, 4, 1).getTime()
        insertAgent(
          db,
          makeAgent(user.id, null, {
            slug: 'oldest',
            createdAt: new Date(t0),
            updatedAt: new Date(t0),
          }),
        )
        insertAgent(
          db,
          makeAgent(user.id, workspace.id, {
            slug: 'middle',
            createdAt: new Date(t0 + 1000),
            updatedAt: new Date(t0 + 1000),
          }),
        )
        insertAgent(
          db,
          makeAgent(user.id, null, {
            slug: 'newest',
            createdAt: new Date(t0 + 2000),
            updatedAt: new Date(t0 + 2000),
          }),
        )

        const list = listAgentsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.slug)).toEqual(['newest', 'middle', 'oldest'])
      })
    })

    it('returns empty array when no rows exist', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(
          listAgentsForUserAndWorkspace(db, { userId: user.id, workspaceId: workspace.id }),
        ).toEqual([])
      })
    })
  })

  describe('listEnabledAgentsForUserAndWorkspace', () => {
    it('returns only enabled, live agents', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertAgent(db, makeAgent(user.id, null, { slug: 'on', enabled: true }))
        insertAgent(db, makeAgent(user.id, workspace.id, { slug: 'off', enabled: false }))
        const deleted = insertAgent(db, makeAgent(user.id, null, { slug: 'gone', enabled: true }))
        softDeleteAgent(db, deleted.id, user.id)

        const list = listEnabledAgentsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.slug)).toEqual(['on'])
      })
    })
  })

  describe('updateAgent', () => {
    it('patches fields and bumps updatedAt', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        const updated = updateAgent(db, inserted.id, user.id, {
          name: 'Renamed',
          enabled: false,
          allowedTools: ['Read', 'Grep'],
        })
        expect(updated?.name).toBe('Renamed')
        expect(updated?.enabled).toBe(false)
        expect(updated?.allowedTools).toEqual(['Read', 'Grep'])
      })
    })

    it('returns null when the agent belongs to another user (tenant isolation)', async () => {
      await withTestDatabase((db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(owner.id, null))
        expect(updateAgent(db, inserted.id, other.id, { name: 'Hacked' })).toBeNull()
      })
    })

    it('returns null for a soft-deleted agent', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        softDeleteAgent(db, inserted.id, user.id)
        expect(updateAgent(db, inserted.id, user.id, { name: 'Nope' })).toBeNull()
      })
    })
  })

  describe('softDeleteAgent', () => {
    it('sets deletedAt and is not returned by live reads', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        const deleted = softDeleteAgent(db, inserted.id, user.id)
        expect(deleted?.deletedAt).toBeInstanceOf(Date)
        expect(findAgentById(db, inserted.id)).toBeNull()
      })
    })

    it('returns null on the second call (idempotent — no live row left)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(user.id, null))
        expect(softDeleteAgent(db, inserted.id, user.id)).not.toBeNull()
        expect(softDeleteAgent(db, inserted.id, user.id)).toBeNull()
      })
    })

    it('returns null when the agent belongs to another user', async () => {
      await withTestDatabase((db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const inserted = insertAgent(db, makeAgent(owner.id, null))
        expect(softDeleteAgent(db, inserted.id, other.id)).toBeNull()
        expect(findAgentById(db, inserted.id)?.id).toBe(inserted.id)
      })
    })
  })

  describe('hardDeleteAgentsDeletedBefore', () => {
    it('removes agents soft-deleted before the cutoff and keeps live + recent ones', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const live = insertAgent(db, makeAgent(user.id, null, { slug: 'live' }))
        const aged = insertAgent(db, makeAgent(user.id, null, { slug: 'aged' }))
        softDeleteAgent(db, aged.id, user.id)

        // Cutoff in the future → the aged soft-delete is purged.
        const cutoff = new Date(Date.now() + 60_000)
        const removed = hardDeleteAgentsDeletedBefore(db, cutoff)
        expect(removed).toBe(1)

        // The live agent survives.
        expect(findAgentById(db, live.id)?.id).toBe(live.id)
      })
    })
  })

  describe('slug uniqueness', () => {
    it('allows the same slug across user-scope and workspace-scope', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const userScope = insertAgent(db, makeAgent(user.id, null, { slug: 'dup' }))
        const wsScope = insertAgent(db, makeAgent(user.id, workspace.id, { slug: 'dup' }))
        expect(userScope.id).not.toBe(wsScope.id)
      })
    })

    it('rejects a duplicate live user-scope slug (partial unique index)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        insertAgent(db, makeAgent(user.id, null, { slug: 'dup' }))
        expect(() => insertAgent(db, makeAgent(user.id, null, { slug: 'dup' }))).toThrow()
      })
    })

    it('allows re-using a slug after the prior agent is soft-deleted', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const first = insertAgent(db, makeAgent(user.id, null, { slug: 'dup' }))
        softDeleteAgent(db, first.id, user.id)
        const second = insertAgent(db, makeAgent(user.id, null, { slug: 'dup' }))
        expect(second.id).not.toBe(first.id)
      })
    })
  })
})

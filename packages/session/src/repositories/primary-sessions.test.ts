// Repository integration tests for the `primary_sessions` table. Real SQLite
// via the local `withTestDatabase` helper (foundation.md §2 row 12 — no DB
// mocking). Spec: `docs/agent-base/session-continuity.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findPrimarySessionById,
  findPrimarySessionForWorkspace,
  findPrimarySessionByCurrentSdkSessionId,
  findGlobalPrimarySessionForUser,
  findVoicePrimarySessionForUser,
  findAgentPrimarySession,
  insertPrimarySession,
  repointPrimarySession,
  softDeletePrimarySession,
  hardDeletePrimarySessionsDeletedBefore,
  type NewPrimarySessionRow,
} from './primary-sessions.js'

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

function makePrimarySession(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewPrimarySessionRow> = {},
): NewPrimarySessionRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

function makeGlobalPrimarySession(
  userId: string,
  overrides: Partial<NewPrimarySessionRow> = {},
): NewPrimarySessionRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

function makeVoicePrimarySession(
  userId: string,
  overrides: Partial<NewPrimarySessionRow> = {},
): NewPrimarySessionRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    scope: 'voice',
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

function makeAgentPrimarySession(
  userId: string,
  workspaceId: string | null,
  scopeRef: string,
  overrides: Partial<NewPrimarySessionRow> = {},
): NewPrimarySessionRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    scope: 'agent',
    scopeRef,
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

describe('primary-sessions repository', () => {
  it('inserts and finds a primary session by id', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const inserted = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      const found = findPrimarySessionById(db, inserted.id)
      expect(found?.id).toBe(inserted.id)
      expect(found?.workspaceId).toBe(workspace.id)
      expect(found?.currentSdkSessionId).toBeNull()
    })
  })

  it('finds the live primary for a workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      const found = findPrimarySessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })
      expect(found).not.toBeNull()
      expect(found?.workspaceId).toBe(workspace.id)
    })
  })

  it('a workspace-grounded SPAWNED row never masquerades as the workspace brain (insert order irrelevant)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // The spawned row FIRST — under a scope-filterless query, rowid order
      // would return it and the regression would hide (the Slice-④b bug).
      insertPrimarySession(
        db,
        makePrimarySession(user.id, workspace.id, {
          scope: 'spawned',
          currentSdkSessionId: 'sdk-spawned-1',
        }),
      )
      const brain = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      const found = findPrimarySessionForWorkspace(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(found?.id).toBe(brain.id)
      expect(found?.scope).toBe('workspace')
    })
  })

  it('repoints a primary at a new SDK session and records the superseded one', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = insertPrimarySession(
        db,
        makePrimarySession(user.id, workspace.id, { currentSdkSessionId: 'sdk-1' }),
      )

      const updated = repointPrimarySession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        currentSdkSessionId: 'sdk-2',
        supersededFromSdkSessionId: 'sdk-1',
      })
      expect(updated?.currentSdkSessionId).toBe('sdk-2')
      expect(updated?.supersededFromSdkSessionId).toBe('sdk-1')
    })
  })

  it('soft-deletes a primary so reads no longer see it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      const deleted = softDeletePrimarySession(db, primary.id, user.id)
      expect(deleted?.deletedAt).toBeInstanceOf(Date)
      expect(findPrimarySessionById(db, primary.id)).toBeNull()
      expect(
        findPrimarySessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id }),
      ).toBeNull()
    })
  })

  it('enforces one LIVE primary per workspace, but allows a fresh primary after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const first = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      // A second live primary for the same workspace violates the partial
      // unique index.
      expect(() => insertPrimarySession(db, makePrimarySession(user.id, workspace.id))).toThrow()

      // After soft-deleting the first, a fresh primary is allowed (partial on
      // deleted_at IS NULL).
      softDeletePrimarySession(db, first.id, user.id)
      const second = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('isolates by tenant — another user cannot find or repoint the primary', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const primary = insertPrimarySession(db, makePrimarySession(owner.id, workspace.id))

      expect(
        findPrimarySessionForWorkspace(db, { userId: stranger.id, workspaceId: workspace.id }),
      ).toBeNull()
      expect(
        repointPrimarySession(db, {
          primarySessionId: primary.id,
          userId: stranger.id,
          currentSdkSessionId: 'sdk-x',
        }),
      ).toBeNull()
    })
  })

  it('finds the live primary by its current SDK session id', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertPrimarySession(
        db,
        makePrimarySession(user.id, workspace.id, { currentSdkSessionId: 'sdk-live' }),
      )

      const found = findPrimarySessionByCurrentSdkSessionId(db, 'sdk-live')
      expect(found?.workspaceId).toBe(workspace.id)
      expect(findPrimarySessionByCurrentSdkSessionId(db, 'sdk-unknown')).toBeNull()
    })
  })

  // ── Global primary (Slice 3b) ──────────────────────────────────────────

  it('resolves the live global primary by (user, scope) — workspaceId is NULL', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(findGlobalPrimarySessionForUser(db, user.id)).toBeNull()

      const global = insertPrimarySession(db, makeGlobalPrimarySession(user.id))
      const found = findGlobalPrimarySessionForUser(db, user.id)
      expect(found?.id).toBe(global.id)
      expect(found?.scope).toBe('global')
      expect(found?.workspaceId).toBeNull()
    })
  })

  it('enforces one LIVE global primary per user, but allows a fresh one after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const first = insertPrimarySession(db, makeGlobalPrimarySession(user.id))

      // SQLite treats NULL workspaceId as distinct, so the workspace index can't
      // catch a duplicate global — the scope-gated partial index does.
      expect(() => insertPrimarySession(db, makeGlobalPrimarySession(user.id))).toThrow()

      softDeletePrimarySession(db, first.id, user.id)
      const second = insertPrimarySession(db, makeGlobalPrimarySession(user.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('lets a global primary and a workspace primary coexist for the same user', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const global = insertPrimarySession(db, makeGlobalPrimarySession(user.id))
      const workspacePrimary = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      expect(findGlobalPrimarySessionForUser(db, user.id)?.id).toBe(global.id)
      expect(
        findPrimarySessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })?.id,
      ).toBe(workspacePrimary.id)
    })
  })

  // ── Voice continuing-session (voice-continuity piece 1) ─────────────────

  it('resolves the live voice session by (user, scope) — workspaceId is NULL', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(findVoicePrimarySessionForUser(db, user.id)).toBeNull()

      const voice = insertPrimarySession(db, makeVoicePrimarySession(user.id))
      const found = findVoicePrimarySessionForUser(db, user.id)
      expect(found?.id).toBe(voice.id)
      expect(found?.scope).toBe('voice')
      expect(found?.workspaceId).toBeNull()
    })
  })

  it('enforces one LIVE voice session per user, but allows a fresh one after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const first = insertPrimarySession(db, makeVoicePrimarySession(user.id))

      // Like the global primary: a NULL workspaceId is distinct in SQLite, so the
      // scope-gated partial index is what pins one live voice session per user.
      expect(() => insertPrimarySession(db, makeVoicePrimarySession(user.id))).toThrow()

      softDeletePrimarySession(db, first.id, user.id)
      const second = insertPrimarySession(db, makeVoicePrimarySession(user.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('lets voice, global, and workspace continuing-sessions coexist for one user', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const voice = insertPrimarySession(db, makeVoicePrimarySession(user.id))
      const global = insertPrimarySession(db, makeGlobalPrimarySession(user.id))
      const workspacePrimary = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))

      expect(findVoicePrimarySessionForUser(db, user.id)?.id).toBe(voice.id)
      expect(findGlobalPrimarySessionForUser(db, user.id)?.id).toBe(global.id)
      expect(
        findPrimarySessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })?.id,
      ).toBe(workspacePrimary.id)
    })
  })

  // ── Agent colleagues (persona-sessions arc) ─────────────────────────

  it('resolves the live agent colleague by (user, grounding, slug)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      expect(
        findAgentPrimarySession(db, { userId: user.id, workspaceId: workspace.id, scopeRef: 'researcher' }),
      ).toBeNull()

      const colleague = insertPrimarySession(
        db,
        makeAgentPrimarySession(user.id, workspace.id, 'researcher'),
      )
      const found = findAgentPrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
        scopeRef: 'researcher',
      })
      expect(found?.id).toBe(colleague.id)
      expect(found?.scope).toBe('agent')
      expect(found?.scopeRef).toBe('researcher')
    })
  })

  it('enforces one LIVE workspace colleague per (user, workspace, slug), freed by soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const first = insertPrimarySession(db, makeAgentPrimarySession(user.id, workspace.id, 'researcher'))

      // A second live colleague for the same (workspace, slug) violates the
      // scope-gated partial unique index.
      expect(() =>
        insertPrimarySession(db, makeAgentPrimarySession(user.id, workspace.id, 'researcher')),
      ).toThrow()

      softDeletePrimarySession(db, first.id, user.id)
      const second = insertPrimarySession(db, makeAgentPrimarySession(user.id, workspace.id, 'researcher'))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('enforces one LIVE GLOBAL colleague per (user, slug) — NULL workspace escapes the pair index', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const first = insertPrimarySession(db, makeAgentPrimarySession(user.id, null, 'researcher'))

      // SQLite treats NULL workspaceId as distinct, so the workspace-pair index
      // can't catch a duplicate global colleague — the global sibling index does.
      expect(() =>
        insertPrimarySession(db, makeAgentPrimarySession(user.id, null, 'researcher')),
      ).toThrow()

      softDeletePrimarySession(db, first.id, user.id)
      const second = insertPrimarySession(db, makeAgentPrimarySession(user.id, null, 'researcher'))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('lets the workspace and GLOBAL colleagues of one slug coexist, and different slugs share a workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const grounded = insertPrimarySession(db, makeAgentPrimarySession(user.id, workspace.id, 'researcher'))
      const global = insertPrimarySession(db, makeAgentPrimarySession(user.id, null, 'researcher'))
      const writer = insertPrimarySession(db, makeAgentPrimarySession(user.id, workspace.id, 'writer'))

      expect(
        findAgentPrimarySession(db, { userId: user.id, workspaceId: workspace.id, scopeRef: 'researcher' })?.id,
      ).toBe(grounded.id)
      expect(
        findAgentPrimarySession(db, { userId: user.id, workspaceId: null, scopeRef: 'researcher' })?.id,
      ).toBe(global.id)
      expect(
        findAgentPrimarySession(db, { userId: user.id, workspaceId: workspace.id, scopeRef: 'writer' })?.id,
      ).toBe(writer.id)
    })
  })

  it('isolates agent colleagues by tenant', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      insertPrimarySession(db, makeAgentPrimarySession(owner.id, workspace.id, 'researcher'))

      expect(
        findAgentPrimarySession(db, {
          userId: stranger.id,
          workspaceId: workspace.id,
          scopeRef: 'researcher',
        }),
      ).toBeNull()
    })
  })

  it('defaults scope to "workspace" when omitted (additive backfill shape)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = insertPrimarySession(db, makePrimarySession(user.id, workspace.id))
      expect(primary.scope).toBe('workspace')
    })
  })

  it('hard-deletes primaries soft-deleted before the cutoff', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const old = new Date('2020-01-01T00:00:00Z')
      insertPrimarySession(
        db,
        makePrimarySession(user.id, workspace.id, { deletedAt: old, updatedAt: old }),
      )

      const removed = hardDeletePrimarySessionsDeletedBefore(db, new Date('2020-06-01T00:00:00Z'))
      expect(removed).toBe(1)
    })
  })
})

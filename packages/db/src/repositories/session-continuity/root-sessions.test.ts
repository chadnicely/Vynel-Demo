// Repository integration tests for the `root_sessions` table. Real SQLite
// via the local `withTestDatabase` helper (foundation.md §2 row 12 — no DB
// mocking). Spec: `docs/agent-base/session-continuity.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  findRootSessionById,
  findRootSessionForWorkspace,
  findRootSessionByCurrentSdkSessionId,
  findGlobalRootSessionForUser,
  findVoiceRootSessionForUser,
  insertRootSession,
  repointRootSession,
  softDeleteRootSession,
  hardDeleteRootSessionsDeletedBefore,
  type NewRootSessionRow,
} from './root-sessions.js'

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

function makeRootSession(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewRootSessionRow> = {},
): NewRootSessionRow {
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

function makeGlobalRootSession(
  userId: string,
  overrides: Partial<NewRootSessionRow> = {},
): NewRootSessionRow {
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

function makeVoiceRootSession(
  userId: string,
  overrides: Partial<NewRootSessionRow> = {},
): NewRootSessionRow {
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

describe('root-sessions repository', () => {
  it('inserts and finds a root session by id', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const inserted = insertRootSession(db, makeRootSession(user.id, workspace.id))

      const found = findRootSessionById(db, inserted.id)
      expect(found?.id).toBe(inserted.id)
      expect(found?.workspaceId).toBe(workspace.id)
      expect(found?.currentSdkSessionId).toBeNull()
    })
  })

  it('finds the live root for a workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertRootSession(db, makeRootSession(user.id, workspace.id))

      const found = findRootSessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })
      expect(found).not.toBeNull()
      expect(found?.workspaceId).toBe(workspace.id)
    })
  })

  it('repoints a root at a new SDK session and records the superseded one', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const root = insertRootSession(
        db,
        makeRootSession(user.id, workspace.id, { currentSdkSessionId: 'sdk-1' }),
      )

      const updated = repointRootSession(db, {
        rootSessionId: root.id,
        userId: user.id,
        currentSdkSessionId: 'sdk-2',
        supersededFromSdkSessionId: 'sdk-1',
      })
      expect(updated?.currentSdkSessionId).toBe('sdk-2')
      expect(updated?.supersededFromSdkSessionId).toBe('sdk-1')
    })
  })

  it('soft-deletes a root so reads no longer see it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const root = insertRootSession(db, makeRootSession(user.id, workspace.id))

      const deleted = softDeleteRootSession(db, root.id, user.id)
      expect(deleted?.deletedAt).toBeInstanceOf(Date)
      expect(findRootSessionById(db, root.id)).toBeNull()
      expect(
        findRootSessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id }),
      ).toBeNull()
    })
  })

  it('enforces one LIVE root per workspace, but allows a fresh root after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const first = insertRootSession(db, makeRootSession(user.id, workspace.id))

      // A second live root for the same workspace violates the partial
      // unique index.
      expect(() => insertRootSession(db, makeRootSession(user.id, workspace.id))).toThrow()

      // After soft-deleting the first, a fresh root is allowed (partial on
      // deleted_at IS NULL).
      softDeleteRootSession(db, first.id, user.id)
      const second = insertRootSession(db, makeRootSession(user.id, workspace.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('isolates by tenant — another user cannot find or repoint the root', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const root = insertRootSession(db, makeRootSession(owner.id, workspace.id))

      expect(
        findRootSessionForWorkspace(db, { userId: stranger.id, workspaceId: workspace.id }),
      ).toBeNull()
      expect(
        repointRootSession(db, {
          rootSessionId: root.id,
          userId: stranger.id,
          currentSdkSessionId: 'sdk-x',
        }),
      ).toBeNull()
    })
  })

  it('finds the live root by its current SDK session id', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertRootSession(
        db,
        makeRootSession(user.id, workspace.id, { currentSdkSessionId: 'sdk-live' }),
      )

      const found = findRootSessionByCurrentSdkSessionId(db, 'sdk-live')
      expect(found?.workspaceId).toBe(workspace.id)
      expect(findRootSessionByCurrentSdkSessionId(db, 'sdk-unknown')).toBeNull()
    })
  })

  // ── Global root (Slice 3b) ──────────────────────────────────────────

  it('resolves the live global root by (user, scope) — workspaceId is NULL', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(findGlobalRootSessionForUser(db, user.id)).toBeNull()

      const global = insertRootSession(db, makeGlobalRootSession(user.id))
      const found = findGlobalRootSessionForUser(db, user.id)
      expect(found?.id).toBe(global.id)
      expect(found?.scope).toBe('global')
      expect(found?.workspaceId).toBeNull()
    })
  })

  it('enforces one LIVE global root per user, but allows a fresh one after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const first = insertRootSession(db, makeGlobalRootSession(user.id))

      // SQLite treats NULL workspaceId as distinct, so the workspace index can't
      // catch a duplicate global — the scope-gated partial index does.
      expect(() => insertRootSession(db, makeGlobalRootSession(user.id))).toThrow()

      softDeleteRootSession(db, first.id, user.id)
      const second = insertRootSession(db, makeGlobalRootSession(user.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('lets a global root and a workspace root coexist for the same user', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const global = insertRootSession(db, makeGlobalRootSession(user.id))
      const workspaceRoot = insertRootSession(db, makeRootSession(user.id, workspace.id))

      expect(findGlobalRootSessionForUser(db, user.id)?.id).toBe(global.id)
      expect(
        findRootSessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })?.id,
      ).toBe(workspaceRoot.id)
    })
  })

  // ── Voice continuing-session (voice-jarvis piece 1) ─────────────────

  it('resolves the live voice session by (user, scope) — workspaceId is NULL', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(findVoiceRootSessionForUser(db, user.id)).toBeNull()

      const voice = insertRootSession(db, makeVoiceRootSession(user.id))
      const found = findVoiceRootSessionForUser(db, user.id)
      expect(found?.id).toBe(voice.id)
      expect(found?.scope).toBe('voice')
      expect(found?.workspaceId).toBeNull()
    })
  })

  it('enforces one LIVE voice session per user, but allows a fresh one after soft-delete', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const first = insertRootSession(db, makeVoiceRootSession(user.id))

      // Like the global root: a NULL workspaceId is distinct in SQLite, so the
      // scope-gated partial index is what pins one live voice session per user.
      expect(() => insertRootSession(db, makeVoiceRootSession(user.id))).toThrow()

      softDeleteRootSession(db, first.id, user.id)
      const second = insertRootSession(db, makeVoiceRootSession(user.id))
      expect(second.id).not.toBe(first.id)
    })
  })

  it('lets voice, global, and workspace continuing-sessions coexist for one user', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const voice = insertRootSession(db, makeVoiceRootSession(user.id))
      const global = insertRootSession(db, makeGlobalRootSession(user.id))
      const workspaceRoot = insertRootSession(db, makeRootSession(user.id, workspace.id))

      expect(findVoiceRootSessionForUser(db, user.id)?.id).toBe(voice.id)
      expect(findGlobalRootSessionForUser(db, user.id)?.id).toBe(global.id)
      expect(
        findRootSessionForWorkspace(db, { userId: user.id, workspaceId: workspace.id })?.id,
      ).toBe(workspaceRoot.id)
    })
  })

  it('defaults scope to "workspace" when omitted (additive backfill shape)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const root = insertRootSession(db, makeRootSession(user.id, workspace.id))
      expect(root.scope).toBe('workspace')
    })
  })

  it('hard-deletes roots soft-deleted before the cutoff', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const old = new Date('2020-01-01T00:00:00Z')
      insertRootSession(
        db,
        makeRootSession(user.id, workspace.id, { deletedAt: old, updatedAt: old }),
      )

      const removed = hardDeleteRootSessionsDeletedBefore(db, new Date('2020-06-01T00:00:00Z'))
      expect(removed).toBe(1)
    })
  })
})

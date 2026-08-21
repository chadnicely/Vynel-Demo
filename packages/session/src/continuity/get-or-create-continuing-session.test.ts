// Integration tests for `getOrCreateContinuingSession` — the generic
// continuing-session identity getter (voice-continuity piece 1). Real SQLite via
// `withTestDatabase` (no mocking). The VOICE scope is the real second consumer
// that proves the primary-continuity generalization; the workspace + global primary
// paths keep their own tests in `get-or-create-primary-session.test.ts`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { getOrCreateContinuingSession } from './get-or-create-continuing-session.js'

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

describe('getOrCreateContinuingSession', () => {
  it('creates a VOICE continuing-session (scope voice, no workspace, no SDK session yet)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())

      const voice = await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      expect(voice.scope).toBe('voice')
      expect(voice.workspaceId).toBeNull()
      expect(voice.userId).toBe(user.id)
      expect(voice.currentSdkSessionId).toBeNull()
    })
  })

  it('is idempotent for the voice session — one live voice session per user', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())

      const first = await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      const second = await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      expect(second.id).toBe(first.id)
    })
  })

  it('keeps the voice, global, and workspace continuing-sessions distinct for one user', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const voice = await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      const global = await getOrCreateContinuingSession(db, { userId: user.id, scope: 'global' })
      const workspacePrimary = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'workspace',
        workspaceId: workspace.id,
      })

      expect(new Set([voice.id, global.id, workspacePrimary.id]).size).toBe(3)
      expect(voice.scope).toBe('voice')
      expect(global.scope).toBe('global')
      expect(workspacePrimary.scope).toBe('workspace')
    })
  })

  it('rejects a workspace scope without a workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        getOrCreateContinuingSession(db, { userId: user.id, scope: 'workspace' }),
      ).rejects.toThrow(ValidationError)
    })
  })

  it('rejects a non-workspace scope that carries a workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await expect(
        getOrCreateContinuingSession(db, {
          userId: user.id,
          scope: 'voice',
          workspaceId: workspace.id,
        }),
      ).rejects.toThrow(ValidationError)
    })
  })

  it('creates an agent COLLEAGUE per (workspace, slug) and resumes it idempotently', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const first = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'researcher',
      })
      expect(first.scope).toBe('agent')
      expect(first.scopeRef).toBe('researcher')
      expect(first.workspaceId).toBe(workspace.id)

      const second = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'researcher',
      })
      expect(second.id).toBe(first.id)
    })
  })

  it('keeps workspace and GLOBAL colleagues of the same agent distinct', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const grounded = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'researcher',
      })
      const global = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        scopeRef: 'researcher',
      })

      expect(global.id).not.toBe(grounded.id)
      expect(global.workspaceId).toBeNull()

      const globalAgain = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        scopeRef: 'researcher',
      })
      expect(globalAgain.id).toBe(global.id)
    })
  })

  it('keeps colleagues of different agents distinct in one workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const researcher = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'researcher',
      })
      const writer = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'writer',
      })
      expect(writer.id).not.toBe(researcher.id)
    })
  })

  it('rejects an agent scope without a scopeRef', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        getOrCreateContinuingSession(db, { userId: user.id, scope: 'agent' }),
      ).rejects.toThrow(ValidationError)
    })
  })

  it("rejects the 'spawned' scope — spawned sessions are created elsewhere", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        getOrCreateContinuingSession(db, { userId: user.id, scope: 'spawned' }),
      ).rejects.toThrow(ValidationError)
    })
  })

  it('rejects a non-agent scope that carries a scopeRef', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        getOrCreateContinuingSession(db, {
          userId: user.id,
          scope: 'voice',
          scopeRef: 'researcher',
        }),
      ).rejects.toThrow(ValidationError)
    })
  })
})

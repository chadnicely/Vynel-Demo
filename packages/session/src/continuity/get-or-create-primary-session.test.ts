// Integration tests for `getOrCreatePrimarySession`. Real SQLite via
// `withTestDatabase` (no mocking). Spec: `docs/agent-base/session-continuity.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { getOrCreatePrimarySession } from './get-or-create-primary-session.js'

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

describe('getOrCreatePrimarySession', () => {
  it('creates a primary for a workspace on first use (no SDK session linked yet)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const primary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(primary.workspaceId).toBe(workspace.id)
      expect(primary.userId).toBe(user.id)
      expect(primary.currentSdkSessionId).toBeNull()
      expect(primary.supersededFromSdkSessionId).toBeNull()
    })
  })

  it('is idempotent — the second call returns the same primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const first = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspace.id })
      const second = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspace.id })
      expect(second.id).toBe(first.id)
    })
  })

  it('gives different workspaces different primaries', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspaceA = insertWorkspace(db, makeWorkspace(user.id))
      const workspaceB = insertWorkspace(db, makeWorkspace(user.id))

      const primaryA = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspaceA.id })
      const primaryB = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspaceB.id })
      expect(primaryA.id).not.toBe(primaryB.id)
    })
  })

  // ── Global primary (Slice 3b) ──────────────────────────────────────────

  it('creates the GLOBAL primary when workspaceId is omitted (scope global, no workspace)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())

      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      expect(primary.scope).toBe('global')
      expect(primary.workspaceId).toBeNull()
      expect(primary.userId).toBe(user.id)
      expect(primary.currentSdkSessionId).toBeNull()
    })
  })

  it('is idempotent for the global primary — the second call returns the same row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())

      const first = await getOrCreatePrimarySession(db, { userId: user.id })
      const second = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: null })
      expect(second.id).toBe(first.id)
    })
  })

  it('keeps the global primary and a workspace primary distinct for the same user', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const global = await getOrCreatePrimarySession(db, { userId: user.id })
      const workspacePrimary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(global.id).not.toBe(workspacePrimary.id)
      expect(global.scope).toBe('global')
      expect(workspacePrimary.scope).toBe('workspace')
    })
  })
})

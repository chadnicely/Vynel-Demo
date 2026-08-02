// Integration tests for the USER-scoped `/knowledge/sources` route — the
// GLOBAL knowledge menu's anchor. Full HTTP stack: route -> userScoped ->
// repo -> SQLite (real, via withTestDatabase). No mocks.
//
// The point of this route is what it does NOT return: the workspace-scoped
// twin fuses a workspace's own sources with the user's global ones, this one
// lists the global ones alone.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertKnowledgeSource } from '@vynel/knowledge/repositories'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function seedSource(
  db: Database,
  input: { userId: string; workspaceId: string | null; absolutePath: string },
) {
  const now = new Date()
  insertKnowledgeSource(db, {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    scope: input.workspaceId === null ? 'global' : 'workspace',
    sourceKind: 'directory',
    absolutePath: input.absolutePath,
    createdAt: now,
    updatedAt: now,
  })
}

describe('user-scoped knowledge routes', () => {
  it('GET /sources lists ONLY the global sources — never a workspace source', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedSource(db, { userId: user.id, workspaceId: null, absolutePath: '/notes' })
      seedSource(db, {
        userId: user.id,
        workspaceId: workspace.id,
        absolutePath: '/bakery/docs',
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request('/knowledge/sources')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        sources: Array<{ absolutePath: string; scope: string; documentCount: number }>
      }
      expect(body.sources).toHaveLength(1)
      expect(body.sources[0]!.absolutePath).toBe('/notes')
      expect(body.sources[0]!.scope).toBe('global')
      // The list item carries the indexing rollup, same as the workspace twin.
      expect(body.sources[0]!.documentCount).toBe(0)
    })
  })

  it('GET /sources returns an empty list when the user has no global sources', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      seedSource(db, {
        userId: user.id,
        workspaceId: workspace.id,
        absolutePath: '/bakery/docs',
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request('/knowledge/sources')
      expect(res.status).toBe(200)
      expect((await res.json()) as { sources: unknown[] }).toEqual({ sources: [] })
    })
  })
})

// Integration tests for the USER-scoped `/memory/entries` route — the GLOBAL
// memory panel's anchor. Full HTTP stack: route -> validator -> userScoped ->
// core op -> repo -> SQLite (real, via withTestDatabase). No mocks.
//
// The point of this route is what it does NOT return: every workspace's
// entries. NOTE the current schema ceiling — `memory_entries.workspace_id` is
// NOT NULL (`id()` is NOT NULL by dialect contract), so no global entry can
// exist yet and the global list is always empty. That is the honest state of
// the settled "Global = workspaceId IS NULL" rule for memory; the read is
// correct the moment a global write path lands.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createMemoryEntry } from '@vynel/memory'
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

describe('user-scoped memory routes', () => {
  it("GET /entries never leaks a workspace's entries into the global list", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'Acme sells tomato every Friday.',
        category: 'memory',
        section: 'Things to remember',
        createdSource: 'user-manual',
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request('/memory/entries')
      expect(res.status).toBe(200)
      expect((await res.json()) as unknown).toEqual({ entries: [], nextCursor: null })
    })
  })

  it('GET /entries rejects an out-of-range limit', async () => {
    await withTestDatabase(async (db) => {
      seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request('/memory/entries?limit=9999')
      expect(res.status).toBe(400)
    })
  })
})

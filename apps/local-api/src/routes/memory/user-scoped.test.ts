// Integration tests for the USER-scoped `/memory/entries` route — the GLOBAL
// memory panel's anchor. Full HTTP stack: route -> validator -> userScoped ->
// core op -> repo -> SQLite (real, via withTestDatabase). No mocks.
//
// The point of this route is what it does NOT touch: any workspace's entries.
// `memory_entries.workspace_id` became nullable in migration 0029, so a GLOBAL
// (user-level) memory is a real row with no workspace anchor — these routes
// are its only write path, and the list is its only read.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createMemoryEntry, updateMemoryEntry } from '@vynel/memory'
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

  it('POST /entries writes a user-level memory the global list then returns', async () => {
    await withTestDatabase(async (db) => {
      seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const created = await app.request('/memory/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'note',
          body: 'I prefer plain language over jargon.',
          category: 'memory',
          section: 'Notes',
          tags: ['preference'],
        }),
      })
      expect(created.status).toBe(201)
      const entry = (await created.json()) as { id: string; workspaceId: string | null }
      expect(entry.workspaceId).toBeNull()

      const listed = await app.request('/memory/entries')
      const body = (await listed.json()) as { entries: { id: string; tags: string[] }[] }
      expect(body.entries.map((row) => row.id)).toEqual([entry.id])
      expect(body.entries[0]!.tags).toEqual(['preference'])
    })
  })

  // Until global entries could exist, this read only ever returned an empty
  // set — its archived/deleted filters had never actually run against rows.
  it('GET /entries hides an archived global entry unless asked for it', async () => {
    await withTestDatabase(async (db) => {
      const { user } = seedWorld(db)
      const live = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: null,
        kind: 'note',
        body: 'I fly out of Heathrow.',
        category: 'memory',
        section: 'Notes',
        createdSource: 'user-manual',
      })
      const archived = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: null,
        kind: 'note',
        body: 'Old address, no longer mine.',
        category: 'memory',
        section: 'Notes',
        createdSource: 'user-manual',
      })
      updateMemoryEntry(db, archived.id, { isArchived: true })
      const app = createApp({ db, logger: silentLogger })

      const listed = await app.request('/memory/entries')
      const body = (await listed.json()) as { entries: { id: string }[] }
      expect(body.entries.map((row) => row.id)).toEqual([live.id])

      const withArchived = await app.request('/memory/entries?includeArchived=true')
      const all = (await withArchived.json()) as { entries: { id: string }[] }
      expect(all.entries.map((row) => row.id).sort()).toEqual([live.id, archived.id].sort())
    })
  })

  it("GET /tags reads the user's own vault, never a workspace's", async () => {
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
        tags: ['suppliers'],
      })
      createMemoryEntry(db, {
        userId: user.id,
        workspaceId: null,
        kind: 'note',
        body: 'I fly out of Heathrow.',
        category: 'memory',
        section: 'Notes',
        createdSource: 'user-manual',
        tags: ['travel'],
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request('/memory/tags')
      expect(res.status).toBe(200)
      const { tags } = (await res.json()) as { tags: string[] }
      expect(tags[0]).toBe('context')
      expect(tags).toContain('travel')
      expect(tags).not.toContain('suppliers')
    })
  })
})

// Integration tests for the read-path `/workspaces/:workspaceId/memory/...`
// routes (list, search, get, mentions). Full HTTP stack (route →
// workspaceScoped → core op → repo → SQLite). The mutating routes
// (create / update / delete) live in `index.mutations.test.ts` — split
// per `structure-standard.md` "File size cap", mirroring the skills
// route-test precedent.
//
// Entries are seeded via the PUBLIC `createMemoryEntry` op (not a raw
// repo insert) — `@vynel/memory`'s package.json exports only `.`, no
// `./repositories` subpath, so tests outside the package use the same
// surface the routes do.
//
// `GET /search` is exercised with `mode: 'fts'` only — hybrid/semantic
// modes call `generateEmbedding` (a real transformer model load), which
// the core-op test level (`search-memory-for-agent.test.ts`) already
// covers via an inline deterministic fake. FTS needs no embedding call,
// so it proves the route → core-op → repo wiring without that cost.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createMemoryEntry, deleteMemoryEntry } from '@vynel/memory'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
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
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

// A second workspace for the SAME user — a fresh test DB must have
// exactly one user row (`getOrCreateLocalUser`, the Phase-1 resolver,
// returns "the" single user per `channels/index.test.ts`'s documented
// precedent), so cross-workspace-ownership tests add a workspace under
// the existing user rather than seeding a second user.
function seedSecondWorkspace(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Beta',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function seedEntry(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  overrides: Partial<{ title: string; body: string }> = {},
) {
  return createMemoryEntry(db, {
    userId,
    workspaceId,
    kind: 'note',
    title: overrides.title ?? 'Tomato supplier',
    body: overrides.body ?? 'Acme sells tomato every Friday.',
    category: 'memory',
    section: 'Things to remember',
    createdSource: 'user-manual',
  })
}

describe('memory routes — reads', () => {
  describe('GET /memory/entries', () => {
    it('returns the workspace entries as JSON', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        seedEntry(db, user.id, workspace.id)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { entries: unknown[]; nextCursor: unknown }
        expect(body.entries).toHaveLength(1)
        expect(body.nextCursor).toBeNull()
      })
    })

    it('returns 404 for an unknown workspace', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/nonexistent/memory/entries`)
        expect(res.status).toBe(404)
      })
    })
  })

  describe('GET /memory/search', () => {
    it('runs FTS-only and returns matches with <mark> snippets', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        seedEntry(db, user.id, workspace.id, { title: 'Tomato supplier', body: 'tomato fresh' })
        seedEntry(db, user.id, workspace.id, { title: 'Pepper supplier', body: 'pepper unripe' })
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(
          `/workspaces/${workspace.id}/memory/search?query=tomato&mode=fts`,
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { results: Array<{ matchedTitle: string }> }
        expect(body.results).toHaveLength(1)
        expect(body.results[0]!.matchedTitle).toContain('<mark>')
      })
    })

    it('returns 400 when query is missing', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${workspace.id}/memory/search`)
        expect(res.status).toBe(400)
      })
    })
  })

  describe('GET /memory/entries/:entryId', () => {
    it('returns the entry', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const entry = seedEntry(db, user.id, workspace.id)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries/${entry.id}`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { id: string; embeddingPresent: boolean }
        expect(body.id).toBe(entry.id)
        expect(body.embeddingPresent).toBe(false)
      })
    })

    it('returns 404 for an entry in a different workspace', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const otherWorkspace = seedSecondWorkspace(db, user.id)
        const entry = seedEntry(db, user.id, otherWorkspace.id)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries/${entry.id}`)
        expect(res.status).toBe(404)
      })
    })

    it('returns 404 for a soft-deleted entry', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const entry = seedEntry(db, user.id, workspace.id)
        deleteMemoryEntry(db, entry.id)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries/${entry.id}`)
        expect(res.status).toBe(404)
      })
    })
  })

  describe('GET /memory/entries/:entryId/mentions', () => {
    it('returns an empty mentions array when none recorded', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const entry = seedEntry(db, user.id, workspace.id)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(
          `/workspaces/${workspace.id}/memory/entries/${entry.id}/mentions`,
        )
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ mentions: [] })
      })
    })

    it('returns 404 for a nonexistent entry', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(
          `/workspaces/${workspace.id}/memory/entries/nonexistent/mentions`,
        )
        expect(res.status).toBe(404)
      })
    })
  })
})

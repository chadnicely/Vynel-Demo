// Integration tests for the MUTATING `/workspaces/:workspaceId/memory/...`
// routes (POST create, PATCH update, DELETE soft-delete). The GET
// (read) routes live in `index.test.ts`. Split per
// `structure-standard.md` "File size cap" (mirrors the skills
// index.mutations.test.ts precedent).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
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
// precedent), so the cross-workspace-ownership test adds a workspace
// under the existing user rather than seeding a second user.
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

const validCreateBody = {
  kind: 'note',
  body: 'Acme sells tomato every Friday.',
  category: 'memory',
  section: 'Things to remember',
}

describe('memory routes — mutations', () => {
  describe('POST /memory/entries', () => {
    it('returns 201 with the created entry (title derived from body)', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        })
        expect(res.status).toBe(201)
        const entry = (await res.json()) as { id: string; title: string; createdSource: string }
        expect(entry.title.length).toBeGreaterThan(0)
        expect(entry.createdSource).toBe('user-manual')
      })
    })

    it('returns 400 for an invalid kind', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...validCreateBody, kind: 'not-a-kind' }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 404 for an unknown workspace', async () => {
      await withTestDatabase(async (db) => {
        seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/nonexistent/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        })
        expect(res.status).toBe(404)
      })
    })
  })

  describe('PATCH /memory/entries/:entryId', () => {
    it('applies the patch and returns the updated entry', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const createRes = await app.request(`/workspaces/${workspace.id}/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        })
        const created = (await createRes.json()) as { id: string }

        const patchRes = await app.request(
          `/workspaces/${workspace.id}/memory/entries/${created.id}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Updated title', isArchived: true }),
          },
        )
        expect(patchRes.status).toBe(200)
        const updated = (await patchRes.json()) as { title: string; isArchived: boolean }
        expect(updated.title).toBe('Updated title')
        expect(updated.isArchived).toBe(true)
      })
    })

    it('returns 404 for an entry not owned by this workspace', async () => {
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const otherWorkspace = seedSecondWorkspace(db, user.id)
        const app = createApp({ db, logger: silentLogger })

        const createRes = await app.request(`/workspaces/${otherWorkspace.id}/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        })
        const created = (await createRes.json()) as { id: string }

        const patchRes = await app.request(
          `/workspaces/${workspace.id}/memory/entries/${created.id}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Should not apply' }),
          },
        )
        expect(patchRes.status).toBe(404)
      })
    })
  })

  describe('DELETE /memory/entries/:entryId', () => {
    it('returns 204 and the entry reads back as gone', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const createRes = await app.request(`/workspaces/${workspace.id}/memory/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validCreateBody),
        })
        const created = (await createRes.json()) as { id: string }

        const delRes = await app.request(
          `/workspaces/${workspace.id}/memory/entries/${created.id}`,
          { method: 'DELETE' },
        )
        expect(delRes.status).toBe(204)

        const getRes = await app.request(`/workspaces/${workspace.id}/memory/entries/${created.id}`)
        expect(getRes.status).toBe(404)
      })
    })

    it('returns 404 for a nonexistent entry id', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/memory/entries/nonexistent`, {
          method: 'DELETE',
        })
        expect(res.status).toBe(404)
      })
    })
  })
})

// Integration tests for the USER-scoped `/journal/...` routes (global +
// cross-workspace) — the panel/CLI surface, including the edit/delete doors
// the agent deliberately lacks. Full HTTP stack: route -> validator ->
// userScoped -> core op -> repo -> SQLite (real, via withTestDatabase). No
// mocks.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1)), so the "attacker" (the resolved
// local user) is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertJournalEntry, makeJournalEntry, seedUserWorkspace } from '@vynel/journal/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('user-scoped journal routes', () => {
  it('POST / with scope:global creates a USER-sourced null-workspace entry; GET / spans both scopes', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertJournalEntry(db, makeJournalEntry(user.id, workspace.id, { content: 'workspace one' }))

      const res = await app.request(
        '/journal',
        jsonBody('POST', { scope: 'global', entryDate: '2026-07-23', content: 'Global note' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { workspaceId: string | null; source: string }
      expect(created.workspaceId).toBeNull()
      // Provenance is hard-coded by the route — the user's door.
      expect(created.source).toBe('user')

      const list = (await (await app.request('/journal')).json()) as { content: string }[]
      expect(list.map((e) => e.content).sort()).toEqual(['Global note', 'workspace one'])
    })
  })

  it('POST / with scope:workspace requires workspaceId (400 without it)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const missing = await app.request(
        '/journal',
        jsonBody('POST', { scope: 'workspace', entryDate: '2026-07-23', content: 'No workspace' }),
      )
      expect(missing.status).toBe(400)

      const ok = await app.request(
        '/journal',
        jsonBody('POST', {
          scope: 'workspace',
          workspaceId: workspace.id,
          entryDate: '2026-07-23',
          content: 'Scoped',
        }),
      )
      expect(ok.status).toBe(201)
      expect(((await ok.json()) as { workspaceId: string | null }).workspaceId).toBe(workspace.id)
    })
  })

  it('PATCH /:entryId edits a GLOBAL entry; DELETE /:entryId removes it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const entry = insertJournalEntry(db, makeJournalEntry(user.id, null, { source: 'user' }))

      const patched = await app.request(
        `/journal/${entry.id}`,
        jsonBody('PATCH', { content: 'Corrected record', entryDate: '2026-07-22' }),
      )
      expect(patched.status).toBe(200)
      const body = (await patched.json()) as { content: string; entryDate: string }
      expect(body.content).toBe('Corrected record')
      expect(body.entryDate).toBe('2026-07-22')

      const deleted = await app.request(`/journal/${entry.id}`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      const list = (await (await app.request('/journal')).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it("404s identically on a missing entry and another user's entry", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // attacker — resolved as the local user
      const victim = seedUserWorkspace(db)
      const victimEntry = insertJournalEntry(db, makeJournalEntry(victim.userId, victim.workspaceId))

      const missing = await app.request(`/journal/${randomUUID()}`, jsonBody('PATCH', { content: 'x' }))
      const foreign = await app.request(`/journal/${victimEntry.id}`, jsonBody('PATCH', { content: 'x' }))
      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)

      const foreignDelete = await app.request(`/journal/${victimEntry.id}`, { method: 'DELETE' })
      expect(foreignDelete.status).toBe(404)
    })
  })
})

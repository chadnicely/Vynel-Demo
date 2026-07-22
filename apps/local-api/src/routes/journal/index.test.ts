// Integration tests for the workspace-scoped
// `/workspaces/:workspaceId/journal` routes — the AGENT's append+read
// surface. Full HTTP stack: route -> validator -> workspaceScoped -> core op
// -> repo -> SQLite (real, via withTestDatabase). No mocks.
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
import { insertJournalEntry, makeJournalEntry } from '@vynel/journal/test-support'
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

describe('workspace-scoped journal routes', () => {
  it('POST / appends an ASSISTANT-sourced entry; GET / reads it back', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/journal`,
        jsonBody('POST', { entryDate: '2026-07-23', content: 'Shipped the newsletter draft.' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { id: string; source: string; entryDate: string }
      // Provenance is hard-coded by the route — the agent's door, unspoofable.
      expect(created.source).toBe('assistant')
      expect(created.entryDate).toBe('2026-07-23')

      const list = (await (
        await app.request(`/workspaces/${workspace.id}/journal`)
      ).json()) as { id: string }[]
      expect(list.map((e) => e.id)).toEqual([created.id])
    })
  })

  it('POST / rejects a malformed entryDate (400)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/journal`,
        jsonBody('POST', { entryDate: 'today', content: 'Undated' }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('GET / filters by exact day and from/to range; excludes global + foreign rows', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertJournalEntry(db, makeJournalEntry(user.id, workspace.id, { content: 'mon', entryDate: '2026-07-20' }))
      insertJournalEntry(db, makeJournalEntry(user.id, workspace.id, { content: 'wed', entryDate: '2026-07-22' }))
      insertJournalEntry(db, makeJournalEntry(user.id, null, { content: 'global' }))

      const all = (await (
        await app.request(`/workspaces/${workspace.id}/journal`)
      ).json()) as { content: string }[]
      expect(all.map((e) => e.content)).toEqual(['wed', 'mon'])

      const day = (await (
        await app.request(`/workspaces/${workspace.id}/journal?entryDate=2026-07-20`)
      ).json()) as { content: string }[]
      expect(day.map((e) => e.content)).toEqual(['mon'])

      const range = (await (
        await app.request(`/workspaces/${workspace.id}/journal?from=2026-07-21&to=2026-07-22`)
      ).json()) as { content: string }[]
      expect(range.map((e) => e.content)).toEqual(['wed'])
    })
  })

  it('has NO agent edit/delete doors — PATCH and DELETE are not mounted here', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const entry = insertJournalEntry(db, makeJournalEntry(user.id, workspace.id))

      // The append-only contract: history edits live on the user door only.
      const patched = await app.request(
        `/workspaces/${workspace.id}/journal/${entry.id}`,
        jsonBody('PATCH', { content: 'rewritten' }),
      )
      const deleted = await app.request(`/workspaces/${workspace.id}/journal/${entry.id}`, {
        method: 'DELETE',
      })
      expect(patched.status).toBe(404)
      expect(deleted.status).toBe(404)
    })
  })
})

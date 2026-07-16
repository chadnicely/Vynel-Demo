// Integration tests for the USER-scoped `/tasks/...` routes (global +
// cross-workspace) — the panel/dashboard/CLI surface. Full HTTP stack:
// route -> validator -> userScoped -> core op -> repo -> SQLite (real, via
// withTestDatabase). No mocks.
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
import { insertTask, makeTask, seedUserWorkspace } from '@vynel/tasks/test-support'
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

describe('user-scoped tasks routes', () => {
  it('POST / with scope:global creates a USER-sourced null-workspace task; GET / spans both scopes', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertTask(db, makeTask(user.id, workspace.id, { title: 'workspace one' }))

      const res = await app.request(
        '/tasks',
        jsonBody('POST', { scope: 'global', title: 'Global chore' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { workspaceId: string | null; source: string }
      expect(created.workspaceId).toBeNull()
      // Provenance is hard-coded by the route — the user's door.
      expect(created.source).toBe('user')

      const list = (await (await app.request('/tasks')).json()) as { title: string }[]
      expect(list.map((t) => t.title).sort()).toEqual(['Global chore', 'workspace one'])
    })
  })

  it('POST / with scope:workspace requires workspaceId (400 without it)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const missing = await app.request(
        '/tasks',
        jsonBody('POST', { scope: 'workspace', title: 'No workspace' }),
      )
      expect(missing.status).toBe(400)

      const ok = await app.request(
        '/tasks',
        jsonBody('POST', { scope: 'workspace', workspaceId: workspace.id, title: 'Scoped' }),
      )
      expect(ok.status).toBe(201)
      expect(((await ok.json()) as { workspaceId: string | null }).workspaceId).toBe(workspace.id)
    })
  })

  it('PATCH /:taskId updates a GLOBAL task; DELETE /:taskId removes it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const task = insertTask(db, makeTask(user.id, null, { source: 'user' }))

      const patched = await app.request(
        `/tasks/${task.id}`,
        jsonBody('PATCH', { title: 'Renamed', status: 'done' }),
      )
      expect(patched.status).toBe(200)
      const body = (await patched.json()) as { title: string; completedAt: string | null }
      expect(body.title).toBe('Renamed')
      expect(body.completedAt).not.toBeNull()

      const deleted = await app.request(`/tasks/${task.id}`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      const list = (await (await app.request('/tasks')).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it("404s identically on a missing task and another user's task", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // attacker — resolved as the local user
      const victim = seedUserWorkspace(db)
      const victimTask = insertTask(db, makeTask(victim.userId, victim.workspaceId))

      const missing = await app.request(`/tasks/${randomUUID()}`, jsonBody('PATCH', { status: 'done' }))
      const foreign = await app.request(`/tasks/${victimTask.id}`, jsonBody('PATCH', { status: 'done' }))
      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)

      const foreignDelete = await app.request(`/tasks/${victimTask.id}`, { method: 'DELETE' })
      expect(foreignDelete.status).toBe(404)
    })
  })
})

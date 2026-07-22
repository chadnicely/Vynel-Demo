// Integration tests for the USER-scoped `/plans/...` routes (global +
// cross-workspace) — the panel/CLI surface. Full HTTP stack: route ->
// validator -> userScoped -> core op -> repo -> SQLite (real, via
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
import { insertPlan, makePlan, seedUserWorkspace } from '@vynel/plans/test-support'
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

describe('user-scoped plans routes', () => {
  it('POST / with scope:global creates a USER-sourced null-workspace plan; GET / spans both scopes', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertPlan(db, makePlan(user.id, workspace.id, { title: 'workspace one' }))

      const res = await app.request(
        '/plans',
        jsonBody('POST', { scope: 'global', title: 'Global plan', planDate: '2026-07-24' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { workspaceId: string | null; source: string }
      expect(created.workspaceId).toBeNull()
      // Provenance is hard-coded by the route — the user's door.
      expect(created.source).toBe('user')

      const list = (await (await app.request('/plans')).json()) as { title: string }[]
      expect(list.map((p) => p.title).sort()).toEqual(['Global plan', 'workspace one'])
    })
  })

  it('POST / with scope:workspace requires workspaceId (400 without it)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const missing = await app.request(
        '/plans',
        jsonBody('POST', { scope: 'workspace', title: 'No workspace', planDate: '2026-07-24' }),
      )
      expect(missing.status).toBe(400)

      const ok = await app.request(
        '/plans',
        jsonBody('POST', {
          scope: 'workspace',
          workspaceId: workspace.id,
          title: 'Scoped',
          planDate: '2026-07-24',
        }),
      )
      expect(ok.status).toBe(201)
      expect(((await ok.json()) as { workspaceId: string | null }).workspaceId).toBe(workspace.id)
    })
  })

  it('PATCH /:planId updates a GLOBAL plan; DELETE /:planId removes it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const plan = insertPlan(db, makePlan(user.id, null, { source: 'user' }))

      const patched = await app.request(
        `/plans/${plan.id}`,
        jsonBody('PATCH', { title: 'Renamed', status: 'done' }),
      )
      expect(patched.status).toBe(200)
      const body = (await patched.json()) as { title: string; completedAt: string | null }
      expect(body.title).toBe('Renamed')
      expect(body.completedAt).not.toBeNull()

      const deleted = await app.request(`/plans/${plan.id}`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      const list = (await (await app.request('/plans')).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it("404s identically on a missing plan and another user's plan", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // attacker — resolved as the local user
      const victim = seedUserWorkspace(db)
      const victimPlan = insertPlan(db, makePlan(victim.userId, victim.workspaceId))

      const missing = await app.request(`/plans/${randomUUID()}`, jsonBody('PATCH', { status: 'done' }))
      const foreign = await app.request(`/plans/${victimPlan.id}`, jsonBody('PATCH', { status: 'done' }))
      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)

      const foreignDelete = await app.request(`/plans/${victimPlan.id}`, { method: 'DELETE' })
      expect(foreignDelete.status).toBe(404)
    })
  })
})

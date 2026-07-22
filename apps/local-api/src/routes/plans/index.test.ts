// Integration tests for the workspace-scoped `/workspaces/:workspaceId/plans`
// routes — the AGENT's surface. Full HTTP stack: route -> validator ->
// workspaceScoped -> core op -> repo -> SQLite (real, via withTestDatabase).
// No mocks.
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
import { insertPlan, makePlan } from '@vynel/plans/test-support'
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

describe('workspace-scoped plans routes', () => {
  it('POST / creates an ASSISTANT-sourced plan; GET / lists it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/plans`,
        jsonBody('POST', {
          title: 'Ship the spring campaign',
          detail: 'Newsletter + landing page.',
          planDate: '2026-07-24',
        }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        id: string
        source: string
        status: string
        planDate: string
      }
      // Provenance is hard-coded by the route — the agent's door, unspoofable.
      expect(created.source).toBe('assistant')
      expect(created.status).toBe('open')
      expect(created.planDate).toBe('2026-07-24')

      const list = (await (
        await app.request(`/workspaces/${workspace.id}/plans`)
      ).json()) as { id: string }[]
      expect(list.map((p) => p.id)).toEqual([created.id])
    })
  })

  it('POST / rejects a malformed planDate (400)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/plans`,
        jsonBody('POST', { title: 'Undated', planDate: 'tomorrow' }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('GET / filters by status and planDate; workspace list excludes global rows', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertPlan(db, makePlan(user.id, workspace.id, { title: 'open one', planDate: '2026-07-23' }))
      insertPlan(
        db,
        makePlan(user.id, workspace.id, { title: 'done one', status: 'done', planDate: '2026-07-22' }),
      )
      insertPlan(db, makePlan(user.id, null, { title: 'global one' }))

      const all = (await (
        await app.request(`/workspaces/${workspace.id}/plans`)
      ).json()) as { title: string }[]
      expect(all.map((p) => p.title).sort()).toEqual(['done one', 'open one'])

      const done = (await (
        await app.request(`/workspaces/${workspace.id}/plans?status=done`)
      ).json()) as { title: string }[]
      expect(done.map((p) => p.title)).toEqual(['done one'])

      const day = (await (
        await app.request(`/workspaces/${workspace.id}/plans?planDate=2026-07-23`)
      ).json()) as { title: string }[]
      expect(day.map((p) => p.title)).toEqual(['open one'])
    })
  })

  it('PATCH /:planId updates status/date; POST /:planId/complete stamps completedAt', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const plan = insertPlan(db, makePlan(user.id, workspace.id))

      const patched = await app.request(
        `/workspaces/${workspace.id}/plans/${plan.id}`,
        jsonBody('PATCH', { status: 'in-progress', planDate: '2026-08-01' }),
      )
      expect(patched.status).toBe(200)
      const patchedBody = (await patched.json()) as { status: string; planDate: string }
      expect(patchedBody.status).toBe('in-progress')
      expect(patchedBody.planDate).toBe('2026-08-01')

      const completed = await app.request(`/workspaces/${workspace.id}/plans/${plan.id}/complete`, {
        method: 'POST',
      })
      expect(completed.status).toBe(200)
      const body = (await completed.json()) as { status: string; completedAt: string | null }
      expect(body.status).toBe('done')
      expect(body.completedAt).not.toBeNull()
    })
  })

  it("404s on another user's plan (tenant boundary)", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser()) // resolved as the local user
      const attackerWorkspace = seedWorkspace(db, attacker.id)
      const victim = insertUser(db, makeUser())
      const victimWorkspace = seedWorkspace(db, victim.id)
      const victimPlan = insertPlan(db, makePlan(victim.id, victimWorkspace.id))

      const res = await app.request(
        `/workspaces/${attackerWorkspace.id}/plans/${victimPlan.id}`,
        jsonBody('PATCH', { status: 'done' }),
      )
      expect(res.status).toBe(404)
    })
  })
})

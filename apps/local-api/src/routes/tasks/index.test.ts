// Integration tests for the workspace-scoped `/workspaces/:workspaceId/tasks`
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

describe('workspace-scoped tasks routes', () => {
  it('POST / creates an ASSISTANT-sourced task; GET / lists it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/tasks`,
        jsonBody('POST', { title: 'Draft the newsletter', detail: 'Spring menu.' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { id: string; source: string; status: string }
      // Provenance is hard-coded by the route — the agent's door, unspoofable.
      expect(created.source).toBe('assistant')
      expect(created.status).toBe('open')

      const list = (await (
        await app.request(`/workspaces/${workspace.id}/tasks`)
      ).json()) as { id: string }[]
      expect(list.map((t) => t.id)).toEqual([created.id])
    })
  })

  it('GET /?status=done filters; workspace list excludes global rows', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertTask(db, makeTask(user.id, workspace.id, { title: 'open one' }))
      insertTask(db, makeTask(user.id, workspace.id, { title: 'done one', status: 'done' }))
      insertTask(db, makeTask(user.id, null, { title: 'global one' }))

      const all = (await (
        await app.request(`/workspaces/${workspace.id}/tasks`)
      ).json()) as { title: string }[]
      expect(all.map((t) => t.title).sort()).toEqual(['done one', 'open one'])

      const done = (await (
        await app.request(`/workspaces/${workspace.id}/tasks?status=done`)
      ).json()) as { title: string }[]
      expect(done.map((t) => t.title)).toEqual(['done one'])
    })
  })

  it('PATCH /:taskId updates status; POST /:taskId/complete stamps completedAt', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const task = insertTask(db, makeTask(user.id, workspace.id))

      const patched = await app.request(
        `/workspaces/${workspace.id}/tasks/${task.id}`,
        jsonBody('PATCH', { status: 'in-progress' }),
      )
      expect(patched.status).toBe(200)
      expect(((await patched.json()) as { status: string }).status).toBe('in-progress')

      const completed = await app.request(`/workspaces/${workspace.id}/tasks/${task.id}/complete`, {
        method: 'POST',
      })
      expect(completed.status).toBe(200)
      const body = (await completed.json()) as { status: string; completedAt: string | null }
      expect(body.status).toBe('done')
      expect(body.completedAt).not.toBeNull()
    })
  })

  it('rejects an empty title with 400 at the boundary', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/tasks`,
        jsonBody('POST', { title: '' }),
      )
      expect(res.status).toBe(400)
    })
  })

  it("404s on another user's task (attacker resolved first)", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser())
      const attackerWorkspace = seedWorkspace(db, attacker.id)
      const victim = seedUserWorkspace(db)
      const victimTask = insertTask(db, makeTask(victim.userId, victim.workspaceId))

      const res = await app.request(
        `/workspaces/${attackerWorkspace.id}/tasks/${victimTask.id}`,
        jsonBody('PATCH', { status: 'done' }),
      )
      expect(res.status).toBe(404)
    })
  })
})

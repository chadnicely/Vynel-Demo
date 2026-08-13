// Integration tests for the workspace-scoped `/workspaces/:workspaceId/phases`
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
import { insertPhase, makePhase } from '@vynel/phases/test-support'
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

describe('workspace-scoped phases routes', () => {
  it('POST / appends phases in order; GET / lists previews, GET /:id the full text', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const longDescription = 'The full write-up of the foundations stage. '.repeat(20)
      const res = await app.request(
        `/workspaces/${workspace.id}/phases`,
        jsonBody('POST', { title: 'Phase 1 — Foundations', description: longDescription }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        id: string
        orderIndex: number
        status: string
        description: string
      }
      expect(created.status).toBe('open')
      expect(created.orderIndex).toBe(0)
      expect(created.description).toBe(longDescription.trim())

      const second = (await (
        await app.request(
          `/workspaces/${workspace.id}/phases`,
          jsonBody('POST', { title: 'Phase 2 — Ordering', description: 'Ordering flow.' }),
        )
      ).json()) as { orderIndex: number }
      expect(second.orderIndex).toBe(1)

      // The LIST carries a bounded preview, never the full body.
      const list = (await (
        await app.request(`/workspaces/${workspace.id}/phases`)
      ).json()) as { title: string; descriptionPreview: string; description?: string }[]
      expect(list.map((p) => p.title)).toEqual(['Phase 1 — Foundations', 'Phase 2 — Ordering'])
      expect(list[0]!.description).toBeUndefined()
      expect(list[0]!.descriptionPreview.length).toBeLessThan(longDescription.length)
      expect(list[0]!.descriptionPreview.endsWith('…')).toBe(true)

      // The single GET carries the full text.
      const full = (await (
        await app.request(`/workspaces/${workspace.id}/phases/${created.id}`)
      ).json()) as { description: string }
      expect(full.description).toBe(longDescription.trim())
    })
  })

  it('GET / filters by status', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertPhase(db, makePhase(user.id, workspace.id, { title: 'open one', orderIndex: 0 }))
      insertPhase(
        db,
        makePhase(user.id, workspace.id, { title: 'done one', status: 'done', orderIndex: 1 }),
      )

      const done = (await (
        await app.request(`/workspaces/${workspace.id}/phases?status=done`)
      ).json()) as { title: string }[]
      expect(done.map((p) => p.title)).toEqual(['done one'])
    })
  })

  it('PATCH /:phaseId moves status + order; POST /:phaseId/complete stamps completedAt', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const phase = insertPhase(db, makePhase(user.id, workspace.id))

      const patched = await app.request(
        `/workspaces/${workspace.id}/phases/${phase.id}`,
        jsonBody('PATCH', { status: 'in-progress', orderIndex: 2 }),
      )
      expect(patched.status).toBe(200)
      const patchedBody = (await patched.json()) as { status: string; orderIndex: number }
      expect(patchedBody.status).toBe('in-progress')
      expect(patchedBody.orderIndex).toBe(2)

      const completed = await app.request(
        `/workspaces/${workspace.id}/phases/${phase.id}/complete`,
        { method: 'POST' },
      )
      expect(completed.status).toBe(200)
      const body = (await completed.json()) as { status: string; completedAt: string | null }
      expect(body.status).toBe('done')
      expect(body.completedAt).not.toBeNull()
    })
  })

  it('DELETE /:phaseId removes the phase', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const phase = insertPhase(db, makePhase(user.id, workspace.id))

      const res = await app.request(`/workspaces/${workspace.id}/phases/${phase.id}`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(204)

      const gone = await app.request(`/workspaces/${workspace.id}/phases/${phase.id}`)
      expect(gone.status).toBe(404)
    })
  })

  it("404s on another user's phase (tenant boundary)", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser()) // resolved as the local user
      const attackerWorkspace = seedWorkspace(db, attacker.id)
      const victim = insertUser(db, makeUser())
      const victimWorkspace = seedWorkspace(db, victim.id)
      const victimPhase = insertPhase(db, makePhase(victim.id, victimWorkspace.id))

      const res = await app.request(
        `/workspaces/${attackerWorkspace.id}/phases/${victimPhase.id}`,
        jsonBody('PATCH', { status: 'done' }),
      )
      expect(res.status).toBe(404)
    })
  })
})

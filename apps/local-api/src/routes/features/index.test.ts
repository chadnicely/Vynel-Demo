// Integration tests for the workspace-scoped
// `/workspaces/:workspaceId/features` routes — the AGENT's surface. Full HTTP
// stack: route -> validator -> workspaceScoped -> core op -> repo -> SQLite
// (real, via withTestDatabase). No mocks.
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
import { insertFeature, makeFeature } from '@vynel/features/test-support'
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

describe('workspace-scoped features routes', () => {
  it('POST / creates (with phase link); GET / lists previews, GET /:id the full text', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const longDescription = 'Customers browse the menu, build a basket, and pay online. '.repeat(
        10,
      )
      const res = await app.request(
        `/workspaces/${workspace.id}/features`,
        jsonBody('POST', {
          title: 'Online ordering',
          description: longDescription,
          phaseId: 'phase-1',
        }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        id: string
        status: string
        phaseId: string | null
        description: string
      }
      expect(created.status).toBe('open')
      expect(created.phaseId).toBe('phase-1')
      expect(created.description).toBe(longDescription.trim())

      // The LIST carries a bounded preview, never the full body.
      const list = (await (
        await app.request(`/workspaces/${workspace.id}/features`)
      ).json()) as { title: string; descriptionPreview: string; description?: string }[]
      expect(list.map((f) => f.title)).toEqual(['Online ordering'])
      expect(list[0]!.description).toBeUndefined()
      expect(list[0]!.descriptionPreview.endsWith('…')).toBe(true)

      // The single GET carries the full text.
      const full = (await (
        await app.request(`/workspaces/${workspace.id}/features/${created.id}`)
      ).json()) as { description: string }
      expect(full.description).toBe(longDescription.trim())
    })
  })

  it('GET / filters by status and phaseId', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      insertFeature(db, makeFeature(user.id, workspace.id, { title: 'unplaced' }))
      insertFeature(
        db,
        makeFeature(user.id, workspace.id, {
          title: 'placed done',
          phaseId: 'phase-1',
          status: 'done',
        }),
      )

      const inPhase = (await (
        await app.request(`/workspaces/${workspace.id}/features?phaseId=phase-1`)
      ).json()) as { title: string }[]
      expect(inPhase.map((f) => f.title)).toEqual(['placed done'])

      const done = (await (
        await app.request(`/workspaces/${workspace.id}/features?status=done`)
      ).json()) as { title: string }[]
      expect(done.map((f) => f.title)).toEqual(['placed done'])
    })
  })

  it('PATCH /:featureId relinks + unlinks the phase; POST /:featureId/complete stamps completedAt', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const feature = insertFeature(db, makeFeature(user.id, workspace.id, { phaseId: 'phase-1' }))

      const relinked = (await (
        await app.request(
          `/workspaces/${workspace.id}/features/${feature.id}`,
          jsonBody('PATCH', { phaseId: 'phase-2', status: 'in-progress' }),
        )
      ).json()) as { phaseId: string | null; status: string }
      expect(relinked.phaseId).toBe('phase-2')
      expect(relinked.status).toBe('in-progress')

      const unlinked = (await (
        await app.request(
          `/workspaces/${workspace.id}/features/${feature.id}`,
          jsonBody('PATCH', { phaseId: null }),
        )
      ).json()) as { phaseId: string | null }
      expect(unlinked.phaseId).toBeNull()

      const completed = await app.request(
        `/workspaces/${workspace.id}/features/${feature.id}/complete`,
        { method: 'POST' },
      )
      expect(completed.status).toBe(200)
      const body = (await completed.json()) as { status: string; completedAt: string | null }
      expect(body.status).toBe('done')
      expect(body.completedAt).not.toBeNull()
    })
  })

  it('DELETE /:featureId removes the feature', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const feature = insertFeature(db, makeFeature(user.id, workspace.id))

      const res = await app.request(`/workspaces/${workspace.id}/features/${feature.id}`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(204)

      const gone = await app.request(`/workspaces/${workspace.id}/features/${feature.id}`)
      expect(gone.status).toBe(404)
    })
  })

  it("404s on another user's feature (tenant boundary)", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser()) // resolved as the local user
      const attackerWorkspace = seedWorkspace(db, attacker.id)
      const victim = insertUser(db, makeUser())
      const victimWorkspace = seedWorkspace(db, victim.id)
      const victimFeature = insertFeature(db, makeFeature(victim.id, victimWorkspace.id))

      const res = await app.request(
        `/workspaces/${attackerWorkspace.id}/features/${victimFeature.id}`,
        jsonBody('PATCH', { status: 'done' }),
      )
      expect(res.status).toBe(404)
    })
  })
})

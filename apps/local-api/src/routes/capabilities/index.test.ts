// Integration tests for the `/workspaces/:workspaceId/capabilities/...`
// routes. Full HTTP stack (route → workspaceScoped → core op → repo →
// SQLite), mirroring the `skills` route test's setup style.

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

describe('capabilities routes', () => {
  describe('GET /capabilities', () => {
    it('returns every catalog capability, all disabled by default', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${workspace.id}/capabilities`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { capabilities: Array<{ id: string; isEnabled: boolean }> }
        expect(body.capabilities.map((c) => c.id).sort()).toEqual(['knowledge', 'memory'])
        expect(body.capabilities.every((c) => !c.isEnabled)).toBe(true)
      })
    })

    it('returns 404 for an unknown/not-owned workspace', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}/capabilities`)
        expect(res.status).toBe(404)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('not_found')
      })
    })
  })

  describe('PUT /capabilities/:capabilityId', () => {
    it('enables a capability and returns the updated status', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${workspace.id}/capabilities/memory`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isEnabled: true }),
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { id: string; isEnabled: boolean }
        expect(body.id).toBe('memory')
        expect(body.isEnabled).toBe(true)

        // Round-trips through the list route too.
        const listRes = await app.request(`/workspaces/${workspace.id}/capabilities`)
        const list = (await listRes.json()) as { capabilities: Array<{ id: string; isEnabled: boolean }> }
        expect(list.capabilities.find((c) => c.id === 'memory')?.isEnabled).toBe(true)
        expect(list.capabilities.find((c) => c.id === 'knowledge')?.isEnabled).toBe(false)
      })
    })

    it('returns 400 for a capabilityId outside the catalog enum', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${workspace.id}/capabilities/bogus`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isEnabled: true }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 400 when isEnabled is not a boolean', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${workspace.id}/capabilities/memory`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isEnabled: 'yes' }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 404 for an unknown/not-owned workspace', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}/capabilities/memory`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isEnabled: true }),
        })
        expect(res.status).toBe(404)
      })
    })
  })
})

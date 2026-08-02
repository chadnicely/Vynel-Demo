// Integration tests for the read routes of the `/agents` HTTP surface —
// full HTTP stack (route → userScoped → core op → repo → SQLite). Mutating
// routes are covered in `index.mutations.test.ts` (mirrors the skills
// route-test split for a large route file).
//
// The user is the Phase-1 single local user that `userResolverMiddleware`
// resolves via `getOrCreateLocalUser` — seeds call the same op so workspace
// ownership lines up with what the route will see.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const logger = pino({ level: 'silent' })

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: '/tmp/acme',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

async function createUserScopeAgent(
  app: ReturnType<typeof createApp>,
  slug: string,
  name = 'My Agent',
) {
  const res = await app.request('/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug,
      name,
      description: 'A test agent.',
      prompt: 'You are a helpful test agent.',
      scope: 'user',
    }),
  })
  return res
}

describe('GET /agents', () => {
  // SPEC CHANGE (2026-08-03): the two questions were split. `GET /agents` is
  // the MENU's read — what a scope OWNS — so a user-scope agent no longer shows
  // under a workspace. `GET /agents/resolved` is what the composer's "@" picker
  // and Claude's own `list_agents` ask, and keeps the union.
  it('returns only the workspace-scope agents for a workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger })

      const created = await createUserScopeAgent(app, 'inbox-helper')
      expect(created.status).toBe(201)

      const res = await app.request(`/agents?workspaceId=${workspace.id}`)
      expect(res.status).toBe(200)
      expect((await res.json()) as Array<{ slug: string }>).toEqual([])
    })
  })

  it('returns the user-scope ∪ workspace-scope agents on /agents/resolved', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger })

      const created = await createUserScopeAgent(app, 'inbox-helper')
      expect(created.status).toBe(201)

      const res = await app.request(`/agents/resolved?workspaceId=${workspace.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ slug: string }>
      expect(body).toHaveLength(1)
      expect(body[0]!.slug).toBe('inbox-helper')
    })
  })

  it('404s when the workspace is not found', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents?workspaceId=nonexistent-workspace')
      expect(res.status).toBe(404)
    })
  })

  it('returns user-scope agents only when workspaceId is omitted (the global surface)', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger })
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger })

      const created = await createUserScopeAgent(app, 'inbox-helper')
      expect(created.status).toBe(201)
      const workspaceScoped = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'room-only',
          name: 'Room Only',
          description: 'A workspace-scoped test agent.',
          prompt: 'You help this room.',
          scope: 'workspace',
          workspaceId: workspace.id,
        }),
      })
      expect(workspaceScoped.status).toBe(201)

      const res = await app.request('/agents')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ slug: string }>
      expect(body.map((agent) => agent.slug)).toEqual(['inbox-helper'])
    })
  })
})

describe('GET /agents/curated', () => {
  it('returns the compiled-in curated catalog', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/curated')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ slug: string; recommendedScope: string }>
      const slugs = body.map((entry) => entry.slug).sort()
      expect(slugs).toEqual(['document-generator', 'inbox-assistant', 'researcher'])
    })
  })
})

describe('GET /agents/:slug', () => {
  it('returns the user-scope agent by slug (with preloaded skillIds)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      await createUserScopeAgent(app, 'researcher-clone')

      const res = await app.request('/agents/researcher-clone')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { slug: string; skillIds: string[] }
      expect(body.slug).toBe('researcher-clone')
      expect(body.skillIds).toEqual([])
    })
  })

  it('404s when no agent matches the slug at that scope', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/no-such-slug')
      expect(res.status).toBe(404)
    })
  })
})

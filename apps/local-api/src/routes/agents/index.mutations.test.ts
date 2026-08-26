// Integration tests for the mutating routes of the `/agents` HTTP surface —
// full HTTP stack (route → userScoped → core op → repo → SQLite). Read
// routes are covered in `index.test.ts` (mirrors the skills route-test
// split for a large route file).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { withHomeDir } from '@vynel/agents/test-support'
import { createApp } from '../../app.js'
import { beginHomeDirOverride } from '@vynel/agents/test-support'

const logger = pino({ level: 'silent' })

// A curated install writes the agent's transparency mirror under
// `~/.claude/agents/` — isolate the real home to a tmpdir.
async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-agents-route-home-'))
  try {
    return await withHomeDir(homeDir, fn)
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

// Every test here creates agents through the API, and createAgent writes the
// disk mirror for EVERY source (2026-08-26) — the home is isolated per test so
// a user-scope fixture never lands in the developer's real ~/.claude/agents.
let isolatedHomeDir = ''
let restoreHomeDir: () => void = () => undefined
beforeEach(() => {
  isolatedHomeDir = mkdtempSync(join(tmpdir(), 'vynel-agents-routes-home-'))
  restoreHomeDir = beginHomeDirOverride(isolatedHomeDir)
})
afterEach(() => {
  restoreHomeDir()
  rmSync(isolatedHomeDir, { recursive: true, force: true })
})

describe('POST /agents', () => {
  it('creates a user-scope agent — 201 with preloaded skillIds', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'my-agent',
          name: 'My Agent',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'user',
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        slug: string
        source: string
        trustTier: string
        skillIds: string[]
      }
      expect(body.slug).toBe('my-agent')
      expect(body.source).toBe('user')
      expect(body.trustTier).toBe('community')
      expect(body.skillIds).toEqual([])
    })
  })

  it('400s when scope is "workspace" but workspaceId is omitted', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'my-agent',
          name: 'My Agent',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'workspace',
        }),
      })
      expect(res.status).toBe(400)
    })
  })

  it('404s when scope is "workspace" and the workspace does not exist', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'my-agent',
          name: 'My Agent',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'workspace',
          workspaceId: 'nonexistent-workspace',
        }),
      })
      expect(res.status).toBe(404)
    })
  })

  it('409s when an agent with the same slug already exists at that scope', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const body = JSON.stringify({
        slug: 'dup-agent',
        name: 'Dup Agent',
        description: 'Does things.',
        prompt: 'You are helpful.',
        scope: 'user',
      })
      const first = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(first.status).toBe(201)

      const second = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(second.status).toBe(409)
    })
  })
})

describe('POST /agents/curated/install', () => {
  it('installs a curated agent at user-scope — 201', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        getOrCreateLocalUser(db, { logger })
        const app = createApp({ db, logger })
        const res = await app.request('/agents/curated/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: 'researcher', scope: 'user' }),
        })
        expect(res.status).toBe(201)
        const body = (await res.json()) as { slug: string; source: string; trustTier: string }
        expect(body.slug).toBe('researcher')
        expect(body.source).toBe('vynel')
        expect(body.trustTier).toBe('verified')
      })
    })
  })

  it('404s for an unknown curated slug', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/curated/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'no-such-curated-agent', scope: 'user' }),
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('PATCH /agents/:agentId', () => {
  it('updates persona fields — 200', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const created = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'editable-agent',
          name: 'Before',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'user',
        }),
      })
      const { id } = (await created.json()) as { id: string }

      const res = await app.request(`/agents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'After' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('After')
    })
  })

  it('404s when the agent does not exist', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/nonexistent-agent', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'After' }),
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('POST /agents/:agentId/enable', () => {
  it('toggles enabled — 200', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const created = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'toggle-agent',
          name: 'Toggle',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'user',
        }),
      })
      const { id } = (await created.json()) as { id: string }

      const res = await app.request(`/agents/${id}/enable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { enabled: boolean }
      expect(body.enabled).toBe(false)
    })
  })

  it('404s when the agent does not exist', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/nonexistent-agent/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(res.status).toBe(404)
    })
  })
})

describe('DELETE /agents/:agentId', () => {
  it('soft-deletes — 204, then the agent 404s on lookup', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const created = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'deletable-agent',
          name: 'Deletable',
          description: 'Does things.',
          prompt: 'You are helpful.',
          scope: 'user',
        }),
      })
      const { id } = (await created.json()) as { id: string }

      const res = await app.request(`/agents/${id}`, { method: 'DELETE' })
      expect(res.status).toBe(204)

      const lookup = await app.request('/agents/deletable-agent')
      expect(lookup.status).toBe(404)
    })
  })

  it('404s when the agent does not exist', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger })
      const app = createApp({ db, logger })
      const res = await app.request('/agents/nonexistent-agent', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })
})

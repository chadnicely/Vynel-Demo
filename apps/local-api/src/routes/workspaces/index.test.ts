// Integration tests for the read + register `/workspaces/...` routes
// (GET /, POST /, GET /directories, GET /:workspaceId). The mutating
// `:workspaceId` routes (PATCH / archive / unarchive / DELETE) live in
// `index.mutations.test.ts`. Split per structure-standard.md "File size
// cap" (mirrors the `skills` route tests).
//
// These routes touch real directories on disk (register + the folder
// picker), so each test that needs one makes its own tmpdir via
// `mkdtempSync` + cleans up with `rmSync` — the same seam
// `create-workspace.test.ts` uses at the core-op layer. No home-dir
// isolation is needed here (unlike `skills`): workspaces only ever
// touches the workspace's own directory, never `~/.claude/...`.
//
// Phase 1 has exactly one local user (`getOrCreateLocalUser` /
// `findSingleLocalUser`) — seeding a user directly via `insertUser`
// makes it THE user every request resolves to, same as the skills/
// channels route tests.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspacePath: string,
  overrides: { isArchived?: boolean } = {},
) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: workspacePath,
    isArchived: overrides.isArchived ?? false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-workspaces-routes-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('workspaces routes', () => {
  describe('GET /workspaces', () => {
    it("returns the resolved user's workspaces", async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request('/workspaces')
          expect(res.status).toBe(200)
          const body = (await res.json()) as Array<{ name: string }>
          expect(body).toHaveLength(1)
          expect(body[0]!.name).toBe('Acme')
        })
      })
    })

    it('excludes archived workspaces unless includeArchived=true', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          seedWorkspace(db, user.id, workspacePath, { isArchived: true })
          const app = createApp({ db, logger: silentLogger })

          const defaultList = await app.request('/workspaces')
          expect(await defaultList.json()).toEqual([])

          const includeArchived = await app.request('/workspaces?includeArchived=true')
          const body = (await includeArchived.json()) as unknown[]
          expect(body).toHaveLength(1)
        })
      })
    })
  })

  describe('POST /workspaces', () => {
    it('registers an existing directory: 201 with the created workspace', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request('/workspaces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Acme', kind: 'small-business', directory: workspacePath }),
          })
          expect(res.status).toBe(201)
          const body = (await res.json()) as { kind: string; path: string }
          expect(body.kind).toBe('small-business')
          expect(body.path).toBeTruthy()
        })
      })
    })

    it('defaults kind to personal when omitted', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request('/workspaces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'No Kind', directory: workspacePath }),
          })
          expect(res.status).toBe(201)
          const body = (await res.json()) as { kind: string }
          expect(body.kind).toBe('personal')
        })
      })
    })

    it('returns 400 when the directory does not exist (ValidationError mapping)', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const missing = join(tmpdir(), `vynel-missing-${randomUUID()}`)
        const res = await app.request('/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'X', directory: missing }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 409 when the directory is already a workspace (ConflictError mapping)', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const app = createApp({ db, logger: silentLogger })
          const first = await app.request('/workspaces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'A', directory: workspacePath }),
          })
          expect(first.status).toBe(201)

          const second = await app.request('/workspaces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'A again', directory: workspacePath }),
          })
          expect(second.status).toBe(409)
        })
      })
    })
  })

  describe('GET /workspaces/directories', () => {
    it('lists subdirectories of an explicit path', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (parentDir) => {
          mkdirSync(join(parentDir, 'Clients'))
          mkdirSync(join(parentDir, 'Invoices'))
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/directories?path=${encodeURIComponent(parentDir)}`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as { entries: Array<{ name: string }> }
          expect(body.entries.map((e) => e.name).sort()).toEqual(['Clients', 'Invoices'])
        })
      })
    })

    it('returns 400 for a path that does not exist', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const missing = join(tmpdir(), `vynel-missing-dir-${randomUUID()}`)
        const res = await app.request(`/workspaces/directories?path=${encodeURIComponent(missing)}`)
        expect(res.status).toBe(400)
      })
    })
  })

  describe('GET /workspaces/:workspaceId', () => {
    it('returns the workspace when owned by the resolved user', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as { id: string; name: string }
          expect(body.id).toBe(workspace.id)
          expect(body.name).toBe('Acme')
        })
      })
    })

    it('returns 404 for a nonexistent workspace id (NotFoundError mapping)', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}`)
        expect(res.status).toBe(404)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('not_found')
      })
    })
  })
})

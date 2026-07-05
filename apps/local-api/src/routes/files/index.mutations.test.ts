// Integration tests for the MUTATING `/workspaces/:workspaceId/files/...`
// routes (create file / create directory / move / delete). The read
// routes (tree/content/raw) live in `index.test.ts`; the activity feed
// lives in `activity.test.ts`. Split per structure-standard.md "File
// size cap" (skills precedent).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspacePath: string,
) {
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
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function withWorkspaceDir<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-files-routes-mut-test-'))
  try {
    return await fn(workspaceDir)
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('files routes — mutations', () => {
  describe('POST /files/file', () => {
    it('creates a new file + returns SerializedFileMetadata', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'new.md', content: 'hello' }),
          })
          expect(res.status).toBe(200)
          const body = (await res.json()) as { relativePath: string }
          expect(body.relativePath).toBe('new.md')
          expect(existsSync(join(workspacePath, 'new.md'))).toBe(true)
        })
      })
    })

    it('returns 409 when a file already exists at that path', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'exists.md'), 'already here')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'exists.md' }),
          })
          expect(res.status).toBe(409)
          const body = (await res.json()) as { code: string }
          expect(body.code).toBe('conflict')
        })
      })
    })
  })

  describe('POST /files/directory', () => {
    it('creates a folder (wasCreated:true) and is idempotent on a second call', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const first = await app.request(`/workspaces/${workspace.id}/files/directory`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'assets' }),
          })
          expect(first.status).toBe(200)
          expect((await first.json()) as { wasCreated: boolean }).toEqual({
            relativePath: 'assets',
            wasCreated: true,
          })

          const second = await app.request(`/workspaces/${workspace.id}/files/directory`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'assets' }),
          })
          expect(second.status).toBe(200)
          expect((await second.json()) as { wasCreated: boolean }).toEqual({
            relativePath: 'assets',
            wasCreated: false,
          })
        })
      })
    })
  })

  describe('POST /files/move', () => {
    it('renames a file', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'old.md'), 'content')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromPath: 'old.md', toPath: 'new.md' }),
          })
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual({ fromPath: 'old.md', toPath: 'new.md' })
          expect(existsSync(join(workspacePath, 'old.md'))).toBe(false)
          expect(existsSync(join(workspacePath, 'new.md'))).toBe(true)
        })
      })
    })

    it('returns 404 when the source does not exist', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromPath: 'missing.md', toPath: 'new.md' }),
          })
          expect(res.status).toBe(404)
        })
      })
    })
  })

  describe('POST /files/delete', () => {
    it('deletes a file', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'gone.md'), 'bye')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'gone.md' }),
          })
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual({ relativePath: 'gone.md', kind: 'file' })
          expect(existsSync(join(workspacePath, 'gone.md'))).toBe(false)
        })
      })
    })

    it('returns 409 for a non-empty directory without recursive:true', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          mkdirSync(join(workspacePath, 'folder'))
          writeFileSync(join(workspacePath, 'folder', 'inside.md'), 'x')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'folder' }),
          })
          expect(res.status).toBe(409)
        })
      })
    })
  })
})

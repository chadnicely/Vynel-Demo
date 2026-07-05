// Integration tests for the `/workspaces/:workspaceId/files/...` READ
// routes (tree, content, raw). Full HTTP stack (route → workspaceScoped
// → core op → real disk). Each test gets a fresh per-test tmpdir as the
// workspace root — the ops read/write real files, so a shared dir would
// leak state across tests and risk touching the dev's real filesystem.
//
// Mutating routes (create/move/delete) live in `index.mutations.test.ts`;
// the activity feed lives in `activity.test.ts`. Split per
// structure-standard.md "File size cap" (skills precedent).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// The ops read/write real files under `workspacePath` — isolate every test
// to its own tmpdir so a run never touches the dev's real filesystem and
// tests never see each other's files.
async function withWorkspaceDir<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-files-routes-test-'))
  try {
    return await fn(workspaceDir)
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('files routes', () => {
  describe('GET /files/tree', () => {
    it('lists entries at the workspace root, dirs first then alpha', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'notes.md'), '# hi')
          mkdirSync(join(workspacePath, 'sub'))
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/tree`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            entries: Array<{ name: string; kind: string }>
          }
          expect(body.entries.map((e) => e.name)).toEqual(['sub', 'notes.md'])
        })
      })
    })

    it('returns 400 for a path that escapes the workspace root', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(
            `/workspaces/${workspace.id}/files/tree?path=${encodeURIComponent('..')}`,
          )
          expect(res.status).toBe(400)
          const body = (await res.json()) as { code: string }
          expect(body.code).toBe('validation_failed')
        })
      })
    })
  })

  describe('GET /files/content', () => {
    it('reads a text file, deriving the markdown kind from its extension', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'notes.md'), '# hello')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(
            `/workspaces/${workspace.id}/files/content?path=notes.md`,
          )
          expect(res.status).toBe(200)
          const body = (await res.json()) as { kind: string; content: string; isText: boolean }
          expect(body.kind).toBe('markdown')
          expect(body.isText).toBe(true)
          expect(body.content).toBe('# hello')
        })
      })
    })

    it('returns 404 for a file that does not exist', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(
            `/workspaces/${workspace.id}/files/content?path=missing.md`,
          )
          expect(res.status).toBe(404)
        })
      })
    })
  })

  describe('PUT /files/content', () => {
    it('saves the file + returns SerializedFileMetadata', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'notes.md'), 'old')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/content`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes.md', content: 'new content' }),
          })
          expect(res.status).toBe(200)
          const body = (await res.json()) as { relativePath: string; fileSizeBytes: number }
          expect(body.relativePath).toBe('notes.md')
          expect(body.fileSizeBytes).toBe(Buffer.byteLength('new content', 'utf8'))
        })
      })
    })

    it('returns 400 when the write targets the reserved .vynel/ folder', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/content`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: '.vynel/state.json', content: '{}' }),
          })
          expect(res.status).toBe(400)
        })
      })
    })
  })

  describe('GET /files/raw', () => {
    it('streams the bytes with the derived content-type', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          writeFileSync(join(workspacePath, 'report.pdf'), 'not-a-real-pdf')
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/raw?path=report.pdf`)
          expect(res.status).toBe(200)
          expect(res.headers.get('content-type')).toBe('application/pdf')
          const text = await res.text()
          expect(text).toBe('not-a-real-pdf')
        })
      })
    })

    it('returns 404 for a file that does not exist', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/raw?path=missing.pdf`)
          expect(res.status).toBe(404)
        })
      })
    })
  })
})

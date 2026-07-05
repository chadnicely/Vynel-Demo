// Integration tests for the MUTATING `/workspaces/:workspaceId` routes
// (PATCH / archive / unarchive / DELETE). The read + register routes
// live in `index.test.ts`. Split per structure-standard.md "File size
// cap" (mirrors the `skills` route tests).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { WORKSPACE_ARCHIVED_EVENT, WORKSPACE_DELETED_EVENT } from '@vynel/workspaces'
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
) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-workspaces-routes-mut-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('workspaces routes — mutations', () => {
  describe('PATCH /workspaces/:workspaceId', () => {
    it('updates name, managerName, and continueEnabled', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: 'Renamed',
              managerName: 'Mark',
              continueEnabled: false,
            }),
          })
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            name: string
            managerName: string
            continueEnabled: boolean
          }
          expect(body.name).toBe('Renamed')
          expect(body.managerName).toBe('Mark')
          expect(body.continueEnabled).toBe(false)
        })
      })
    })

    it('returns 404 for a nonexistent workspace id', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        })
        expect(res.status).toBe(404)
      })
    })
  })

  describe('POST /workspaces/:workspaceId/archive + /unarchive', () => {
    it('archive then unarchive round-trip — both 200 + archive emits workspace.archived', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const archiveRes = await app.request(`/workspaces/${workspace.id}/archive`, {
            method: 'POST',
          })
          expect(archiveRes.status).toBe(200)
          const archived = (await archiveRes.json()) as { isArchived: boolean }
          expect(archived.isArchived).toBe(true)

          const events = listOutboxEventsByType(db, WORKSPACE_ARCHIVED_EVENT)
          expect(events).toHaveLength(1)

          const unarchiveRes = await app.request(`/workspaces/${workspace.id}/unarchive`, {
            method: 'POST',
          })
          expect(unarchiveRes.status).toBe(200)
          const unarchived = (await unarchiveRes.json()) as { isArchived: boolean }
          expect(unarchived.isArchived).toBe(false)
        })
      })
    })

    it('returns 404 archiving a nonexistent workspace id', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}/archive`, { method: 'POST' })
        expect(res.status).toBe(404)
      })
    })
  })

  describe('DELETE /workspaces/:workspaceId', () => {
    it('returns 204 + emits workspace.deleted; preserves files when deleteFilesFromDisk is false', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deleteFilesFromDisk: false }),
          })
          expect(res.status).toBe(204)
          expect(existsSync(workspacePath)).toBe(true)

          const events = listOutboxEventsByType(db, WORKSPACE_DELETED_EVENT)
          expect(events).toHaveLength(1)
        })
      })
    })

    it('removes the folder from disk when deleteFilesFromDisk is true', async () => {
      await withTestDatabase(async (db) => {
        await withTmpDir(async (workspacePath) => {
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deleteFilesFromDisk: true }),
          })
          expect(res.status).toBe(204)
          expect(existsSync(workspacePath)).toBe(false)
        })
      })
    })

    it('returns 404 for a nonexistent workspace id', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deleteFilesFromDisk: false }),
        })
        expect(res.status).toBe(404)
      })
    })
  })
})

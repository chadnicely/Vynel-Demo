// Integration tests for the `/workspaces/:workspaceId/files/activity` +
// `/files/activity/file` read routes. Drives real mutations through the
// mounted HTTP stack (create/save) so the activity feed reflects actual
// `file_activities` rows rather than hand-seeded fixtures.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-files-routes-activity-test-'))
  try {
    return await fn(workspaceDir)
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('files routes — activity', () => {
  describe('GET /files/activity', () => {
    it('lists activity for both files created', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.md' }),
          })
          await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'b.md' }),
          })

          const res = await app.request(`/workspaces/${workspace.id}/files/activity`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            activities: Array<{ relativePath: string; activityKind: string }>
            nextCursor: unknown
          }
          // Both creates land in the feed. Not asserting which comes first —
          // both can occur within the same millisecond, and the keyset
          // tie-break (id DESC) is not insertion order.
          expect(body.activities.map((a) => a.relativePath).sort()).toEqual(['a.md', 'b.md'])
          expect(body.activities.every((a) => a.activityKind === 'file-created')).toBe(true)
          expect(body.nextCursor).toBeNull()
        })
      })
    })

    it('returns an empty feed for a fresh workspace', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/files/activity`)
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual({ activities: [], nextCursor: null })
        })
      })
    })
  })

  describe('GET /files/activity/file', () => {
    it('filters the feed to one relativePath', async () => {
      await withWorkspaceDir(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.md' }),
          })
          await app.request(`/workspaces/${workspace.id}/files/file`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'b.md' }),
          })
          // A save on a.md after both creates — history for a.md should have 2 rows.
          await app.request(`/workspaces/${workspace.id}/files/content`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'a.md', content: 'edited' }),
          })

          const res = await app.request(
            `/workspaces/${workspace.id}/files/activity/file?path=a.md`,
          )
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            activities: Array<{ relativePath: string; activityKind: string }>
          }
          expect(body.activities).toHaveLength(2)
          expect(body.activities.every((a) => a.relativePath === 'a.md')).toBe(true)
          // Not asserting order (see the note in the /activity test above) —
          // just that both the create and the edit were recorded.
          expect(body.activities.map((a) => a.activityKind).sort()).toEqual([
            'file-created',
            'file-edited',
          ])
        })
      })
    })
  })
})

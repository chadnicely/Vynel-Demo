// Integration tests for the status vocabulary surface (redesign Arc 5b):
// PUT /workspaces/:workspaceId/status (the set_workspace_status MCP write)
// + GET /workspaces/statuses (the composed facts read: set state, latest
// turn envelope, task rollup). Split file per the groups-test precedent.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { SessionActivityFeed, buildSessionTurnRecorder } from '@vynel/session/runtime'
import { createTask, updateTask } from '@vynel/tasks'
import type { WorkspaceStatusReport } from '@vynel/contracts/workspaces/workspace-status'
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
) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'project',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('workspaces routes — status vocabulary', () => {
  it('PUT /:workspaceId/status sets the state and the list echoes it', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })

      const put = await app.request(`/workspaces/${workspace.id}/status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed', note: 'All tasks shipped' }),
      })
      expect(put.status).toBe(200)
      const updated = (await put.json()) as {
        status: string | null
        statusNote: string | null
        statusSetAt: string | null
      }
      expect(updated.status).toBe('completed')
      expect(updated.statusNote).toBe('All tasks shipped')
      expect(updated.statusSetAt).not.toBeNull()
    })
  })

  it('rejects an unknown status word at the boundary', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'on-fire' }),
      })
      expect(res.status).toBe(400)
    })
  })

  it('GET /statuses composes set state + latest turn + task counts per workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const quiet = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })

      // Two tasks, one done — the rollup input.
      const task = createTask(db, {
        userId: user.id,
        workspaceId: workspace.id,
        title: 'One',
        source: 'assistant',
      })
      createTask(db, { userId: user.id, workspaceId: workspace.id, title: 'Two', source: 'user' })
      updateTask(db, { userId: user.id, taskId: task.id, status: 'done' })

      // A failed latest turn through the REAL write path (feed + recorder) —
      // the "stuck on an error" problem signal.
      const feed = new SessionActivityFeed({
        turnRecorder: buildSessionTurnRecorder(db, silentLogger),
      })
      feed
        .begin({
          userId: user.id,
          scopeKind: 'workspace',
          workspaceId: workspace.id,
          origin: 'web',
        })
        .end('failed')

      const res = await app.request('/workspaces/statuses')
      expect(res.status).toBe(200)
      const reports = (await res.json()) as WorkspaceStatusReport[]
      const byId = new Map(reports.map((row) => [row.workspaceId, row]))

      const busy = byId.get(workspace.id)
      expect(busy).toBeDefined()
      expect(busy!.tasksTotal).toBe(2)
      expect(busy!.tasksDone).toBe(1)
      expect(busy!.latestTurn?.endedReason).toBe('failed')
      expect(busy!.setStatus).toBeNull()

      const idle = byId.get(quiet.id)
      expect(idle).toMatchObject({ tasksTotal: 0, tasksDone: 0, latestTurn: null })
    })
  })

  describe('POST /:workspaceId/setup-complete', () => {
    it('stamps a pulled-in project set up, and the row echoes it — idempotent', async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id)
        const app = createApp({ db, logger: silentLogger })

        const before = (await (await app.request(`/workspaces/${workspace.id}`)).json()) as {
          setupCompletedAt: string | null
        }
        expect(before.setupCompletedAt).toBeNull()

        const res = await app.request(`/workspaces/${workspace.id}/setup-complete`, {
          method: 'POST',
        })
        expect(res.status).toBe(200)
        const stamped = (await res.json()) as { setupCompletedAt: string | null }
        expect(stamped.setupCompletedAt).not.toBeNull()

        const again = (await (
          await app.request(`/workspaces/${workspace.id}/setup-complete`, { method: 'POST' })
        ).json()) as { setupCompletedAt: string | null }
        expect(again.setupCompletedAt).toBe(stamped.setupCompletedAt)
      })
    })

    it('404s a workspace this user does not own', async () => {
      await withTestDatabase(async (db) => {
        seedUser(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await app.request(`/workspaces/${randomUUID()}/setup-complete`, {
          method: 'POST',
        })
        expect(res.status).toBe(404)
      })
    })
  })
})

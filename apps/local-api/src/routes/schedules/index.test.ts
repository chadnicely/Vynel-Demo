// Integration tests for the `/workspaces/:workspaceId/schedules/...` routes.
// Full HTTP stack: route -> validator -> workspaceScoped -> core op -> repo
// -> SQLite (real, via withTestDatabase).
//
// Every route runs the REAL core op against a repo-seeded schedule. A fresh
// test DB has exactly one user, so getOrCreateLocalUser (the Phase-1 resolver)
// returns that seeded user and the seeded workspace resolves for the route.
// `insertSchedule` / `insertScheduleRun` come from `@vynel/schedules/test-support`
// (the leaf keeps its repositories internal to the production barrel).
//
// The source `POST /:scheduleId/fire-now` route is NOT ported yet (its MCP-turn
// composition — composeSessionMcpServers / vynelWorkspaceDescriptor — is
// deferred to the session Slice-3 app-wiring), so it has no test here.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertSchedule,
  insertScheduleRun,
  type NewSchedule,
} from '@vynel/schedules/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function seedWorld(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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

function seedSchedule(
  db: Database,
  userId: string,
  workspaceId: string,
  overrides: Partial<NewSchedule> = {},
) {
  const now = new Date()
  return insertSchedule(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    templateKind: 'custom',
    scheduleKind: 'recurring',
    displayName: 'Custom',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    promptTemplate: 'Do the thing',
    destinationKind: 'chat-only',
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

describe('schedules routes', () => {
  it('GET / returns an empty list initially', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/schedules`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  it('GET /templates returns the built-in templates (incl. the verbatim reminder)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/schedules/templates`)
      expect(res.status).toBe(200)
      const templates = (await res.json()) as { templateKind: string }[]
      expect(templates.map((t) => t.templateKind)).toEqual([
        'morning-briefing',
        'weekly-summary',
        'email-watch',
        'custom',
        'reminder',
      ])
    })
  })

  it('POST / creates a RECURRING (cron) schedule (201) and GET / then lists it', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules`,
        jsonBody('POST', { templateKind: 'morning-briefing', channelId: 'chan-1' }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        nextScheduledFireAt: string | null
        cronExpression: string | null
        scheduleKind: string
      }
      expect(created.scheduleKind).toBe('recurring')
      expect(created.nextScheduledFireAt).not.toBeNull()
      expect(created.cronExpression).toBe('0 8 * * *') // the morning-briefing cron

      const list = (await (await app.request(`/workspaces/${workspace.id}/schedules`)).json()) as unknown[]
      expect(list).toHaveLength(1)
    })
  })

  it('POST / rejects an invalid cron with 400', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules`,
        jsonBody('POST', { templateKind: 'custom', cronExpression: 'not a cron' }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('POST / rejects chat-and-channel without a channel with 400', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules`,
        jsonBody('POST', { templateKind: 'morning-briefing' }), // defaults to chat-and-channel
      )
      expect(res.status).toBe(400)
    })
  })

  it('POST / with fireAt creates a ONE-TIME schedule that fires at exactly that instant', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const fireAt = new Date(Date.now() + 15 * 60_000).toISOString() // "remind me in 15 minutes"
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules`,
        jsonBody('POST', { templateKind: 'custom', destinationKind: 'chat-only', fireAt }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        nextScheduledFireAt: string | null
        cronExpression: string | null
        scheduleKind: string
      }
      expect(created.scheduleKind).toBe('one-time')
      expect(created.cronExpression).toBeNull() // a one-time schedule has no cron
      // A one-time schedule fires at exactly the requested instant — a recurring
      // schedule would have computed a different next-fire from its cron.
      expect(created.nextScheduledFireAt).toBe(fireAt)
    })
  })

  it('POST / rejects a one-time fireAt in the past with 400', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules`,
        jsonBody('POST', {
          templateKind: 'custom',
          destinationKind: 'chat-only',
          fireAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('PATCH /:scheduleId updates the display name', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const schedule = seedSchedule(db, user.id, workspace.id)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules/${schedule.id}`,
        jsonBody('PATCH', { displayName: 'My routine' }),
      )
      expect(res.status).toBe(200)
      expect(((await res.json()) as { displayName: string }).displayName).toBe('My routine')
    })
  })

  it('PATCH /:scheduleId returns 404 for a missing schedule', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        `/workspaces/${workspace.id}/schedules/${randomUUID()}`,
        jsonBody('PATCH', { displayName: 'x' }),
      )
      expect(res.status).toBe(404)
    })
  })

  it('disable then enable toggle isEnabled', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const schedule = seedSchedule(db, user.id, workspace.id)
      const app = createApp({ db, logger: silentLogger })

      const disabled = await app.request(
        `/workspaces/${workspace.id}/schedules/${schedule.id}/disable`,
        { method: 'POST' },
      )
      expect(((await disabled.json()) as { isEnabled: boolean }).isEnabled).toBe(false)

      const enabled = await app.request(
        `/workspaces/${workspace.id}/schedules/${schedule.id}/enable`,
        { method: 'POST' },
      )
      expect(((await enabled.json()) as { isEnabled: boolean }).isEnabled).toBe(true)
    })
  })

  it('DELETE /:scheduleId hard-deletes (204) and GET / is then empty', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const schedule = seedSchedule(db, user.id, workspace.id)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/schedules/${schedule.id}`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(204)
      const list = (await (await app.request(`/workspaces/${workspace.id}/schedules`)).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it('GET /:scheduleId/runs returns the run history newest-first', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const schedule = seedSchedule(db, user.id, workspace.id)
      const base = new Date('2026-06-05T00:00:00Z').getTime()
      for (let minute = 0; minute < 3; minute++) {
        insertScheduleRun(db, {
          id: randomUUID(),
          scheduleId: schedule.id,
          scheduledFireAt: new Date(base + minute * 60_000),
          startedAt: new Date(base + minute * 60_000),
          completedAt: new Date(base + minute * 60_000),
          chatSessionId: null,
          status: 'completed',
          statusMessage: null,
          triggerKind: 'poll',
        })
      }
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(`/workspaces/${workspace.id}/schedules/${schedule.id}/runs`)
      expect(res.status).toBe(200)
      const runs = (await res.json()) as { startedAt: string }[]
      expect(runs).toHaveLength(3)
      expect(new Date(runs[0]!.startedAt).getTime()).toBeGreaterThan(
        new Date(runs[2]!.startedAt).getTime(),
      )
    })
  })
})

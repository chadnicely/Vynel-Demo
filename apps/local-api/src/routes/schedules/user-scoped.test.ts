// Integration tests for the USER-scoped `/schedules/...` routes (global +
// cross-workspace). Full HTTP stack: route -> validator -> userScoped -> core op
// -> repo -> SQLite (real, via withTestDatabase). No mocks — every route runs
// the REAL core op; the id-ops already authorize by userId.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1)). So the "attacker" (the resolved
// local user) is `insertUser`'d BEFORE the victim's user+schedule, or the roles
// silently invert and the test would pass for the wrong reason.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertSchedule, stubFireDeps, type NewSchedule } from '@vynel/schedules/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

// A schedule row for a SPECIFIC owner + scope (workspaceId null = global).
function seedScheduleRow(
  db: Database,
  userId: string,
  workspaceId: string | null,
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

describe('user-scoped schedules routes', () => {
  it('POST / with scope:global persists workspaceId=null and GET / lists it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/schedules',
        jsonBody('POST', {
          scope: 'global',
          templateKind: 'custom',
          destinationKind: 'chat-only',
          cronExpression: '0 9 * * *',
        }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { workspaceId: string | null; scheduleKind: string }
      expect(created.workspaceId).toBeNull()
      expect(created.scheduleKind).toBe('recurring')

      const list = (await (await app.request('/schedules')).json()) as { workspaceId: string | null }[]
      expect(list).toHaveLength(1)
      expect(list[0]?.workspaceId).toBeNull()
    })
  })

  it('POST / with scope:workspace + workspaceId persists that workspace', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, {
        id: randomUUID(),
        userId: localUser.id,
        name: 'Acme',
        kind: 'small-business',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/schedules',
        jsonBody('POST', {
          scope: 'workspace',
          workspaceId: ws.id,
          templateKind: 'custom',
          destinationKind: 'chat-only',
          cronExpression: '0 9 * * *',
        }),
      )
      expect(res.status).toBe(201)
      expect(((await res.json()) as { workspaceId: string | null }).workspaceId).toBe(ws.id)
    })
  })

  it('POST / with scope:workspace but NO workspaceId is rejected (400)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/schedules',
        jsonBody('POST', { scope: 'workspace', templateKind: 'custom', destinationKind: 'chat-only' }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('POST / "remind me in 20 min" — a ONE-TIME GLOBAL schedule (fireAt, scope:global)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const fireAt = new Date(Date.now() + 20 * 60_000).toISOString()
      const res = await app.request(
        '/schedules',
        jsonBody('POST', {
          scope: 'global',
          templateKind: 'custom',
          destinationKind: 'chat-only',
          fireAt,
        }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as {
        workspaceId: string | null
        scheduleKind: string
        cronExpression: string | null
        nextScheduledFireAt: string | null
      }
      expect(created.workspaceId).toBeNull()
      expect(created.scheduleKind).toBe('one-time')
      expect(created.cronExpression).toBeNull()
      expect(created.nextScheduledFireAt).toBe(fireAt)

      const list = (await (await app.request('/schedules')).json()) as unknown[]
      expect(list).toHaveLength(1)
    })
  })

  it('GET / lists a user’s GLOBAL + WORKSPACE schedules', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, {
        id: randomUUID(),
        userId: localUser.id,
        name: 'Acme',
        kind: 'small-business',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      seedScheduleRow(db, localUser.id, null) // global
      seedScheduleRow(db, localUser.id, ws.id) // workspace
      const app = createApp({ db, logger: silentLogger })
      const list = (await (await app.request('/schedules')).json()) as { workspaceId: string | null }[]
      expect(list).toHaveLength(2)
      expect(list.some((s) => s.workspaceId === null)).toBe(true)
      expect(list.some((s) => s.workspaceId === ws.id)).toBe(true)
    })
  })

  it('manages a schedule end-to-end: patch / disable / enable / runs / delete', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const schedule = seedScheduleRow(db, localUser.id, null)
      const app = createApp({ db, logger: silentLogger })

      const patched = await app.request(`/schedules/${schedule.id}`, jsonBody('PATCH', { displayName: 'Renamed' }))
      expect(((await patched.json()) as { displayName: string }).displayName).toBe('Renamed')

      const disabled = await app.request(`/schedules/${schedule.id}/disable`, { method: 'POST' })
      expect(((await disabled.json()) as { isEnabled: boolean }).isEnabled).toBe(false)
      const enabled = await app.request(`/schedules/${schedule.id}/enable`, { method: 'POST' })
      expect(((await enabled.json()) as { isEnabled: boolean }).isEnabled).toBe(true)

      expect((await app.request(`/schedules/${schedule.id}/runs`)).status).toBe(200)
      expect((await app.request(`/schedules/${schedule.id}`, { method: 'DELETE' })).status).toBe(204)
      expect(((await (await app.request('/schedules')).json()) as unknown[])).toHaveLength(0)
    })
  })

  it('POST /:scheduleId/fire-now records a run for a GLOBAL schedule (202, FAKE turn)', async () => {
    await withTestDatabase(async (db) => {
      const localUser = insertUser(db, makeUser())
      const schedule = seedScheduleRow(db, localUser.id, null) // global (null workspace)
      // Inject a fake fire path — no live AI turn.
      const app = createApp({ db, logger: silentLogger, scheduleFireDeps: stubFireDeps() })

      const res = await app.request(`/schedules/${schedule.id}/fire-now`, { method: 'POST' })
      expect(res.status).toBe(202)
      const run = (await res.json()) as { triggerKind: string }
      expect(run.triggerKind).toBe('manual')

      const runs = (await (await app.request(`/schedules/${schedule.id}/runs`)).json()) as unknown[]
      expect(runs).toHaveLength(1)
    })
  })

  it('TENANT ISOLATION: a user cannot see or act on another user’s schedule (404)', async () => {
    await withTestDatabase(async (db) => {
      // Attacker = the resolved local user; inserted FIRST (findSingleLocalUser = first row).
      insertUser(db, makeUser())
      // Victim = a different (second) user + their schedule.
      const victimUser = insertUser(db, makeUser())
      const victim = seedScheduleRow(db, victimUser.id, null)
      const app = createApp({ db, logger: silentLogger, scheduleFireDeps: stubFireDeps() })

      // The attacker's list never shows the victim's schedule.
      expect(((await (await app.request('/schedules')).json()) as unknown[])).toHaveLength(0)

      // Every id-op on the victim's schedule is an identical 404 — fire-now
      // included (manualFireSchedule authorizes by userId before any turn).
      expect((await app.request(`/schedules/${victim.id}`, jsonBody('PATCH', { displayName: 'x' }))).status).toBe(404)
      expect((await app.request(`/schedules/${victim.id}`, { method: 'DELETE' })).status).toBe(404)
      expect((await app.request(`/schedules/${victim.id}/enable`, { method: 'POST' })).status).toBe(404)
      expect((await app.request(`/schedules/${victim.id}/disable`, { method: 'POST' })).status).toBe(404)
      expect((await app.request(`/schedules/${victim.id}/runs`)).status).toBe(404)
      expect((await app.request(`/schedules/${victim.id}/fire-now`, { method: 'POST' })).status).toBe(404)
    })
  })
})

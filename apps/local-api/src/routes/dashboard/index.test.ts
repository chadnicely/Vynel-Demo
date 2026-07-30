// Integration test for the net-new `dashboard` surface — full HTTP stack
// against a local harness that mounts `dashboardApp` at `/dashboard` with the
// same DI middleware + VynelError `onError` `createApp` wires (`dashboardApp`
// is not mounted in app.ts yet — switch this harness to `createApp` from
// ../../app.js once the integrator mounts it; the `root/index.test.ts`
// precedent). Real SQLite via `@vynel/testing` — no mocks, since the route
// only composes existing sync/async reads (no AI runtime involved).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  insertChatMessage,
  type NewChatSession,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import { insertSchedule, type NewSchedule } from '@vynel/schedules/test-support'
import { insertTask, makeTask } from '@vynel/tasks/test-support'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import { dashboardApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

// Mirrors createApp's DI middleware + onError for the not-yet-mounted sub-app
// (the `root/index.test.ts` harness precedent).
function makeHarness(db: Database) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/dashboard', dashboardApp)
  return app
}

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string, overrides: { isArchived?: boolean } = {}) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: overrides.isArchived ?? false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function seedChatSession(
  db: Database,
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
) {
  const now = new Date()
  return insertChatSession(db, {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'Session',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function seedSchedule(
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

function seedAssistantMessage(
  db: Database,
  sessionId: string,
  overrides: Partial<NewChatMessage> = {},
) {
  const now = new Date()
  return insertChatMessage(db, {
    id: `message-${randomUUID()}`,
    sessionId,
    role: 'assistant',
    body: 'Done.',
    inputTokens: 100,
    outputTokens: 50,
    startedAt: now,
    createdAt: now,
    ...overrides,
  })
}

describe('GET /dashboard/overview', () => {
  it('assembles workspaces (excl. archived) + the cross-scope recent-activity feed + upcoming schedules', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspaceA = seedWorkspace(db, user.id)
      const workspaceB = seedWorkspace(db, user.id)
      seedWorkspace(db, user.id, { isArchived: true }) // excluded from the feed

      const t0 = new Date('2026-06-01T00:00:00Z')
      const t1 = new Date('2026-06-02T00:00:00Z')
      const t2 = new Date('2026-06-03T00:00:00Z')
      const t3 = new Date('2026-06-04T00:00:00Z')
      const t4 = new Date('2026-06-05T00:00:00Z')
      const t5 = new Date('2026-06-06T00:00:00Z')
      // Six visible sessions across both workspaces + the global root — only
      // the newest 5 should come back, newest first.
      seedChatSession(db, user.id, workspaceA.id, { id: 'session-1', lastMessageAt: t0 })
      seedChatSession(db, user.id, workspaceB.id, { id: 'session-2', lastMessageAt: t1 })
      seedChatSession(db, user.id, null, { id: 'session-3', lastMessageAt: t2 })
      seedChatSession(db, user.id, workspaceA.id, { id: 'session-4', lastMessageAt: t3 })
      seedChatSession(db, user.id, workspaceB.id, { id: 'session-5', lastMessageAt: t4 })
      seedChatSession(db, user.id, workspaceA.id, { id: 'session-6', lastMessageAt: t5 })
      // Excluded from the feed regardless of recency.
      seedChatSession(db, user.id, workspaceA.id, {
        id: 'session-archived',
        lastMessageAt: t5,
        isArchived: true,
      })
      seedChatSession(db, user.id, workspaceA.id, {
        id: 'session-deleted',
        lastMessageAt: t5,
        deletedAt: t5,
      })
      seedChatSession(db, user.id, workspaceA.id, {
        id: 'session-hidden',
        lastMessageAt: t5,
        visibility: 'hidden',
      })

      const soon = new Date(Date.now() + 60_000)
      const later = new Date(Date.now() + 3_600_000)
      seedSchedule(db, user.id, workspaceA.id, {
        id: 'schedule-later',
        displayName: 'Later',
        nextScheduledFireAt: later,
      })
      seedSchedule(db, user.id, workspaceA.id, {
        id: 'schedule-soon',
        displayName: 'Soon',
        nextScheduledFireAt: soon,
      })
      // Excluded: disabled despite having a next-fire time.
      seedSchedule(db, user.id, workspaceA.id, {
        id: 'schedule-disabled',
        displayName: 'Disabled',
        isEnabled: false,
        nextScheduledFireAt: soon,
      })
      // Excluded: enabled but no next-fire time yet.
      seedSchedule(db, user.id, workspaceA.id, {
        id: 'schedule-undated',
        displayName: 'Undated',
        nextScheduledFireAt: null,
      })

      // Tasks: open + in-progress land in openTasks (both scopes); the done
      // tail is capped at 5 and ordered by completion time, newest first.
      insertTask(db, makeTask(user.id, workspaceA.id, { id: 'task-open', title: 'Open' }))
      insertTask(
        db,
        makeTask(user.id, null, { id: 'task-doing', title: 'Doing', status: 'in-progress' }),
      )
      for (let i = 0; i < 6; i += 1) {
        insertTask(
          db,
          makeTask(user.id, workspaceA.id, {
            id: `task-done-${i}`,
            title: `Done ${i}`,
            status: 'done',
            completedAt: new Date(Date.UTC(2026, 5, 1 + i)),
          }),
        )
      }

      const app = makeHarness(db)
      const res = await app.request('/dashboard/overview')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        workspaces: { id: string }[]
        recentSessions: { id: string }[]
        upcomingSchedules: { id: string }[]
        openTasks: { id: string }[]
        recentlyCompletedTasks: { id: string }[]
      }

      expect(body.workspaces.map((w) => w.id).sort()).toEqual([workspaceA.id, workspaceB.id].sort())

      expect(body.recentSessions.map((s) => s.id)).toEqual([
        'session-6',
        'session-5',
        'session-4',
        'session-3',
        'session-2',
      ])

      expect(body.upcomingSchedules.map((s) => s.id)).toEqual(['schedule-soon', 'schedule-later'])

      expect(body.openTasks.map((t) => t.id).sort()).toEqual(['task-doing', 'task-open'])
      expect(body.recentlyCompletedTasks.map((t) => t.id)).toEqual([
        'task-done-5',
        'task-done-4',
        'task-done-3',
        'task-done-2',
        'task-done-1',
      ])
    })
  })
})

describe('GET /dashboard/usage', () => {
  it('sums assistant usage per model per day across every scope', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const opusSession = seedChatSession(db, user.id, workspace.id, {
        model: 'claude-opus-4-8',
      })
      const sonnetSession = seedChatSession(db, user.id, null, {
        model: 'claude-sonnet-5',
      })
      seedAssistantMessage(db, opusSession.id, { inputTokens: 100, outputTokens: 40 })
      seedAssistantMessage(db, opusSession.id, { inputTokens: 200, outputTokens: 60 })
      seedAssistantMessage(db, sonnetSession.id, { inputTokens: 10, outputTokens: 5 })
      // Outside every window this test requests — must never appear.
      seedAssistantMessage(db, opusSession.id, {
        createdAt: new Date(Date.now() - 120 * 24 * 3600 * 1000),
      })

      const app = makeHarness(db)
      const res = await app.request('/dashboard/usage')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        rows: { model: string | null; inputTokens: number; outputTokens: number }[]
      }
      expect(body.rows).toHaveLength(2)
      const opus = body.rows.find((row) => row.model === 'claude-opus-4-8')
      expect(opus).toMatchObject({ inputTokens: 300, outputTokens: 100, assistantMessageCount: 2 })
      const sonnet = body.rows.find((row) => row.model === 'claude-sonnet-5')
      expect(sonnet).toMatchObject({ inputTokens: 10, outputTokens: 5 })
    })
  })

  it('rejects an out-of-range days parameter at the boundary', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/dashboard/usage?days=365')
      expect(res.status).toBe(400)
    })
  })
})

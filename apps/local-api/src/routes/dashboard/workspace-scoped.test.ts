// Integration test for the workspace-scoped dashboard twin — full HTTP stack
// against the `index.test.ts`-style harness, mounted at the real
// `/workspaces/:workspaceId/dashboard` prefix so the workspace resolver runs.

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
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import { dashboardWorkspaceApp } from './workspace-scoped.js'

const silentLogger = pino({ level: 'silent' })

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
  app.route('/workspaces/:workspaceId/dashboard', dashboardWorkspaceApp)
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

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function seedSessionWithUsage(
  db: Database,
  userId: string,
  workspaceId: string | null,
  outputTokens: number,
  sessionOverrides: Partial<NewChatSession> = {},
  messageOverrides: Partial<NewChatMessage> = {},
) {
  const now = new Date()
  const session = insertChatSession(db, {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    model: 'claude-opus-4-8',
    title: 'Session',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...sessionOverrides,
  })
  insertChatMessage(db, {
    id: `message-${randomUUID()}`,
    sessionId: session.id,
    role: 'assistant',
    body: 'Done.',
    inputTokens: 100,
    outputTokens,
    startedAt: now,
    createdAt: now,
    ...messageOverrides,
  })
  return session
}

describe('GET /workspaces/:workspaceId/dashboard/usage', () => {
  it("returns only the workspace's own usage — global and sibling-workspace turns stay out", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const sibling = seedWorkspace(db, user.id)
      seedSessionWithUsage(db, user.id, workspace.id, 40)
      seedSessionWithUsage(db, user.id, sibling.id, 50)
      seedSessionWithUsage(db, user.id, null, 60)

      const app = makeHarness(db)
      const res = await app.request(`/workspaces/${workspace.id}/dashboard/usage`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: { outputTokens: number }[] }
      expect(body.rows).toHaveLength(1)
      expect(body.rows[0]).toMatchObject({ model: 'claude-opus-4-8', outputTokens: 40 })
    })
  })

  it('404s on a workspace the user does not own', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request(`/workspaces/${randomUUID()}/dashboard/usage`)
      expect(res.status).toBe(404)
    })
  })
})

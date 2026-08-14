// Integration tests for both `section-counts` twins — full HTTP stack over a
// real SQLite temp file, mounted at the real prefixes so the workspace
// resolver runs.
//
// The point of these pins: a count must agree with what OPENING the row
// shows. So they assert the curation (archived / soft-deleted / hidden swap
// segments are excluded, sibling scopes stay out) rather than just "a number
// came back".

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import { sectionCountsApp } from './index.js'
import { sectionCountsWorkspaceApp } from './workspace-scoped.js'

const silentLogger = pino({ level: 'silent' })

type CountsBody = {
  counts: { sessions: number; agents: number; skills: number; rules: number; apps?: number }
}

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
  app.route('/workspaces/:workspaceId/section-counts', sectionCountsWorkspaceApp)
  app.route('/section-counts', sectionCountsApp)
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

function seedSession(
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
    ...overrides,
  })
}

describe('GET /workspaces/:workspaceId/section-counts', () => {
  it("counts only the workspace's own listed sessions — siblings and global stay out", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const sibling = seedWorkspace(db, user.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, sibling.id)
      seedSession(db, user.id, null)

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(2)
    })
  })

  it('excludes archived, soft-deleted and hidden sessions — the library hides them too', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, workspace.id, { isArchived: true })
      seedSession(db, user.id, workspace.id, { deletedAt: new Date() })
      seedSession(db, user.id, workspace.id, { visibility: 'hidden' })

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(1)
    })
  })

  it('reports apps at workspace scope, and zeroes for the empty sections', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      const body = (await res.json()) as CountsBody
      expect(body.counts).toMatchObject({ sessions: 0, agents: 0, skills: 0, apps: 0 })
      // The workspace folder does not exist on disk — a missing rules folder
      // contributes nothing rather than throwing.
      expect(body.counts.rules).toBe(0)
    })
  })

  it('404s on a workspace the user does not own', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const res = await makeHarness(db).request(`/workspaces/${randomUUID()}/section-counts`)
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /section-counts', () => {
  it('counts every scope the Global library lists, and omits apps', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      seedSession(db, user.id, null)
      seedSession(db, user.id, workspace.id)

      const res = await makeHarness(db).request('/section-counts')
      expect(res.status).toBe(200)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(2)
      expect(body.counts.apps).toBeUndefined()
    })
  })
})

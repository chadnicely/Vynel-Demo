// Integration test for the `sessions` surface — full HTTP stack against the
// local harness (the dashboard/root harness precedent; real SQLite, no
// mocks). Thin: chain-folding logic is covered by the op's own tests
// (`@vynel/session/overview`); this pins the mount, the wire shape, and the
// user scoping.

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
import { TurnEventBroadcaster } from '@vynel/session/delegation'
import { sessionChannelKey } from '@vynel/session/runtime'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import { sessionsApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

function makeHarness(db: Database, turnEvents = new TurnEventBroadcaster()) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    c.set('turnEvents', turnEvents)
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/sessions', sessionsApp)
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

function makeSession(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date('2026-07-01T00:00:00Z')
  return {
    id: `sdk-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    visibility: 'listed',
    scope: 'workspace',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('GET /sessions/overview', () => {
  it('returns the folded overview for the local user', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      const head = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Ship the panel',
          model: 'claude-opus-4-8',
          lastContextTokens: 150_000,
        }),
      )
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Continued conversation',
          visibility: 'hidden',
          continuedFromSessionId: head.id,
          lastContextTokens: 9_000,
          lastMessageAt: new Date('2026-07-01T01:00:00Z'),
        }),
      )

      const app = makeHarness(db)
      const res = await app.request('/sessions/overview')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{
        title: string
        contextTokens: number | null
        contextWindow: number
        segments: unknown[]
      }>
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        title: 'Ship the panel',
        workspaceName: 'Acme',
        contextTokens: 9_000,
        contextWindow: 1_000_000,
      })
      expect(body[0]!.segments).toHaveLength(2)
    })
  })
})

describe('GET /sessions/:sessionId/stream (SSE observe)', () => {
  it('404s on an unknown session AND on another tenant’s session (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const otherUser = seedUser(db)
      const otherWs = insertWorkspace(db, {
        id: randomUUID(),
        userId: otherUser.id,
        name: 'Theirs',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      const theirs = insertChatSession(db, makeSession(otherUser.id, otherWs.id))
      // The harness resolves the FIRST user as the local user — `user` here.
      void user
      const app = makeHarness(db)

      expect((await app.request('/sessions/no-such-session/stream')).status).toBe(404)
      expect((await app.request(`/sessions/${theirs.id}/stream`)).status).toBe(404)
    })
  })

  it('streams the session-channel live events and ends when the turn finishes', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const turnEvents = new TurnEventBroadcaster()
      const app = makeHarness(db, turnEvents)

      const res = await app.request(`/sessions/${session.id}/stream`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      // Let the SSE callback attach its subscriber, then play a producer turn.
      await new Promise((resolve) => setTimeout(resolve, 25))
      const key = sessionChannelKey(session.id)
      turnEvents.publish(key, {
        kind: 'text-chunk',
        messageId: 'm1',
        textDelta: 'Working…',
      } as never)
      turnEvents.end(key)

      const frames = await res.text()
      expect(frames).toContain('event: text-chunk')
      expect(frames).toContain('Working…')
      expect(frames).toContain('event: turn-stream-ended')
    })
  })
})

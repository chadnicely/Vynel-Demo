// Integration test for the `sessions` surface — full HTTP stack against the
// local harness (the dashboard/root harness precedent; real SQLite, no
// mocks). Thin: chain-folding logic is covered by the op's own tests
// (`@vynel/session/overview`); this pins the mount, the wire shape, and the
// user scoping.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  findChatSessionById,
  type NewChatSession,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import { TurnEventBroadcaster } from '@vynel/session/delegation'
import { sessionChannelKey } from '@vynel/session/runtime'
import { findSpawnedSessionBySegmentId } from '@vynel/session/spawned'
import type { Database } from '@vynel/db'
import type {
  AiAgentProvider,
  NormalizedSessionEvent,
  StartChatSessionInput,
} from '@vynel/providers'
import type { AppEnv } from '../../factory.js'
import { withVynelUserDataDir } from '../../sessions/global-root-workspace.js'
import { TURN_SESSION_HEADER } from '../../sessions/turn-session-header.js'
import { sessionsApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

// The create route's priming turn, faked: session-started + completed — the
// runSeededSwapSession drain shape (no live SDK).
function makePrimingProvider(
  sessionId: string,
  inputs: StartChatSessionInput[] = [],
): AiAgentProvider {
  return {
    startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
      inputs.push(input)
      return (async function* () {
        yield {
          kind: 'session-started',
          sessionId,
          resumedFromExisting: false,
          startedAt: new Date(),
        } as NormalizedSessionEvent
        yield {
          kind: 'session-completed',
          sessionId,
          isNewSession: true,
          completedAt: new Date(),
        } as NormalizedSessionEvent
      })()
    },
  } as unknown as AiAgentProvider
}

function makeHarness(
  db: Database,
  turnEvents = new TurnEventBroadcaster(),
  aiProvider?: AiAgentProvider,
) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    c.set('turnEvents', turnEvents)
    if (aiProvider !== undefined) c.set('aiProvider', aiProvider)
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

function makeMessage(sessionId: string, body: string): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  }
}

function seedWorkspace(db: Database, userId: string, name: string) {
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
  })
}

describe('GET /sessions/search (cross-session FTS)', () => {
  it('searches every owned session by default and narrows on workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const wsA = seedWorkspace(db, user.id, 'Acme')
      const wsB = seedWorkspace(db, user.id, 'Beta')
      const sA = insertChatSession(db, makeSession(user.id, wsA.id))
      const sB = insertChatSession(db, makeSession(user.id, wsB.id))
      insertChatMessage(db, makeMessage(sA.id, 'muffin recipe for the bakery'))
      insertChatMessage(db, makeMessage(sB.id, 'muffin was the cat name'))

      const app = makeHarness(db)
      const all = await app.request('/sessions/search?query=muffin')
      expect(all.status).toBe(200)
      const allHits = (await all.json()) as Array<{ sessionId: string }>
      expect(allHits.map((h) => h.sessionId).sort()).toEqual([sA.id, sB.id].sort())

      const narrowed = await app.request(`/sessions/search?query=muffin&workspaceId=${wsA.id}`)
      const narrowedHits = (await narrowed.json()) as Array<{ sessionId: string }>
      expect(narrowedHits.map((h) => h.sessionId)).toEqual([sA.id])
    })
  })

  it("never surfaces the global root's own thread", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const globalThread = insertChatSession(
        db,
        makeSession(user.id, '', { workspaceId: null, scope: 'global' }),
      )
      insertChatMessage(db, makeMessage(globalThread.id, 'muffin secret plans'))

      const app = makeHarness(db)
      const res = await app.request('/sessions/search?query=muffin')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })
})

describe('GET /sessions/:sessionId/messages (cross-session detail)', () => {
  it("returns any owned session's full conversation, workspace or global-grounded", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const spawned = insertChatSession(
        db,
        makeSession(user.id, '', { workspaceId: null, scope: 'spawned' }),
      )
      insertChatMessage(db, makeMessage(spawned.id, 'research notes'))

      const app = makeHarness(db)
      const res = await app.request(`/sessions/${spawned.id}/messages`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        session: { id: string }
        messages: Array<{ body: string }>
      }
      expect(body.session.id).toBe(spawned.id)
      expect(body.messages.map((m) => m.body)).toEqual(['research notes'])
    })
  })

  it("404s on the global root's own thread, unknown ids, and other users' sessions alike", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const otherUser = seedUser(db)
      const globalThread = insertChatSession(
        db,
        makeSession(user.id, '', { workspaceId: null, scope: 'global' }),
      )
      const otherWs = seedWorkspace(db, otherUser.id, 'Theirs')
      const theirs = insertChatSession(db, makeSession(otherUser.id, otherWs.id))

      const app = makeHarness(db)
      expect((await app.request(`/sessions/${globalThread.id}/messages`)).status).toBe(404)
      expect((await app.request('/sessions/no-such-session/messages')).status).toBe(404)
      expect((await app.request(`/sessions/${theirs.id}/messages`)).status).toBe(404)
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

describe('POST /sessions/spawned (Slice ④ — create_session)', () => {
  it('primes a session with the purpose in the global-root cwd and records the named, listed spawned session', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-spawned-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const primingInputs: StartChatSessionInput[] = []
        const app = makeHarness(
          db,
          new TurnEventBroadcaster(),
          makePrimingProvider('sdk-spawned-route', primingInputs),
        )

        const res = await app.request('/sessions/spawned', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Research: pricing',
            purpose: 'Compare competitor pricing pages.',
          }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
          status: 'created',
          sessionId: 'sdk-spawned-route',
          name: 'Research: pricing',
        })

        // The priming turn ran in the pinned global-root cwd with the purpose.
        expect(primingInputs[0]!.workspacePath).toBe(path.join(dataDir, 'global-root'))
        expect(primingInputs[0]!.userMessageText).toContain('Compare competitor pricing pages.')

        // Recorded: the listed named segment + the resolvable spawned primary.
        const segment = findChatSessionById(db, 'sdk-spawned-route')
        expect(segment?.scope).toBe('spawned')
        expect(segment?.visibility).toBe('listed')
        expect(segment?.title).toBe('Research: pricing')
        expect(
          findSpawnedSessionBySegmentId(db, { userId: user.id, sessionId: 'sdk-spawned-route' }),
        ).not.toBeNull()
      })
    })
  })

  it('grounds a WORKSPACE-origin create in that workspace (Slice ④b): cwd = the workspace path, primary + segment carry the id', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-spawned-ws-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const ws = insertWorkspace(db, {
          id: randomUUID(),
          userId: user.id,
          name: 'Acme',
          kind: 'personal',
          path: `/tmp/vynel/acme-${randomUUID()}`,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        })
        const primingInputs: StartChatSessionInput[] = []
        const app = makeHarness(
          db,
          new TurnEventBroadcaster(),
          makePrimingProvider('sdk-spawned-ws', primingInputs),
        )

        const res = await app.request('/sessions/spawned', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Acme research',
            purpose: 'Dig into the backlog.',
            workspaceId: ws.id,
          }),
        })
        expect(res.status).toBe(200)

        // The priming turn ran in the WORKSPACE's path, not the global dir.
        expect(primingInputs[0]!.workspacePath).toBe(ws.path)

        // The created session carries the workspace on primary + segment.
        const segment = findChatSessionById(db, 'sdk-spawned-ws')
        expect(segment?.workspaceId).toBe(ws.id)
        expect(segment?.scope).toBe('spawned')
        const spawned = findSpawnedSessionBySegmentId(db, {
          userId: user.id,
          sessionId: 'sdk-spawned-ws',
        })
        expect(spawned?.workspaceId).toBe(ws.id)
      })
    })
  })

  it("404s a workspaceId that is unknown or another user's (no enumeration leak)", async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-spawned-404-'))
      await withVynelUserDataDir(dataDir, async () => {
        seedUser(db) // the resolved local user
        const stranger = seedUser(db)
        const foreignWs = insertWorkspace(db, {
          id: randomUUID(),
          userId: stranger.id,
          name: 'Theirs',
          kind: 'personal',
          path: `/tmp/vynel/${randomUUID()}`,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        })
        const app = makeHarness(db, new TurnEventBroadcaster(), makePrimingProvider('sdk-never'))

        const postSpawned = (workspaceId: string) =>
          app.request('/sessions/spawned', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'N', purpose: 'p', workspaceId }),
          })

        expect((await postSpawned(randomUUID())).status).toBe(404)
        // Not-owned answers exactly like unknown.
        expect((await postSpawned(foreignWs.id)).status).toBe(404)
        // Nothing was created on either failure.
        expect(findChatSessionById(db, 'sdk-never')).toBeNull()
      })
    })
  })

  it('validates the body (empty name rejected)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db, new TurnEventBroadcaster(), makePrimingProvider('sdk-x'))
      const res = await app.request('/sessions/spawned', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', purpose: 'p' }),
      })
      expect(res.status).toBe(400)
    })
  })
})

describe('GET + PATCH /sessions/:sessionId/settings (per-session composer settings)', () => {
  it('reads null settings on a fresh session, patches partially, and reads back', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = seedWorkspace(db, user.id, 'Mine')
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const app = makeHarness(db)

      const fresh = await app.request(`/sessions/${session.id}/settings`)
      expect(fresh.status).toBe(200)
      expect(await fresh.json()).toEqual({
        sessionMode: null,
        selectedModel: null,
        thinkingEffort: null,
        autoBuildout: null,
      })

      const patched = await app.request(`/sessions/${session.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionMode: 'auto', autoBuildout: true }),
      })
      expect(patched.status).toBe(200)
      expect(await patched.json()).toEqual({
        sessionMode: 'auto',
        selectedModel: null,
        thinkingEffort: null,
        autoBuildout: true,
      })

      // A later partial patch leaves the untouched fields alone.
      const second = await app.request(`/sessions/${session.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedModel: 'claude-opus-4-8', thinkingEffort: 'max' }),
      })
      expect(await second.json()).toEqual({
        sessionMode: 'auto',
        selectedModel: 'claude-opus-4-8',
        thinkingEffort: 'max',
        autoBuildout: true,
      })
      // Persisted on the row itself, not just the response shape.
      const row = findChatSessionById(db, session.id)
      expect(row?.sessionMode).toBe('auto')
      expect(row?.selectedModel).toBe('claude-opus-4-8')
    })
  })

  it("reaches the global thread's segments (no scope wall — the composer's own surface)", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const globalThread = insertChatSession(
        db,
        makeSession(user.id, '', { workspaceId: null, scope: 'global' }),
      )
      const app = makeHarness(db)
      const res = await app.request(`/sessions/${globalThread.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionMode: 'bypass' }),
      })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { sessionMode: string }).sessionMode).toBe('bypass')
    })
  })

  it("404s unknown ids and other users' sessions alike (no enumeration leak)", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const otherUser = seedUser(db)
      const otherWs = seedWorkspace(db, otherUser.id, 'Theirs')
      const theirs = insertChatSession(db, makeSession(otherUser.id, otherWs.id))
      void user
      const app = makeHarness(db)

      expect((await app.request('/sessions/no-such/settings')).status).toBe(404)
      expect((await app.request(`/sessions/${theirs.id}/settings`)).status).toBe(404)
      const patch = await app.request(`/sessions/${theirs.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionMode: 'auto' }),
      })
      expect(patch.status).toBe(404)
    })
  })

  it('rejects an unknown mode/effort at the boundary (400)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = seedWorkspace(db, user.id, 'Mine')
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const app = makeHarness(db)
      const res = await app.request(`/sessions/${session.id}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionMode: 'yolo' }),
      })
      expect(res.status).toBe(400)
    })
  })
})

describe('PUT /sessions/status (set_session_status)', () => {
  it("sets the CALLING session's status from the ambient turn header — never a body id", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = seedWorkspace(db, user.id, 'Mine')
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const app = makeHarness(db)

      const res = await app.request('/sessions/status', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          [TURN_SESSION_HEADER]: session.id,
        },
        body: JSON.stringify({ status: 'problem', note: 'Blocked: the repo needs a login.' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        status: 'problem',
        statusNote: 'Blocked: the repo needs a login.',
      })

      const row = findChatSessionById(db, session.id)
      expect(row?.status).toBe('problem')
      expect(row?.statusSetAt).not.toBeNull()
    })
  })

  it('400s when the turn has no watching session (a schedule fire, a delegation tick)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/sessions/status', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      expect(res.status).toBe(400)
    })
  })

  it("404s when the header names another user's session (no cross-tenant writes)", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const otherUser = seedUser(db)
      const otherWs = seedWorkspace(db, otherUser.id, 'Theirs')
      const theirs = insertChatSession(db, makeSession(otherUser.id, otherWs.id))
      void user
      const app = makeHarness(db)

      const res = await app.request('/sessions/status', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          [TURN_SESSION_HEADER]: theirs.id,
        },
        body: JSON.stringify({ status: 'completed' }),
      })
      expect(res.status).toBe(404)
    })
  })

  it('rejects a status outside the vocabulary', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const ws = seedWorkspace(db, user.id, 'Mine')
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const app = makeHarness(db)
      const res = await app.request('/sessions/status', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          [TURN_SESSION_HEADER]: session.id,
        },
        body: JSON.stringify({ status: 'on-fire' }),
      })
      expect(res.status).toBe(400)
    })
  })
})

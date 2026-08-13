// Route tests for the global-root surface — full HTTP stack against a local
// harness that mounts `rootApp` at `/root` with the same DI middleware + VynelError
// onError `createApp` wires (rootApp is not mounted in app.ts yet — switch this
// harness to `createApp` from ../../app.js once the integrator mounts it). Real
// SQLite via `@vynel/testing`; the provider registry is mocked at the module
// boundary (the approvals/chat-turn precedent) so no live SDK runtime starts, and
// `@vynel/mcp` is stubbed with a `build → null` routing descriptor so the heavy
// SDK builder never loads (the run-global-root-turn test precedent).

import { describe, it, expect, vi, beforeEach } from 'vitest'
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
import { insertAgent } from '@vynel/db/repositories/agents'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'

// Configurable per test: the SDK session id the fake assigns, plus a capture of
// every startChatSession input for composition assertions.
let nextSdkSessionId = 'sdk-root-smoke-1'
const startChatSessionInputs: StartChatSessionInput[] = []
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  const sessionId = nextSdkSessionId
  async function* events(): AsyncIterable<NormalizedSessionEvent> {
    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: input.resumeSessionId !== undefined,
      startedAt: new Date(),
    }
    yield {
      kind: 'text-chunk',
      sessionId,
      messageId: 'assistant-m1',
      textDelta: 'Hello from the fake brain.',
      isFinalChunk: true,
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
  }
  return events()
}

const { interruptChatSessionMock } = vi.hoisted(() => ({
  interruptChatSessionMock: vi.fn(async () => undefined),
}))

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      startChatSession: fakeStartChatSession,
      interruptChatSession: interruptChatSessionMock,
    }),
  }
})

// Stub routing descriptor: `build` returns null → the real composer yields an
// empty MCP set, and the heavy `@vynel/mcp` (SDK builder) never loads.
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
// Same treatment for the notebook descriptor (instructions slice) — a null
// build keeps the SDK out and the composed MCP set empty.
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))

import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
  findPrimaryConversation,
} from '@vynel/session/continuity'
import {
  enqueueWorkspaceDelegation,
  enqueueSessionDelegation,
  findDelegationJobById,
  failDelegationJob,
  claimNextPendingDelegationJob,
} from '@vynel/orchestration'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  insertChatSession,
  findChatSessionById,
  listChatMessagesForSession,
} from '@vynel/chat/repositories'
import type { AppEnv } from '../../factory.js'
import { withVynelUserDataDir } from '../../sessions/global-root-workspace.js'
import {
  TurnEventBroadcaster,
  traceChannelKey,
  DelegationCancelRegistry,
} from '@vynel/session/delegation'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { PendingAskRegistry } from '@vynel/asks'
import { rootApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

beforeEach(() => {
  nextSdkSessionId = `sdk-${randomUUID()}`
  startChatSessionInputs.length = 0
  interruptChatSessionMock.mockClear()
})

// Mirrors createApp's DI middleware + onError for the not-yet-mounted sub-app.
function makeHarness(
  db: Database,
  turnEvents: TurnEventBroadcaster = new TurnEventBroadcaster(),
  delegationCancels: DelegationCancelRegistry = new DelegationCancelRegistry(),
) {
  const activityFeed = new SessionActivityFeed()
  // Without a waiter registry the stream's turn-end ask cleanup throws into
  // hono's swallowed streaming error path (noisy stderr, silently skipped).
  const askWaiters = new PendingAskRegistry()
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    c.set('turnEvents', turnEvents)
    c.set('activityFeed', activityFeed)
    c.set('delegationCancels', delegationCancels)
    c.set('askWaiters', askWaiters)
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/root', rootApp)
  return app
}

function seedUser(db: Database, id: string = randomUUID()) {
  const now = new Date()
  return insertUser(db, {
    id,
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedGlobalSession(db: Database, userId: string, sessionId: string) {
  return insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
}

describe('GET /root/continuing', () => {
  it('returns nulls before the first global-root turn, then the linked ids', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)

      const before = await app.request('/root/continuing')
      expect(before.status).toBe(200)
      expect(await before.json()).toEqual({ rootSessionId: null, currentSdkSessionId: null })

      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      seedGlobalSession(db, user.id, 'g-1')
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-1',
      })

      const after = await app.request('/root/continuing')
      expect(await after.json()).toEqual({ rootSessionId: primary.id, currentSdkSessionId: 'g-1' })
    })
  })
})

describe('GET /root/transcript', () => {
  it('returns the empty transcript shape before the first turn', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/root/transcript')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ messages: [], toolCallsByMessageId: {} })
    })
  })
})

describe('GET /root/trace/:partialSessionId', () => {
  it('returns an empty trace for an unknown key (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/root/trace/no-such-key')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        partialSessionId: 'no-such-key',
        status: null,
        spawnedTargetSession: null,
        entries: [],
      })
    })
  })
})

describe('GET /root/sessions/:sessionId', () => {
  it('returns the owned session in full, 404s on unknown AND cross-user (IDOR gate)', async () => {
    await withTestDatabase(async (db) => {
      // First-inserted user = the resolved local user (Phase 1 single-user).
      const owner = seedUser(db)
      const other = seedUser(db)
      seedGlobalSession(db, owner.id, 'mine-1')
      seedGlobalSession(db, other.id, 'theirs-1')
      const app = makeHarness(db)

      const owned = await app.request('/root/sessions/mine-1')
      expect(owned.status).toBe(200)
      const detail = (await owned.json()) as { session: { id: string } }
      expect(detail.session.id).toBe('mine-1')

      const unknown = await app.request('/root/sessions/nope')
      expect(unknown.status).toBe(404)

      // Same response as unknown — no enumeration leak.
      const crossUser = await app.request('/root/sessions/theirs-1')
      expect(crossUser.status).toBe(404)
    })
  })
})

describe('GET /root/delegations', () => {
  it('returns the in-flight delegations (empty when idle)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = insertWorkspace(db, {
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
      const app = makeHarness(db)

      const idle = await app.request('/root/delegations')
      expect(idle.status).toBe(200)
      expect(await idle.json()).toEqual({ delegations: [] })

      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-parent',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the notes',
      })

      const busy = await app.request('/root/delegations')
      const body = (await busy.json()) as {
        delegations: {
          partialSessionId: string | null
          workspaceName: string
          sessionName: string | null
          status: string
        }[]
      }
      expect(body.delegations).toHaveLength(1)
      expect(body.delegations[0]!.workspaceName).toBe('Acme')
      expect(body.delegations[0]!.status).toBe('pending')
      expect(body.delegations[0]!.partialSessionId).not.toBeNull()
      // A workspace-target job never carries a session name.
      expect(body.delegations[0]!.sessionName).toBeNull()
    })
  })

  it('surfaces SESSION-target jobs with a sessionName for the banner chip (Slice ④)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)

      // No primary row behind the target ref — the serve-time enrichment falls
      // back to the generic name (the real-name path is pinned in the session
      // package's attach-spawned-session-names test).
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-parent',
        targetPrimarySessionId: randomUUID(),
        runCwdPath: '/tmp/vynel/global-root',
        taskText: 'research the pricing pages',
      })

      const busy = await app.request('/root/delegations')
      const body = (await busy.json()) as {
        delegations: {
          partialSessionId: string | null
          workspaceId: string | null
          sessionName: string | null
          taskLabel: string
        }[]
      }
      expect(body.delegations).toHaveLength(1)
      expect(body.delegations[0]!.workspaceId).toBeNull()
      expect(body.delegations[0]!.sessionName).toBe('Session')
      expect(body.delegations[0]!.taskLabel).toBe('research the pricing pages')
      // The chip's Watch opens the trace by this key, target kind regardless.
      expect(body.delegations[0]!.partialSessionId).not.toBeNull()
    })
  })
})

describe('GET /root/trace/:partialSessionId/stream (SSE observe)', () => {
  function seedJob(db: Database) {
    const user = seedUser(db)
    const workspace = insertWorkspace(db, {
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
    const jobId = enqueueWorkspaceDelegation(db, {
      userId: user.id,
      parentSessionId: 'g-parent',
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      workspaceName: workspace.name,
      taskText: 'summarize the notes',
    })
    return { user, jobId, partialSessionId: findDelegationJobById(db, jobId)!.partialSessionId! }
  }

  it('404s on an unknown trace key (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/root/trace/no-such-key/stream')
      expect(res.status).toBe(404)
    })
  })

  it('closes immediately for a terminal job — the fetched trace is the whole story', async () => {
    await withTestDatabase(async (db) => {
      const { jobId, partialSessionId } = seedJob(db)
      failDelegationJob(db, jobId, 'done elsewhere', new Date())
      const app = makeHarness(db)

      const res = await app.request(`/root/trace/${partialSessionId}/stream`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')
      const frames = await res.text()
      expect(frames).toContain('event: turn-stream-ended')
    })
  })

  it('streams the published live events and ends when the producer finishes', async () => {
    await withTestDatabase(async (db) => {
      const { partialSessionId } = seedJob(db)
      const turnEvents = new TurnEventBroadcaster()
      const app = makeHarness(db, turnEvents)

      const res = await app.request(`/root/trace/${partialSessionId}/stream`)
      expect(res.status).toBe(200)

      // Let the stream attach its subscriber (the SSE callback runs async), then
      // play a producer: two events, then the turn ends.
      await new Promise((resolve) => setTimeout(resolve, 25))
      const key = traceChannelKey(partialSessionId)
      turnEvents.publish(key, {
        kind: 'text-chunk',
        messageId: 'm1',
        textDelta: 'Working…',
      } as never)
      turnEvents.publish(key, {
        kind: 'tool-call-started',
        toolCall: { id: 't1', parentMessageId: 'm1', toolName: 'Read' },
      } as never)
      turnEvents.end(key)

      const frames = await res.text()
      expect(frames).toContain('event: text-chunk')
      expect(frames).toContain('Working…')
      expect(frames).toContain('event: tool-call-started')
      expect(frames).toContain('event: turn-stream-ended')
    })
  })
})

describe('POST /root/turn (SSE)', () => {
  it('streams the turn, persists the hidden brain session, links the primary', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-'))

      await withVynelUserDataDir(dataDir, async () => {
        const res = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'hello brain' }),
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toContain('text/event-stream')

        const frames = await res.text()
        expect(frames).toContain('event: session-created')
        expect(frames).toContain('event: user-message-persisted')
        expect(frames).toContain('event: text-chunk')
        expect(frames).toContain('event: session-completed')
        expect(frames).toContain('event: turn-stream-ended')
      })

      // The brain segment persisted with its locked presentation (hidden, scope
      // 'global', no workspace), and the primary now points at it.
      const session = findChatSessionById(db, nextSdkSessionId)
      expect(session).not.toBeNull()
      expect(session!.title).toBe('Global brain')
      expect(session!.visibility).toBe('hidden')
      expect(session!.scope).toBe('global')
      expect(session!.workspaceId).toBeNull()
      const primary = findPrimaryConversation(db, { userId: user.id })
      expect(primary?.currentSdkSessionId).toBe(nextSdkSessionId)

      // Routing-only compose with a null build → no routing tools reach the
      // provider, and the brain ran on the hidden user-data cwd.
      // test: correct expectation — the interactive global chat now ALSO
      // carries the `vynel-ask` server (ask_user attaches to interactive app
      // turns; ask module 2026-07-17); was: empty.
      expect(startChatSessionInputs).toHaveLength(1)
      const input = startChatSessionInputs[0]!
      // The ask server registers; no wildcard rides to the provider — the
      // canUseTool policy map gates each call (SHADOWED fix).
      expect(input.mcpServers).toHaveProperty('vynel-ask')
      expect('allowedMcpToolPatterns' in input).toBe(false)
      expect(input.workspacePath).toBe(path.join(dataDir, 'global-root'))

      // The transcript now hydrates the turn's messages (cold-start read).
      const transcript = await app.request('/root/transcript')
      const body = (await transcript.json()) as { messages: { body: string }[] }
      expect(body.messages.map((m) => m.body)).toContain('hello brain')
    })
  })

  it("stamps 'voice' as the user row's originChannel on a voice turn (plain turns stay null)", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-'))

      await withVynelUserDataDir(dataDir, async () => {
        const spoken = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'traffic in dhaka?', voice: true }),
        })
        expect(spoken.status).toBe(200)
        await spoken.text() // drain the SSE body so the turn completes

        const typed = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'and by keyboard' }),
        })
        expect(typed.status).toBe(200)
        await typed.text()
      })

      const rows = listChatMessagesForSession(db, nextSdkSessionId).filter(
        (message) => message.role === 'user',
      )
      expect(rows.map((message) => [message.body, message.originChannel])).toEqual([
        ['traffic in dhaka?', 'voice'],
        ['and by keyboard', null],
      ])
    })
  })

  it('400s on a model outside the curated allowlist', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/root/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userMessageText: 'hi', model: 'not-a-real-model' }),
      })
      expect(res.status).toBe(400)
      expect(startChatSessionInputs).toHaveLength(0)
    })
  })

  it('runs the brain turn under the requested mode; absent → the bypass default (surface-up step 1)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-'))

      await withVynelUserDataDir(dataDir, async () => {
        const asked = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'hello brain', mode: 'ask' }),
        })
        expect(asked.status).toBe(200)
        await asked.text() // drain the SSE body so the turn completes
        expect(startChatSessionInputs[0]!.permissionMode).toBe('ask')

        const defaulted = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'hello again' }),
        })
        expect(defaulted.status).toBe(200)
        await defaulted.text()
        expect(startChatSessionInputs[1]!.permissionMode).toBe('bypass-with-behavior-gate')
      })
    })
  })

  it('composes USER-scope agents onto the global turn (agents parity with the workspace chat)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      insertAgent(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: null, // user scope — available to the global brain
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches topics.',
        icon: null,
        prompt: 'You are a careful researcher.',
        model: null,
        effort: null,
        permissionMode: null,
        background: false,
        allowedTools: null,
        disallowedTools: null,
        scope: 'user',
        source: 'vynel',
        trustTier: 'verified',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      const app = makeHarness(db)
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-'))

      await withVynelUserDataDir(dataDir, async () => {
        const res = await app.request('/root/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessageText: 'research something' }),
        })
        expect(res.status).toBe(200)
        await res.text()
      })

      const input = startChatSessionInputs[0] as { agents?: Record<string, unknown> }
      expect(Object.keys(input.agents ?? {})).toEqual(['researcher'])
    })
  })

  it('400s on a mode outside the session-mode catalog', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/root/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userMessageText: 'hi', mode: 'yolo' }),
      })
      expect(res.status).toBe(400)
      expect(startChatSessionInputs).toHaveLength(0)
    })
  })
})

describe('POST /root/delegations/:partialSessionId/stop', () => {
  function seedStopJob(db: Database, userId: string) {
    const workspace = insertWorkspace(db, {
      id: randomUUID(),
      userId,
      name: 'Acme',
      kind: 'personal',
      path: `/tmp/vynel/${randomUUID()}`,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
    })
    const jobId = enqueueWorkspaceDelegation(db, {
      userId,
      parentSessionId: 'g-parent',
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      workspaceName: workspace.name,
      taskText: 'a task the user stops',
    })
    return { jobId, partialSessionId: findDelegationJobById(db, jobId)!.partialSessionId! }
  }

  it('fails a PENDING job before claim', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const { jobId, partialSessionId } = seedStopJob(db, user.id)
      const app = makeHarness(db)

      const res = await app.request(`/root/delegations/${partialSessionId}/stop`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ result: 'stopped' })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).toBe('stopped by the user')
      expect(interruptChatSessionMock).not.toHaveBeenCalled()
    })
  })

  it('flags a CLAIMED run on the cancel bridge and interrupts its learned session', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const { partialSessionId } = seedStopJob(db, user.id)
      claimNextPendingDelegationJob(db, new Date())

      // The tick's half, replayed: the run registered + learned its session.
      const delegationCancels = new DelegationCancelRegistry()
      const handle = delegationCancels.begin(partialSessionId)
      handle.sessionResolved('sdk-run-1')

      const app = makeHarness(db, new TurnEventBroadcaster(), delegationCancels)
      const res = await app.request(`/root/delegations/${partialSessionId}/stop`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ result: 'stopping' })
      expect(handle.isCancelRequested()).toBe(true)
      expect(interruptChatSessionMock).toHaveBeenCalledWith('sdk-run-1')
    })
  })

  it('stops a SESSION-target job identically — the stop keys on the job, not the target (Slice ④)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-parent',
        targetPrimarySessionId: randomUUID(),
        runCwdPath: '/tmp/vynel/global-root',
        taskText: 'a session task the user stops',
      })
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!
      const app = makeHarness(db)

      const res = await app.request(`/root/delegations/${partialSessionId}/stop`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ result: 'stopped' })
      expect(findDelegationJobById(db, jobId)?.status).toBe('failed')
    })
  })

  it('answers already-finished for a terminal job, 404 for unknown or not-owned', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db) // the resolver's local user (first row wins)
      const { jobId, partialSessionId } = seedStopJob(db, user.id)
      failDelegationJob(db, jobId, 'done elsewhere', new Date())
      const app = makeHarness(db)

      const finished = await app.request(`/root/delegations/${partialSessionId}/stop`, {
        method: 'POST',
      })
      expect(await finished.json()).toEqual({ result: 'already-finished' })

      const unknown = await app.request('/root/delegations/no-such-key/stop', { method: 'POST' })
      expect(unknown.status).toBe(404)

      const stranger = seedUser(db)
      const theirs = seedStopJob(db, stranger.id)
      const notOwned = await app.request(`/root/delegations/${theirs.partialSessionId}/stop`, {
        method: 'POST',
      })
      expect(notOwned.status).toBe(404)
    })
  })
})

describe('POST /root/turn/interrupt', () => {
  it('interrupts the linked global-root session; no-ops before one exists', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)

      const before = await app.request('/root/turn/interrupt', { method: 'POST' })
      expect(await before.json()).toEqual({ interrupted: false })
      expect(interruptChatSessionMock).not.toHaveBeenCalled()

      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      seedGlobalSession(db, user.id, 'g-run-1')
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'g-run-1',
      })

      const after = await app.request('/root/turn/interrupt', { method: 'POST' })
      expect(await after.json()).toEqual({ interrupted: true })
      expect(interruptChatSessionMock).toHaveBeenCalledWith('g-run-1')
    })
  })
})

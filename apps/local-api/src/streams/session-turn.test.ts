// End-to-end tests for the spawned-session turn SSE stream (sessions-surface
// Slice ③a) — full HTTP stack (route → userScoped → streamSpawnedSessionTurn →
// startChatTurn → consumeSessionEventStream → SQLite) with the provider
// registry mocked at the module boundary (the chat-turn.test.ts precedent).
// Pins the three locked decisions: the background-toolset parity per
// grounding, head-resume (+ link-on-swap), and the FIFO queue behind a held
// target lock.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type {
  AiAgentProvider,
  NormalizedSessionEvent,
  StartChatSessionInput,
} from '@vynel/providers'

// Configurable per test: the fake resumes the session it was asked to resume
// (the normal shape) unless `swapToSessionId` simulates a mid-turn compaction
// swap by starting a DIFFERENT session id.
let swapToSessionId: string | null = null
const startChatSessionInputs: StartChatSessionInput[] = []
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  const sessionId = swapToSessionId ?? input.resumeSessionId ?? `sdk-${randomUUID()}`
  async function* events(): AsyncIterable<NormalizedSessionEvent> {
    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: swapToSessionId === null,
      startedAt: new Date(),
    }
    yield {
      kind: 'text-chunk',
      sessionId,
      messageId: `assistant-${randomUUID()}`,
      textDelta: 'Reply from the session.',
      isFinalChunk: true,
    }
    yield { kind: 'session-completed', sessionId, isNewSession: false, completedAt: new Date() }
  }
  return events()
}

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({ startChatSession: fakeStartChatSession }),
  }
})

import {
  findChatSessionById,
  listChatMessagesForSession,
  insertChatSession,
} from '@vynel/chat/repositories'
import { createSpawnedSession, findSpawnedSessionBySegmentId } from '@vynel/session/spawned'
import { getOrCreatePrimarySession, linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { buildNewChatSessionRow } from '@vynel/chat'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { withVynelUserDataDir } from '../sessions/global-root-workspace.js'
import { createApp } from '../app.js'

const silentLogger = pino({ level: 'silent' })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  swapToSessionId = null
  startChatSessionInputs.length = 0
})

function seedUser(db: Database) {
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

function seedWorkspace(db: Database, userId: string, name = 'Acme') {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

// The create priming turn, faked — the runSeededSwapSession drain shape (the
// routing-test precedent). Distinct from the registry mock above: create takes
// its provider explicitly.
function makePrimingProvider(sessionId: string): AiAgentProvider {
  return {
    startChatSession(): AsyncIterable<NormalizedSessionEvent> {
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

async function seedSpawnedSession(
  db: Database,
  userId: string,
  sdkSessionId: string,
  workspace?: { id: string; path: string },
) {
  return createSpawnedSession(db, makePrimingProvider(sdkSessionId), {
    userId,
    name: 'Research: pricing',
    purpose: 'compare pricing pages',
    workspacePath: workspace?.path ?? '/tmp/vynel/global-root',
    ...(workspace !== undefined ? { workspaceId: workspace.id } : {}),
  })
}

function postTurn(app: ReturnType<typeof createApp>, sessionId: string, body: object) {
  return app.request(`/sessions/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /sessions/:sessionId/turn (SSE)', () => {
  it('404s unknown, foreign, and non-spawned session handles identically', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-404-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const stranger = seedUser(db)
        const foreign = await seedSpawnedSession(db, stranger.id, 'sdk-foreign-1')
        // A non-spawned continuing session (the global primary) — its segment
        // handle must NOT be chattable through this route.
        const globalPrimary = await getOrCreatePrimarySession(db, { userId: user.id })
        insertChatSession(
          db,
          buildNewChatSessionRow({
            sessionId: 'g-1',
            userId: user.id,
            workspaceId: null,
            providerId: 'claude',
            startedAt: new Date(),
            title: 'Global brain',
            visibility: 'hidden',
          }),
        )
        linkPrimarySessionToSdkSession(db, {
          primarySessionId: globalPrimary.id,
          userId: user.id,
          sdkSessionId: 'g-1',
        })
        const app = createApp({ db, logger: silentLogger })

        expect((await postTurn(app, 'no-such-session', { userMessageText: 'hi' })).status).toBe(404)
        expect((await postTurn(app, foreign.sessionId, { userMessageText: 'hi' })).status).toBe(404)
        expect((await postTurn(app, 'g-1', { userMessageText: 'hi' })).status).toBe(404)
        expect(startChatSessionInputs).toHaveLength(0)
      })
    })
  })

  it('validates the body: empty message and off-allowlist model both 400', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-400-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-400')
        const app = createApp({ db, logger: silentLogger })

        expect((await postTurn(app, spawned.sessionId, { userMessageText: '' })).status).toBe(400)
        expect(
          (await postTurn(app, spawned.sessionId, { userMessageText: 'hi', model: 'gpt-5' }))
            .status,
        ).toBe(400)
        expect(startChatSessionInputs).toHaveLength(0)
      })
    })
  })

  it('resumes the CURRENT head of a GLOBAL-grounded session with NO MCP attachment and persists the turn', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-global-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-global')
        const app = createApp({ db, logger: silentLogger })

        const res = await postTurn(app, spawned.sessionId, { userMessageText: 'hello session' })
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toContain('text/event-stream')

        const frames = await res.text()
        expect(frames).toContain('event: user-message-persisted')
        expect(frames).toContain('event: text-chunk')
        expect(frames).toContain('event: turn-stream-ended')
        // A free target never queues — the sentinel must NOT appear.
        expect(frames).not.toContain('event: turn-queued')

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        // Locked decision 2: the turn resumes the chain HEAD.
        expect(input.resumeSessionId).toBe('sdk-sp-global')
        // Ground: the hidden global-root cwd, exactly like its delegated runs.
        expect(input.workspacePath).toBe(path.join(dataDir, 'global-root'))
        // Locked decision 1 (global-grounded half): NOTHING attaches — its
        // delegated turns run bare, so its user turns do too.
        expect(input.mcpServers).toBeUndefined()
        expect(input.allowedMcpToolPatterns).toBeUndefined()
        expect(input.systemPromptAppend).toBeUndefined()
        // Interactive default — the workspace chat stream's mode resolution,
        // NOT the routed-turn bypass default.
        expect(input.permissionMode).toBe('ask')

        // The turn persisted onto the spawned session's recorded segment.
        const messages = listChatMessagesForSession(db, 'sdk-sp-global')
        expect(messages.map((m) => m.role).sort()).toEqual(['assistant', 'user'])
        expect(messages.find((m) => m.role === 'user')!.body).toBe('hello session')
      })
    })
  })

  it('a WORKSPACE-grounded session gets its workspace cwd + the plain background MCP set (never the routed-task steer)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-ws-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-ws', workspace)
        const app = createApp({ db, logger: silentLogger })

        const res = await postTurn(app, spawned.sessionId, {
          userMessageText: 'hi',
          model: 'claude-haiku-4-5',
          thinkingEffort: 'low',
        })
        await res.text()

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        expect(input.workspacePath).toBe(workspace.path)
        // Locked decision 1: the PLAIN background set — the same attachment its
        // delegated turns carry (vynel workspace tools present).
        expect(input.mcpServers).toBeDefined()
        expect(input.allowedMcpToolPatterns).toContain('mcp__vynel__*')
        // The user is talking directly — the routed-task steer must NOT ride
        // the system prompt (only the composer's per-feature sections may).
        expect(input.systemPromptAppend ?? '').not.toContain('routed from')
        // The per-turn picks thread through.
        expect(input.model).toBe('claude-haiku-4-5')
        expect(input.thinkingEffort).toBe('low')
      })
    })
  })

  it('QUEUES behind a held target lock (turn-queued frame), runs after release, and frees the lock after the stream', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-queue-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-queue')
        const locks = new SessionTargetLocks()
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

        // A "delegated run" holds the spawned primary's key.
        const releaseDelegatedRun = await locks.acquire(spawned.primarySessionId)

        const resPromise = postTurn(app, spawned.sessionId, { userMessageText: 'queued turn' })
        await sleep(50)
        // Locked decision 3: the user turn is PARKED — no provider call yet.
        expect(startChatSessionInputs).toHaveLength(0)

        releaseDelegatedRun()
        const frames = await (await resPromise).text()
        // The queued sentinel preceded the turn; the turn then ran to the end.
        expect(frames).toContain('event: turn-queued')
        expect(frames.indexOf('event: turn-queued')).toBeLessThan(
          frames.indexOf('event: user-message-persisted'),
        )
        expect(frames).toContain('event: turn-stream-ended')
        expect(startChatSessionInputs).toHaveLength(1)

        // The lock released with the stream — a second turn starts unqueued.
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)
        const second = await postTurn(app, spawned.sessionId, { userMessageText: 'again' })
        const secondFrames = await second.text()
        expect(secondFrames).not.toContain('event: turn-queued')
        expect(secondFrames).toContain('event: turn-stream-ended')
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)
      })
    })
  })

  it('a client DISCONNECT while parked never leaks the lock — the abandoned queued turn still runs to completion', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-abort-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-abort')
        const locks = new SessionTargetLocks()
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

        const releaseDelegatedRun = await locks.acquire(spawned.primarySessionId)

        const res = await postTurn(app, spawned.sessionId, { userMessageText: 'abandoned turn' })
        expect(res.status).toBe(200)
        await sleep(50)
        expect(startChatSessionInputs).toHaveLength(0) // parked behind the held key

        // The client walks away WHILE PARKED. Cancelling the response body is
        // how a dead socket reaches hono's stream (the runtime cancels
        // responseReadable → stream.abort() → writes become silent no-ops) —
        // a bare AbortController signal reaches nothing on the node path.
        await res.body!.cancel()
        // THEN the held run finishes — the abandoned waiter is next in line.
        releaseDelegatedRun()
        // Wait for the detached callback to drain (nobody is reading it).
        for (let i = 0; i < 40 && locks.isBusy(spawned.primarySessionId); i += 1) {
          await sleep(25)
        }

        // Pinned semantics (intentional): the abandoned waiter still RUNS TO
        // COMPLETION — the client saw `turn-queued` ("will be delivered"), so
        // the message must not silently vanish; the reply persists onto the
        // session transcript while the dead stream's writes no-op. And THE
        // pin this test exists for: the outer finally released the lock even
        // though nobody was reading — a hostile refactor of that finally
        // would leak the key and leave the session unwritable forever.
        expect(startChatSessionInputs).toHaveLength(1)
        const messages = listChatMessagesForSession(db, 'sdk-sp-abort')
        expect(messages.find((m) => m.body === 'abandoned turn')).toBeDefined()
        expect(messages.some((m) => m.role === 'assistant')).toBe(true)
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)

        // The freed key is genuinely usable: a fresh turn runs unqueued.
        const next = await postTurn(app, spawned.sessionId, { userMessageText: 'after abort' })
        const frames = await next.text()
        expect(frames).not.toContain('event: turn-queued')
        expect(frames).toContain('event: turn-stream-ended')
      })
    })
  })

  it('link-on-swap: a mid-turn compaction swap advances the primary link and keeps the stock hidden segment presentation', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-swap-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-old')
        swapToSessionId = 'sdk-sp-new'
        const app = createApp({ db, logger: silentLogger })

        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'swap me' })
        ).text()
        expect(frames).toContain('event: session-created')

        // The primary now points at the NEW head — the next turn resumes it.
        expect(
          findSpawnedSessionBySegmentId(db, { userId: user.id, sessionId: 'sdk-sp-new' })?.id,
        ).toBe(spawned.primarySessionId)
        expect(
          findSpawnedSessionBySegmentId(db, { userId: user.id, sessionId: 'sdk-sp-old' }),
        ).toBeNull()

        // The swap segment keeps the stock hidden presentation (the
        // delegateToSpawnedSession shape) — the entry's identity stays its
        // first, listed, named segment.
        const swapSegment = findChatSessionById(db, 'sdk-sp-new')
        expect(swapSegment?.visibility).toBe('hidden')
        expect(swapSegment?.title).toBe('Continued conversation')
      })
    })
  })
})

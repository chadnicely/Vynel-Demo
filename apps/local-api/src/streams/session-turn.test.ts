// End-to-end tests for the spawned-session turn SSE stream (sessions-surface
// Slice ③a) — full HTTP stack (route → userScoped → streamSpawnedSessionTurn →
// startChatTurn → consumeSessionEventStream → SQLite) with the provider
// registry mocked at the module boundary (the chat-turn.test.ts precedent).
// Pins the three locked decisions: the background-toolset parity per
// grounding, head-resume (+ link-on-swap), and the FIFO queue behind a held
// target lock — plus the session-hardening seams (2026-08-19): the voice
// leg's forced tier + no settings write, the unconditionally stamped mode
// header, and the interactive wall clock (a fake that can HANG a turn until
// interrupted; `loadEnv` overridable per test for the bound).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { VOICE_TIER_MODEL } from '@vynel/contracts/chat/voice-tier'
import { insertUser, upsertPreferenceForUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type * as DesktopControl from '@vynel/desktop-control'
import type {
  AiAgentProvider,
  NormalizedSessionEvent,
  StartChatSessionInput,
} from '@vynel/providers'

// Configurable per test: the fake resumes the session it was asked to resume
// (the normal shape) unless `swapToSessionId` simulates a mid-turn compaction
// swap by starting a DIFFERENT session id. `usageTokensForTurn` makes the turn
// report its context occupancy (on Haiku's 200k window) — what the boundary
// continuity step measures.
let swapToSessionId: string | null = null
let usageTokensForTurn: number | null = null
/** The next turn HANGS after its first chunk until interrupted (the wall-clock case). */
let nextTurnHangs = false
const startChatSessionInputs: StartChatSessionInput[] = []
let summarizeSessionCalls = 0
const {
  interruptChatSessionMock,
  hangResolvers,
  wrapAppRequestWithModeSpy,
  desktopBuildContexts,
  envOverrides,
} = vi.hoisted(() => {
  const hangResolvers = new Map<string, () => void>()
  return {
    hangResolvers,
    // Every acting value this stream hands the desktop descriptor, in turn order.
    desktopBuildContexts: [] as Array<{ enableDesktopActions: boolean | undefined }>,
    // A REAL interrupt ends the hung fake turn — the way the SDK runtime ends
    // a session the provider interrupts.
    interruptChatSessionMock: vi.fn(async (sessionId: string) => {
      hangResolvers.get(sessionId)?.()
      hangResolvers.delete(sessionId)
    }),
    wrapAppRequestWithModeSpy: vi.fn(),
    envOverrides: { current: {} as Record<string, unknown> },
  }
})
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  const sessionId = swapToSessionId ?? input.resumeSessionId ?? `sdk-${randomUUID()}`
  const hangs = nextTurnHangs
  nextTurnHangs = false
  async function* events(): AsyncIterable<NormalizedSessionEvent> {
    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: swapToSessionId === null,
      startedAt: new Date(),
    }
    const messageId = `assistant-${randomUUID()}`
    yield {
      kind: 'text-chunk',
      sessionId,
      messageId,
      textDelta: 'Reply from the session.',
      isFinalChunk: true,
    }
    if (hangs) {
      await new Promise<void>((resolve) => hangResolvers.set(sessionId, resolve))
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
      return
    }
    if (usageTokensForTurn !== null) {
      yield {
        kind: 'usage-reported',
        sessionId,
        messageId,
        model: 'claude-haiku-4-5',
        inputTokens: usageTokensForTurn,
        outputTokens: 5,
      }
    }
    yield { kind: 'session-completed', sessionId, isNewSession: false, completedAt: new Date() }
  }
  return events()
}

// A carry that clears the swap's fidelity floor (the boundary continuity test).
const USABLE_CARRY =
  'GOAL: compare pricing pages. DONE: gathered three competitors. NEXT: write the comparison. FACTS: competitor A undercuts by 12%.'

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      startChatSession: fakeStartChatSession,
      interruptChatSession: interruptChatSessionMock,
      summarizeSession: async () => {
        summarizeSessionCalls += 1
        return USABLE_CARRY
      },
    }),
  }
})
// The real header writer, with the stamped mode recorded (the parent == child pin).
vi.mock('../sessions/delegation-mode-header.js', async () => {
  const actual = await vi.importActual<typeof import('../sessions/delegation-mode-header.js')>(
    '../sessions/delegation-mode-header.js',
  )
  return {
    ...actual,
    wrapAppRequestWithMode: (
      appRequest: Parameters<typeof actual.wrapAppRequestWithMode>[0],
      permissionMode: string,
    ) => {
      wrapAppRequestWithModeSpy(permissionMode)
      return actual.wrapAppRequestWithMode(appRequest, permissionMode)
    },
  }
})
// The REAL desktop descriptor, with the acting value this stream resolves per
// turn recorded. Deliberately a pass-through: the real `build` still returns
// null with no `desktopReader` wired, so the composed toolset is unchanged for
// every other case in this file — only the seam value is observed.
vi.mock('@vynel/desktop-control', async (importOriginal) => {
  const actual = await importOriginal<typeof DesktopControl>()
  return {
    ...actual,
    desktopFeatureDescriptor: {
      ...actual.desktopFeatureDescriptor,
      build: (context: Parameters<typeof actual.desktopFeatureDescriptor.build>[0]) => {
        desktopBuildContexts.push({ enableDesktopActions: context.enableDesktopActions })
        return actual.desktopFeatureDescriptor.build(context)
      },
    },
  }
})
// The bounds knobs, per test — everything else stays the real parsed env.
vi.mock('../env.js', async () => {
  const actual = await vi.importActual<typeof import('../env.js')>('../env.js')
  return { ...actual, loadEnv: () => ({ ...actual.loadEnv(), ...envOverrides.current }) }
})

import {
  findChatSessionById,
  listChatMessagesForSession,
  insertChatSession,
} from '@vynel/chat/repositories'
import {
  createSpawnedSession,
  findRoutableSessionById,
  findSpawnedSessionBySegmentId,
} from '@vynel/session/spawned'
import {
  getOrCreateContinuingSession,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
  markPrimarySwapping,
  clearPrimarySwapping,
} from '@vynel/session/continuity'
import { buildNewChatSessionRow } from '@vynel/chat'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { withVynelUserDataDir } from '../sessions/global-root-workspace.js'
import { createApp } from '../app.js'

/** The liveness frames a turn announces — the scope every workspace indicator
 *  keys on, so the two doors into one child (this one and the delegated
 *  `run-task-job`) must agree on it. */
function collectTurnStarts(feed: SessionActivityFeed, userId: string) {
  const starts: Array<{
    scopeKind: string
    workspaceId: string | null
    primarySessionId: string | null | undefined
  }> = []
  feed.subscribe(userId, (event) => {
    if (event.kind === 'turn-started') {
      starts.push({
        scopeKind: event.scopeKind,
        workspaceId: event.workspaceId,
        primarySessionId: event.primarySessionId,
      })
    }
  })
  return starts
}

const silentLogger = pino({ level: 'silent' })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  swapToSessionId = null
  usageTokensForTurn = null
  nextTurnHangs = false
  summarizeSessionCalls = 0
  startChatSessionInputs.length = 0
  interruptChatSessionMock.mockClear()
  wrapAppRequestWithModeSpy.mockClear()
  desktopBuildContexts.length = 0
  hangResolvers.clear()
  envOverrides.current = {}
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

// The primary's CURRENT head, by primary id — what the next turn will resume.
function readCurrentHead(db: Database, userId: string, primarySessionId: string): string {
  const head = findRoutableSessionById(db, { userId, primarySessionId })
  if (head === null || head.currentSdkSessionId === null) throw new Error('no head')
  return head.currentSdkSessionId
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
        const activityFeed = new SessionActivityFeed()
        const turnStarts = collectTurnStarts(activityFeed, user.id)
        const app = createApp({ db, logger: silentLogger, activityFeed })

        const res = await postTurn(app, spawned.sessionId, { userMessageText: 'hello session' })
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toContain('text/event-stream')

        const frames = await res.text()
        expect(frames).toContain('event: user-message-persisted')
        expect(frames).toContain('event: text-chunk')
        expect(frames).toContain('event: turn-stream-ended')
        // A free target never queues — the sentinel must NOT appear.
        expect(frames).not.toContain('event: turn-queued')
        // A global-grounded child announces in the global area, as its own primary.
        expect(turnStarts).toEqual([
          { scopeKind: 'global', workspaceId: null, primarySessionId: spawned.primarySessionId },
        ])

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        // Locked decision 2: the turn resumes the chain HEAD.
        expect(input.resumeSessionId).toBe('sdk-sp-global')
        // Ground: the hidden global-root cwd, exactly like its delegated runs.
        expect(input.workspacePath).toBe(path.join(dataDir, 'global-root'))
        // Locked decision 1 (global-grounded half): this path attaches nothing
        // of its own. (Its DELEGATED turns have composed the root toolset since
        // 2026-07-26 — a per-origin difference recorded as a deferred call.)
        // test: correct expectation — was "no MCP attachment at all"; now the
        // ONE server every session carries, whoami (continuity arc Slice 3).
        expect(Object.keys(input.mcpServers ?? {})).toEqual(['vynel-session'])
        // test: correct expectation — the identity stack (base + spawned-session)
        // now LEADS the direct turn's prompt; whoami's standing line follows it.
        expect(input.systemPromptAppend).toContain(composeSessionInstruction('spawned-session'))
        expect(input.systemPromptAppend).toContain('You can call whoami')
        expect(input.systemPromptAppend).not.toContain('routed from')
        // Interactive default — the workspace chat stream's mode resolution
        // (DEFAULT_SESSION_MODE = auto since 2026-08-19; was ask).
        expect(input.permissionMode).toBe('auto')

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
        const activityFeed = new SessionActivityFeed()
        const turnStarts = collectTurnStarts(activityFeed, user.id)
        const app = createApp({ db, logger: silentLogger, activityFeed })

        const res = await postTurn(app, spawned.sessionId, {
          userMessageText: 'hi',
          model: 'claude-haiku-4-5',
          thinkingEffort: 'low',
        })
        await res.text()

        // A child spawned INSIDE a room works in that room: the frame carries
        // the workspace (so the room reads "working") and the child's own
        // primary (so no workspace chat mistakes it for the room's thread) —
        // the same frame the delegated door announces.
        expect(turnStarts).toEqual([
          {
            scopeKind: 'workspace',
            workspaceId: workspace.id,
            primarySessionId: spawned.primarySessionId,
          },
        ])

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        expect(input.workspacePath).toBe(workspace.path)
        // Locked decision 1: the PLAIN background set — the same attachment its
        // delegated turns carry (vynel workspace tools present).
        expect(input.mcpServers).toBeDefined()
        expect(input.mcpServers).toHaveProperty('vynel')
        // The user is talking directly — the identity stack leads and the
        // routed-task steer must NOT ride the system prompt.
        expect(input.systemPromptAppend ?? '').toContain(
          composeSessionInstruction('spawned-session'),
        )
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

  it('a user turn into an agent COLLEAGUE runs with the delegated agent-session toolset (G5)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-agent-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const colleague = await getOrCreateContinuingSession(db, {
          userId: user.id,
          scope: 'agent',
          workspaceId: null,
          scopeRef: 'reviewer',
        })
        insertChatSession(
          db,
          buildNewChatSessionRow({
            sessionId: 'colleague-seg-1',
            userId: user.id,
            workspaceId: null,
            providerId: 'claude',
            startedAt: new Date(),
            title: 'Code Reviewer',
            scope: 'agent',
          }),
        )
        linkPrimarySessionToSdkSession(db, {
          primarySessionId: colleague.id,
          userId: user.id,
          sdkSessionId: 'colleague-seg-1',
        })
        const app = createApp({ db, logger: silentLogger })

        // Pre-G5 this 404'd (the finder gated scope 'spawned' only) — the
        // recorded deferral, now shipped (redesign D7).
        const res = await postTurn(app, 'colleague-seg-1', { userMessageText: 'hey reviewer' })
        expect(res.status).toBe(200)
        const frames = await res.text()
        expect(frames).toContain('event: turn-stream-ended')

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        expect(input.resumeSessionId).toBe('colleague-seg-1')
        // The DELEGATED agent-session set (G5's MCP parity) — never the bare
        // global-grounded shape: the vynel routing tools ride the turn, so the
        // colleague speaks (send_message) exactly as its mention runs do.
        expect(input.mcpServers ?? {}).toHaveProperty('vynel')
        expect(Object.keys(input.mcpServers ?? {}).length).toBeGreaterThan(0)
        // No agent row backs the slug in this fixture — the identity falls
        // back to the child stack rather than failing the user's turn.
        expect(input.systemPromptAppend ?? '').toContain(
          composeSessionInstruction('spawned-session'),
        )
        expect(input.systemPromptAppend ?? '').not.toContain('persistent colleague')
      })
    })
  })

  it('a colleague with a real agent row carries its persona on the DIRECT turn too', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-agent-persona-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        await createAgent(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'reviewer',
          name: 'Code Reviewer',
          description: 'Reviews code.',
          prompt: 'You review code carefully.',
          source: 'user',
          trustTier: 'community',
        })
        const colleague = await getOrCreateContinuingSession(db, {
          userId: user.id,
          scope: 'agent',
          workspaceId: null,
          scopeRef: 'reviewer',
        })
        insertChatSession(
          db,
          buildNewChatSessionRow({
            sessionId: 'colleague-seg-2',
            userId: user.id,
            workspaceId: null,
            providerId: 'claude',
            startedAt: new Date(),
            title: 'Code Reviewer',
            scope: 'agent',
          }),
        )
        linkPrimarySessionToSdkSession(db, {
          primarySessionId: colleague.id,
          userId: user.id,
          sdkSessionId: 'colleague-seg-2',
        })
        const app = createApp({ db, logger: silentLogger })

        const res = await postTurn(app, 'colleague-seg-2', { userMessageText: 'review this' })
        expect(res.status).toBe(200)
        await res.text()

        expect(startChatSessionInputs).toHaveLength(1)
        const input = startChatSessionInputs[0]!
        // The persona rides EVERY turn (persona-sessions) — direct included:
        // base + the rendered colleague framing + the agent's own prompt.
        expect(input.systemPromptAppend).toContain('You are "Code Reviewer"')
        expect(input.systemPromptAppend).toContain('You review code carefully.')
        expect(input.systemPromptAppend).not.toContain('routed from')
      })
    })
  })

  // test: correct expectation — audit R2-J reversed the pinned semantics. It
  // used to read "the abandoned queued turn still runs to completion" (the
  // client saw `turn-queued`, i.e. "will be delivered", so the message must not
  // vanish). A turn run for nobody still holds the single-writer key for its
  // whole run and burns a provider session, so a disconnected waiter now LEAVES
  // the queue. The lock-leak pin this test exists for is unchanged.
  it('a client DISCONNECT while parked drops the queued waiter — it never takes the lock', async () => {
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
        // responseReadable → stream.abort() → the waiter's give-up signal) —
        // a bare AbortController signal reaches nothing on the node path,
        // which is exactly why the stream's own abort feeds the signal too.
        await res.body!.cancel()
        await sleep(50)
        // THEN the held run finishes — and finds no waiter behind it.
        releaseDelegatedRun()
        await sleep(100)

        // Pinned semantics (audit R2-J): the abandoned waiter LEFT the queue —
        // no provider session, no rows, nothing run for a client that is gone.
        // And THE pin this test exists for: the key is free — a leak here would
        // leave the session unwritable forever.
        expect(startChatSessionInputs).toHaveLength(0)
        const messages = listChatMessagesForSession(db, 'sdk-sp-abort')
        expect(messages.find((m) => m.body === 'abandoned turn')).toBeUndefined()
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)

        // The freed key is genuinely usable: a fresh turn runs unqueued.
        const next = await postTurn(app, spawned.sessionId, { userMessageText: 'after abort' })
        const frames = await next.text()
        expect(frames).not.toContain('event: turn-queued')
        expect(frames).toContain('event: turn-stream-ended')
      })
    })
  })

  it('a WORKSPACE-grounded session’s mid-turn swap segment stays in its room (its own ground, never workspace-less)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-swap-ws-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-ws-old', workspace)
        swapToSessionId = 'sdk-sp-ws-new'
        const app = createApp({ db, logger: silentLogger })

        await (await postTurn(app, spawned.sessionId, { userMessageText: 'swap me' })).text()

        const swapSegment = findChatSessionById(db, 'sdk-sp-ws-new')
        expect(swapSegment?.continuedFromSessionId).toBe('sdk-sp-ws-old')
        expect(swapSegment?.workspaceId).toBe(workspace.id)
        expect(swapSegment?.scope).toBe('spawned')
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

  it("a turn parked behind the session's OWN context swap says so — queued reason context-patching", async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-queued-swap-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-swapping')
        const locks = new SessionTargetLocks()
        const release = await locks.acquire(spawned.primarySessionId)
        markPrimarySwapping(spawned.primarySessionId)
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })
        try {
          const pending = postTurn(app, spawned.sessionId, { userMessageText: 'while it patches' })
          await sleep(50)
          clearPrimarySwapping(spawned.primarySessionId)
          release()
          const frames = await (await pending).text()
          expect(frames).toContain('event: turn-queued')
          expect(frames).toContain('"reason":"context-patching"')
        } finally {
          clearPrimarySwapping(spawned.primarySessionId)
        }
      })
    })
  })

  it('boundary continuity: a direct turn that leaves the session over the threshold swaps it before its next turn', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-bridge-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-a')
        usageTokensForTurn = 190_000 // 0.95 of Haiku's window
        const app = createApp({ db, logger: silentLogger })

        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'keep going' })
        ).text()
        expect(frames).toContain('event: turn-stream-ended')
        // The swap is VISIBLE on the stream, in order, before the terminal frame.
        const at = (marker: string) => frames.indexOf(marker)
        expect(at('event: context-patching')).toBeGreaterThan(at('event: session-completed'))
        expect(at('event: context-patched')).toBeGreaterThan(at('event: context-patching'))
        expect(at('event: turn-stream-ended')).toBeGreaterThan(at('event: context-patched'))
        expect(frames).toContain('"toSessionId":"')

        // The turn ran on the head; the swap's priming session was a second,
        // FRESH start; the distill ran once.
        expect(startChatSessionInputs).toHaveLength(2)
        expect(startChatSessionInputs[0]?.resumeSessionId).toBe('sdk-sp-a')
        expect(startChatSessionInputs[1]?.resumeSessionId).toBeUndefined()
        expect(summarizeSessionCalls).toBe(1)

        // The identity continues on the fresh segment, chained to the old head,
        // hidden, still scope 'spawned' — the listed identity row untouched.
        const primary = readCurrentHead(db, user.id, spawned.primarySessionId)
        expect(primary).not.toBe('sdk-sp-a')
        const fresh = findChatSessionById(db, primary)
        expect(fresh?.continuedFromSessionId).toBe('sdk-sp-a')
        expect(fresh?.visibility).toBe('hidden')
        expect(fresh?.scope).toBe('spawned')
        expect(findChatSessionById(db, 'sdk-sp-a')?.visibility).toBe('listed')
      })
    })
  })

  it('stamps the RESOLVED mode on the routing header even when nothing was set — parent == child (A6)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-mode-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-mode')
        const app = createApp({ db, logger: silentLogger })

        // Born with NULL settings, no mode in the body → the default runs AND
        // is what the children inherit (used to stamp nothing → NULL → the
        // runner's own default).
        await (await postTurn(app, spawned.sessionId, { userMessageText: 'no mode' })).text()
        expect(startChatSessionInputs[0]!.permissionMode).toBe('auto')
        expect(wrapAppRequestWithModeSpy).toHaveBeenCalledWith('auto')

        wrapAppRequestWithModeSpy.mockClear()
        await (await postTurn(app, spawned.sessionId, { userMessageText: 'ask', mode: 'ask' })).text()
        expect(startChatSessionInputs[1]!.permissionMode).toBe('ask')
        expect(wrapAppRequestWithModeSpy).toHaveBeenCalledWith('ask')
      })
    })
  })

  it('a VOICE turn (the live-call leg) runs the tier — auto / sonnet-5 / low — forced over the body into a NULL-settings session and writes nothing (V1)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-voice-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-call')
        const app = createApp({ db, logger: silentLogger })

        // Agent-1's repro shape: the call client's body onto a spawned row born
        // NULL — the interactive path used to resolve the carding default and
        // stamp the pins onto the row. Nothing in the body rides either.
        const frames = await (
          await postTurn(app, spawned.sessionId, {
            userMessageText: 'note that down',
            voice: true,
            // A model OUTSIDE the voice tier proves the force.
            model: 'claude-opus-4-8',
            thinkingEffort: 'max',
            mode: 'ask',
          })
        ).text()
        expect(frames).toContain('event: turn-stream-ended')

        const input = startChatSessionInputs[0]!
        expect(input.permissionMode).toBe('auto')
        expect(input.model).toBe(VOICE_TIER_MODEL)
        expect(input.thinkingEffort).toBe('low')
        // Thinking OFF on every voice leg (the lean tier) — the provider drops
        // the effort beside it at the SDK boundary.
        expect(input.disableThinking).toBe(true)
        // The children inherit the tier's mode too.
        expect(wrapAppRequestWithModeSpy).toHaveBeenCalledWith('auto')
        // The row stays untouched — the tier's pins are the surface's, not chips.
        const row = findChatSessionById(db, 'sdk-sp-call')
        expect(row?.sessionMode).toBeNull()
        expect(row?.selectedModel).toBeNull()
        expect(row?.thinkingEffort).toBeNull()

        // A keyboard turn into the same session still resolves + persists as before.
        await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'typed', mode: 'ask' })
        ).text()
        expect(startChatSessionInputs[1]!.permissionMode).toBe('ask')
        expect(findChatSessionById(db, 'sdk-sp-call')?.sessionMode).toBe('ask')
      })
    })
  })

  it('a VOICE turn carries the speak DENY and yields its session id before the first chunk (VR1 / A3)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-voice-tools-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-voice-tools')
        const app = createApp({ db, logger: silentLogger })

        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'what did she say', voice: true })
        ).text()
        // The call leg speaks the streamed text, so the tool that would say it
        // again is denied — regardless of which branch composed this turn.
        expect(startChatSessionInputs[0]!.deniedToolNames).toContain('mcp__vynel__speak')
        // The barge-in contract: a resumed turn's user row persists before the
        // provider starts, so the id leads the first spoken delta. The
        // toContain guard is load-bearing — a MISSING frame indexes to -1 and
        // would satisfy the ordering check on its own.
        expect(frames).toContain('event: user-message-persisted')
        expect(frames).toContain('event: text-chunk')
        expect(frames.indexOf('event: user-message-persisted')).toBeLessThan(
          frames.indexOf('event: text-chunk'),
        )

        // A keyboard turn into the same session keeps the tool.
        await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'typed' })
        ).text()
        expect(startChatSessionInputs[1]!.deniedToolNames).not.toContain('mcp__vynel__speak')
      })
    })
  })

  it('the interactive wall clock: a turn past VYNEL_INTERACTIVE_TURN_MAX_MS is interrupted, records the failure row, streams the errored frame, and frees the target lock (D5)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-clock-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-clock')
        const locks = new SessionTargetLocks()
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })
        envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 60 }

        nextTurnHangs = true
        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'never ends' })
        ).text()

        // The clock interrupted THE turn's head (nothing else released the hang).
        expect(interruptChatSessionMock).toHaveBeenCalledWith('sdk-sp-clock')
        expect(frames).toContain('"errorCode":"turn-wall-clock-exceeded"')
        expect(frames).toContain('turn exceeded the 0.001-minute limit')
        expect(frames).toContain('event: session-interrupted')
        expect(frames).toContain('event: turn-stream-ended')
        // The durable fact on the thread.
        const errored = listChatMessagesForSession(db, 'sdk-sp-clock').find(
          (message) => message.errorCode === 'turn-wall-clock-exceeded',
        )
        expect(errored?.errorMessage).toBe('turn exceeded the 0.001-minute limit')
        // The single-writer key is free again.
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)

        // A normal turn never trips it.
        envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 5_000 }
        interruptChatSessionMock.mockClear()
        await (await postTurn(app, spawned.sessionId, { userMessageText: 'quick' })).text()
        expect(interruptChatSessionMock).not.toHaveBeenCalled()
      })
    })
  })

  it('the lock-queue bound: a turn queued past VYNEL_LOCK_WAIT_MAX_MS gives up cleanly and never takes the key (R2-J)', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-queue-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-queue')
        const locks = new SessionTargetLocks()
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })
        // The QUEUE's budget, not the turn's — the wall clock only starts once
        // the turn holds its key, so before this a turn behind a wedged holder
        // waited with no bound at all.
        envOverrides.current = { VYNEL_LOCK_WAIT_MAX_MS: 60 }

        const releaseDelegatedRun = await locks.acquire(spawned.primarySessionId)
        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'queued too long' })
        ).text()

        // It said it was waiting, then said honestly that it gave up.
        expect(frames).toContain('event: turn-queued')
        expect(frames).toContain('"errorCode":"lock-wait-exceeded"')
        expect(frames).toContain('the conversation stayed busy')
        expect(frames).toContain('event: turn-stream-ended')
        // The turn never started: no provider session, no rows.
        expect(startChatSessionInputs).toHaveLength(0)
        expect(listChatMessagesForSession(db, 'sdk-sp-queue')).toHaveLength(0)
        // And the give-up freed its queue slot — the holder's release finds
        // nobody behind it.
        releaseDelegatedRun()
        expect(locks.isBusy(spawned.primarySessionId)).toBe(false)
      })
    })
  })
})

describe('POST /sessions/:sessionId/turn — a non-lock failure before the acquire (review fold)', () => {
  it('surfaces as the typed frame, never a silent turn-stream-ended', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-acquire-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-acquire')
        const locks = new SessionTargetLocks()
        // Anything that is NOT a queue give-up: the acquire itself blowing up.
        // `writeLockWaitGiveUp` returns false for it, and the catch used to
        // return on that false with no log and no frame — the composer folded a
        // clean ending over an error nobody ever saw.
        vi.spyOn(locks, 'acquire').mockRejectedValue(new Error('the lock registry blew up'))
        const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

        const frames = await (
          await postTurn(app, spawned.sessionId, { userMessageText: 'boom' })
        ).text()

        expect(frames).toContain('"errorCode":"turn-stream-failed"')
        expect(frames).toContain('the lock registry blew up')
        expect(frames).toContain('event: turn-stream-ended')
        // It really never started — the frame is the failure, not a turn's own.
        expect(startChatSessionInputs).toHaveLength(0)
      })
    })
  })
})

describe('POST /sessions/:sessionId/turn — Settings → Desktop control', () => {
  // The seam at `session-turn.ts` (`enableDesktopActions:
  // resolveDesktopActionsEnabled(...)`) had no binding test: nothing proved a
  // spawned turn hands the descriptor the RESOLVED preference rather than a
  // constant. Both legs are asserted against a seeded row — never the
  // never-touched fallthrough, which would read the ambient env seed. A
  // SPAWNED (not agent) session is used on purpose: the agent scope composes
  // no desktop server at all.
  it('hands the desktop descriptor the resolved preference, and the NEXT turn sees a flip', async () => {
    await withTestDatabase(async (db) => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-turn-desktop-'))
      await withVynelUserDataDir(dataDir, async () => {
        const user = seedUser(db)
        const spawned = await seedSpawnedSession(db, user.id, 'sdk-sp-desktop')
        const app = createApp({ db, logger: silentLogger })

        upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(false))
        await (await postTurn(app, spawned.sessionId, { userMessageText: 'before' })).text()
        expect(desktopBuildContexts).toHaveLength(1)
        expect(desktopBuildContexts[0]!.enableDesktopActions).toBe(false)

        // No restart, no new app — the very next turn re-resolves.
        upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(true))
        await (await postTurn(app, spawned.sessionId, { userMessageText: 'after' })).text()
        expect(desktopBuildContexts).toHaveLength(2)
        expect(desktopBuildContexts[1]!.enableDesktopActions).toBe(true)
      })
    })
  })
})

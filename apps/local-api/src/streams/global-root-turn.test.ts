// Stream tests for `streamGlobalRootTurn` — the session-hardening seams
// (2026-08-19): the voice leg's forced tier + no ask_user + no auto-continue,
// the identity-shaped feed (`scopeKind: 'voice' | 'global'` + primary id), the
// `turn-queued { reason: 'busy' }` sentinel off the root lock, the bounded
// interactive ask descriptor, and the interactive wall clock (interrupt +
// failure row + `turn-ended failed`). Full HTTP stack against the root harness
// (the routes/root test precedent): real SQLite, the provider registry mocked
// at the module boundary (a fake that can HANG a turn until interrupted), the
// heavy MCP builders stubbed, `loadEnv` overridable per test for the bounds.

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
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'

const {
  interruptChatSessionMock,
  hangResolvers,
  buildAskFeatureDescriptorSpy,
  envOverrides,
} = vi.hoisted(() => {
  const hangResolvers = new Map<string, () => void>()
  return {
    hangResolvers,
    // A REAL interrupt ends the hung fake turn — the way the SDK runtime ends a
    // session the provider interrupts.
    interruptChatSessionMock: vi.fn(async (sessionId: string) => {
      hangResolvers.get(sessionId)?.()
      hangResolvers.delete(sessionId)
    }),
    buildAskFeatureDescriptorSpy: vi.fn(),
    envOverrides: { current: {} as Record<string, unknown> },
  }
})

let nextSdkSessionId = 'sdk-stream-1'
/** The next turn HANGS after its first chunk until interrupted (the wall-clock cases). */
let nextTurnHangs = false
const startChatSessionInputs: StartChatSessionInput[] = []
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  const sessionId = nextSdkSessionId
  const hangs = nextTurnHangs
  nextTurnHangs = false
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
    if (hangs) {
      await new Promise<void>((resolve) => hangResolvers.set(sessionId, resolve))
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
      return
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
  }
  return events()
}

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
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))
// The real descriptor, with its deps recorded — the bound + gate assertions.
vi.mock('@vynel/asks/mcp', async () => {
  const actual = await vi.importActual<typeof import('@vynel/asks/mcp')>('@vynel/asks/mcp')
  return {
    ...actual,
    buildAskFeatureDescriptor: (deps: Parameters<typeof actual.buildAskFeatureDescriptor>[0]) => {
      buildAskFeatureDescriptorSpy(deps)
      return actual.buildAskFeatureDescriptor(deps)
    },
  }
})
// The bounds knobs, per test — everything else stays the real parsed env.
vi.mock('../env.js', async () => {
  const actual = await vi.importActual<typeof import('../env.js')>('../env.js')
  return { ...actual, loadEnv: () => ({ ...actual.loadEnv(), ...envOverrides.current }) }
})

import { PendingAskRegistry } from '@vynel/asks'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { findPrimaryConversation, findVoicePrimarySessionForUser } from '@vynel/session/continuity'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { TurnEventBroadcaster, DelegationCancelRegistry } from '@vynel/session/delegation'
import type { AppEnv } from '../factory.js'
import { withVynelUserDataDir } from '../sessions/global-root-workspace.js'
import { rootApp } from '../routes/root/index.js'

const silentLogger = pino({ level: 'silent' })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  nextSdkSessionId = `sdk-${randomUUID()}`
  nextTurnHangs = false
  startChatSessionInputs.length = 0
  interruptChatSessionMock.mockClear()
  buildAskFeatureDescriptorSpy.mockClear()
  hangResolvers.clear()
  envOverrides.current = {}
})

function makeHarness(db: Database, activityFeed: SessionActivityFeed = new SessionActivityFeed()) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    c.set('turnEvents', new TurnEventBroadcaster())
    c.set('activityFeed', activityFeed)
    c.set('delegationCancels', new DelegationCancelRegistry())
    c.set('askWaiters', new PendingAskRegistry())
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

async function postTurn(app: Hono<AppEnv>, body: object): Promise<Response> {
  return app.request('/root/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function withDataDir<T>(run: () => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-stream-'))
  return withVynelUserDataDir(dataDir, run)
}

describe('streamGlobalRootTurn — the voice leg (D1/D2)', () => {
  it('a VOICE turn runs the tier (sonnet-5 / low / auto) forced over the body, attaches NO ask_user, never auto-continues, and writes no settings', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      await withDataDir(async () => {
        const spoken = await postTurn(app, {
          userMessageText: 'traffic in dhaka?',
          voice: true,
          // A stale pin / a typed pick — none of it rides.
          model: 'claude-haiku-4-5',
          thinkingEffort: 'max',
          mode: 'ask',
        })
        expect(spoken.status).toBe(200)
        await spoken.text()
      })
      const input = startChatSessionInputs[0]!
      expect(input.model).toBe('claude-sonnet-5')
      expect(input.thinkingEffort).toBe('low')
      expect(input.permissionMode).toBe('auto')
      // No ask form on a hands-free surface — the model asks in speech.
      expect(input.mcpServers).not.toHaveProperty('vynel-ask')
      expect(buildAskFeatureDescriptorSpy).not.toHaveBeenCalled()
      // autoContinue:false → the core arms no mid-turn context nudge.
      expect(input.onToolResultContext).toBeUndefined()
      // The voice row never learns the body's chips.
      const row = findChatSessionById(db, nextSdkSessionId)
      expect(row?.scope).toBe('voice')
      expect(row?.sessionMode).toBeNull()
      expect(row?.selectedModel).toBeNull()
      expect(row?.thinkingEffort).toBeNull()
    })
  })

  it('a KEYBOARD turn attaches ask_user with the interactive bound + the wall-clock gate, and keeps the context nudge', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      envOverrides.current = { VYNEL_INTERACTIVE_ASK_MAX_MS: 123_456 }
      const app = makeHarness(db)
      await withDataDir(async () => {
        await (await postTurn(app, { userMessageText: 'hello brain' })).text()
      })
      const input = startChatSessionInputs[0]!
      expect(input.mcpServers).toHaveProperty('vynel-ask')
      expect(input.onToolResultContext).toBeDefined()
      expect(buildAskFeatureDescriptorSpy).toHaveBeenCalledTimes(1)
      const deps = buildAskFeatureDescriptorSpy.mock.calls[0]![0] as {
        timeoutMs?: number
        waitGate?: unknown
      }
      expect(deps.timeoutMs).toBe(123_456)
      expect(deps.waitGate).toBeDefined()
    })
  })
})

describe('streamGlobalRootTurn — the spoken thread speaks its own text (VR1)', () => {
  it('a VOICE turn carries the speak DENY; a keyboard turn keeps the tool', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      await withDataDir(async () => {
        await (await postTurn(app, { userMessageText: 'spoken', voice: true })).text()
        nextSdkSessionId = `sdk-${randomUUID()}`
        await (await postTurn(app, { userMessageText: 'typed' })).text()
      })
      // The thread's streamed text IS its voice — a `speak` call would say the
      // answer a second time, a tool round-trip late.
      expect(startChatSessionInputs[0]!.deniedToolNames).toContain('mcp__vynel__speak')
      // Every other surface still speaks through the daemon relay.
      expect(startChatSessionInputs[1]!.deniedToolNames).not.toContain('mcp__vynel__speak')
    })
  })

  it('yields the session id BEFORE the first text chunk on both shapes (the barge-in contract, A3)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      await withDataDir(async () => {
        // First-ever voice turn: the fresh segment arrives as `session-created`.
        const opened = await (
          await postTurn(app, { userMessageText: 'first spoken', voice: true })
        ).text()
        // The toContain guards are load-bearing on both shapes — a MISSING
        // frame indexes to -1 and would satisfy the ordering check alone.
        expect(opened).toContain('event: session-created')
        expect(opened).toContain('event: text-chunk')
        expect(opened.indexOf('event: session-created')).toBeLessThan(
          opened.indexOf('event: text-chunk'),
        )
        // Resumed voice turn: the user row persists before the provider starts,
        // so `user-message-persisted` leads — this is the frame a client must
        // read its `sessionId` from for `POST /root/turn/interrupt`.
        const resumed = await (
          await postTurn(app, { userMessageText: 'second spoken', voice: true })
        ).text()
        expect(resumed).toContain('event: user-message-persisted')
        expect(resumed).toContain('event: text-chunk')
        expect(resumed.indexOf('event: user-message-persisted')).toBeLessThan(
          resumed.indexOf('event: text-chunk'),
        )
        // The id on the wire is the CHAT session id the interrupt door takes.
        const persisted = JSON.parse(
          resumed
            .split('\n')
            .find((line) => line.startsWith('data: {"kind":"user-message-persisted"'))!
            .slice('data: '.length),
        ) as { message: { sessionId: string } }
        expect(findChatSessionById(db, persisted.message.sessionId)?.scope).toBe('voice')
      })
    })
  })
})

describe('streamGlobalRootTurn — the identity-shaped feed (V2)', () => {
  it("announces a voice turn as scopeKind 'voice' and a keyboard turn as 'global', each with ITS primary id", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const activityFeed = new SessionActivityFeed()
      const started: SessionActivityEvent[] = []
      const unsubscribe = activityFeed.subscribe(user.id, (event) => {
        if (event.kind === 'turn-started') started.push(event)
      })
      const app = makeHarness(db, activityFeed)
      try {
        await withDataDir(async () => {
          await (await postTurn(app, { userMessageText: 'spoken', voice: true })).text()
          nextSdkSessionId = `sdk-${randomUUID()}`
          await (await postTurn(app, { userMessageText: 'typed' })).text()
        })
      } finally {
        unsubscribe()
      }
      const voicePrimary = findVoicePrimarySessionForUser(db, user.id)
      const globalPrimary = findPrimaryConversation(db, { userId: user.id })
      expect(voicePrimary).not.toBeNull()
      expect(globalPrimary).not.toBeNull()
      expect(voicePrimary!.id).not.toBe(globalPrimary!.id)
      expect(started).toHaveLength(2)
      expect(started[0]).toMatchObject({
        scopeKind: 'voice',
        origin: 'voice',
        primarySessionId: voicePrimary!.id,
      })
      expect(started[1]).toMatchObject({
        scopeKind: 'global',
        origin: 'web',
        primarySessionId: globalPrimary!.id,
      })
    })
  })
})

describe('streamGlobalRootTurn — the queued sentinel (S2)', () => {
  it("a second turn arriving while another holds the identity's root lock sees turn-queued { reason: 'busy' } before it runs", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      await withDataDir(async () => {
        // Turn 1 hangs on the lock until we interrupt it by hand. Its body is
        // READ from the start — hono's SSE writer backpressures until the
        // reader pulls, so an unread stream never reaches the hang point.
        nextTurnHangs = true
        const heldSessionId = nextSdkSessionId
        const firstFramesPromise = postTurn(app, { userMessageText: 'long one' }).then((res) =>
          res.text(),
        )
        // Let it reach the hang (it holds the root lock now).
        for (let i = 0; i < 80 && !hangResolvers.has(heldSessionId); i += 1) await sleep(25)
        expect(hangResolvers.has(heldSessionId)).toBe(true)

        nextSdkSessionId = `sdk-${randomUUID()}`
        const secondFramesPromise = postTurn(app, { userMessageText: 'queued one' }).then((res) =>
          res.text(),
        )
        await sleep(50)
        // Parked: no provider call yet for the second turn.
        expect(startChatSessionInputs).toHaveLength(1)

        // Release the holder (a real interrupt ends its fake stream).
        await interruptChatSessionMock(heldSessionId)
        const [firstFrames, secondFrames] = await Promise.all([
          firstFramesPromise,
          secondFramesPromise,
        ])
        expect(firstFrames).not.toContain('event: turn-queued')
        expect(secondFrames).toContain('event: turn-queued')
        expect(secondFrames).toContain('"reason":"busy"')
        expect(secondFrames.indexOf('event: turn-queued')).toBeLessThan(
          secondFrames.indexOf('event: user-message-persisted'),
        )
        expect(startChatSessionInputs).toHaveLength(2)
      })
    })
  })
})

describe('streamGlobalRootTurn — the interactive wall clock (D5)', () => {
  it('a turn past VYNEL_INTERACTIVE_TURN_MAX_MS is interrupted, records the failure row, streams the errored frame, ends the feed FAILED, and frees the lock', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 60_000 * 0.001 } // 60 ms
      const activityFeed = new SessionActivityFeed()
      const endedOutcomes: string[] = []
      const unsubscribe = activityFeed.subscribe(user.id, (event) => {
        if (event.kind === 'turn-ended') endedOutcomes.push(event.outcome)
      })
      const app = makeHarness(db, activityFeed)
      try {
        await withDataDir(async () => {
          nextTurnHangs = true
          const hungSessionId = nextSdkSessionId
          const frames = await (await postTurn(app, { userMessageText: 'never ends' })).text()

          // The clock interrupted THE turn's session (no manual release here).
          expect(interruptChatSessionMock).toHaveBeenCalledWith(hungSessionId)
          // The client learned WHY, then the interrupt + the terminal frame.
          expect(frames).toContain('"errorCode":"turn-wall-clock-exceeded"')
          expect(frames).toContain('turn exceeded the 0.001-minute limit')
          expect(frames).toContain('event: session-interrupted')
          expect(frames).toContain('event: turn-stream-ended')
          // The durable fact: an assistant row carrying the error on the thread.
          const errored = listChatMessagesForSession(db, hungSessionId).find(
            (message) => message.errorCode === 'turn-wall-clock-exceeded',
          )
          expect(errored?.errorMessage).toBe('turn exceeded the 0.001-minute limit')
          expect(endedOutcomes).toEqual(['failed'])

          // The lock is free: a normal turn runs straight through, unqueued.
          envOverrides.current = {}
          nextSdkSessionId = `sdk-${randomUUID()}`
          const next = await (await postTurn(app, { userMessageText: 'and again' })).text()
          expect(next).not.toContain('event: turn-queued')
          expect(next).toContain('event: session-completed')
          expect(endedOutcomes).toEqual(['failed', 'ended'])
        })
      } finally {
        unsubscribe()
      }
    })
  })

  it('a normal turn never trips the clock — no interrupt, no failure row', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 5_000 }
      const app = makeHarness(db)
      await withDataDir(async () => {
        await (await postTurn(app, { userMessageText: 'quick' })).text()
      })
      expect(interruptChatSessionMock).not.toHaveBeenCalled()
      expect(
        listChatMessagesForSession(db, nextSdkSessionId).some((message) => message.errorCode !== null),
      ).toBe(false)
    })
  })
})

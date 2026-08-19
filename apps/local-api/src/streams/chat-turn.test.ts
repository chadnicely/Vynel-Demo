// End-to-end smoke for the chat-turn SSE stream — full HTTP stack (route →
// workspaceScoped → streamChatTurn → startChatTurn → consumeSessionEventStream
// → SQLite), with the provider registry mocked at the module boundary (the
// approvals route-test precedent) so no live SDK runtime is started. The
// `@vynel/session` test-support FakeAiAgentProvider is not exported from the
// package (no `./runtime/test-support` subpath), so the stub lives here — same
// normalized-event shapes. The session-hardening seams (2026-08-19) ride the
// same harness: the unconditionally stamped mode header, the bounded ask
// descriptor, the primary-head lock guard on by-id turns, and the interactive
// wall clock (the fake can HANG a turn until interrupted; `loadEnv` is
// overridable per test for the bound).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'

// Configurable per test: the SDK session id the fake assigns, plus a capture of
// every startChatSession input for composition assertions.
let nextSdkSessionId = 'sdk-smoke-1'
// Per-call ids (shifted; exhausted → nextSdkSessionId) + an optional usage
// report — a boundary-swap case drives TWO starts through one fake (the turn,
// then the swap's priming session) and needs the turn to report its occupancy.
const queuedSessionIds: string[] = []
let usageTokensForTurn: number | null = null
// Per-call usage (shifted; exhausted → usageTokensForTurn) — the auto-continue
// case lands the turn pressured and its continuation relaxed.
const queuedUsageTokens: Array<number | null> = []
const startChatSessionInputs: StartChatSessionInput[] = []
// A test's seam to act MID-TURN the way a tool would (mark a checkpoint on
// the turn's identity) — the fake has no tools of its own.
let onStartChatSession: ((input: StartChatSessionInput, ordinal: number) => void) | null = null
/** The next turn HANGS after its first chunk until interrupted (the wall-clock case). */
let nextTurnHangs = false
const {
  interruptChatSessionMock,
  hangResolvers,
  wrapAppRequestWithModeSpy,
  buildAskFeatureDescriptorSpy,
  envOverrides,
} = vi.hoisted(() => {
  const hangResolvers = new Map<string, () => void>()
  return {
    hangResolvers,
    // A REAL interrupt ends the hung fake turn — the way the SDK runtime ends
    // a session the provider interrupts.
    interruptChatSessionMock: vi.fn(async (sessionId: string) => {
      hangResolvers.get(sessionId)?.()
      hangResolvers.delete(sessionId)
    }),
    wrapAppRequestWithModeSpy: vi.fn(),
    buildAskFeatureDescriptorSpy: vi.fn(),
    envOverrides: { current: {} as Record<string, unknown> },
  }
})
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  onStartChatSession?.(input, startChatSessionInputs.length)
  const sessionId = queuedSessionIds.shift() ?? nextSdkSessionId
  const usageTokens = queuedUsageTokens.length > 0 ? queuedUsageTokens.shift()! : usageTokensForTurn
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
      textDelta: 'Hello from the fake provider.',
      isFinalChunk: true,
    }
    if (hangs) {
      await new Promise<void>((resolve) => hangResolvers.set(sessionId, resolve))
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
      return
    }
    if (usageTokens !== null) {
      yield {
        kind: 'usage-reported',
        sessionId,
        messageId: 'assistant-m1',
        model: 'claude-haiku-4-5',
        inputTokens: usageTokens,
        outputTokens: 5,
      }
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
  }
  return events()
}

// A carry that clears the swap's fidelity floor (the boundary-swap case).
const USABLE_CARRY =
  'GOAL: keep the workspace moving. DONE: answered. NEXT: await the next message. FACTS: the fake provider said hello.'

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      startChatSession: fakeStartChatSession,
      interruptChatSession: interruptChatSessionMock,
      summarizeSession: async () => USABLE_CARRY,
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
// The real ask descriptor, with its deps recorded — the bound + gate assertions.
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

import {
  findChatSessionById,
  listChatMessagesForSession,
} from '@vynel/chat/repositories'
import {
  findPrimaryConversation,
  linkPrimarySessionToSdkSession,
  markPendingCheckpoint,
} from '@vynel/session/continuity'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { createApp } from '../app.js'

const silentLogger = pino({ level: 'silent' })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  nextSdkSessionId = `sdk-${randomUUID()}`
  queuedSessionIds.length = 0
  usageTokensForTurn = null
  queuedUsageTokens.length = 0
  startChatSessionInputs.length = 0
  onStartChatSession = null
  nextTurnHangs = false
  interruptChatSessionMock.mockClear()
  wrapAppRequestWithModeSpy.mockClear()
  buildAskFeatureDescriptorSpy.mockClear()
  hangResolvers.clear()
  envOverrides.current = {}
})

function seedWorld(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function postTurn(app: ReturnType<typeof createApp>, workspaceId: string, body: object) {
  return app.request(`/workspaces/${workspaceId}/chat/sessions/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /chat/sessions/turn (SSE)', () => {
  it('streams the turn events and persists the session + messages', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await postTurn(app, workspace.id, { userMessageText: 'hello vynel' })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      const frames = await res.text()
      expect(frames).toContain('event: session-created')
      expect(frames).toContain('event: user-message-persisted')
      expect(frames).toContain('event: text-chunk')
      expect(frames).toContain('event: session-completed')
      expect(frames).toContain('event: turn-stream-ended')

      const session = findChatSessionById(db, nextSdkSessionId)
      expect(session).not.toBeNull()
      // Heuristic title = first line of the first user message (D11).
      expect(session!.title).toBe('hello vynel')
      // Order-insensitive: the user + assistant rows can share a startedAt
      // millisecond, and the list orders by startedAt.
      const messages = listChatMessagesForSession(db, nextSdkSessionId)
      expect(messages).toHaveLength(2)
      expect(messages.map((m) => m.role).sort()).toEqual(['assistant', 'user'])
      expect(messages.find((m) => m.role === 'assistant')!.body).toBe(
        'Hello from the fake provider.',
      )
    })
  })

  it('composes the workspace MCP attachment + permission mode into the provider call', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await postTurn(app, workspace.id, { userMessageText: 'hi', mode: 'bypass' })
      await res.text()

      expect(startChatSessionInputs).toHaveLength(1)
      const input = startChatSessionInputs[0]!
      expect(input.userMessageText).toBe('hi')
      expect(input.workspacePath).toBe(workspace.path)
      // test: correct expectation — the user's bypass maps to the truly-silent
      // provider mode since 2026-07-30 (bypass-with-behavior-gate stays the
      // unattended default only).
      expect(input.permissionMode).toBe('bypass')
      // Servers register; no wildcard patterns reach the provider (SHADOWED fix).
      expect(input.mcpServers).toHaveProperty('vynel')
      expect('allowedMcpToolPatterns' in input).toBe(false)
      // The capability PROMPT composition (operating rules) rides along.
      expect(input.systemPromptAppend).toBeTruthy()
    })
  })

  it('continueRoot: links the primary conversation to the session the turn ran on', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await postTurn(app, workspace.id, {
        userMessageText: 'continue please',
        continueRoot: true,
      })
      await res.text()

      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary).not.toBeNull()
      expect(primary!.currentSdkSessionId).toBe(nextSdkSessionId)
      // The first primary segment is hidden from the curated sidebar (Slice 2).
      expect(findChatSessionById(db, nextSdkSessionId)?.visibility).toBe('hidden')
    })
  })

  it('continueRoot: a turn that leaves the primary over the threshold swaps it VISIBLY — patching → patched → ended, on the stream', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      // Two SDK starts: the turn (segment A, 0.95 of Haiku's window), then the
      // swap's priming session (segment B).
      queuedSessionIds.push('sdk-ws-a', 'sdk-ws-b')
      usageTokensForTurn = 190_000
      const app = createApp({ db, logger: silentLogger })

      const frames = await (
        await postTurn(app, workspace.id, { userMessageText: 'keep going', continueRoot: true })
      ).text()

      // The swap is announced on the stream, in order, before the terminal frame.
      const at = (marker: string) => frames.indexOf(marker)
      expect(at('event: session-completed')).toBeGreaterThan(-1)
      expect(at('event: context-patching')).toBeGreaterThan(at('event: session-completed'))
      expect(at('event: context-patched')).toBeGreaterThan(at('event: context-patching'))
      expect(at('event: turn-stream-ended')).toBeGreaterThan(at('event: context-patched'))
      expect(frames).toContain('"toSessionId":"sdk-ws-b"')
      // …and it really happened: the primary continues on B, chained to A.
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary!.currentSdkSessionId).toBe('sdk-ws-b')
      expect(findChatSessionById(db, 'sdk-ws-b')?.continuedFromSessionId).toBe('sdk-ws-a')
    })
  })

  it('continueRoot: a CHECKPOINTED turn continues on the SAME stream after its swap — patched → the continuation row on the fresh head → its end → ended', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      // Three SDK starts, ONE request: the turn (A, pressured — the model
      // checkpoints mid-turn), the swap's priming (B), the continuation (B, relaxed).
      queuedSessionIds.push('sdk-ws-a', 'sdk-ws-b', 'sdk-ws-b')
      queuedUsageTokens.push(190_000, null, 10_000)
      onStartChatSession = (_input, ordinal) => {
        if (ordinal !== 1) return
        // What the `checkpoint` tool does when the model calls it: the
        // primary exists before composition (whoami / checkpoint key on it).
        const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
        markPendingCheckpoint(primary!.id, 'sum the July receipts')
      }
      const app = createApp({ db, logger: silentLogger })

      const frames = await (
        await postTurn(app, workspace.id, { userMessageText: 'reconcile the receipts', continueRoot: true })
      ).text()

      // One stream: patching → patched onto B → the continuation's own user
      // row → its completion → the single terminal frame.
      const at = (marker: string) => frames.indexOf(marker)
      const patchedAt = at('event: context-patched')
      expect(patchedAt).toBeGreaterThan(at('event: context-patching'))
      const continuationRowAt = frames.indexOf('event: user-message-persisted', patchedAt)
      expect(continuationRowAt).toBeGreaterThan(patchedAt)
      expect(frames.indexOf('event: session-completed', continuationRowAt)).toBeGreaterThan(continuationRowAt)
      expect(at('event: turn-stream-ended')).toBeGreaterThan(continuationRowAt)
      expect(frames.split('event: turn-stream-ended')).toHaveLength(2)
      expect(frames).toContain('Continuing after patching context — next: sum the July receipts')

      // The continuation RESUMED the fresh head with the instruction; its
      // anchor row persisted on B, stamped as a relayed anchor (not the user).
      expect(startChatSessionInputs).toHaveLength(3)
      expect(startChatSessionInputs[2]?.resumeSessionId).toBe('sdk-ws-b')
      expect(startChatSessionInputs[2]?.userMessageText).toContain('NEXT STEP: sum the July receipts')
      const rowsOnB = listChatMessagesForSession(db, 'sdk-ws-b')
      const anchor = rowsOnB.find((row) => row.role === 'user' && row.body.startsWith('Continuing after patching context'))
      expect(anchor).toMatchObject({ sourceKind: 'global-root', sourceLabel: null })
      // Turn 1's own row stayed on A — nothing was lost or re-persisted.
      expect(listChatMessagesForSession(db, 'sdk-ws-a').map((row) => row.body)).toContain('reconcile the receipts')
    })
  })

  it('maps the session mode to the provider permission mode (default auto when absent)', async () => {
    // Closes the workspace-route half of the mode-forwarding pin — the global
    // route has had this end-to-end assertion since surface-up step 1.
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      await (await postTurn(app, workspace.id, { userMessageText: 'hi', mode: 'bypass' })).text()
      // test: correct expectation — user bypass → 'bypass' since 2026-07-30.
      expect(startChatSessionInputs[0]!.permissionMode).toBe('bypass')

      await (await postTurn(app, workspace.id, { userMessageText: 'hi again' })).text()
      // test: correct expectation — DEFAULT_SESSION_MODE is auto since 2026-08-19 (was ask).
      expect(startChatSessionInputs[1]!.permissionMode).toBe('auto')
    })
  })

  it('400s on a model outside the curated allowlist', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await postTurn(app, workspace.id, {
        userMessageText: 'hi',
        model: 'not-a-real-model',
      })
      expect(res.status).toBe(400)
      expect(startChatSessionInputs).toHaveLength(0)
    })
  })

  it('continueRoot QUEUES behind the held workspace key and resumes the FRESH head after release', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const locks = new SessionTargetLocks()
      const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

      // Seed the primary through a normal continue turn.
      await (
        await postTurn(app, workspace.id, { userMessageText: 'seed', continueRoot: true })
      ).text()
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })!
      const seededHead = primary.currentSdkSessionId!

      // A "delegated run" holds the pool's exclusion key for this workspace.
      const releaseDelegatedRun = await locks.acquire(workspace.id)

      const resPromise = postTurn(app, workspace.id, {
        userMessageText: 'queued turn',
        continueRoot: true,
      })
      await sleep(50)
      // Parked: no provider call for the queued turn yet (B3 — two writers
      // used to interleave on the primary's SDK session right here).
      expect(startChatSessionInputs.some((i) => i.userMessageText === 'queued turn')).toBe(false)

      // While parked, the held run compaction-swaps the primary onto a fresh
      // segment — the queued turn must resume THAT head, not a pre-wait read.
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'sdk-swapped-head',
      })
      nextSdkSessionId = 'sdk-swapped-head'

      releaseDelegatedRun()
      const frames = await (await resPromise).text()
      expect(frames).toContain('event: turn-queued')
      expect(frames.indexOf('event: turn-queued')).toBeLessThan(
        frames.indexOf('event: user-message-persisted'),
      )
      expect(frames).toContain('event: turn-stream-ended')

      const queuedInput = startChatSessionInputs.find((i) => i.userMessageText === 'queued turn')
      expect(queuedInput).toBeDefined()
      expect(queuedInput!.resumeSessionId).toBe('sdk-swapped-head')
      expect(queuedInput!.resumeSessionId).not.toBe(seededHead)

      // The lock released with the stream — the key is immediately reusable.
      expect(locks.isBusy(workspace.id)).toBe(false)
    })
  })

  it('a held workspace key never parks NON-continue turns (no lock, prior behavior)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const locks = new SessionTargetLocks()
      const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

      const releaseDelegatedRun = await locks.acquire(workspace.id)
      const frames = await (
        await postTurn(app, workspace.id, { userMessageText: 'plain' })
      ).text()
      expect(frames).not.toContain('event: turn-queued')
      expect(frames).toContain('event: turn-stream-ended')
      expect(startChatSessionInputs).toHaveLength(1)
      releaseDelegatedRun()
    })
  })

  it('a client DISCONNECT while parked never leaks the workspace key', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const locks = new SessionTargetLocks()
      const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

      await (
        await postTurn(app, workspace.id, { userMessageText: 'seed', continueRoot: true })
      ).text()
      const releaseDelegatedRun = await locks.acquire(workspace.id)

      const res = await postTurn(app, workspace.id, {
        userMessageText: 'abandoned turn',
        continueRoot: true,
      })
      expect(res.status).toBe(200)
      await sleep(50)
      expect(startChatSessionInputs.some((i) => i.userMessageText === 'abandoned turn')).toBe(
        false,
      )

      // The client walks away WHILE PARKED (cancelling the body is how a dead
      // socket reaches hono's stream on the node path — the session-turn pin).
      await res.body!.cancel()
      releaseDelegatedRun()
      // The abandoned waiter still runs to completion detached; wait it out.
      for (let i = 0; i < 40 && locks.isBusy(workspace.id); i += 1) {
        await sleep(25)
      }

      // THE pin: the finally released the key even with nobody reading — a
      // leak here would park every future continue-turn AND the delegation
      // pool on this workspace forever.
      expect(locks.isBusy(workspace.id)).toBe(false)
      expect(startChatSessionInputs.some((i) => i.userMessageText === 'abandoned turn')).toBe(
        true,
      )
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary).not.toBeNull()
    })
  })

  it('stamps the RESOLVED mode on the routing header even when nothing was set — parent == child (A6)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      // A fresh conversation, no mode in the body → the default runs AND is
      // what the children inherit (used to stamp nothing → NULL → the runner's
      // own default: an ask-mode parent's children could run unattended).
      await (await postTurn(app, workspace.id, { userMessageText: 'no mode' })).text()
      expect(startChatSessionInputs[0]!.permissionMode).toBe('auto')
      expect(wrapAppRequestWithModeSpy).toHaveBeenCalledWith('auto')

      wrapAppRequestWithModeSpy.mockClear()
      await (await postTurn(app, workspace.id, { userMessageText: 'careful', mode: 'ask' })).text()
      expect(startChatSessionInputs[1]!.permissionMode).toBe('ask')
      expect(wrapAppRequestWithModeSpy).toHaveBeenCalledWith('ask')
    })
  })

  it('attaches ask_user with the interactive bound (VYNEL_INTERACTIVE_ASK_MAX_MS) + the wall-clock gate (D5)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      envOverrides.current = { VYNEL_INTERACTIVE_ASK_MAX_MS: 654_321 }
      const app = createApp({ db, logger: silentLogger })

      await (await postTurn(app, workspace.id, { userMessageText: 'hi' })).text()
      expect(startChatSessionInputs[0]!.mcpServers).toHaveProperty('vynel-ask')
      expect(buildAskFeatureDescriptorSpy).toHaveBeenCalledTimes(1)
      const deps = buildAskFeatureDescriptorSpy.mock.calls[0]![0] as {
        timeoutMs?: number
        waitGate?: unknown
      }
      expect(deps.timeoutMs).toBe(654_321)
      expect(deps.waitGate).toBeDefined()
    })
  })

  it('a by-id turn on the primary\'s CURRENT head takes the workspace key too — a foreign id never does (S7)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const locks = new SessionTargetLocks()
      const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })

      // Seed the primary; a plain (non-primary) session too.
      await (await postTurn(app, workspace.id, { userMessageText: 'seed', continueRoot: true })).text()
      const head = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })!
        .currentSdkSessionId!
      nextSdkSessionId = 'sdk-plain'
      await (await postTurn(app, workspace.id, { userMessageText: 'plain seed' })).text()

      // A "delegated run" holds the workspace key.
      const releaseDelegatedRun = await locks.acquire(workspace.id)

      // By-id onto the primary's head: it must QUEUE (two writers on one CLI
      // session otherwise) — the by-id path used to take no lock at all.
      const headTurn = postTurn(app, workspace.id, {
        userMessageText: 'onto the head',
        resumeSessionId: head,
      })
      await sleep(50)
      expect(startChatSessionInputs.some((i) => i.userMessageText === 'onto the head')).toBe(false)

      // By-id onto a session the pool never writes: no lock, runs straight through.
      const plainFrames = await (
        await postTurn(app, workspace.id, {
          userMessageText: 'onto the plain one',
          resumeSessionId: 'sdk-plain',
        })
      ).text()
      expect(plainFrames).not.toContain('event: turn-queued')
      expect(plainFrames).toContain('event: turn-stream-ended')

      releaseDelegatedRun()
      const headFrames = await (await headTurn).text()
      expect(headFrames).toContain('event: turn-queued')
      expect(headFrames).toContain('"reason":"busy"')
      expect(headFrames).toContain('event: turn-stream-ended')
      const headInput = startChatSessionInputs.find((i) => i.userMessageText === 'onto the head')
      expect(headInput?.resumeSessionId).toBe(head)
      expect(locks.isBusy(workspace.id)).toBe(false)
    })
  })

  it('the interactive wall clock: a turn past VYNEL_INTERACTIVE_TURN_MAX_MS is interrupted, records the failure row, streams the errored frame, and frees the workspace key (D5)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const locks = new SessionTargetLocks()
      const app = createApp({ db, logger: silentLogger, sessionTargetLocks: locks })
      envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 60 }

      nextTurnHangs = true
      const hungSessionId = nextSdkSessionId
      const frames = await (
        await postTurn(app, workspace.id, { userMessageText: 'never ends', continueRoot: true })
      ).text()

      // The clock interrupted THE turn's session (nothing else released the hang).
      expect(interruptChatSessionMock).toHaveBeenCalledWith(hungSessionId)
      expect(frames).toContain('"errorCode":"turn-wall-clock-exceeded"')
      expect(frames).toContain('turn exceeded the 0.001-minute limit')
      expect(frames).toContain('event: session-interrupted')
      expect(frames).toContain('event: turn-stream-ended')
      const errored = listChatMessagesForSession(db, hungSessionId).find(
        (message) => message.errorCode === 'turn-wall-clock-exceeded',
      )
      expect(errored?.errorMessage).toBe('turn exceeded the 0.001-minute limit')
      // The workspace key released with the stream.
      expect(locks.isBusy(workspace.id)).toBe(false)

      // A normal turn never trips it.
      envOverrides.current = { VYNEL_INTERACTIVE_TURN_MAX_MS: 5_000 }
      interruptChatSessionMock.mockClear()
      nextSdkSessionId = `sdk-${randomUUID()}`
      await (await postTurn(app, workspace.id, { userMessageText: 'quick', continueRoot: true })).text()
      expect(interruptChatSessionMock).not.toHaveBeenCalled()
    })
  })
})

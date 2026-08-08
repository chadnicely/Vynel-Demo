// End-to-end smoke for the chat-turn SSE stream — full HTTP stack (route →
// workspaceScoped → streamChatTurn → startChatTurn → consumeSessionEventStream
// → SQLite), with the provider registry mocked at the module boundary (the
// approvals route-test precedent) so no live SDK runtime is started. The
// `@vynel/session` test-support FakeAiAgentProvider is not exported from the
// package (no `./runtime/test-support` subpath), so the stub lives here — same
// normalized-event shapes.

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
      textDelta: 'Hello from the fake provider.',
      isFinalChunk: true,
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
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

import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import {
  findPrimaryConversation,
  linkPrimarySessionToSdkSession,
} from '@vynel/session/continuity'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { createApp } from '../app.js'

const silentLogger = pino({ level: 'silent' })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  nextSdkSessionId = `sdk-${randomUUID()}`
  startChatSessionInputs.length = 0
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
      expect(input.allowedMcpToolPatterns).toContain('mcp__vynel__*')
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

  it('maps the session mode to the provider permission mode (default ask when absent)', async () => {
    // Closes the workspace-route half of the mode-forwarding pin — the global
    // route has had this end-to-end assertion since surface-up step 1.
    await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db)
      const app = createApp({ db, logger: silentLogger })

      await (await postTurn(app, workspace.id, { userMessageText: 'hi', mode: 'bypass' })).text()
      // test: correct expectation — user bypass → 'bypass' since 2026-07-30.
      expect(startChatSessionInputs[0]!.permissionMode).toBe('bypass')

      await (await postTurn(app, workspace.id, { userMessageText: 'hi again' })).text()
      expect(startChatSessionInputs[1]!.permissionMode).toBe('ask')
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
})

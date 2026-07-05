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
import { findPrimaryConversation } from '@vynel/session/continuity'
import { createApp } from '../app.js'

const silentLogger = pino({ level: 'silent' })

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
      expect(input.permissionMode).toBe('bypass-with-behavior-gate')
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
})

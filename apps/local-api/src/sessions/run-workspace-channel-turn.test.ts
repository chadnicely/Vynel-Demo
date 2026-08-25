// The WORKSPACE channel turn, end to end against real SQLite with the provider
// registry mocked at the module boundary (the chat-turn.test.ts harness): the
// turn resumes the workspace's continuing conversation, its row carries the
// channel origin ("via Telegram"), the marker rides PROVIDER input only, the
// feed announces the WORKSPACE identity, the reply tool is addressed by the
// origin header, and a busy workspace parks the turn FIFO behind the holder.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
// Type-only (erased at runtime, so the hoisted `vi.mock` factories below may
// name them) — `vi.importActual` needs the module's shape.
import type * as ProvidersModule from '@vynel/providers'
import type * as GlobalRootTurnModule from './run-global-root-turn.js'

const startChatSessionInputs: StartChatSessionInput[] = []
let nextSdkSessionId = 'sdk-channel-1'
/** The next turn ends with a terminal `session-errored` carrying this message. */
let nextTurnErrors: string | null = null

const { wrapAppRequestWithOriginSpy, askDescriptorCalls } = vi.hoisted(() => ({
  wrapAppRequestWithOriginSpy: vi.fn(),
  askDescriptorCalls: [] as { waiters: unknown; turnKey: string; timeoutMs: number }[],
}))

// The ask descriptor pulls the SDK builder — stub it and record what the turn
// asked for (the BOUND is the subject).
vi.mock('@vynel/asks/mcp', () => ({
  buildAskFeatureDescriptor: (input: { waiters: unknown; turnKey: string; timeoutMs: number }) => {
    askDescriptorCalls.push(input)
    return { serverName: 'vynel-ask', build: () => null, mutatingToolNames: [] }
  },
}))

/** Ordering log — what happened before what (the lock's real subject). */
const timeline: string[] = []

function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  startChatSessionInputs.push(input)
  timeline.push('start-chat-session')
  const sessionId = nextSdkSessionId
  const errorMessage = nextTurnErrors
  nextTurnErrors = null
  async function* events(): AsyncIterable<NormalizedSessionEvent> {
    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: input.resumeSessionId !== undefined,
      startedAt: new Date(),
    }
    if (errorMessage !== null) {
      yield {
        kind: 'session-errored',
        sessionId,
        errorCode: 'provider-unreachable',
        errorMessage,
        isRecoverable: false,
        erroredAt: new Date(),
      }
      return
    }
    yield {
      kind: 'text-chunk',
      sessionId,
      messageId: 'assistant-m1',
      textDelta: 'Sent it back to Telegram.',
      isFinalChunk: true,
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
  }
  return events()
}

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof ProvidersModule>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      startChatSession: fakeStartChatSession,
      interruptChatSession: async () => {},
      summarizeSession: async () => null,
    }),
  }
})
// The REAL origin wrapper, with the origin it stamps recorded — what makes
// `reply_to_channel` answer the exact chat that asked (and what a delegation
// this turn enqueues carries onto its job row).
vi.mock('./run-global-root-turn.js', async () => {
  const actual = await vi.importActual<typeof GlobalRootTurnModule>('./run-global-root-turn.js')
  return {
    ...actual,
    wrapAppRequestWithOrigin: (
      appRequest: Parameters<typeof actual.wrapAppRequestWithOrigin>[0],
      origin: Parameters<typeof actual.wrapAppRequestWithOrigin>[1],
    ) => {
      wrapAppRequestWithOriginSpy(origin)
      return actual.wrapAppRequestWithOrigin(appRequest, origin)
    },
  }
})

import { listChatMessagesForSession } from '@vynel/chat/repositories'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { PendingAskRegistry } from '@vynel/asks'
import { DELEGATION_ORIGIN_HEADER } from './delegation-origin-header.js'
import { CHANNEL_ASK_TIMEOUT_MS } from './run-global-root-turn.js'
import { buildWorkspaceChannelTurnRunner } from './run-workspace-channel-turn.js'

const silentLogger = pino({ level: 'silent' })

beforeEach(() => {
  startChatSessionInputs.length = 0
  timeline.length = 0
  nextSdkSessionId = `sdk-${randomUUID()}`
  nextTurnErrors = null
  wrapAppRequestWithOriginSpy.mockClear()
  askDescriptorCalls.length = 0
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
    name: 'Letterman',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

const channelOrigin = {
  channelId: 'chan-1',
  externalSenderId: '123456',
  externalChatContextId: '123456',
}

function turnInput(userId: string, workspace: { id: string; path: string; name: string }) {
  return {
    userId,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    userMessageText: 'how did yesterday go?',
    origin: channelOrigin,
    originChannel: 'telegram' as const,
    channelReplyMarker: '(Reply by CALLING the reply_to_channel tool.)',
  }
}

describe('runWorkspaceChannelTurn', () => {
  it("runs on the workspace's continuing conversation and stamps the channel origin", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      // The durable envelope is the honest read of what the feed announced.
      const announced: {
        scopeKind: string
        origin: string
        workspaceId: string | null
        primarySessionId: string | null
      }[] = []
      const feed = new SessionActivityFeed({
        turnRecorder: {
          turnStarted: (turn) =>
            announced.push({
              scopeKind: turn.scopeKind,
              origin: turn.origin,
              workspaceId: turn.workspaceId,
              primarySessionId: turn.primarySessionId,
            }),
          turnResolved: () => {},
          turnEnded: () => {},
        },
      })
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: feed,
        targetLocks: new SessionTargetLocks(),
      })

      const result = await run(db, turnInput(user.id, workspace))

      // The workspace's primary now exists and the turn's segment IS it.
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary).not.toBeNull()
      expect(primary?.currentSdkSessionId).toBe(nextSdkSessionId)

      // The persisted user row: clean body, channel origin ("via Telegram").
      const messages = listChatMessagesForSession(db, nextSdkSessionId)
      const userRow = messages.find((message) => message.role === 'user')!
      expect(userRow.body).toBe('how did yesterday go?')
      expect(userRow.originChannel).toBe('telegram')
      // The marker reaches the MODEL only.
      expect(userRow.body).not.toContain('reply_to_channel')
      expect(startChatSessionInputs[0]?.userMessageText).toContain('reply_to_channel')

      // The feed names the WORKSPACE identity beside the channel as origin —
      // readers match by identity, never by an absence.
      expect(announced).toEqual([
        {
          scopeKind: 'workspace',
          origin: 'telegram',
          workspaceId: workspace.id,
          primarySessionId: primary!.id,
        },
      ])
      expect(result.resultText).toBe('Sent it back to Telegram.')
    })
  })

  it('addresses the reply tool with the asking channel — the origin header', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const seenHeaders: (string | null)[] = []
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: (_input, init) => {
          seenHeaders.push(new Headers(init?.headers).get(DELEGATION_ORIGIN_HEADER))
          return new Response(null)
        },
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
      })

      await run(db, turnInput(user.id, workspace))

      // The turn composed its tools through an origin-wrapped dispatcher: the
      // model never handles an address, and a delegation it enqueues inherits
      // the channel ids so the answer comes back HERE.
      expect(wrapAppRequestWithOriginSpy).toHaveBeenCalledWith(channelOrigin)
    })
  })

  it('resumes the SAME conversation on the next message', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
      })

      await run(db, turnInput(user.id, workspace))
      const firstSegment = nextSdkSessionId
      await run(db, turnInput(user.id, workspace))

      expect(startChatSessionInputs).toHaveLength(2)
      expect(startChatSessionInputs[0]?.resumeSessionId).toBeUndefined()
      expect(startChatSessionInputs[1]?.resumeSessionId).toBe(firstSegment)
    })
  })

  it('waits FIFO behind whoever holds the workspace key', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const targetLocks = new SessionTargetLocks()
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks,
      })

      // Somebody else is mid-turn on this workspace (a user chat, a fire).
      const releaseHolder = await targetLocks.acquire(workspace.id)
      const turn = run(db, turnInput(user.id, workspace))
      // Long enough for the whole pre-turn path (primary resolve, settings,
      // MCP composition) to finish — so an unheld key WOULD have reached the
      // provider by now, and the ORDER below is what proves the park.
      await new Promise((resolve) => setTimeout(resolve, 50))
      timeline.push('holder-released')
      releaseHolder()
      await turn

      expect(timeline).toEqual(['holder-released', 'start-chat-session'])
    })
  })

  it('serializes two channel messages — the second resumes what the first created', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
      })

      // Both messages land at once (the 1s processing tick fires pending rows
      // CONCURRENTLY). The key makes them a queue, not two writers.
      await Promise.all([
        run(db, turnInput(user.id, workspace)),
        run(db, turnInput(user.id, workspace)),
      ])

      expect(startChatSessionInputs).toHaveLength(2)
      // Interleaved, both would have resolved the primary before either linked
      // a segment, and BOTH would have started fresh on the same conversation.
      expect(startChatSessionInputs[0]?.resumeSessionId).toBeUndefined()
      expect(startChatSessionInputs[1]?.resumeSessionId).toBe(nextSdkSessionId)
    })
  })

  it('throws on a terminal stream error, and releases the key', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const targetLocks = new SessionTargetLocks()
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks,
      })
      nextTurnErrors = 'the engine is unreachable'

      // The throw is what makes the channel path enqueue its apology and mark
      // the inbound row failed — silence would leave the sender watching
      // "typing…" stop.
      await expect(run(db, turnInput(user.id, workspace))).rejects.toThrow(
        'the engine is unreachable',
      )

      // A leaked key would park every later turn on this workspace forever.
      // Read the registry rather than acquiring: an acquire on a LEAKED key
      // hangs instead of failing, so the guard would time out rather than tell
      // us what went wrong.
      expect(targetLocks.isBusy(workspace.id)).toBe(false)
    })
  })

  it('gives the turn its chat-session identity and a BOUNDED ask_user (the global runner’s shape)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const askWaiters = new PendingAskRegistry()
      const cancelForTurn = vi.spyOn(askWaiters, 'cancelForTurn')
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
        askWaiters,
      })

      await run(db, turnInput(user.id, workspace))

      // The ask descriptor was built for THIS turn with the shared bound —
      // nobody may be looking at the app, so an unanswered form expires.
      expect(askDescriptorCalls).toHaveLength(1)
      expect(askDescriptorCalls[0]?.timeoutMs).toBe(CHANNEL_ASK_TIMEOUT_MS)
      expect(askDescriptorCalls[0]?.waiters).toBe(askWaiters)
      expect(askDescriptorCalls[0]?.turnKey).toEqual(expect.any(String))
      // …and its waiters are cancelled at turn end, so a parked ask can never
      // outlive the turn that raised it.
      expect(cancelForTurn).toHaveBeenCalledWith(askDescriptorCalls[0]?.turnKey)
    })
  })

  it('attaches no ask_user at all when no registry is wired (the pre-slice shape)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db)
      const run = await buildWorkspaceChannelTurnRunner({
        logger: silentLogger,
        appRequest: () => new Response(null),
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
      })

      await run(db, turnInput(user.id, workspace))

      expect(askDescriptorCalls).toHaveLength(0)
    })
  })
})

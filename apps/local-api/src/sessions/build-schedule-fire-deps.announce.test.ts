// The schedule-fire ANNOUNCE + CONTINUING-CONVERSATION wrapper: the deps'
// startChatTurn must resolve the workspace's continuing conversation INSIDE
// the workspace lock (schedule-on-primary — registering the primary db-first
// on a first fire, resuming its head otherwise), begin the turn on the
// activity feed naming that identity (origin 'schedule', the fired workspace,
// the primary id), forward the resume target + continuity + the shared
// turnEvents broadcaster into the runtime, and end in a finally — even when
// the underlying turn throws mid-stream. The runtime's startChatTurn is
// swapped for a scripted fake via the importOriginal-spread pattern so no
// live turn machinery runs; the primary resolution and the DB are REAL
// (withTestDatabase — never mock the DB).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { HonoAppRequestFn } from '../factory.js'

const { fakeStartChatTurn } = vi.hoisted(() => ({ fakeStartChatTurn: vi.fn() }))

vi.mock('@vynel/session/runtime', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, startChatTurn: fakeStartChatTurn }
})
// Keep the SDK-heavy descriptor modules out (the schedules-service.test stub).
vi.mock('@vynel/mcp', () => ({
  vynelWorkspaceDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))

import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks, TurnEventBroadcaster } from '@vynel/session/delegation'
import {
  findPrimaryConversation,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '@vynel/session/continuity'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'

const silentLogger = pino({ level: 'silent' })
const fakeAppRequest = vi.fn() as unknown as HonoAppRequestFn

function seedWorkspace(db: Database): { userId: string; workspaceId: string } {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id }
}

/** A workspace whose continuing conversation already runs on a head segment. */
async function seedContinuingConversation(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<{ primarySessionId: string; headSdkSessionId: string }> {
  const headSdkSessionId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: headSdkSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
    }),
  )
  const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
  linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId: headSdkSessionId })
  return { primarySessionId: primary.id, headSdkSessionId }
}

function turnInputFor(userId: string, workspaceId: string) {
  return {
    userId,
    workspaceId,
    workspacePath: 'C:/tmp/ws-1',
    providerId: 'claude',
    userMessageText: 'fire!',
    scheduleRunId: 'run-1',
    permissionMode: 'auto',
    mcpServers: {},
    deniedToolNames: [],
    systemPromptAppend: '',
  }
}

function collect(feed: SessionActivityFeed, userId: string) {
  const events: SessionActivityEvent[] = []
  feed.subscribe(userId, (event) => events.push(event))
  return events
}

async function buildDeps(feed: SessionActivityFeed, turnEvents?: TurnEventBroadcaster) {
  return buildScheduleFireDeps({
    appRequest: fakeAppRequest,
    logger: silentLogger,
    activityFeed: feed,
    targetLocks: new SessionTargetLocks(),
    ...(turnEvents !== undefined ? { turnEvents } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildScheduleFireDeps — the activity announce + continuing-conversation wrapper', () => {
  it('a FIRST fire registers the primary db-first, announces it, and starts fresh with continuity (no resume)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'session-created', session: { id: 'sdk-1' } }
        yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'done' }
      })
      const feed = new SessionActivityFeed()
      const events = collect(feed, userId)
      const deps = await buildDeps(feed)

      const seen: string[] = []
      for await (const event of deps.startChatTurn(db, turnInputFor(userId, workspaceId) as never, {
        logger: silentLogger,
      })) {
        seen.push(event.kind)
      }

      expect(seen).toEqual(['session-created', 'text-chunk']) // events pass through untouched
      // The primary row was REGISTERED before the turn (db-first, the
      // continuity arc's rule) — the fresh turn becomes the conversation.
      const primary = findPrimaryConversation(db, { userId, workspaceId })
      expect(primary).not.toBeNull()
      expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-updated', 'turn-ended'])
      // The frame names the continuing identity beside origin 'schedule' —
      // the working rail's named conversation chip (rail-identity-census).
      expect(events[0]).toMatchObject({
        scopeKind: 'workspace',
        workspaceId,
        origin: 'schedule',
        primarySessionId: primary!.id,
        sessionId: null, // a fresh conversation resolves it mid-turn …
      })
      expect(events[1]).toMatchObject({ sessionId: 'sdk-1' }) // … from the stream.
      // The runtime got NO resume target (fresh) but DID get the continuing
      // identity, so the boundary link makes this turn the conversation.
      const [, runtimeInput] = fakeStartChatTurn.mock.calls[0]!
      expect(runtimeInput.resumeSessionId).toBeUndefined()
      expect(runtimeInput.continuity).toMatchObject({ primarySessionId: primary!.id })
    })
  })

  it('a fire on an EXISTING conversation resumes its head and announces the known identity up front', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      const { primarySessionId, headSdkSessionId } = await seedContinuingConversation(db, userId, workspaceId)
      fakeStartChatTurn.mockImplementation(async function* () {
        // A resumed head announces via user-message-persisted only — no
        // session-created (handle-session-started's resumed branch).
        yield { kind: 'user-message-persisted', message: { sessionId: headSdkSessionId } }
        yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'done' }
      })
      const feed = new SessionActivityFeed()
      const events = collect(feed, userId)
      const deps = await buildDeps(feed)

      for await (const event of deps.startChatTurn(db, turnInputFor(userId, workspaceId) as never, {
        logger: silentLogger,
      })) {
        void event
      }

      // Identity known up front: begin already carries the head, so the
      // stream's confirmation is a no-op — no turn-updated frame.
      expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-ended'])
      expect(events[0]).toMatchObject({
        scopeKind: 'workspace',
        workspaceId,
        origin: 'schedule',
        primarySessionId,
        sessionId: headSdkSessionId,
      })
      // The runtime resumes the chain head, with the continuing identity for
      // the boundary continuity step.
      const [, runtimeInput] = fakeStartChatTurn.mock.calls[0]!
      expect(runtimeInput.resumeSessionId).toBe(headSdkSessionId)
      expect(runtimeInput.continuity).toMatchObject({ primarySessionId })
    })
  })

  it('forwards the shared turnEvents broadcaster so the resumed head’s open thread lights up (Watch everywhere)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      await seedContinuingConversation(db, userId, workspaceId)
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'done' }
      })
      const turnEvents = new TurnEventBroadcaster()
      const deps = await buildDeps(new SessionActivityFeed(), turnEvents)

      for await (const event of deps.startChatTurn(db, turnInputFor(userId, workspaceId) as never, {
        logger: silentLogger,
      })) {
        void event
      }

      // The runtime tees onto `session:<head>` through THIS broadcaster — the
      // channel the open workspace thread watches (the delegated turns' path).
      const [, , runtimeDeps] = fakeStartChatTurn.mock.calls[0]!
      expect(runtimeDeps.turnEvents).toBe(turnEvents)
    })
  })

  it('ends the turn even when the underlying stream throws mid-turn', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'user-message-persisted', message: { sessionId: 'sdk-2' } }
        throw new Error('provider down')
      })
      const feed = new SessionActivityFeed()
      const events = collect(feed, userId)
      const deps = await buildDeps(feed)

      await expect(async () => {
        for await (const event of deps.startChatTurn(db, turnInputFor(userId, workspaceId) as never, {
          logger: silentLogger,
        })) {
          void event
        }
      }).rejects.toThrow('provider down')

      expect(events.map((event) => event.kind)).toEqual([
        'turn-started',
        'turn-updated', // user-message-persisted resolved the fresh identity
        'turn-ended',
      ])
    })
  })
})

// The schedule-fire ANNOUNCE wrapper: the deps' startChatTurn must begin the
// turn on the activity feed (origin 'schedule', the fired workspace), resolve
// the session identity from the stream, and end in a finally — even when the
// underlying turn throws mid-stream. Kept separate from
// build-schedule-fire-deps.test.ts (real composition, no mocks): here the
// runtime's startChatTurn is swapped for a scripted fake via the
// importOriginal-spread pattern so no live turn machinery runs.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@vynel/db'
import pino from 'pino'
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
import { SessionTargetLocks } from '@vynel/session/delegation'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'

const silentLogger = pino({ level: 'silent' })
const fakeAppRequest = vi.fn() as unknown as HonoAppRequestFn
const fakeDb = {} as unknown as Database

const turnInput = {
  userId: 'u1',
  workspaceId: 'ws-1',
  workspacePath: 'C:/tmp/ws-1',
  providerId: 'claude',
  userMessageText: 'fire!',
  scheduleRunId: 'run-1',
  permissionMode: 'auto',
  mcpServers: {},
  deniedToolNames: [],
  systemPromptAppend: '',
}

function collect(feed: SessionActivityFeed, userId: string) {
  const events: SessionActivityEvent[] = []
  feed.subscribe(userId, (event) => events.push(event))
  return events
}

describe('buildScheduleFireDeps — the activity announce wrapper', () => {
  it('begins with origin schedule, resolves the session from the stream, ends on drain', async () => {
    fakeStartChatTurn.mockImplementation(async function* () {
      yield { kind: 'session-created', session: { id: 'sdk-1' } }
      yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'done' }
    })
    const feed = new SessionActivityFeed()
    const events = collect(feed, 'u1')
    const deps = await buildScheduleFireDeps({
      appRequest: fakeAppRequest,
      logger: silentLogger,
      activityFeed: feed,
      targetLocks: new SessionTargetLocks(),
    })

    const seen: string[] = []
    for await (const event of deps.startChatTurn(fakeDb, turnInput as never, {
      logger: silentLogger,
    })) {
      seen.push(event.kind)
    }

    expect(seen).toEqual(['session-created', 'text-chunk']) // events pass through untouched
    expect(events.map((event) => event.kind)).toEqual([
      'turn-started',
      'turn-updated',
      'turn-ended',
    ])
    expect(events[0]).toMatchObject({
      scopeKind: 'workspace',
      workspaceId: 'ws-1',
      origin: 'schedule',
    })
    expect(events[1]).toMatchObject({ sessionId: 'sdk-1' })
  })

  it('ends the turn even when the underlying stream throws mid-turn', async () => {
    fakeStartChatTurn.mockImplementation(async function* () {
      yield { kind: 'user-message-persisted', message: { sessionId: 'sdk-2' } }
      throw new Error('provider down')
    })
    const feed = new SessionActivityFeed()
    const events = collect(feed, 'u1')
    const deps = await buildScheduleFireDeps({
      appRequest: fakeAppRequest,
      logger: silentLogger,
      activityFeed: feed,
      targetLocks: new SessionTargetLocks(),
    })

    await expect(async () => {
      for await (const event of deps.startChatTurn(fakeDb, turnInput as never, {
        logger: silentLogger,
      })) {
        void event
      }
    }).rejects.toThrow('provider down')

    expect(events.map((event) => event.kind)).toEqual([
      'turn-started',
      'turn-updated', // user-message-persisted resolved the resumed identity
      'turn-ended',
    ])
  })
})

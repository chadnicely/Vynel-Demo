// The feed's contract: begin announces, subscribe replays the in-flight
// snapshot, sessionResolved publishes identity once, end is idempotent, and
// users never see each other's turns.

import { describe, expect, it } from 'vitest'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'
import { SessionActivityFeed } from './session-activity-feed.js'

function collect(feed: SessionActivityFeed, userId: string) {
  const events: SessionActivityEvent[] = []
  const unsubscribe = feed.subscribe(userId, (event) => events.push(event))
  return { events, unsubscribe }
}

describe('SessionActivityFeed', () => {
  it('announces turn-started to live subscribers with the turn identity', () => {
    const feed = new SessionActivityFeed()
    const { events } = collect(feed, 'user-1')
    const handle = feed.begin({
      userId: 'user-1',
      scopeKind: 'workspace',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      origin: 'web',
    })
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'turn-started',
        turnId: handle.turnId,
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        origin: 'web',
      }),
    ])
  })

  it('replays the in-flight snapshot to a subscriber attaching mid-turn', () => {
    const feed = new SessionActivityFeed()
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'telegram' })
    handle.sessionResolved('session-9')

    const { events } = collect(feed, 'user-1')
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'turn-started',
        turnId: handle.turnId,
        sessionId: 'session-9', // the snapshot carries what the turn has learned
        origin: 'telegram',
      }),
    ])
  })

  it('publishes turn-updated once when the session resolves, then turn-ended', () => {
    const feed = new SessionActivityFeed()
    const { events } = collect(feed, 'user-1')
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'voice' })
    handle.sessionResolved('session-2')
    handle.sessionResolved('session-2') // same id — no duplicate frame
    handle.end()
    handle.end() // idempotent

    expect(events.map((event) => event.kind)).toEqual([
      'turn-started',
      'turn-updated',
      'turn-ended',
    ])
    expect(events[2]).toEqual({
      kind: 'turn-ended',
      turnId: handle.turnId,
      sessionId: 'session-2',
    })
  })

  it('an ended turn leaves the snapshot and ignores late sessionResolved', () => {
    const feed = new SessionActivityFeed()
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'web' })
    handle.end()
    handle.sessionResolved('session-late')

    const { events } = collect(feed, 'user-1')
    expect(events).toEqual([]) // nothing in flight, nothing replayed
  })

  it('publishTurnStep reaches live subscribers stamped with the turnId', () => {
    const feed = new SessionActivityFeed()
    const { events } = collect(feed, 'user-1')
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'web' })
    handle.publishTurnStep({
      kind: 'turn-tool-started',
      toolUseId: 'toolu_1',
      toolName: 'mcp__desktop__snapshot_app',
      toolInput: { app: 'Discord' },
    })
    expect(events[1]).toEqual({
      kind: 'turn-tool-started',
      turnId: handle.turnId,
      toolUseId: 'toolu_1',
      toolName: 'mcp__desktop__snapshot_app',
      toolInput: { app: 'Discord' },
    })
  })

  // test: correct expectation — persona-sessions changed the snapshot spec:
  // steps stay TRANSIENT (never stored), but the LAST step per in-flight turn
  // now replays right after its `turn-started` so a mid-turn attach narrates
  // immediately instead of waiting for the next tool call.
  it('the snapshot replays each in-flight turn plus its LAST step only', () => {
    const feed = new SessionActivityFeed()
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'web' })
    handle.publishTurnStep({ kind: 'turn-tool-started', toolUseId: 't1', toolName: 'Read' })
    handle.publishTurnStep({ kind: 'turn-tool-settled', toolUseId: 't1', status: 'completed' })

    const { events } = collect(feed, 'user-1')
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-tool-settled'])

    // …and the step memory dies with the turn: after end, nothing replays.
    handle.end()
    const after = collect(feed, 'user-1')
    expect(after.events).toEqual([])
  })

  it('publishTurnStep after end() is a no-op', () => {
    const feed = new SessionActivityFeed()
    const { events } = collect(feed, 'user-1')
    const handle = feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'web' })
    handle.end()
    handle.publishTurnStep({ kind: 'turn-tool-started', toolUseId: 't', toolName: 'Read' })
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-ended'])
  })

  it('keeps users isolated', () => {
    const feed = new SessionActivityFeed()
    const alice = collect(feed, 'alice')
    feed.begin({ userId: 'bob', scopeKind: 'global', origin: 'web' })
    expect(alice.events).toEqual([])
  })

  it('unsubscribe stops delivery', () => {
    const feed = new SessionActivityFeed()
    const { events, unsubscribe } = collect(feed, 'user-1')
    unsubscribe()
    feed.begin({ userId: 'user-1', scopeKind: 'global', origin: 'web' })
    expect(events).toEqual([])
  })
})

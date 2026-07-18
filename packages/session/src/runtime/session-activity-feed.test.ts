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

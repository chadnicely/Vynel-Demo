// Tests for the PURE matcher. No database — the whole point of keeping this a
// function over data is that every rule is pinned directly rather than inferred
// from tick behavior.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeMonitorRow } from '../test-support.js'
import { findFirstMatch, matchesMonitor } from './match-monitor-to-event.js'
import type { WatchableEvent } from '../monitors-types.js'

function makeEvent(overrides: Partial<WatchableEvent> = {}): WatchableEvent {
  return {
    id: randomUUID(),
    type: 'task.completed',
    payload: { userId: 'user-1', taskId: 't-1' },
    createdAt: new Date(),
    ...overrides,
  }
}

describe('matchesMonitor — tenant gate', () => {
  // outbox_events is one table for every domain, so this is THE boundary that
  // keeps one user's monitor from firing on another user's event.
  it("never matches another user's event", () => {
    const monitor = makeMonitorRow({ userId: 'user-1' })
    expect(matchesMonitor(monitor, makeEvent({ payload: { userId: 'user-2' } }))).toBe(false)
  })

  it('fails CLOSED on a payload with no usable userId', () => {
    const monitor = makeMonitorRow({ userId: 'user-1' })
    expect(matchesMonitor(monitor, makeEvent({ payload: {} }))).toBe(false)
    expect(matchesMonitor(monitor, makeEvent({ payload: { userId: 42 } }))).toBe(false)
    expect(matchesMonitor(monitor, makeEvent({ payload: { userId: null } }))).toBe(false)
  })
})

describe('matchesMonitor — type gate', () => {
  it('matches a subscribed type and ignores everything else', () => {
    const monitor = makeMonitorRow({
      userId: 'user-1',
      eventTypes: ['task.completed', 'app.crashed'],
    })
    expect(matchesMonitor(monitor, makeEvent({ type: 'task.completed' }))).toBe(true)
    expect(matchesMonitor(monitor, makeEvent({ type: 'app.crashed' }))).toBe(true)
    expect(matchesMonitor(monitor, makeEvent({ type: 'task.created' }))).toBe(false)
  })
})

describe('matchesMonitor — payload filter', () => {
  it('requires every filter entry to match', () => {
    const monitor = makeMonitorRow({
      userId: 'user-1',
      payloadFilter: { workspaceId: 'ws-1', taskId: 't-1' },
    })
    const payload = { userId: 'user-1', workspaceId: 'ws-1', taskId: 't-1' }

    expect(matchesMonitor(monitor, makeEvent({ payload }))).toBe(true)
    expect(
      matchesMonitor(monitor, makeEvent({ payload: { ...payload, taskId: 't-2' } })),
    ).toBe(false)
  })

  it('misses nothing when a filtered field is absent or null', () => {
    const monitor = makeMonitorRow({ userId: 'user-1', payloadFilter: { workspaceId: 'ws-1' } })
    expect(matchesMonitor(monitor, makeEvent({ payload: { userId: 'user-1' } }))).toBe(false)
    expect(
      matchesMonitor(monitor, makeEvent({ payload: { userId: 'user-1', workspaceId: null } })),
    ).toBe(false)
  })

  // A filter arrives from a tool call as text, but outbox payloads carry mixed
  // types. Without coercion `{ firedCount: '0' }` would silently never match.
  it('compares as strings so a numeric payload field is filterable', () => {
    const monitor = makeMonitorRow({
      userId: 'user-1',
      eventTypes: ['monitor.expired'],
      payloadFilter: { firedCount: '0' },
    })
    expect(
      matchesMonitor(
        monitor,
        makeEvent({ type: 'monitor.expired', payload: { userId: 'user-1', firedCount: 0 } }),
      ),
    ).toBe(true)
  })

  it('matches on type alone when there is no filter', () => {
    const monitor = makeMonitorRow({ userId: 'user-1', payloadFilter: null })
    expect(matchesMonitor(monitor, makeEvent({ payload: { userId: 'user-1' } }))).toBe(true)
  })
})

describe('matchesMonitor — scope is deliberately not a gate', () => {
  // A workspace-scoped monitor may watch a global event: a channel message
  // arriving is not workspace-shaped. Scope says who gets WOKEN, not what may
  // be watched — narrowing is payloadFilter's job, and stays explicit.
  it('lets a workspace-scoped monitor match an event with no workspace', () => {
    const monitor = makeMonitorRow({ userId: 'user-1', workspaceId: 'ws-1' })
    expect(
      matchesMonitor(monitor, makeEvent({ payload: { userId: 'user-1', workspaceId: null } })),
    ).toBe(true)
  })
})

describe('findFirstMatch', () => {
  // Events arrive oldest-first, so a `once` monitor must fire on the EARLIEST
  // match — otherwise which event woke it would be arbitrary.
  it('returns the earliest match, not an arbitrary one', () => {
    const monitor = makeMonitorRow({ userId: 'user-1' })
    const older = makeEvent({ createdAt: new Date(1_000) })
    const newer = makeEvent({ createdAt: new Date(2_000) })

    expect(findFirstMatch(monitor, [older, newer])?.id).toBe(older.id)
  })

  it('returns null when nothing matches', () => {
    const monitor = makeMonitorRow({ userId: 'user-1', eventTypes: ['app.crashed'] })
    expect(findFirstMatch(monitor, [makeEvent()])).toBeNull()
  })
})

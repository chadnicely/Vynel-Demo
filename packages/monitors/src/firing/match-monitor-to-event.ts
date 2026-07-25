// The matcher — does this event wake this monitor? A PURE function over data
// (no db, no clock), so every rule below is pinned by a table test rather than
// inferred from tick behavior.
//
// Three gates, in order of how badly they fail:
//
//   1. TENANT. The event's payload must name the monitor's user. Outbox rows
//      are cross-tenant by design (one table, every domain), so this is the
//      boundary that stops one user's monitor firing on another's event. It
//      fails CLOSED: a payload with no `userId`, or a non-string one, never
//      matches. A monitor that misses an event is a bug; a monitor that reads
//      across tenants is a breach.
//   2. TYPE. Coarse subscription — the event type must be one the monitor
//      named.
//   3. PAYLOAD FILTER. Optional narrowing: every entry must equal the payload's
//      field of the same name. Compared as STRINGS — outbox payloads are JSON
//      with mixed field types (ids are strings, counts numbers), and a filter
//      arrives from a tool call as text. Coercing one way keeps
//      `{ firedCount: '0' }` from silently never matching.
//
// Scope is deliberately NOT a gate. A workspace-scoped monitor may watch a
// global event (a channel message arriving is not workspace-shaped), and the
// owner decides where the wake lands — the monitor's scope says who gets woken,
// not what may be watched. Narrowing by workspace is what `payloadFilter` is
// for, and it stays the caller's explicit choice.

import type { Monitor } from '../repositories/index.js'
import type { WatchableEvent } from '../monitors-types.js'

export function matchesMonitor(monitor: Monitor, event: WatchableEvent): boolean {
  const payloadUserId = event.payload['userId']
  if (typeof payloadUserId !== 'string' || payloadUserId !== monitor.userId) return false

  if (!monitor.eventTypes.includes(event.type)) return false

  const filter = monitor.payloadFilter
  if (filter === null) return true
  return Object.entries(filter).every(([field, expected]) => {
    const actual = event.payload[field]
    if (actual === null || actual === undefined) return false
    return String(actual) === expected
  })
}

/** The first event that wakes this monitor, or null. Events arrive oldest-first
 *  so a `once` monitor fires on the EARLIEST match, not an arbitrary one. */
export function findFirstMatch(
  monitor: Monitor,
  events: readonly WatchableEvent[],
): WatchableEvent | null {
  return events.find((event) => matchesMonitor(monitor, event)) ?? null
}

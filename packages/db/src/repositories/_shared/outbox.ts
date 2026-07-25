// Functional repository for the cross-cutting `outbox_events` table.
// Shipped by `/build-domain workspaces` (first consumer; every future
// event-publishing domain reuses these functions).
// Spec: `docs/blueprints/workspaces/blueprint.md §5.1`.
//
// Phase 1 SYNC return values per the better-sqlite3 transaction contract
// in `.claude/memory/decisions/phase-1-sync-transactions.md`.

import { and, asc, desc, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  outboxEvents,
  type OutboxEventRow,
  type NewOutboxEvent,
} from '../../schema/_shared/outbox-events.js'

export type { OutboxEventRow, NewOutboxEvent } from '../../schema/_shared/outbox-events.js'

export function insertOutboxEvent(db: Database, newEvent: NewOutboxEvent): OutboxEventRow {
  const [inserted] = db.insert(outboxEvents).values(newEvent).returning().all()
  if (!inserted) {
    throw new Error('insertOutboxEvent: no row returned')
  }
  return inserted
}

export function listOutboxEventsByType(
  db: Database,
  type: string,
  options: { limit?: number } = {},
): OutboxEventRow[] {
  const query = db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.type, type))
    .orderBy(asc(outboxEvents.createdAt))
  return options.limit !== undefined ? query.limit(options.limit).all() : query.all()
}

// The generic outbox relay's input: unprocessed events of a REGISTERED type,
// oldest-first. The `types` filter is load-bearing — a real DB holds a
// historical backlog of other domains' published-but-never-relayed events
// (e.g. `memory.*` / `knowledge.*` published-for-future-consumer before any
// relay existed). An unfiltered oldest-first + limit query would starve newer
// `schedule.run-completed` events behind that backlog, or force wrongly
// marking unrelated domains' events processed. Filtering to the registered
// types leaves those events untouched (their accumulation is a pre-existing
// condition, not the relay's to clean up). Added by `/build-domain schedules`
// (the first generic outbox dispatch/relay — jointly owned with channels).
export function listUnprocessedOutboxEvents(
  db: Database,
  input: { types: string[]; limit?: number },
): OutboxEventRow[] {
  if (input.types.length === 0) return []
  const limit = Math.min(input.limit ?? 100, 200)
  return db
    .select()
    .from(outboxEvents)
    .where(and(isNull(outboxEvents.processedAt), inArray(outboxEvents.type, input.types)))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit)
    .all()
}

export function markOutboxEventProcessed(db: Database, id: string): void {
  db.update(outboxEvents).set({ processedAt: new Date() }).where(eq(outboxEvents.id, id)).run()
}

// Recent events of the given types, NEWEST-first — the `monitor` activity feed
// reads its lifecycle signals (agent.run-*, session.swapped/compacted/delegated)
// straight from the outbox (Phase 1: no materialized activity_log; reading the
// outbox directly is the lower-risk cut — the table already holds these events).
// Reads processed + unprocessed alike (the monitor shows the full trail). Keyset
// pagination via the optional `before` cursor on createdAt.
export function listRecentOutboxEventsByTypes(
  db: Database,
  input: { types: string[]; limit?: number; before?: Date },
): OutboxEventRow[] {
  if (input.types.length === 0) return []
  const limit = Math.min(input.limit ?? 50, 200)
  const conditions = [inArray(outboxEvents.type, input.types)]
  if (input.before !== undefined) conditions.push(lt(outboxEvents.createdAt, input.before))
  return db
    .select()
    .from(outboxEvents)
    .where(and(...conditions))
    .orderBy(desc(outboxEvents.createdAt))
    .limit(limit)
    .all()
}

// Events in a HALF-OPEN window, oldest first — the monitors tick's read.
//
// `(after, through]` is deliberate: exclusive low, inclusive high. Each event
// then falls in exactly ONE tick window, so a monitor can neither miss an event
// at a boundary nor see it twice. `listRecentOutboxEventsByTypes` cannot serve
// this — it is newest-first, which would fire a `once` monitor on the LATEST
// match rather than the earliest.
export function listOutboxEventsByTypesInWindow(
  db: Database,
  input: { types: string[]; after: Date; through: Date; limit?: number },
): OutboxEventRow[] {
  if (input.types.length === 0) return []
  const limit = Math.min(input.limit ?? 200, 500)
  return db
    .select()
    .from(outboxEvents)
    .where(
      and(
        inArray(outboxEvents.type, input.types),
        gt(outboxEvents.createdAt, input.after),
        lte(outboxEvents.createdAt, input.through),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
    .limit(limit)
    .all()
}

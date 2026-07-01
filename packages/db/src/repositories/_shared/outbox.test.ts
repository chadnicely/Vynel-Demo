// Repository tests for the cross-cutting `outbox_events` table. Uses the
// LOCAL test-support helper to avoid the `packages/db ↔ packages/testing`
// workspace cycle (per `.claude/rules/structure-standard.md`).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import {
  insertOutboxEvent,
  listOutboxEventsByType,
  listUnprocessedOutboxEvents,
  markOutboxEventProcessed,
  type NewOutboxEvent,
} from './outbox.js'

function makeEvent(overrides: Partial<NewOutboxEvent> = {}): NewOutboxEvent {
  return {
    id: randomUUID(),
    type: 'test.event',
    payload: { hello: 'world' },
    createdAt: new Date(),
    ...overrides,
  }
}

describe('outbox repository', () => {
  it('insertOutboxEvent returns the inserted row with the timestamps preserved', async () => {
    await withTestDatabase((db) => {
      const createdAt = new Date('2026-05-21T22:00:00Z')
      const inserted = insertOutboxEvent(db, makeEvent({ createdAt }))
      expect(inserted.type).toBe('test.event')
      expect(inserted.payload).toEqual({ hello: 'world' })
      expect(inserted.createdAt.getTime()).toBe(createdAt.getTime())
      expect(inserted.processedAt).toBeNull()
    })
  })

  it('insertOutboxEvent throws on .returning() empty (internal-invariant violation)', async () => {
    // The repo throws on a missing returning row. Drizzle + better-sqlite3
    // always returns the inserted row on a valid insert, so we exercise the
    // error path by re-inserting a duplicate PK which causes the underlying
    // insert to throw — separately from the `.returning() empty` branch,
    // which is defense-in-depth.
    await withTestDatabase((db) => {
      const event = makeEvent()
      insertOutboxEvent(db, event)
      expect(() => insertOutboxEvent(db, event)).toThrow()
    })
  })

  it('listOutboxEventsByType returns events matching the type, ordered by createdAt asc', async () => {
    await withTestDatabase((db) => {
      const t0 = new Date('2026-05-21T22:00:00Z')
      const t1 = new Date('2026-05-21T22:01:00Z')
      const t2 = new Date('2026-05-21T22:02:00Z')
      insertOutboxEvent(db, makeEvent({ type: 'workspace.created', createdAt: t2 }))
      insertOutboxEvent(db, makeEvent({ type: 'workspace.created', createdAt: t0 }))
      insertOutboxEvent(db, makeEvent({ type: 'workspace.archived', createdAt: t1 }))

      const created = listOutboxEventsByType(db, 'workspace.created')
      expect(created).toHaveLength(2)
      expect(created[0]!.createdAt.getTime()).toBe(t0.getTime())
      expect(created[1]!.createdAt.getTime()).toBe(t2.getTime())
    })
  })

  it('listOutboxEventsByType respects the optional limit', async () => {
    await withTestDatabase((db) => {
      for (let i = 0; i < 5; i++) {
        insertOutboxEvent(
          db,
          makeEvent({ type: 'workspace.created', createdAt: new Date(2_000_000 + i * 1000) }),
        )
      }
      const limited = listOutboxEventsByType(db, 'workspace.created', { limit: 2 })
      expect(limited).toHaveLength(2)
    })
  })

  it('listOutboxEventsByType returns empty array when no events match', async () => {
    await withTestDatabase((db) => {
      insertOutboxEvent(db, makeEvent({ type: 'workspace.created' }))
      const empty = listOutboxEventsByType(db, 'workspace.deleted')
      expect(empty).toEqual([])
    })
  })

  it('listUnprocessedOutboxEvents returns only unprocessed events of the given types, oldest-first', async () => {
    await withTestDatabase((db) => {
      const t0 = new Date('2026-06-05T08:00:00Z')
      const t1 = new Date('2026-06-05T08:01:00Z')
      const t2 = new Date('2026-06-05T08:02:00Z')
      insertOutboxEvent(db, makeEvent({ type: 'schedule.run-completed', createdAt: t1 }))
      insertOutboxEvent(db, makeEvent({ type: 'schedule.run-completed', createdAt: t0 }))
      // An unregistered-type event (the historical-backlog case) is excluded.
      insertOutboxEvent(db, makeEvent({ type: 'memory.entry-created', createdAt: t2 }))

      const events = listUnprocessedOutboxEvents(db, { types: ['schedule.run-completed'] })
      expect(events).toHaveLength(2)
      expect(events[0]!.createdAt.getTime()).toBe(t0.getTime()) // oldest first
      expect(events.every((event) => event.type === 'schedule.run-completed')).toBe(true)
    })
  })

  it('markOutboxEventProcessed sets processedAt so the event is no longer unprocessed', async () => {
    await withTestDatabase((db) => {
      const event = insertOutboxEvent(db, makeEvent({ type: 'schedule.run-completed' }))
      expect(listUnprocessedOutboxEvents(db, { types: ['schedule.run-completed'] })).toHaveLength(1)
      markOutboxEventProcessed(db, event.id)
      expect(listUnprocessedOutboxEvents(db, { types: ['schedule.run-completed'] })).toHaveLength(0)
    })
  })

  it('listUnprocessedOutboxEvents returns empty for an empty type list', async () => {
    await withTestDatabase((db) => {
      insertOutboxEvent(db, makeEvent({ type: 'schedule.run-completed' }))
      expect(listUnprocessedOutboxEvents(db, { types: [] })).toEqual([])
    })
  })
})

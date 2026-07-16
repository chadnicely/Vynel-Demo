import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertOutboxEvent, listUnprocessedOutboxEvents } from '@vynel/db/repositories/_shared'
import { skipStaleOutboxEvents, STALE_OUTBOX_EVENT_CUTOFF_MS } from './skip-stale-outbox-events.js'

function seedEvent(db: Parameters<typeof insertOutboxEvent>[0], type: string, createdAt: Date) {
  insertOutboxEvent(db, {
    id: randomUUID(),
    type,
    payload: { marker: createdAt.toISOString() },
    createdAt,
    processedAt: null,
  })
}

describe('skipStaleOutboxEvents', () => {
  it('marks stale registered events processed; fresh + unregistered stay', async () => {
    await withTestDatabase(async (db) => {
      const now = new Date()
      const stale = new Date(now.getTime() - STALE_OUTBOX_EVENT_CUTOFF_MS - 60_000)
      const fresh = new Date(now.getTime() - 1_000)
      seedEvent(db, 'ask.created', stale)
      seedEvent(db, 'schedule.run-completed', stale)
      seedEvent(db, 'ask.created', fresh) // the crash-window event — must survive
      seedEvent(db, 'task.created', stale) // unregistered type — not the relay's to touch

      const result = skipStaleOutboxEvents(db, { now: () => now })
      expect(result.skippedCount).toBe(2)

      const remainingRegistered = listUnprocessedOutboxEvents(db, {
        types: ['ask.created', 'schedule.run-completed'],
        limit: 10,
      })
      expect(remainingRegistered).toHaveLength(1) // only the fresh one
      expect(
        listUnprocessedOutboxEvents(db, { types: ['task.created'], limit: 10 }),
      ).toHaveLength(1)
    })
  })

  it('allOfTypes skips a type regardless of age (the ask.created boot rule)', async () => {
    await withTestDatabase(async (db) => {
      const now = new Date()
      const fresh = new Date(now.getTime() - 1_000)
      seedEvent(db, 'ask.created', fresh)
      seedEvent(db, 'schedule.run-completed', fresh)

      const result = skipStaleOutboxEvents(db, { now: () => now, allOfTypes: ['ask.created'] })
      expect(result.skippedCount).toBe(1)
      expect(listUnprocessedOutboxEvents(db, { types: ['ask.created'], limit: 10 })).toHaveLength(0)
      // The fresh crash-window schedule delivery still flows.
      expect(
        listUnprocessedOutboxEvents(db, { types: ['schedule.run-completed'], limit: 10 }),
      ).toHaveLength(1)
    })
  })

  it('drains a backlog larger than one page', async () => {
    await withTestDatabase(async (db) => {
      const now = new Date()
      const stale = new Date(now.getTime() - STALE_OUTBOX_EVENT_CUTOFF_MS - 60_000)
      for (let i = 0; i < 130; i += 1) seedEvent(db, 'ask.created', stale)

      const result = skipStaleOutboxEvents(db, { now: () => now })
      expect(result.skippedCount).toBe(130)
      expect(listUnprocessedOutboxEvents(db, { types: ['ask.created'], limit: 10 })).toHaveLength(0)
    })
  })
})

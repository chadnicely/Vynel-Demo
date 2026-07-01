import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertOutboxEvent, listUnprocessedOutboxEvents } from '@vynel/db/repositories/_shared'
import type { Database } from '@vynel/db'
import { dispatchOutboxEvents } from './dispatch-outbox-events.js'
import type { OutboxConsumer } from './outbox-consumer-registry.js'

function seedEvent(db: Database, type: string): void {
  insertOutboxEvent(db, {
    id: randomUUID(),
    type,
    payload: { n: 1 },
    createdAt: new Date(),
    processedAt: null,
  })
}

describe('dispatchOutboxEvents', () => {
  it('invokes the registered consumer and marks the event processed', async () => {
    await withTestDatabase((db) => {
      const seen: number[] = []
      const registry: Record<string, OutboxConsumer> = {
        'test.event': (_db, payload) => {
          seen.push((payload as { n: number }).n)
        },
      }
      seedEvent(db, 'test.event')

      const result = dispatchOutboxEvents(db, {}, registry)

      expect(result).toEqual({ dispatched: 1, failed: 0 })
      expect(seen).toEqual([1])
      // Marked processed → no longer unprocessed.
      expect(listUnprocessedOutboxEvents(db, { types: ['test.event'] })).toHaveLength(0)
    })
  })

  it('leaves unregistered-type events untouched (no starvation, no wrong-mark)', async () => {
    await withTestDatabase((db) => {
      const registry: Record<string, OutboxConsumer> = { 'test.event': () => {} }
      seedEvent(db, 'memory.entry-created') // a historical-backlog event, unregistered here

      const result = dispatchOutboxEvents(db, {}, registry)

      expect(result).toEqual({ dispatched: 0, failed: 0 })
      expect(listUnprocessedOutboxEvents(db, { types: ['memory.entry-created'] })).toHaveLength(1)
    })
  })

  it('leaves a throwing consumer’s event unprocessed for retry', async () => {
    await withTestDatabase((db) => {
      const registry: Record<string, OutboxConsumer> = {
        'test.event': () => {
          throw new Error('boom')
        },
      }
      seedEvent(db, 'test.event')

      const result = dispatchOutboxEvents(db, {}, registry)

      expect(result).toEqual({ dispatched: 0, failed: 1 })
      // Still unprocessed → the next tick retries it (transient-error recovery).
      expect(listUnprocessedOutboxEvents(db, { types: ['test.event'] })).toHaveLength(1)
    })
  })
})

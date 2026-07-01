// The generic outbox dispatch/relay (Phase 1 home: the apps/worker per-minute
// job). Reads unprocessed events of the REGISTERED types, invokes each
// consumer, and marks the event processed — atomically PER EVENT, so one
// poison event can't roll back the good ones AND a crash between consume + mark
// can't duplicate a side effect (e.g. a channel push). sync (consumers + repos
// are DB-only).
//
// The registry is an injectable default param (a test seam, NOT an event bus):
// production passes nothing (the real minimal registry); tests inject a fake
// registry to exercise the relay's OWN three behaviors without seeding a real
// channel.
//
// KNOWN LIMITATION (Phase 1 — flag, don't build): a persistently-throwing
// consumer retries every minute forever (log-spam). Acceptable now because the
// only consumer (`consumeScheduleRunCompletedEvent`) DROPS QUIETLY on a
// missing/disabled channel rather than throwing — so a real throw is a
// transient DB error where retry IS correct. A max-attempts / dead-letter is
// the eventual fix (foundation-hardening).
//
// Spec: `docs/blueprints/schedules/blueprint.md §8` + decisions D15.

import { withTransaction } from '@vynel/db'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { OUTBOX_CONSUMERS, type OutboxConsumer } from './outbox-consumer-registry.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'

const DISPATCH_BATCH_LIMIT = 100

export function dispatchOutboxEvents(
  db: Database,
  deps: { logger?: StructuralLogger } = {},
  registry: Record<string, OutboxConsumer> = OUTBOX_CONSUMERS,
): { dispatched: number; failed: number } {
  const types = Object.keys(registry)
  const events = outboxRepository.listUnprocessedOutboxEvents(db, {
    types,
    limit: DISPATCH_BATCH_LIMIT,
  })

  let dispatched = 0
  let failed = 0
  for (const event of events) {
    const consumer = registry[event.type]
    if (!consumer) continue // defensive — the query already filtered to `types`
    try {
      // consume + mark co-commit so a crash between them can't duplicate the
      // consumer's side effect on the next tick.
      withTransaction(db, (tx) => {
        consumer(tx, event.payload)
        outboxRepository.markOutboxEventProcessed(tx, event.id)
      })
      dispatched++
    } catch (err) {
      failed++
      // Left unprocessed → retried next tick (transient-error recovery).
      deps.logger?.error(
        {
          error: err instanceof Error ? err.message : String(err),
          eventId: event.id,
          type: event.type,
        },
        'outbox dispatch failed',
      )
    }
  }
  return { dispatched, failed }
}

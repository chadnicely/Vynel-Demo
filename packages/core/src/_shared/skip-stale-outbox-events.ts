// One-time boot pass for the outbox relay: mark REGISTERED-type events older
// than the cutoff as processed WITHOUT consuming them.
//
// WHY: the relay shipped LONG after producers started publishing — dev DBs
// hold months of unprocessed `schedule.run-completed` rows whose channel
// deliveries are ancient history (and `ask.created` rows whose asks boot
// recovery already expired). Consuming those on the relay's first boot would
// flood the user's Telegram with stale messages. The cutoff is AGE-bounded,
// not blanket, so the outbox's reliability property survives: an event
// published just before a crash still delivers on the next boot.

import { withTransaction } from '@vynel/db'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { OUTBOX_CONSUMERS } from './outbox-consumer-registry.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'

// Generous crash-recovery window; anything older is history, not backlog.
export const STALE_OUTBOX_EVENT_CUTOFF_MS = 10 * 60 * 1000

const SKIP_BATCH_LIMIT = 100

export function skipStaleOutboxEvents(
  db: Database,
  deps: {
    logger?: StructuralLogger
    now?: () => Date
    /** Types skipped REGARDLESS of age — for events whose subject cannot
     *  survive a restart (an `ask.created` nudge after boot always points at
     *  an ask that boot recovery just expired). */
    allOfTypes?: readonly string[]
  } = {},
  registry: Record<string, unknown> = OUTBOX_CONSUMERS,
): { skippedCount: number } {
  const cutoff = new Date(
    (deps.now ?? (() => new Date()))().getTime() - STALE_OUTBOX_EVENT_CUTOFF_MS,
  )
  const types = Object.keys(registry)
  const skipAllTypes = new Set(deps.allOfTypes ?? [])

  let skippedCount = 0
  // Batch until no stale rows remain — a months-old backlog can exceed one page.
  for (;;) {
    const events = outboxRepository
      .listUnprocessedOutboxEvents(db, { types, limit: SKIP_BATCH_LIMIT })
      .filter(
        (event) =>
          skipAllTypes.has(event.type) || event.createdAt.getTime() < cutoff.getTime(),
      )
    if (events.length === 0) break
    withTransaction(db, (tx) => {
      for (const event of events) outboxRepository.markOutboxEventProcessed(tx, event.id)
    })
    skippedCount += events.length
    // A full page of stale rows may hide more behind the limit; a page with
    // any FRESH rows means everything older was just handled — done either way
    // once a fetch yields no stale rows.
  }

  if (skippedCount > 0) {
    deps.logger?.info({ skippedCount }, 'outbox relay: stale pre-relay events skipped undelivered')
  }
  return { skippedCount }
}

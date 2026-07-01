// The generic outbox-event consumer registry — the minimal seam mapping a
// published event TYPE to the core consumer that reacts to it. A plain map, NOT
// an event bus. Consumers register here as their domains land.
//
// Empty in the knowledge-slice pull: the first consumer
// (`schedule.run-completed` → channels) returns when channels + schedules are
// pulled. Spec: `docs/blueprints/schedules/blueprint.md §8` + decisions D15.

import type { Database } from '@vynel/db'
import type { OutboxEventRow } from '@vynel/db/repositories/_shared'

// A consumer reacts to one event type's payload. Sync (Phase 1 consumers are
// DB-only). It receives the opaque payload + narrows it at its own boundary.
export type OutboxConsumer = (db: Database, payload: OutboxEventRow['payload']) => void

export const OUTBOX_CONSUMERS: Record<string, OutboxConsumer> = {}

// The generic outbox-event consumer registry — the minimal seam mapping a
// published event TYPE to the core consumer that reacts to it. A plain map, NOT
// an event bus. Consumers register here as their domains land; the api's
// outbox-relay service drives `dispatchOutboxEvents` over this map.
//
// Event-type keys are LITERAL strings, not imported constants — the loose
// cross-domain contract (each consumer re-declares the payload shape it reads;
// core stays off the producer leaf's dependency list). Core is the SPINE, so
// composing the channels leaf here is the intended direction.
//
// Spec: `docs/blueprints/schedules/blueprint.md §8` + decisions D15.

import { consumeAskCreatedEvent, consumeScheduleRunCompletedEvent } from '@vynel/channels'
import type { AskCreatedPayload, ScheduleRunCompletedPayload } from '@vynel/channels'
import { consumeScheduleRunFailedEvent, consumeTaskCreatedEvent } from '@vynel/orchestration'
import type { ScheduleRunFailedPayload, TaskCreatedPayload } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import type { OutboxEventRow } from '@vynel/db/repositories/_shared'

// A consumer reacts to one event type's payload. Sync (Phase 1 consumers are
// DB-only). It receives the opaque payload + narrows it at its own boundary.
export type OutboxConsumer = (db: Database, payload: OutboxEventRow['payload']) => void

export const OUTBOX_CONSUMERS: Record<string, OutboxConsumer> = {
  // A fired schedule destined for a channel → enqueue the rendered output
  // (the schedules ↔ channels §9 contract; dormant until the relay wiring).
  // The opaque payload narrows through `unknown` at this boundary — the
  // consumer's re-declared shape IS the loose contract.
  'schedule.run-completed': (db, payload) =>
    consumeScheduleRunCompletedEvent(db, payload as unknown as ScheduleRunCompletedPayload),
  // A pending ask_user form → nudge the user's channel ("Claude needs your
  // input"); the answer stays in-app.
  'ask.created': (db, payload) =>
    consumeAskCreatedEvent(db, payload as unknown as AskCreatedPayload),
  // A FAILED schedule run → a global-root report delivery, so the failure
  // reaches the user's chat instead of dying on a run row with no UI.
  'schedule.run-failed': (db, payload) =>
    consumeScheduleRunFailedEvent(db, payload as unknown as ScheduleRunFailedPayload),
  // A USER-created task → the pickup nudge on the scope's primary
  // conversation (assistant-created tasks return without enqueueing).
  'task.created': (db, payload) =>
    consumeTaskCreatedEvent(db, payload as unknown as TaskCreatedPayload),
}

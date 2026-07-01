// The `outbox_events` table — cross-cutting infrastructure shipped by
// the `workspaces` domain (first consumer; every future event-publishing
// domain consumes the same infra; do NOT redefine per-domain).
// Spec: `docs/blueprints/workspaces/blueprint.md §3.2`.
//
// Phase 1 SYNC discipline applies — see
// `.claude/memory/decisions/phase-1-sync-transactions.md`.

import { table, id, text, timestamp, json, index } from '@vynel/db/dialect'

// Multi-tenant across domains — per-event-type payload narrowing happens
// in the consumer (cast against the per-domain payload type). The table
// itself treats payload as opaque.
export type OutboxEventPayload = Record<string, unknown>

export const outboxEvents = table(
  'outbox_events',
  {
    id: id().primaryKey(),
    type: text().notNull(),
    payload: json<OutboxEventPayload>().notNull(),
    createdAt: timestamp().notNull(),
    processedAt: timestamp(),
  },
  (t) => ({
    typeIdx: index('idx_outbox_events_type').on(t.type),
    createdAtIdx: index('idx_outbox_events_created_at').on(t.createdAt),
  }),
)

export type OutboxEventRow = typeof outboxEvents.$inferSelect
export type NewOutboxEvent = typeof outboxEvents.$inferInsert

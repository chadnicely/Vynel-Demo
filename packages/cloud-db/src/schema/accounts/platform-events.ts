// Dedup log for platform webhook deliveries. The platform retries (at-least-
// once); a captured delivery could also be replayed inside the 5-minute HMAC
// window. Recording each event id (unique) makes application exactly-once:
// a second delivery of the same id is acknowledged without re-applying.

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const platformEvents = pgTable('platform_events', {
  // The platform's own event id — the idempotency key.
  eventId: text().primaryKey(),
  type: text().notNull(),
  platformUserId: text().notNull(),
  processedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export type PlatformEventRow = typeof platformEvents.$inferSelect

// Marketplace publishers. v1 seeds ONE row (Vynel Team, verified) — the
// table exists so community publishing later is a data change, not a schema
// change (vision §8: curation is the value, no free-for-all yet).

import { pgTable, text } from 'drizzle-orm/pg-core'

export const publishers = pgTable('publishers', {
  id: text().primaryKey(),
  name: text().notNull(),
  // 'verified' | 'community' — app-enforced union.
  tier: text().notNull().default('verified'),
  url: text(),
})

export type PublisherRow = typeof publishers.$inferSelect

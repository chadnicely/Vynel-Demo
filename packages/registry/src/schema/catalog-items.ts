// A marketplace catalog item — kind-agnostic (skill | agent | mcp | rule |
// plugin). One row per installable thing; its downloadable content lives in
// `item_versions`. `minimumTier` gates installation (checked against the
// caller's FRESH tier on the download route, never a stale token claim).

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { publishers } from './publishers.js'

export const catalogItems = pgTable('catalog_items', {
  // Kebab-case, globally unique (e.g. 'email-drafter').
  itemId: text().primaryKey(),
  // 'skill' | 'agent' | 'mcp' | 'rule' | 'plugin' — app-enforced union.
  kind: text().notNull(),
  publisherId: text()
    .notNull()
    .references(() => publishers.id),
  displayName: text().notNull(),
  oneLineDescription: text().notNull(),
  category: text().notNull(),
  iconName: text().notNull(),
  // 'user' | 'workspace' | null — some kinds have no install scope.
  recommendedScope: text(),
  // Upstream origin of the item's content (the credit line's Source link) —
  // e.g. the pinned anthropics/skills folder. Null = first-party.
  sourceUrl: text(),
  // 'basic' | 'pro' — which access tier may install (default basic = anyone).
  minimumTier: text().notNull().default('basic'),
  // 'draft' | 'published' | 'yanked' — only 'published' surfaces in browse.
  status: text().notNull().default('draft'),
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export type CatalogItemRow = typeof catalogItems.$inferSelect

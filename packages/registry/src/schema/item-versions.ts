// A published version of a catalog item — the downloadable content's
// integrity + provenance record. The artifact BYTES live in the hub's
// ArtifactStore (keyed by itemId + version); this row carries the sha256 the
// desktop verifies against, plus the manifest describing how to install it.

import { pgTable, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items.js'

export const itemVersions = pgTable(
  'item_versions',
  {
    id: text().primaryKey(),
    itemId: text()
      .notNull()
      .references(() => catalogItems.itemId),
    // Semver.
    version: text().notNull(),
    changelog: text().notNull().default(''),
    // JSON: per-kind install manifest (entry file, declared tools,
    // permissions). Validated at publish; opaque to the registry otherwise.
    manifestJson: text().notNull(),
    // Hex sha256 of the stored artifact bytes.
    artifactSha256: text().notNull(),
    artifactSize: integer().notNull(),
    // Stored, NOT enforced until D2 stamps real app versions.
    minAppVersion: text(),
    releasedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('item_versions_item_version_unique').on(table.itemId, table.version),
    index('item_versions_item_id_idx').on(table.itemId),
  ],
)

export type ItemVersionRow = typeof itemVersions.$inferSelect

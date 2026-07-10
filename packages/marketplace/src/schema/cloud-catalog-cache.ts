// Local cache of the hub's cloud catalog. A daemon sync job replaces these
// rows from GET /catalog so the marketplace merges + browses SYNCHRONOUSLY
// and works offline (cloud-api.md §5 desktop integration). Marketplace owned
// no tables under D1 (the catalog was bundled-in-code) — the cloud catalog
// RETIRES that premise; this table is the deliberate supersede.
//
// Tier-NEUTRAL by design: we cache the hub's item (incl. `minimumTier` + the
// latest version's sha), NEVER a per-caller `canInstall` — that's computed
// client-side for display, and the real install gate stays server-side
// fail-closed at download.

import { table, text, timestamp } from '@vynel/db/dialect'

export const marketplaceCloudCatalog = table('marketplace_cloud_catalog', {
  itemId: text().primaryKey(),
  kind: text().notNull(),
  publisherName: text().notNull(),
  publisherTier: text().notNull(),
  publisherUrl: text(),
  displayName: text().notNull(),
  oneLineDescription: text().notNull(),
  category: text().notNull(),
  iconName: text().notNull(),
  recommendedScope: text(),
  minimumTier: text().notNull(),
  latestVersion: text().notNull(),
  latestVersionSha256: text().notNull(),
  // ISO string, straight from the hub DTO.
  releasedAt: text().notNull(),
  syncedAt: timestamp().notNull(),
})

export type MarketplaceCloudCatalogRow = typeof marketplaceCloudCatalog.$inferSelect

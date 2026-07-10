// Functional cache repository — `db` first arg, stateless, SYNC (better-
// sqlite3), so the merge in `listMarketplaceItems` stays synchronous.

import { eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  marketplaceCloudCatalog,
  type MarketplaceCloudCatalogRow,
} from '../schema/cloud-catalog-cache.js'

export type InsertCloudCatalogRow = MarketplaceCloudCatalogRow

/** Replace the whole cache with a fresh snapshot — the catalog is small and
 * curated; a full swap is simpler than a diff and can't leave stale rows. */
export function replaceCloudCatalog(db: Database, rows: InsertCloudCatalogRow[]): void {
  db.transaction((tx) => {
    tx.delete(marketplaceCloudCatalog).run()
    if (rows.length > 0) tx.insert(marketplaceCloudCatalog).values(rows).run()
  })
}

export function listCloudCatalog(db: Database): MarketplaceCloudCatalogRow[] {
  return db.select().from(marketplaceCloudCatalog).all()
}

/** One cached cloud item by id — the install route reads the latest version +
 * its sha256 (the integrity anchor) here. Null = not a cloud item (bundled). */
export function findCachedCloudItem(
  db: Database,
  itemId: string,
): MarketplaceCloudCatalogRow | null {
  return (
    db
      .select()
      .from(marketplaceCloudCatalog)
      .where(eq(marketplaceCloudCatalog.itemId, itemId))
      .get() ?? null
  )
}

export function clearCloudCatalog(db: Database): void {
  db.delete(marketplaceCloudCatalog).run()
}

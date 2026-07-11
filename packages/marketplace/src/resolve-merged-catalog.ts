// The merge site (replaces the bundled-only `resolveCatalogSources()` at the
// two read callers): bundled catalog ∪ cached cloud catalog, deduped by
// itemId with CLOUD WINS. Cloud is the evolving source the bundled catalog
// always stood in for (v1 cloud = Vynel-Team-only, so no trust gap); dedup
// also removes the annotate-by-skillId ambiguity a duplicate would cause
// (e.g. email-drafter, which ships bundled AND was seeded to the cloud).

import { resolveCatalogSources } from '@vynel/contracts/marketplace/resolve-catalog-sources'
import type { Database } from '@vynel/db'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import { listCloudCatalog } from './repositories/cloud-catalog-cache-repository.js'
import { cloudRowToMarketplaceItem } from './cloud-catalog-mapper.js'

export function resolveMergedCatalog(db: Database): MarketplaceItem[] {
  const byId = new Map<string, MarketplaceItem>()
  for (const item of resolveCatalogSources()) byId.set(item.itemId, item)
  for (const row of listCloudCatalog(db)) {
    // Only INSTALLABLE kinds surface — honest UI over dead Get buttons:
    // `rule` waits for the instructions-notebook leaf (its install
    // target), `mcp` needs two open calls (which leaf owns a standalone
    // MCP install; whether it cards), `plugin` has no desktop semantics
    // yet. See docs/module-notes/marketplace-kinds.md "Deferred".
    if (row.kind !== 'skill' && row.kind !== 'agent') continue
    byId.set(row.itemId, cloudRowToMarketplaceItem(row)) // cloud wins
  }
  return [...byId.values()]
}

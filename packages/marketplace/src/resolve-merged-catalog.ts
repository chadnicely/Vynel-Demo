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
    // `rule` still waits for its slice (Arc 3). `plugin` installs via the
    // Claude CLI delegate; `mcp` installs by writing the scope's Claude
    // MCP config (config-is-truth, 2026-08-02) — each surfaces only with
    // a parsable manifest, or its Get button would be dead.
    if (
      row.kind !== 'skill' &&
      row.kind !== 'agent' &&
      row.kind !== 'plugin' &&
      row.kind !== 'mcp'
    )
      continue
    const item = cloudRowToMarketplaceItem(row)
    if (row.kind === 'plugin' && item.pluginKey === undefined) continue
    if (row.kind === 'mcp' && item.mcpServerName === undefined) continue
    byId.set(row.itemId, item) // cloud wins
  }
  return [...byId.values()]
}

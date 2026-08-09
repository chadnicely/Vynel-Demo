// The merge site (replaces the bundled-only `resolveCatalogSources()` at the
// two read callers): bundled catalog ∪ cached cloud catalog, deduped by
// itemId with CLOUD WINS. Cloud is the evolving source the bundled catalog
// always stood in for (v1 cloud = Vynel-Team-only, so no trust gap); dedup
// also removes the annotate-by-skillId ambiguity a duplicate would cause
// (e.g. email-drafter, which ships bundled AND was seeded to the cloud).

import { resolveCatalogSources } from '@vynel/contracts/marketplace/resolve-catalog-sources'
import { parseRuleItemManifest } from '@vynel/contracts/marketplace/rule-item-manifest'
import type { Database } from '@vynel/db'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import { listCloudCatalog } from './repositories/cloud-catalog-cache-repository.js'
import { cloudRowToMarketplaceItem } from './cloud-catalog-mapper.js'

export function resolveMergedCatalog(
  db: Database,
  // Rows from user-registered Claude-native marketplaces (already mapped)
  // — appended, never overriding: their `<plugin>@<marketplace>` ids can't
  // collide with kebab catalog ids, and the guard below keeps that fact
  // load-bearing rather than assumed.
  claudeMarketplaceRows: readonly MarketplaceItem[] = [],
): MarketplaceItem[] {
  const byId = new Map<string, MarketplaceItem>()
  for (const item of resolveCatalogSources()) byId.set(item.itemId, item)
  for (const row of listCloudCatalog(db)) {
    // Every hub kind installs now, but each manifest-carried kind surfaces
    // only with a PARSABLE manifest, or its Get button would be dead:
    // `plugin` delegates to the Claude CLI; `mcp` writes the scope's
    // Claude MCP config; `rule` writes `.claude/rules/<id>.md`
    // (config-is-truth, 2026-08-02). An unknown future kind stays off.
    if (
      row.kind !== 'skill' &&
      row.kind !== 'agent' &&
      row.kind !== 'plugin' &&
      row.kind !== 'mcp' &&
      row.kind !== 'rule'
    )
      continue
    const item = cloudRowToMarketplaceItem(row)
    if (row.kind === 'plugin' && item.pluginKey === undefined) continue
    if (row.kind === 'mcp' && item.mcpServerName === undefined) continue
    if (row.kind === 'rule' && parseRuleItemManifest(row.latestVersionManifestJson) === null)
      continue
    byId.set(row.itemId, item) // cloud wins
  }
  for (const item of claudeMarketplaceRows) {
    if (!byId.has(item.itemId)) byId.set(item.itemId, item)
  }
  return [...byId.values()]
}

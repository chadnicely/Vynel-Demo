// Public surface of `@vynel/marketplace` — the marketplace leaf. Uses the
// generic VynelError taxonomy strictly (D10) and publishes no outbox events
// (D10). It now OWNS one table — `marketplace_cloud_catalog`, the local cache
// of the hub's cloud catalog (M4b) — a deliberate supersede of D1
// ("marketplace owns no tables"), which held only while the catalog was
// bundled-in-code. `marketplace-types.ts` remains the cross-leaf injection
// seam (install status is derived from the caller's installed skills, which
// the `skills` leaf owns).

export type {
  MarketplaceItem,
  MarketplaceItemInstallStatus,
  PublisherTier,
  MarketplaceSortKey,
  MarketplaceFilterInput,
  ListMarketplaceItemsInput,
} from '@vynel/contracts/marketplace/marketplace-item'

export type { InstalledSkillView, MarketplaceDeps } from './marketplace-types.js'

export { annotateWithInstallStatus, type AnnotateInput } from './annotate-with-install-status.js'

export { filterAndSortMarketplaceItems } from './filter-marketplace-items.js'

export { listMarketplaceItems } from './list-marketplace-items.js'

export { getMarketplaceItem, type GetMarketplaceItemInput } from './get-marketplace-item.js'

export { syncCloudCatalog, clearCachedCloudCatalog } from './sync-cloud-catalog.js'

export { resolveMergedCatalog } from './resolve-merged-catalog.js'

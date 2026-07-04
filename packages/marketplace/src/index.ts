// Public surface of `@vynel/marketplace` — the marketplace leaf. The
// domain owns no tables (D1), uses the generic VynelError taxonomy
// strictly (D10), and publishes no outbox events (D10) — so there are
// no `marketplace-errors.ts` / `marketplace-events.ts` files. The one
// local type file, `marketplace-types.ts`, exists only for the
// cross-leaf injection seam (install status is derived from the
// caller's installed skills, which the `skills` leaf owns).

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

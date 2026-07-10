// Top-level marketplace browse: resolve the catalog, read the
// caller's installed skills (user-scope ∪ workspace-scope for this
// workspace) via the injected reader, annotate, filter+sort.
// **Sync** — Phase-1 sync-transactions discipline applies; the one
// injected read returns `T` (not `Promise<T>`), and the rest of the
// pipeline is in-memory. Caller can still `await` harmlessly.
//
// The installed-skills read is INJECTED (`deps.listInstalledSkills`)
// so this leaf never imports the `skills` sibling leaf (invariant #2).
//
// Spec: blueprint §5.3 + coding.md §6.2.

import { resolveMergedCatalog } from './resolve-merged-catalog.js'
import type { Database } from '@vynel/db'
import type {
  ListMarketplaceItemsInput,
  MarketplaceFilterInput,
  MarketplaceItem,
} from '@vynel/contracts/marketplace/marketplace-item'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import { filterAndSortMarketplaceItems } from './filter-marketplace-items.js'
import type { MarketplaceDeps } from './marketplace-types.js'

export function listMarketplaceItems(
  db: Database,
  input: ListMarketplaceItemsInput,
  deps: MarketplaceDeps,
): MarketplaceItem[] {
  const catalogItems = resolveMergedCatalog(db)
  const installedSkills = deps.listInstalledSkills(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  const annotated = annotateWithInstallStatus({ catalogItems, installedSkills })

  // Build the filter input conditionally — `exactOptionalPropertyTypes`
  // foot-gun: spreading `{x: input.x}` when `x?: T` produces
  // `{x: undefined}` which TS rejects against the optional-only shape.
  const filterInput: MarketplaceFilterInput = { items: annotated }
  if (input.category !== undefined) filterInput.category = input.category
  if (input.publisherTier !== undefined) filterInput.publisherTier = input.publisherTier
  if (input.installState !== undefined) filterInput.installState = input.installState
  if (input.searchQuery !== undefined) filterInput.searchQuery = input.searchQuery
  if (input.sortBy !== undefined) filterInput.sortBy = input.sortBy
  return filterAndSortMarketplaceItems(filterInput)
}

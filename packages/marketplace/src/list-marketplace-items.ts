// Top-level marketplace browse: resolve the catalog, keep the items the
// requested SURFACE lists (global = user+both, workspace = workspace+both),
// read the caller's installed rows via the injected readers, annotate,
// filter+sort. The WORKSPACE surface annotates against user-scope ∪ that
// workspace's rows (D12 preference intact); the GLOBAL surface annotates
// against USER-scoped installs only (`workspaceId: null` to the readers).
// **Sync** — Phase-1 sync-transactions discipline applies; the injected
// reads return `T` (not `Promise<T>`), and the rest of the pipeline is
// in-memory. Caller can still `await` harmlessly.
//
// The installed-rows reads are INJECTED (`MarketplaceDeps`) so this leaf
// never imports the `skills`/`agents` sibling leaves (invariant #2).
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
import { isItemVisibleOnSurface } from './surface-visibility.js'
import type { MarketplaceDeps } from './marketplace-types.js'

export function listMarketplaceItems(
  db: Database,
  input: ListMarketplaceItemsInput,
  deps: MarketplaceDeps,
): MarketplaceItem[] {
  const catalogItems = resolveMergedCatalog(db).filter((item) =>
    isItemVisibleOnSurface(item, input.surface),
  )
  const owner = {
    userId: input.userId,
    workspaceId: input.surface === 'workspace' ? input.workspaceId : null,
  }
  const annotated = annotateWithInstallStatus({
    catalogItems,
    installedSkills: deps.listInstalledSkills(db, owner),
    installedAgents: deps.listInstalledAgents(db, owner),
    installedPlugins: deps.listInstalledPlugins(),
  })

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

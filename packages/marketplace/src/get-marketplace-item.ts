// Look up one marketplace item by itemId ON a surface. Throws
// `NotFoundError('marketplace-item', itemId)` when no catalog entry
// matches — including when the entry exists in
// `VERIFIED_SKILL_CATALOG` but is hidden by `resolveCatalogSources`
// (D4: `isSystemInstalled === true`), and when the entry exists but
// does not SURFACE here (a workspace-only item asked for globally, or
// vice versa). No enumeration leak — the same 404 for "unknown id",
// "hidden id", and "off-surface id."
//
// Annotation mirrors the list read: the workspace surface joins
// user-scope ∪ that workspace's rows (D12), the global surface joins
// USER-scoped rows only. Readers are INJECTED (invariant #2).
//
// Spec: blueprint §5.4 + coding.md §6.3.

import { NotFoundError } from '@vynel/errors'
import { resolveMergedCatalog } from './resolve-merged-catalog.js'
import type { Database } from '@vynel/db'
import type {
  MarketplaceItem,
  MarketplaceSurfaceSelector,
} from '@vynel/contracts/marketplace/marketplace-item'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import { isItemVisibleOnSurface } from './surface-visibility.js'
import type { MarketplaceDeps } from './marketplace-types.js'

export type GetMarketplaceItemInput = {
  itemId: string
  userId: string
} & MarketplaceSurfaceSelector

export function getMarketplaceItem(
  db: Database,
  input: GetMarketplaceItemInput,
  deps: MarketplaceDeps,
): MarketplaceItem {
  const catalogItems = resolveMergedCatalog(db)
  const item = catalogItems.find((i) => i.itemId === input.itemId)
  if (!item || !isItemVisibleOnSurface(item, input.surface)) {
    throw new NotFoundError('marketplace-item', input.itemId)
  }

  const owner = {
    userId: input.userId,
    workspaceId: input.surface === 'workspace' ? input.workspaceId : null,
  }
  const [annotated] = annotateWithInstallStatus({
    catalogItems: [item],
    installedSkills: deps.listInstalledSkills(db, owner),
    installedAgents: deps.listInstalledAgents(db, owner),
  })
  return annotated!
}

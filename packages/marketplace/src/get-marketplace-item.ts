// Look up one marketplace item by itemId. Throws
// `NotFoundError('marketplace-item', itemId)` when no catalog entry
// matches — including when the entry exists in
// `VERIFIED_SKILL_CATALOG` but is hidden by `resolveCatalogSources`
// (D4: `isSystemInstalled === true`). No enumeration leak — same
// 404 for "unknown id" and "hidden id."
//
// The installed-skills read is INJECTED (`deps.listInstalledSkills`)
// so this leaf never imports the `skills` sibling leaf (invariant #2).
//
// Spec: blueprint §5.4 + coding.md §6.3.

import { NotFoundError } from '@vynel/errors'
import { resolveMergedCatalog } from './resolve-merged-catalog.js'
import type { Database } from '@vynel/db'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import type { MarketplaceDeps } from './marketplace-types.js'

export type GetMarketplaceItemInput = {
  itemId: string
  userId: string
  workspaceId: string
}

export function getMarketplaceItem(
  db: Database,
  input: GetMarketplaceItemInput,
  deps: MarketplaceDeps,
): MarketplaceItem {
  const catalogItems = resolveMergedCatalog(db)
  const item = catalogItems.find((i) => i.itemId === input.itemId)
  if (!item) throw new NotFoundError('marketplace-item', input.itemId)

  const owner = { userId: input.userId, workspaceId: input.workspaceId }
  const [annotated] = annotateWithInstallStatus({
    catalogItems: [item],
    installedSkills: deps.listInstalledSkills(db, owner),
    installedAgents: deps.listInstalledAgents(db, owner),
  })
  return annotated!
}

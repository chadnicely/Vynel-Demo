// Browse: every PUBLISHED item that has at least one version, mapped to the
// wire DTO and annotated with the caller's install eligibility. Browse is
// generous (fail-open) — an item the caller can't install is still shown with
// canInstall:false; the download route is the fail-closed gate.

import type { CloudDatabase } from '@vynel/cloud-db'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import {
  findLatestVersionForItem,
  listPublishedItemsWithPublisher,
} from './repositories/catalog-repository.js'
import { toHubCatalogItem } from './registry-mappers.js'

export async function listCatalog(
  db: CloudDatabase,
  input: { readonly callerTier: HubTier },
): Promise<HubCatalogItem[]> {
  const joined = await listPublishedItemsWithPublisher(db)
  const items: HubCatalogItem[] = []
  for (const row of joined) {
    const latest = await findLatestVersionForItem(db, row.item.itemId)
    // A published item with no version yet is not installable — skip it.
    if (latest === null) continue
    items.push(toHubCatalogItem(row, latest, input.callerTier))
  }
  return items
}

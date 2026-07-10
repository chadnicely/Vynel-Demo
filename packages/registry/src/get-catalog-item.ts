// Item detail: the item + all its versions (newest first). Throws NotFound
// for an unknown or unpublished item — detail is a published-catalog read.

import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { HubCatalogItemDetail } from '@vynel/contracts/hub/catalog'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import {
  findItemWithPublisher,
  findLatestVersionForItem,
  listVersionsForItem,
} from './repositories/catalog-repository.js'
import { toHubCatalogItem, toHubCatalogVersion } from './registry-mappers.js'

export async function getCatalogItemDetail(
  db: CloudDatabase,
  input: { readonly itemId: string; readonly callerTier: HubTier },
): Promise<HubCatalogItemDetail> {
  const joined = await findItemWithPublisher(db, input.itemId)
  if (joined === null || joined.item.status !== 'published') {
    throw new NotFoundError('catalog item', input.itemId)
  }
  const latest = await findLatestVersionForItem(db, input.itemId)
  if (latest === null) throw new NotFoundError('catalog item version', input.itemId)
  const versions = await listVersionsForItem(db, input.itemId)
  return {
    ...toHubCatalogItem(joined, latest, input.callerTier),
    versions: versions.map(toHubCatalogVersion),
  }
}

// Apply a freshly-fetched hub catalog to the local cache (daemon sync job).
// Full-swap: the curated catalog is small and a replace can't leave stale
// rows. `clearCachedCloudCatalog` is the sign-out / hub-gone path.

import type { Database } from '@vynel/db'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import {
  clearCloudCatalog,
  replaceCloudCatalog,
} from './repositories/cloud-catalog-cache-repository.js'

export function syncCloudCatalog(
  db: Database,
  items: readonly HubCatalogItem[],
  now: Date,
): void {
  replaceCloudCatalog(
    db,
    items.map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      publisherName: item.publisherName,
      publisherTier: item.publisherTier,
      publisherUrl: item.publisherUrl,
      displayName: item.displayName,
      oneLineDescription: item.oneLineDescription,
      category: item.category,
      iconName: item.iconName,
      recommendedScope: item.recommendedScope,
      sourceUrl: item.sourceUrl,
      minimumTier: item.minimumTier,
      latestVersion: item.latestVersion,
      latestVersionManifestJson: item.latestVersionManifestJson,
      latestVersionSha256: item.latestVersionSha256,
      releasedAt: item.releasedAt,
      syncedAt: now,
    })),
  )
}

export function clearCachedCloudCatalog(db: Database): void {
  clearCloudCatalog(db)
}

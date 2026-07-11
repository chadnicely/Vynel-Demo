// Row → wire-DTO mappers. `canInstall` is annotated from the caller's tier
// here so the single `tierMeetsMinimum` rule (contracts) drives both browse
// and the download gate.

import { tierMeetsMinimum, type HubCatalogItem, type HubCatalogVersion } from '@vynel/contracts/hub/catalog'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import type { CatalogItemWithPublisher } from './repositories/catalog-repository.js'
import type { ItemVersionRow } from './schema/item-versions.js'

export function normalizeTier(raw: string): HubTier {
  return raw === 'pro' ? 'pro' : 'basic'
}

export function toHubCatalogVersion(row: ItemVersionRow): HubCatalogVersion {
  return {
    version: row.version,
    changelog: row.changelog,
    artifactSha256: row.artifactSha256,
    artifactSize: row.artifactSize,
    minAppVersion: row.minAppVersion,
    releasedAt: row.releasedAt.toISOString(),
  }
}

export function toHubCatalogItem(
  joined: CatalogItemWithPublisher,
  latest: ItemVersionRow,
  callerTier: HubTier,
): HubCatalogItem {
  const { item, publisher } = joined
  const minimumTier = normalizeTier(item.minimumTier)
  return {
    itemId: item.itemId,
    kind: item.kind as HubCatalogItem['kind'],
    publisherName: publisher.name,
    publisherTier: publisher.tier === 'community' ? 'community' : 'verified',
    publisherUrl: publisher.url,
    displayName: item.displayName,
    oneLineDescription: item.oneLineDescription,
    category: item.category,
    iconName: item.iconName,
    recommendedScope: item.recommendedScope,
    minimumTier,
    latestVersion: latest.version,
    latestVersionSha256: latest.artifactSha256,
    releasedAt: latest.releasedAt.toISOString(),
    canInstall: tierMeetsMinimum(callerTier, minimumTier),
  }
}

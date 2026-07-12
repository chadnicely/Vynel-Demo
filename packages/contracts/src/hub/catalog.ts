// Wire types for the hub's marketplace REGISTRY (apps/cloud-api /catalog/*) —
// shared by the hub's routes and (in M4b) the desktop's sync client. Kept
// deliberately SEPARATE from `@vynel/contracts/marketplace`'s
// `MarketplaceItem`: that type is skill-shaped (skillId, SkillCategory,
// SkillScope); the registry is kind-agnostic. Merging a cloud item into the
// marketplace UI is M4b's problem — the hub speaks its own DTO.
// Consumers import the file directly (`@vynel/contracts/hub/catalog`).

import type { HubTier } from './entitlements.js'

export type HubItemKind = 'skill' | 'agent' | 'mcp' | 'rule' | 'plugin'
export type HubItemStatus = 'draft' | 'published' | 'yanked'
export type HubPublisherTier = 'verified' | 'community'
/** Where the item is meant to live once installed — 'both' means it fits
 * either level and the installer lets the user pick. */
export type HubRecommendedScope = 'user' | 'workspace' | 'both'

export interface HubCatalogVersion {
  readonly version: string
  readonly changelog: string
  /** Hex sha256 of the artifact bytes — the desktop recomputes + compares
   * before install (the v1 integrity floor; a detached signature lands with
   * the object-storage move). */
  readonly artifactSha256: string
  readonly artifactSize: number
  /** Stored but NOT enforced until the D2 installer stamps real app versions
   * (the desktop still reports '0.0.0'). */
  readonly minAppVersion: string | null
  readonly releasedAt: string
}

export interface HubCatalogItem {
  readonly itemId: string
  readonly kind: HubItemKind
  readonly publisherName: string
  readonly publisherTier: HubPublisherTier
  readonly publisherUrl: string | null
  readonly displayName: string
  readonly oneLineDescription: string
  readonly category: string
  readonly iconName: string
  readonly recommendedScope: string | null
  readonly minimumTier: HubTier
  readonly latestVersion: string
  /** sha256 of the latest version's artifact — the desktop caches this as the
   * integrity anchor and compares it against the bytes it downloads (M4b). */
  readonly latestVersionSha256: string
  readonly releasedAt: string
  /** Annotated per-caller from the caller's FRESH tier. Fail-open on browse:
   * false only means "shown, not installable" — the download route is the
   * real, fail-closed gate. */
  readonly canInstall: boolean
}

export interface HubCatalogItemDetail extends HubCatalogItem {
  readonly versions: readonly HubCatalogVersion[]
}

export interface HubCatalogResponse {
  readonly items: readonly HubCatalogItem[]
}

const TIER_RANK: Readonly<Record<HubTier, number>> = { basic: 0, pro: 1 }

/** Install eligibility: the caller's tier must rank at or above the item's
 * minimum. The single source both the browse annotation and the download
 * gate use, so they can't diverge. */
export function tierMeetsMinimum(callerTier: HubTier, minimumTier: HubTier): boolean {
  return TIER_RANK[callerTier] >= TIER_RANK[minimumTier]
}

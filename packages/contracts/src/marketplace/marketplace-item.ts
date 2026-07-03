// Type definitions for the `marketplace` domain. The domain owns no
// DB tables (D1) — types live entirely in `@vynel/contracts`. Per
// `contracts-exports-map`, consumers import the file directly
// (`@vynel/contracts/marketplace/marketplace-item`); no barrel.

import type {
  SkillCategory,
  SkillScope,
} from '../skills/verified-skills/verified-skill-definition.js'

/** Phase 1 emits only `'verified'`; the other two are reserved for
 * Phase 1.5+ items. Closed union — the UI compiles against all three
 * badge variants from day one. Per D3. */
export type PublisherTier = 'verified' | 'anthropic-official' | 'community'

/** Sort modes the UI offers (no `'updated'` under MINIMAL per D8 —
 * no update flow in Phase 1). */
export type MarketplaceSortKey = 'recommended' | 'name-asc' | 'newest'

/** Install-status discriminator. Phase 1 has two variants (no
 * `'installed-with-update-available'` per D8). */
export type MarketplaceItemInstallStatus =
  | { kind: 'not-installed' }
  | {
      kind: 'installed'
      scope: SkillScope
      installedSkillId: string
      versionInstalled: string
    }

/** A catalog row, always annotated with install status. Under
 * MINIMAL, `itemId === skillId` (one item kind only) — see D7. */
export type MarketplaceItem = {
  itemId: string
  skillId: string
  publisherTier: PublisherTier
  publisherName: string
  publisherUrl: string | null
  displayName: string
  oneLineDescription: string
  category: SkillCategory
  iconName: string
  version: string
  releasedAt: string
  recommendedScope: SkillScope
  isOfficial: boolean
  installStatus: MarketplaceItemInstallStatus
}

export type MarketplaceFilterInput = {
  items: MarketplaceItem[]
  category?: SkillCategory
  publisherTier?: PublisherTier
  installState?: 'installed' | 'not-installed'
  searchQuery?: string
  sortBy?: MarketplaceSortKey
}

export type ListMarketplaceItemsInput = {
  userId: string
  workspaceId: string
  category?: SkillCategory
  publisherTier?: PublisherTier
  installState?: 'installed' | 'not-installed'
  searchQuery?: string
  sortBy?: MarketplaceSortKey
}

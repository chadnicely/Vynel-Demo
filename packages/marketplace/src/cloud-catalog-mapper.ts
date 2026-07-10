// Cache row → the skill-shaped `MarketplaceItem` the UI renders. v1 maps a
// cloud SKILL as a skill: `skillId === itemId` (as bundled items already do).
// Non-skill kinds are filtered out upstream (they don't fit this shape until
// `MarketplaceItem` gains `kind`).

import type {
  MarketplaceItem,
  PublisherTier,
} from '@vynel/contracts/marketplace/marketplace-item'
import type {
  SkillCategory,
  SkillScope,
} from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { MarketplaceCloudCatalogRow } from './schema/cloud-catalog-cache.js'

const SKILL_CATEGORIES: readonly SkillCategory[] = [
  'email',
  'documents',
  'calendar',
  'files',
  'research',
  'notes',
  'context',
]

function toSkillCategory(raw: string): SkillCategory {
  return (SKILL_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as SkillCategory)
    : 'context'
}

function toPublisherTier(raw: string): PublisherTier {
  return raw === 'community' ? 'community' : 'verified'
}

export function cloudRowToMarketplaceItem(row: MarketplaceCloudCatalogRow): MarketplaceItem {
  return {
    itemId: row.itemId,
    skillId: row.itemId,
    publisherTier: toPublisherTier(row.publisherTier),
    publisherName: row.publisherName,
    publisherUrl: row.publisherUrl,
    displayName: row.displayName,
    oneLineDescription: row.oneLineDescription,
    category: toSkillCategory(row.category),
    iconName: row.iconName,
    version: row.latestVersion,
    releasedAt: row.releasedAt,
    recommendedScope: (row.recommendedScope === 'workspace' ? 'workspace' : 'user') as SkillScope,
    isOfficial: toPublisherTier(row.publisherTier) === 'verified',
    installStatus: { kind: 'not-installed' },
    minimumTier: row.minimumTier === 'pro' ? 'pro' : 'basic',
  }
}

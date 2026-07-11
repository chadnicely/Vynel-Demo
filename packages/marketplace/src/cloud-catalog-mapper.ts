// Cache row → the `MarketplaceItem` the UI renders. `skillId === itemId`
// for every kind (the id anchor, not skill-semantics — see the contract's
// D7 note). Non-installable kinds (mcp/rule/plugin) are filtered out
// upstream in `resolveMergedCatalog`, so the narrowing here only ever
// sees skill/agent rows.

import type {
  MarketplaceItem,
  MarketplaceItemKind,
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

function toItemKind(raw: string): MarketplaceItemKind {
  return raw === 'agent' ? 'agent' : 'skill'
}

export function cloudRowToMarketplaceItem(row: MarketplaceCloudCatalogRow): MarketplaceItem {
  return {
    itemId: row.itemId,
    kind: toItemKind(row.kind),
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

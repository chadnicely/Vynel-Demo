// Cache row → the `MarketplaceItem` the UI renders. `skillId === itemId`
// for every kind (the id anchor, not skill-semantics — see the contract's
// D7 note). Non-installable kinds (mcp/rule/plugin) are filtered out
// upstream in `resolveMergedCatalog`, so the narrowing here only ever
// sees skill/agent rows.

import { toHubPublisherTier } from '@vynel/contracts/hub/catalog'
import type {
  MarketplaceItem,
  MarketplaceItemKind,
  MarketplaceItemScope,
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
  'creative',
  'communication',
]

function toSkillCategory(raw: string): SkillCategory {
  return (SKILL_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as SkillCategory)
    : 'context'
}

// The cache stores the hub's tier text verbatim, so parsing it is HUB
// vocabulary — the shared `toHubPublisherTier` is the one home. Its union is
// structurally identical to the desktop's `PublisherTier`, so no re-map.

function toItemKind(raw: string): MarketplaceItemKind {
  return raw === 'agent' ? 'agent' : 'skill'
}

// The cache row's `recommendedScope` text doubles as the hub's SURFACING
// scope (user/workspace/both after the hub-side scope rollout). A null or
// unknown value maps to 'both': legacy hub rows predate the scope semantics,
// and a legacy item must never vanish from either marketplace surface just
// because its publisher hasn't re-edited it.
function toItemScope(raw: string | null): MarketplaceItemScope {
  return raw === 'user' || raw === 'workspace' ? raw : 'both'
}

export function cloudRowToMarketplaceItem(row: MarketplaceCloudCatalogRow): MarketplaceItem {
  return {
    itemId: row.itemId,
    kind: toItemKind(row.kind),
    skillId: row.itemId,
    publisherTier: toHubPublisherTier(row.publisherTier),
    publisherName: row.publisherName,
    publisherUrl: row.publisherUrl,
    sourceUrl: row.sourceUrl,
    displayName: row.displayName,
    oneLineDescription: row.oneLineDescription,
    category: toSkillCategory(row.category),
    iconName: row.iconName,
    version: row.latestVersion,
    releasedAt: row.releasedAt,
    // The install picker's default only — a 'both' surfacing scope still
    // needs one concrete SkillScope to suggest, and 'user' matches what a
    // 'both' item most often is (useful everywhere).
    recommendedScope: (row.recommendedScope === 'workspace' ? 'workspace' : 'user') as SkillScope,
    scope: toItemScope(row.recommendedScope),
    // Both curated tiers badge as official — 'verified' (Vynel Team) and
    // 'anthropic-official' (upstream Anthropic). Only community rows don't.
    isOfficial: toHubPublisherTier(row.publisherTier) !== 'community',
    installStatus: { kind: 'not-installed' },
    minimumTier: row.minimumTier === 'pro' ? 'pro' : 'basic',
  }
}

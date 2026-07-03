// The single catalog seam. Phase 1 reads from `VERIFIED_SKILL_CATALOG`
// only (D2); Phase 1.5+ extends this function to merge cloud-fetched
// and locally-curated catalogs into the same `MarketplaceItem[]`
// shape — every caller stays unchanged.
//
// Filters out `isSystemInstalled: true` entries (D4) so
// system-installed bundles don't surface in the marketplace. Single
// source of truth — future system-installed bundles get hidden
// automatically. (Phase 1 ships none after `workspace-context`'s A2
// removal; the filter stays for the next one.)
//
// Spec: blueprint §3.2 + coding.md §1.2 + §1.4.

import { VERIFIED_SKILL_CATALOG } from '../skills/verified-skills/verified-skill-catalog.js'
import type { VerifiedSkillDefinition } from '../skills/verified-skills/verified-skill-definition.js'
import type { MarketplaceItem } from './marketplace-item.js'

const VYNEL_TEAM_PUBLISHER_NAME = 'Vynel Team'

// Phase 1 default for the wire-shape `releasedAt` — catalog entries
// don't yet carry the field (D7 trade-off). Foundation-hardening
// backlog adds catalog enrichment (`releasedAt` / `longDescription`
// / `screenshots[]`) when the first entry actually populates them.
const PHASE_1_RELEASED_AT_DEFAULT = '2026-01-01T00:00:00Z'

export function resolveCatalogSources(): MarketplaceItem[] {
  return VERIFIED_SKILL_CATALOG.filter((skill) => !skill.isSystemInstalled).map(
    verifiedSkillToMarketplaceItem,
  )
}

function verifiedSkillToMarketplaceItem(skill: VerifiedSkillDefinition): MarketplaceItem {
  return {
    // Under MINIMAL, `itemId === skillId` (one item kind in Phase 1
    // per D7). The second item kind (rule pack, agent bundle) will
    // make these diverge — recorded in `decisions.md` D7 trigger.
    itemId: skill.skillId,
    skillId: skill.skillId,
    publisherTier: 'verified',
    publisherName: VYNEL_TEAM_PUBLISHER_NAME,
    publisherUrl: null,
    displayName: skill.displayName,
    oneLineDescription: skill.oneLineDescription,
    category: skill.category,
    iconName: skill.iconName,
    version: skill.version,
    releasedAt: PHASE_1_RELEASED_AT_DEFAULT,
    recommendedScope: skill.recommendedScope,
    isOfficial: true,
    // Annotated downstream by `annotateWithInstallStatus`. The
    // resolver returns the not-installed default so callers can use
    // the result as a `MarketplaceItem[]` even before annotation —
    // e.g. tests that don't care about install state.
    installStatus: { kind: 'not-installed' },
  }
}

// Response serializers for the `marketplace` routes. Pass-through
// under MINIMAL — the type already matches the wire shape; kept as a
// function so a future shape difference (e.g. publisherUrl becomes
// optional, displayName gets prefixed) is a one-place edit.
//
// Spec: blueprint §6 + coding.md §6.5. Filled in by /build-domain
// marketplace step 7.

import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledSkillRow } from '@vynel/skills'

export function serializeMarketplaceItem(item: MarketplaceItem): MarketplaceItem {
  return item
}

// The skill branch of the install response (both the cloud-artifact and
// bundled-template paths answer with the installed-skill row); the agent
// branch is shaped inline at the route — its fields come from two sources
// (agent row + cached cloud version), not one row.
export function serializeInstalledSkillResponse(row: InstalledSkillRow, itemId: string) {
  return {
    kind: 'skill' as const,
    installedSkillId: row.id,
    itemId,
    scope: row.scope,
    source: row.installedFromSource,
    version: row.versionInstalled,
  }
}

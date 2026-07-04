// Pure helper — annotates each catalog item with the caller's
// install status. No I/O, no DB; the caller fetches installed
// skills + passes them in. Workspace-scope match preferred over
// user-scope when both exist (D12).
//
// Spec: blueprint §5.1 + coding.md §6.1.

import type {
  MarketplaceItem,
  MarketplaceItemInstallStatus,
} from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledSkillView } from './marketplace-types.js'

export type AnnotateInput = {
  catalogItems: MarketplaceItem[]
  installedSkills: InstalledSkillView[]
}

export function annotateWithInstallStatus(input: AnnotateInput): MarketplaceItem[] {
  return input.catalogItems.map((item) => ({
    ...item,
    installStatus: determineInstallStatus(item, input.installedSkills),
  }))
}

function determineInstallStatus(
  item: MarketplaceItem,
  installedSkills: InstalledSkillView[],
): MarketplaceItemInstallStatus {
  const matches = installedSkills.filter((s) => s.skillId === item.skillId)
  if (matches.length === 0) return { kind: 'not-installed' }
  // D12: workspace-scope match preferred when both exist.
  const workspaceScoped = matches.find((s) => s.workspaceId !== null)
  const match = workspaceScoped ?? matches[0]!
  return {
    kind: 'installed',
    scope: match.scope,
    installedSkillId: match.id,
    versionInstalled: match.versionInstalled,
  }
}

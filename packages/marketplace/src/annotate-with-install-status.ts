// Pure helper — annotates each catalog item with the caller's
// install status. No I/O, no DB; the caller fetches installed
// skills + agents and passes them in. Matching is per item KIND:
// skills key on skillId, agents on slug (=== itemId, enforced at
// install). Workspace-scope match preferred over user-scope when
// both exist (D12) — for both kinds.
//
// Spec: blueprint §5.1 + coding.md §6.1; C-agents extends per kind.

import type {
  MarketplaceItem,
  MarketplaceItemInstallStatus,
} from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledAgentView, InstalledSkillView } from './marketplace-types.js'

export type AnnotateInput = {
  catalogItems: MarketplaceItem[]
  installedSkills: InstalledSkillView[]
  installedAgents: InstalledAgentView[]
}

export function annotateWithInstallStatus(input: AnnotateInput): MarketplaceItem[] {
  return input.catalogItems.map((item) => ({
    ...item,
    installStatus:
      item.kind === 'agent'
        ? determineAgentInstallStatus(item, input.installedAgents)
        : determineSkillInstallStatus(item, input.installedSkills),
  }))
}

function determineSkillInstallStatus(
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
    installedId: match.id,
    versionInstalled: match.versionInstalled,
  }
}

function determineAgentInstallStatus(
  item: MarketplaceItem,
  installedAgents: InstalledAgentView[],
): MarketplaceItemInstallStatus {
  const matches = installedAgents.filter((a) => a.slug === item.itemId)
  if (matches.length === 0) return { kind: 'not-installed' }
  const workspaceScoped = matches.find((a) => a.workspaceId !== null)
  const match = workspaceScoped ?? matches[0]!
  return {
    kind: 'installed',
    scope: match.workspaceId === null ? 'user' : 'workspace',
    installedId: match.id,
    // Agent rows don't record an installed version (update flow is a
    // deferred arc).
    versionInstalled: null,
  }
}

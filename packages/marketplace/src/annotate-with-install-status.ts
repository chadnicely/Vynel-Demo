// Pure helper — annotates each catalog item with the caller's
// install status. No I/O, no DB; the caller fetches installed
// skills + agents and passes them in. Matching is per item KIND:
// skills key on skillId, agents on slug (=== itemId, enforced at
// install) AND source === 'community' (marketplace-installed only).
// Workspace-scope match preferred over user-scope when both exist
// (D12) — for both kinds.
//
// Spec: blueprint §5.1 + coding.md §6.1; C-agents extends per kind.

import type {
  MarketplaceItem,
  MarketplaceItemInstallStatus,
} from '@vynel/contracts/marketplace/marketplace-item'
import type {
  InstalledAgentView,
  InstalledMcpServerView,
  InstalledPluginView,
  InstalledRuleView,
  InstalledSkillView,
} from './marketplace-types.js'

export type AnnotateInput = {
  catalogItems: MarketplaceItem[]
  installedSkills: InstalledSkillView[]
  installedAgents: InstalledAgentView[]
  installedPlugins: InstalledPluginView[]
  installedMcpServers: InstalledMcpServerView[]
  installedRules: InstalledRuleView[]
}

export function annotateWithInstallStatus(input: AnnotateInput): MarketplaceItem[] {
  return input.catalogItems.map((item) => ({
    ...item,
    installStatus:
      item.kind === 'agent'
        ? determineAgentInstallStatus(item, input.installedAgents)
        : item.kind === 'plugin'
          ? determinePluginInstallStatus(item, input.installedPlugins)
          : item.kind === 'mcp'
            ? determineMcpInstallStatus(item, input.installedMcpServers)
            : item.kind === 'rule'
              ? determineRuleInstallStatus(item, input.installedRules)
              : determineSkillInstallStatus(item, input.installedSkills),
  }))
}

function determineRuleInstallStatus(
  item: MarketplaceItem,
  installedRules: InstalledRuleView[],
): MarketplaceItemInstallStatus {
  // Config-is-truth: the `<itemId>.md` file (provenance-marked — the view
  // never contains hand-authored files) is the whole installed state.
  const matches = installedRules.filter((r) => r.ruleId === item.itemId)
  if (matches.length === 0) return { kind: 'not-installed' }
  // D12: workspace folder preferred when both scopes carry the file.
  const match = matches.find((r) => r.scope === 'workspace') ?? matches[0]!
  return {
    kind: 'installed',
    scope: match.scope,
    installedId: match.ruleId,
    // The marker records the installed version — honest data, though the
    // card offers no rule update (hasCloudArtifact is false; re-Get after
    // uninstall, like agents).
    versionInstalled: match.version,
  }
}

function determineMcpInstallStatus(
  item: MarketplaceItem,
  installedMcpServers: InstalledMcpServerView[],
): MarketplaceItemInstallStatus {
  // Config-is-truth: the entry key in the scope's Claude MCP config is the
  // whole installed state. `installedId` is the server name — the uninstall
  // route resolves the config entry to remove through this same match.
  const matches = installedMcpServers.filter((s) => s.name === item.mcpServerName)
  if (matches.length === 0) return { kind: 'not-installed' }
  // D12: workspace-scope match preferred when both configs carry the name.
  const match = matches.find((s) => s.scope === 'workspace') ?? matches[0]!
  return {
    kind: 'installed',
    scope: match.scope,
    installedId: match.name,
    // A config entry records no version — like agents, the card never
    // offers an update (hasCloudArtifact is false for mcp items anyway).
    versionInstalled: null,
  }
}

function determinePluginInstallStatus(
  item: MarketplaceItem,
  installedPlugins: InstalledPluginView[],
): MarketplaceItemInstallStatus {
  // Full-key match only (`name@marketplace`) — a same-named plugin from a
  // DIFFERENT marketplace must never flip the card to "Installed"; the
  // uninstall route resolves through this same match and would remove the
  // wrong plugin (the agents-slug precedent). Plugins are user-scope global.
  const match = installedPlugins.find((p) => p.key === item.pluginKey)
  if (match === undefined) return { kind: 'not-installed' }
  return {
    kind: 'installed',
    scope: 'user',
    installedId: match.key,
    versionInstalled: match.version,
  }
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
  // Marketplace-installed agents only (`installCloudAgent` stamps
  // `source: 'community'`): a HAND-MADE agent (`source: 'user'`) whose
  // slug happens to equal a catalog itemId must never flip the card to
  // "Installed" — the uninstall route resolves through this same match
  // and would soft-delete the user's own agent.
  const matches = installedAgents.filter(
    (a) => a.source === 'community' && a.slug === item.itemId,
  )
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

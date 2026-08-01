// The `marketplace` leaf owns no tables (D1) — its wire types live in
// `@vynel/contracts/marketplace/*`. What lives HERE is the injection
// seam: the install-status of a catalog item is derived from the
// caller's installed skills, which the `skills` leaf owns. A leaf
// never imports a sibling leaf (invariant #2), so marketplace declares
// a STRUCTURAL view of the one skill shape it reads + a deps contract
// for the reader; the api layer (which may compose leaves) binds the
// real `listInstalledSkillsForUserAndWorkspace`. Mirrors the
// `FireScheduleDeps` / `ProcessInboundDeps` precedent.

import type { Database } from '@vynel/db'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

// The exact five fields `annotateWithInstallStatus` reads off an
// installed-skill row. Field types match `@vynel/skills`'
// `InstalledSkillRow` (and `SkillScope` is the same contracts type
// `MarketplaceItemInstallStatus.scope` uses) so the injected reader's
// `InstalledSkillRow[]` return is assignable here without importing the
// skills leaf.
export type InstalledSkillView = {
  id: string
  skillId: string
  workspaceId: string | null
  scope: SkillScope
  versionInstalled: string
}

// The four fields `annotateWithInstallStatus` reads off an installed
// AGENT row (`@vynel/agents` is a sibling leaf too — same structural-
// view rule). Scope is derived: `workspaceId === null` = user-scope.
// `source` is a plain string (not the agents leaf's `AgentSource`
// union — no sibling import); the annotator matches only
// `'community'`, the value `installCloudAgent` stamps. `AgentRow` is
// assignable here, so the app can bind the kernel's
// `listAgentsForUserAndWorkspace` directly.
export type InstalledAgentView = {
  id: string
  slug: string
  workspaceId: string | null
  source: string
}

// The cross-leaf reads `listMarketplaceItems` / `getMarketplaceItem`
// need injected. With a workspaceId, each reader returns the union of
// the caller's user-scope + that workspace's rows (the WORKSPACE
// surface); with `workspaceId: null` it returns user-scope rows ONLY —
// the GLOBAL surface annotates against user-scoped installs, never a
// workspace's. Both kernel readers honor the same null convention.
export type MarketplaceInstallOwner = {
  userId: string
  workspaceId: string | null
}

// The two fields the annotator reads off a Claude-CLI-installed PLUGIN
// (`@vynel/providers` owns the registry read — same structural-view rule).
// `key` is `<pluginName>@<marketplaceName>`, matched against the item's
// precomputed `pluginKey` (full key, never bare name). Plugins are
// user-scope global by nature — no owner input, no db.
export type InstalledPluginView = {
  key: string
  version: string | null
}

// The two fields the annotator reads off a standalone MCP-server config
// entry (config-is-truth: presence of the key in the scope's Claude MCP
// config IS installed; `@vynel/skills` owns the config read — same
// structural-view rule). The ROUTE binds the reader with the surface's
// config paths (user config alone for global; ∪ workspace `.mcp.json`
// for a workspace surface), so the deps call stays argument-free.
export type InstalledMcpServerView = {
  name: string
  scope: SkillScope
}

export type MarketplaceDeps = {
  listInstalledSkills: (db: Database, input: MarketplaceInstallOwner) => InstalledSkillView[]
  listInstalledAgents: (db: Database, input: MarketplaceInstallOwner) => InstalledAgentView[]
  listInstalledPlugins: () => InstalledPluginView[]
  listInstalledMcpServers: () => InstalledMcpServerView[]
}

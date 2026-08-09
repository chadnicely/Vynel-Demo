// The ONE home for the marketplace's per-kind install/uninstall dispatch,
// shared by the workspace-scoped routes (`index.ts`) and the user-scoped
// twins (`user-scoped.ts`) so the two surfaces can never drift apart.
//
// This file is the composition point — apps compose leaves — so it binds
// `@vynel/skills` + `@vynel/agents` install functions and the kernel's
// agents reader into the `@vynel/marketplace` leaf's injected-deps seam
// (the leaf never imports a sibling leaf, invariant #2).
//
// BOTH lifecycle ops resolve through `getMarketplaceItem` ON the caller's
// surface FIRST (workspace nullability picks the surface): only items the
// surface lists are installable/uninstallable from it, and the off-surface
// 404 is byte-identical to the unknown-id one (no enumeration leak). This
// is the ONE surface gate — routes never pre-resolve.
//
// Install dispatch (M4b-2 + C-agents): a CACHED cloud item downloads its
// verified artifact (sha256-checked in the leaf) and installs per its kind;
// `plugin` delegates to Claude Code's own plugin system, `mcp` writes the
// scope's Claude MCP config, `rule` writes the scope's `.claude/rules/`
// file (config-is-truth, 2026-08-02); anything else falls through to the
// bundled-template `installSkill`.
//
// Uninstall dispatch: the surface resolution doubles as the exact per-kind
// resolution the list annotator uses — so the row removed is the one the
// card shows as "Installed", and a hand-made agent with a colliding slug is
// never soft-deleted.

import { sep } from 'node:path'
import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import type { HubSession } from '@vynel/hub-account'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { MarketplaceSurfaceSelector } from '@vynel/contracts/marketplace/marketplace-item'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { getMarketplaceItem, findCachedCloudItem } from '@vynel/marketplace'
import {
  listInstalledSkillsForUserAndWorkspace,
  installSkill,
  installCloudSkill,
  updateCloudSkill,
  uninstallSkill,
} from '@vynel/skills'
import { installCloudAgent, softDeleteAgent } from '@vynel/agents'
import { listAgentsForUserAndWorkspace } from '@vynel/db/repositories/agents'
import type {
  MarketplaceDeps,
  ClaudeMarketplaceSourceView,
  InstalledPluginView,
  InstalledMcpServerView,
  InstalledRuleView,
} from '@vynel/marketplace'
import type { InstalledClaudePluginView } from '@vynel/providers'
import type { MarketplacePluginDelegate } from '../../services/marketplace-plugin-delegate.js'
import type { McpAuthDelegate } from '../../services/mcp-auth-delegate.js'
import { serializeInstalledSkillResponse } from './serializers.js'
import { installPluginItem, updatePluginItem, uninstallPluginItem } from './plugin-item-lifecycle.js'
import { installMcpItem, uninstallMcpItem, mcpServersReaderFor } from './mcp-item-lifecycle.js'
import { installRuleItem, uninstallRuleItem, rulesReaderFor } from './rule-item-lifecycle.js'

// Agents' install-status reader binds the kernel repo directly — the
// `@vynel/agents` leaf export (`listAgentsForWorkspace`) is async, and
// the marketplace pipeline is sync (Phase-1 sync-transactions). The
// row's `source` rides along: the annotator matches marketplace-
// installed (`source: 'community'`) agents only. Both readers honor
// `workspaceId: null` = user-scope rows only (the global surface).
// The PLUGIN reader is injected per request (the `pluginDelegate`
// precedent): plugins live in Claude Code's own registry
// (`installed_plugins.json`), so a statically-bound reader would make
// every unmocked route test read the developer's real `~/.claude/plugins`.
export function marketplaceDepsWith(
  listInstalledPlugins: () => InstalledPluginView[],
  listInstalledMcpServers: () => InstalledMcpServerView[],
  listInstalledRules: () => InstalledRuleView[],
  listClaudeMarketplaces: () => ClaudeMarketplaceSourceView[],
): MarketplaceDeps {
  return {
    listInstalledSkills: listInstalledSkillsForUserAndWorkspace,
    listInstalledAgents: listAgentsForUserAndWorkspace,
    listInstalledPlugins,
    listInstalledMcpServers,
    listInstalledRules,
    listClaudeMarketplaces,
  }
}

// The provider registry read is surface-agnostic; `pluginsReaderFor`
// narrows it per surface: user entries always, plus PROJECT entries whose
// path is THIS workspace (normalized — the CLI records the cwd spelling).
export function pluginsReaderFor(
  workspace: { path: string } | null,
  listInstalledPlugins: () => InstalledClaudePluginView[],
): () => InstalledPluginView[] {
  const normalize = (value: string) =>
    value.replaceAll('/', sep).replace(/[\\/]+$/, '').toLowerCase()
  return () => {
    const views: InstalledPluginView[] = []
    for (const entry of listInstalledPlugins()) {
      if (entry.scope === 'user') {
        views.push({ key: entry.key, version: entry.version, scope: 'user' })
        continue
      }
      if (
        workspace !== null &&
        entry.projectPath !== null &&
        normalize(entry.projectPath) === normalize(workspace.path)
      ) {
        views.push({ key: entry.key, version: entry.version, scope: 'workspace' })
      }
    }
    return views
  }
}

export type MarketplaceRequestContext = {
  db: Database
  hubSession: HubSession | undefined
  logger: Logger
  pluginDelegate: MarketplacePluginDelegate
  listInstalledPlugins: () => InstalledClaudePluginView[]
  listClaudeMarketplaces: () => ClaudeMarketplaceSourceView[]
  mcpAuthDelegate: McpAuthDelegate
}

// null workspace = the GLOBAL surface; non-null = that workspace's surface.
// The ONE derivation both lifecycle ops share — the gate and the uninstall
// resolution can never key on different surfaces.
function surfaceSelectorFor(
  workspace: { id: string } | null,
): MarketplaceSurfaceSelector {
  return workspace === null
    ? { surface: 'global' }
    : { surface: 'workspace', workspaceId: workspace.id }
}

export type MarketplaceInstallRequest = {
  itemId: string
  userId: string
  scope: SkillScope
  // null = the GLOBAL surface (a user-scope install needs no workspace).
  workspace: { id: string; path: string } | null
  /** Mcp items only: values for the manifest's declared configuration
   * fields. Secrets — never logged; other kinds ignore them. */
  mcpConfigurationValues?: Record<string, string>
  /** Plugin items only — the UI's explicit consent; the session tool's
   * schema excludes it, so tool installs of plugins 400 actionably. */
  acceptPluginExecution?: true
}

export async function installMarketplaceItem(
  ctx: MarketplaceRequestContext,
  request: MarketplaceInstallRequest,
) {
  const { itemId, userId, scope, workspace } = request
  // Surface gate: only items this surface lists install from here — an
  // off-surface or unknown id throws the same NotFoundError the uninstall
  // path produces, so no surface can mint a row its own reads would hide.
  const gateItem = getMarketplaceItem(
    ctx.db,
    { itemId, userId, ...surfaceSelectorFor(workspace) },
    marketplaceDepsWith(
      pluginsReaderFor(workspace, ctx.listInstalledPlugins),
      mcpServersReaderFor(workspace),
      rulesReaderFor(workspace),
      ctx.listClaudeMarketplaces,
    ),
  )
  if (gateItem.kind === 'plugin') {
    return installPluginItem(
      { db: ctx.db, logger: ctx.logger, pluginDelegate: ctx.pluginDelegate },
      {
        itemId,
        pluginKey: gateItem.pluginKey,
        source: gateItem.source,
        sourceUrl: gateItem.sourceUrl,
        scope,
        workspace,
        acceptPluginExecution: request.acceptPluginExecution === true,
      },
    )
  }
  if (gateItem.kind === 'mcp') {
    return installMcpItem(
      { db: ctx.db, logger: ctx.logger },
      { itemId, scope, workspace, configurationValues: request.mcpConfigurationValues ?? {} },
    )
  }
  if (gateItem.kind === 'rule') {
    return installRuleItem({ db: ctx.db, logger: ctx.logger }, { itemId, scope, workspace })
  }
  const cached = findCachedCloudItem(ctx.db, itemId)
  const cloud =
    cached !== null && (cached.kind === 'skill' || cached.kind === 'agent') ? cached : null
  if (cloud !== null) {
    if (ctx.hubSession === undefined) {
      throw new ValidationError('The hub is not available to download this item.')
    }
    const artifactBytes = await ctx.hubSession.downloadArtifact(itemId, cloud.latestVersion)
    if (cloud.kind === 'agent') {
      const agent = await installCloudAgent(
        ctx.db,
        {
          userId,
          workspaceId: workspace?.id ?? null,
          itemId,
          scope,
          artifactBytes,
          expectedSha256: cloud.latestVersionSha256,
        },
        { logger: ctx.logger },
      )
      return {
        kind: 'agent' as const,
        agentId: agent.id,
        slug: agent.slug,
        itemId,
        scope: agent.scope,
        version: cloud.latestVersion,
      }
    }
    const installed = await installCloudSkill(
      ctx.db,
      {
        userId,
        workspaceId: workspace?.id ?? null,
        workspacePath: workspace?.path ?? null,
        itemId,
        scope,
        artifactBytes,
        expectedSha256: cloud.latestVersionSha256,
        version: cloud.latestVersion,
      },
      { logger: ctx.logger },
    )
    return serializeInstalledSkillResponse(installed, itemId)
  }
  const installed = await installSkill(
    ctx.db,
    {
      userId,
      workspaceId: workspace?.id ?? null,
      workspacePath: workspace?.path ?? null,
      skillId: itemId,
      scope,
    },
    { logger: ctx.logger },
  )
  return serializeInstalledSkillResponse(installed, itemId)
}

export type MarketplaceUpdateRequest = {
  itemId: string
  userId: string
  // null = the GLOBAL surface (resolves against user-scope installs).
  workspace: { id: string; path: string } | null
}

// Skills update from the hub artifact; plugins update in place via the
// Claude CLI delegate (2026-08-02). Agents carry no installed version to
// compare, and mcp/rule config entries refresh by reinstall — their story
// stays uninstall+reinstall. The catalog's latest version is the only
// update target: "update" always means "to what the card shows".
export async function updateMarketplaceItem(
  ctx: MarketplaceRequestContext,
  request: MarketplaceUpdateRequest,
) {
  const { itemId, userId, workspace } = request
  const item = getMarketplaceItem(
    ctx.db,
    { itemId, userId, ...surfaceSelectorFor(workspace) },
    marketplaceDepsWith(
      pluginsReaderFor(workspace, ctx.listInstalledPlugins),
      mcpServersReaderFor(workspace),
      rulesReaderFor(workspace),
      ctx.listClaudeMarketplaces,
    ),
  )
  if (item.installStatus.kind !== 'installed') {
    throw new NotFoundError('installed-item', itemId)
  }
  if (item.kind === 'plugin') {
    return updatePluginItem(
      {
        logger: ctx.logger,
        pluginDelegate: ctx.pluginDelegate,
        listInstalledPlugins: ctx.listInstalledPlugins,
      },
      {
        itemId,
        installedKey: item.installStatus.installedId,
        installedScope: item.installStatus.scope,
        workspace,
      },
    )
  }
  if (item.kind !== 'skill') {
    throw new ValidationError(
      'Only skills and plugins support in-place updates — uninstall and reinstall to get the latest version.',
    )
  }
  const cached = findCachedCloudItem(ctx.db, itemId)
  const cloud = cached !== null && cached.kind === 'skill' ? cached : null
  if (cloud === null) {
    // Bundled-only items version with app releases; there is nothing newer
    // to download.
    throw new ValidationError('This item has no cloud version to update to.')
  }
  if (ctx.hubSession === undefined) {
    throw new ValidationError('The hub is not available to download this update.')
  }
  const artifactBytes = await ctx.hubSession.downloadArtifact(itemId, cloud.latestVersion)
  const updated = await updateCloudSkill(
    ctx.db,
    {
      userId,
      installedSkillId: item.installStatus.installedId,
      workspacePath: workspace?.path ?? null,
      artifactBytes,
      expectedSha256: cloud.latestVersionSha256,
      version: cloud.latestVersion,
    },
    { logger: ctx.logger },
  )
  return serializeInstalledSkillResponse(updated, itemId)
}

export type MarketplaceUninstallRequest = {
  itemId: string
  userId: string
  // null = the GLOBAL surface: resolve against USER-scoped installs and
  // remove the user-scope row; non-null = today's workspace behavior.
  workspace: { id: string; path: string } | null
}

export async function uninstallMarketplaceItem(
  ctx: MarketplaceRequestContext,
  request: MarketplaceUninstallRequest,
) {
  const { itemId, userId, workspace } = request
  const item = getMarketplaceItem(
    ctx.db,
    { itemId, userId, ...surfaceSelectorFor(workspace) },
    marketplaceDepsWith(
      pluginsReaderFor(workspace, ctx.listInstalledPlugins),
      mcpServersReaderFor(workspace),
      rulesReaderFor(workspace),
      ctx.listClaudeMarketplaces,
    ),
  )
  if (item.installStatus.kind !== 'installed') {
    throw new NotFoundError('installed-item', itemId)
  }
  if (item.kind === 'plugin') {
    return uninstallPluginItem(
      { logger: ctx.logger, pluginDelegate: ctx.pluginDelegate },
      {
        itemId,
        installedKey: item.installStatus.installedId,
        installedScope: item.installStatus.scope,
        workspace,
      },
    )
  }
  if (item.kind === 'mcp') {
    return uninstallMcpItem(
      { db: ctx.db, logger: ctx.logger, mcpAuthDelegate: ctx.mcpAuthDelegate },
      {
        itemId,
        serverName: item.installStatus.installedId,
        serverScope: item.installStatus.scope,
        workspace,
      },
    )
  }
  if (item.kind === 'rule') {
    return uninstallRuleItem(
      { logger: ctx.logger },
      {
        itemId,
        ruleId: item.installStatus.installedId,
        ruleScope: item.installStatus.scope,
        workspace,
      },
    )
  }
  if (item.kind === 'agent') {
    await softDeleteAgent(
      ctx.db,
      { agentId: item.installStatus.installedId, userId },
      { logger: ctx.logger },
    )
    return { kind: 'agent' as const, agentId: item.installStatus.installedId, itemId }
  }
  await uninstallSkill(
    ctx.db,
    {
      userId,
      installedSkillId: item.installStatus.installedId,
      // A user-scope row's disk home is workspace-independent; the path
      // only matters for a workspace-scope skill folder.
      ...(workspace !== null ? { workspacePath: workspace.path } : {}),
    },
    { logger: ctx.logger },
  )
  return {
    kind: 'skill' as const,
    installedSkillId: item.installStatus.installedId,
    itemId,
  }
}

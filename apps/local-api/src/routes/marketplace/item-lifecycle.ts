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
// anything else falls through to the bundled-template `installSkill` — a
// cached NON-INSTALLABLE kind (mcp/rule/plugin) must never shadow a same-id
// bundled skill.
//
// Uninstall dispatch: the surface resolution doubles as the exact per-kind
// resolution the list annotator uses — so the row removed is the one the
// card shows as "Installed", and a hand-made agent with a colliding slug is
// never soft-deleted.

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
import { serializeInstalledSkillResponse } from './serializers.js'

// Agents' install-status reader binds the kernel repo directly — the
// `@vynel/agents` leaf export (`listAgentsForWorkspace`) is async, and
// the marketplace pipeline is sync (Phase-1 sync-transactions). The
// row's `source` rides along: the annotator matches marketplace-
// installed (`source: 'community'`) agents only. Both readers honor
// `workspaceId: null` = user-scope rows only (the global surface).
export const marketplaceDeps = {
  listInstalledSkills: listInstalledSkillsForUserAndWorkspace,
  listInstalledAgents: listAgentsForUserAndWorkspace,
}

export type MarketplaceRequestContext = {
  db: Database
  hubSession: HubSession | undefined
  logger: Logger
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
}

export async function installMarketplaceItem(
  ctx: MarketplaceRequestContext,
  request: MarketplaceInstallRequest,
) {
  const { itemId, userId, scope, workspace } = request
  // Surface gate: only items this surface lists install from here — an
  // off-surface or unknown id throws the same NotFoundError the uninstall
  // path produces, so no surface can mint a row its own reads would hide.
  getMarketplaceItem(
    ctx.db,
    { itemId, userId, ...surfaceSelectorFor(workspace) },
    marketplaceDeps,
  )
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

// Skills only — agents carry no installed version to compare (the annotator
// returns null), so their update story is uninstall+reinstall until the
// agent-update arc lands. The catalog's latest version is the only update
// target: "update" always means "to what the card shows".
export async function updateMarketplaceItem(
  ctx: MarketplaceRequestContext,
  request: MarketplaceUpdateRequest,
) {
  const { itemId, userId, workspace } = request
  const item = getMarketplaceItem(
    ctx.db,
    { itemId, userId, ...surfaceSelectorFor(workspace) },
    marketplaceDeps,
  )
  if (item.installStatus.kind !== 'installed') {
    throw new NotFoundError('installed-item', itemId)
  }
  if (item.kind === 'agent') {
    throw new ValidationError(
      'Agent items cannot be updated in place yet — uninstall and reinstall to get the latest version.',
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
    marketplaceDeps,
  )
  if (item.installStatus.kind !== 'installed') {
    throw new NotFoundError('installed-item', itemId)
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

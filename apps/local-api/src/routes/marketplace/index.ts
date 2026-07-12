// HTTP routes for the `marketplace` domain, mounted under
// `/workspaces/:workspaceId/marketplace`. Four routes: `GET /items` (list,
// annotated with install status) + `GET /items/:itemId` (detail) +
// `POST /install` + `POST /uninstall`. Owner-filtered via `...workspaceScoped`.
//
// The install-status annotation is derived from the caller's installed
// skills. The `@vynel/marketplace` LEAF never imports the `skills`
// sibling leaf (invariant #2); it takes the reader as an injected dep.
// This route file is the composition point — apps compose leaves — so
// it imports `listInstalledSkillsForUserAndWorkspace` + the install
// functions from `@vynel/skills`.
//
// **`POST /install` lives HERE, not in `/skills/install`** (M4b-2 reverses
// the old D7): a CLOUD item requires a server-side download + sha256 verify
// before install, so the route dispatches by cache membership — a cached
// cloud item downloads its verified artifact, a bundled item renders its
// in-code template. **No `x-mcp`** (D9 — skills already exposes
// `list_available_skills` + `list_installed_skills`; marketplace's reads are
// the join of those two, redundant for the LLM).
//
// **No error mapping in this file.** Core throws `NotFoundError` from
// `@vynel/errors`; the single `onError` middleware in `app.ts` maps it.
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" +
// `sdk-mcp.md`: `describeRoute` (from `../../openapi.js` — widens the
// type for `x-mcp` + `x-sdk-name`) → `validator` (from
// `hono-openapi/zod`) → `...workspaceScoped` → handler. Chained methods
// on `factory.createApp()` — RPC types depend on the chain.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { listMarketplaceItems, getMarketplaceItem, findCachedCloudItem } from '@vynel/marketplace'
import {
  listInstalledSkillsForUserAndWorkspace,
  installSkill,
  installCloudSkill,
  uninstallSkill,
} from '@vynel/skills'
import { installCloudAgent, softDeleteAgent } from '@vynel/agents'
import { listAgentsForUserAndWorkspace } from '@vynel/db/repositories/agents'
import {
  ListMarketplaceItemsQuerySchema,
  ItemIdParamSchema,
  ListMarketplaceItemsResponseSchema,
  MarketplaceItemSchema,
  InstallMarketplaceItemBodySchema,
  InstallMarketplaceItemResponseSchema,
  UninstallMarketplaceItemBodySchema,
  UninstallMarketplaceItemResponseSchema,
} from './schemas.js'
import { serializeMarketplaceItem, serializeInstalledSkillResponse } from './serializers.js'

// Agents' install-status reader binds the kernel repo directly — the
// `@vynel/agents` leaf export (`listAgentsForWorkspace`) is async, and
// the marketplace pipeline is sync (Phase-1 sync-transactions). The
// row's `source` rides along: the annotator matches marketplace-
// installed (`source: 'community'`) agents only.
const marketplaceDeps = {
  listInstalledSkills: listInstalledSkillsForUserAndWorkspace,
  listInstalledAgents: listAgentsForUserAndWorkspace,
}

export const marketplaceApp = factory
  .createApp()
  .get(
    '/items',
    describeRoute({
      tags: ['marketplace'],
      summary: 'List marketplace items annotated with install status.',
      'x-sdk-name': 'marketplace.listItems',
      responses: {
        200: {
          description: 'Annotated marketplace items.',
          content: { 'application/json': { schema: resolver(ListMarketplaceItemsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListMarketplaceItemsQuerySchema),
    ...workspaceScoped,
    (c) => {
      const query = c.req.valid('query')
      // exactOptionalPropertyTypes — conditional assembly, not spread
      // (per the workspaces `listWorkspacesForUser` precedent in MEMORY).
      const input: Parameters<typeof listMarketplaceItems>[1] = {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      }
      if (query.category !== undefined) input.category = query.category
      if (query.publisherTier !== undefined) input.publisherTier = query.publisherTier
      if (query.installState !== undefined) input.installState = query.installState
      if (query.searchQuery !== undefined) input.searchQuery = query.searchQuery
      if (query.sortBy !== undefined) input.sortBy = query.sortBy
      const items = listMarketplaceItems(c.var.db, input, marketplaceDeps)
      return c.json(items.map(serializeMarketplaceItem))
    },
  )
  .get(
    '/items/:itemId',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Get one marketplace item annotated with install status.',
      'x-sdk-name': 'marketplace.getItem',
      responses: {
        200: {
          description: 'The annotated marketplace item.',
          content: { 'application/json': { schema: resolver(MarketplaceItemSchema) } },
        },
        404: { description: 'Item not in catalog OR workspace not found.' },
      },
    }),
    validator('param', ItemIdParamSchema),
    ...workspaceScoped,
    (c) => {
      const { itemId } = c.req.valid('param')
      const item = getMarketplaceItem(
        c.var.db,
        {
          itemId,
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
        },
        marketplaceDeps,
      )
      return c.json(serializeMarketplaceItem(item))
    },
  )
  .post(
    '/install',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Install a marketplace item (cloud artifact or bundled skill).',
      'x-sdk-name': 'marketplace.install',
      responses: {
        201: {
          description: 'The installed skill.',
          content: { 'application/json': { schema: resolver(InstallMarketplaceItemResponseSchema) } },
        },
        403: { description: 'The caller’s tier may not install this item.' },
        404: { description: 'Item not in catalog OR workspace not found.' },
        409: { description: 'Already installed at the requested scope.' },
      },
    }),
    validator('json', InstallMarketplaceItemBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { itemId, scope } = c.req.valid('json')
      const workspace = c.var.workspace!
      const base = {
        userId: c.var.user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        scope,
      }
      // A cloud item downloads its verified artifact; a bundled item renders
      // its in-code template. One route, dispatched by cache membership +
      // the cached kind (C-agents). A cached row of a NON-INSTALLABLE kind
      // (mcp/rule/plugin) is treated as "not cloud" and falls through to
      // the bundled dispatch: a hidden cloud row must never shadow a
      // same-id bundled skill, and the final not-found stays byte-identical
      // to the unknown-id case (`installSkill`'s NotFoundError('skill', …))
      // — no enumeration distinguisher.
      const cached = findCachedCloudItem(c.var.db, itemId)
      const cloud =
        cached !== null && (cached.kind === 'skill' || cached.kind === 'agent') ? cached : null
      if (cloud !== null) {
        if (c.var.hubSession === undefined) {
          throw new ValidationError('The hub is not available to download this item.')
        }
        const artifactBytes = await c.var.hubSession.downloadArtifact(itemId, cloud.latestVersion)
        if (cloud.kind === 'agent') {
          const agent = await installCloudAgent(
            c.var.db,
            {
              userId: base.userId,
              workspaceId: base.workspaceId,
              itemId,
              scope,
              artifactBytes,
              expectedSha256: cloud.latestVersionSha256,
            },
            { logger: c.var.logger },
          )
          return c.json(
            {
              kind: 'agent' as const,
              agentId: agent.id,
              slug: agent.slug,
              itemId,
              scope: agent.scope,
              version: cloud.latestVersion,
            },
            201,
          )
        }
        const installed = await installCloudSkill(
          c.var.db,
          {
            ...base,
            itemId,
            artifactBytes,
            expectedSha256: cloud.latestVersionSha256,
            version: cloud.latestVersion,
          },
          { logger: c.var.logger },
        )
        return c.json(serializeInstalledSkillResponse(installed, itemId), 201)
      }
      const installed = await installSkill(
        c.var.db,
        { ...base, skillId: itemId },
        { logger: c.var.logger },
      )
      return c.json(serializeInstalledSkillResponse(installed, itemId), 201)
    },
  )
  .post(
    '/uninstall',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Uninstall a marketplace item (skill hard-delete or agent soft-delete).',
      'x-sdk-name': 'marketplace.uninstall',
      responses: {
        200: {
          description: 'The removed installation, discriminated by item kind.',
          content: { 'application/json': { schema: resolver(UninstallMarketplaceItemResponseSchema) } },
        },
        403: { description: 'The skill is system-installed; uninstall blocked.' },
        404: { description: 'Item not in catalog, not installed, OR workspace not found.' },
      },
    }),
    validator('json', UninstallMarketplaceItemBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { itemId } = c.req.valid('json')
      const workspace = c.var.workspace!
      // The SAME per-kind resolution the list annotator uses (skills key on
      // skillId, agents on slug === itemId AND source === 'community',
      // workspace-scope preferred) — so the row we remove is exactly the one
      // the card shows as "Installed", and a hand-made agent with a
      // colliding slug is never soft-deleted here.
      const item = getMarketplaceItem(
        c.var.db,
        { itemId, userId: c.var.user.id, workspaceId: workspace.id },
        marketplaceDeps,
      )
      if (item.installStatus.kind !== 'installed') {
        throw new NotFoundError('installed-item', itemId)
      }
      if (item.kind === 'agent') {
        await softDeleteAgent(
          c.var.db,
          { agentId: item.installStatus.installedId, userId: c.var.user.id },
          { logger: c.var.logger },
        )
        return c.json({ kind: 'agent' as const, agentId: item.installStatus.installedId, itemId })
      }
      await uninstallSkill(
        c.var.db,
        {
          userId: c.var.user.id,
          installedSkillId: item.installStatus.installedId,
          workspacePath: workspace.path,
        },
        { logger: c.var.logger },
      )
      return c.json({
        kind: 'skill' as const,
        installedSkillId: item.installStatus.installedId,
        itemId,
      })
    },
  )

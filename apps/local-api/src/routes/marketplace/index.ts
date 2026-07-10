// HTTP routes for the `marketplace` domain, mounted under
// `/workspaces/:workspaceId/marketplace`. Three routes: `GET /items` (list,
// annotated with install status) + `GET /items/:itemId` (detail) +
// `POST /install`. Owner-filtered via `...workspaceScoped`.
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
import { ValidationError } from '@vynel/errors'
import { listMarketplaceItems, getMarketplaceItem, findCachedCloudItem } from '@vynel/marketplace'
import { listInstalledSkillsForUserAndWorkspace, installSkill, installCloudSkill } from '@vynel/skills'
import {
  ListMarketplaceItemsQuerySchema,
  ItemIdParamSchema,
  ListMarketplaceItemsResponseSchema,
  MarketplaceItemSchema,
  InstallMarketplaceItemBodySchema,
  InstallMarketplaceItemResponseSchema,
} from './schemas.js'
import { serializeMarketplaceItem } from './serializers.js'

const marketplaceDeps = { listInstalledSkills: listInstalledSkillsForUserAndWorkspace }

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
      // its in-code template. One route, dispatched by cache membership.
      const cloud = findCachedCloudItem(c.var.db, itemId)
      let installed
      if (cloud !== null) {
        if (c.var.hubSession === undefined) {
          throw new ValidationError('The hub is not available to download this item.')
        }
        const artifactBytes = await c.var.hubSession.downloadArtifact(itemId, cloud.latestVersion)
        installed = await installCloudSkill(
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
      } else {
        installed = await installSkill(c.var.db, { ...base, skillId: itemId }, { logger: c.var.logger })
      }
      return c.json(
        {
          installedSkillId: installed.id,
          itemId,
          scope: installed.scope,
          source: installed.installedFromSource,
          version: installed.versionInstalled,
        },
        201,
      )
    },
  )

// HTTP routes for the `marketplace` domain. Two read-only routes per
// blueprint §6 — `GET /items` (list, annotated with install status) +
// `GET /items/:itemId` (detail). Owner-filtered via `...workspaceScoped`.
// Mounted under `/workspaces/:workspaceId/marketplace` in `app.ts`.
//
// The install-status annotation is derived from the caller's installed
// skills. The `@vynel/marketplace` LEAF never imports the `skills`
// sibling leaf (invariant #2); it takes the reader as an injected dep.
// This route file is the composition point — apps compose leaves — so
// it imports `listInstalledSkillsForUserAndWorkspace` from `@vynel/skills`
// and passes it as `deps.listInstalledSkills`.
//
// **No `POST /install`** (D7 — UI calls `POST /skills/install`
// directly). **No `x-mcp`** (D9 — skills already exposes
// `list_available_skills` + `list_installed_skills`; marketplace's
// reads are the join of those two, redundant for the LLM).
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
import { listMarketplaceItems, getMarketplaceItem } from '@vynel/marketplace'
import { listInstalledSkillsForUserAndWorkspace } from '@vynel/skills'
import {
  ListMarketplaceItemsQuerySchema,
  ItemIdParamSchema,
  ListMarketplaceItemsResponseSchema,
  MarketplaceItemSchema,
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

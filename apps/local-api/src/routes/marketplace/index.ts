// HTTP routes for the `marketplace` domain's WORKSPACE surface, mounted
// under `/workspaces/:workspaceId/marketplace`. Four routes: `GET /items`
// (list, annotated with install status) + `GET /items/:itemId` (detail) +
// `POST /install` + `POST /uninstall`. Owner-filtered via
// `...workspaceScoped`. This surface lists items whose scope is
// 'workspace' or 'both' (`surface: 'workspace'`); the GLOBAL twin lives
// in `user-scoped.ts`. The per-kind install/uninstall dispatch and the
// leaf's injected-deps binding live in `item-lifecycle.ts` — ONE home,
// shared with the user-scoped twin.
//
// **`POST /install` lives HERE, not in `/skills/install`** (M4b-2 reverses
// the old D7): a CLOUD item requires a server-side download + sha256 verify
// before install, so the dispatch keys on cache membership — a cached
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
import { listMarketplaceItems, getMarketplaceItem } from '@vynel/marketplace'
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
import { serializeMarketplaceItem } from './serializers.js'
import {
  marketplaceDeps,
  installMarketplaceItem,
  uninstallMarketplaceItem,
} from './item-lifecycle.js'

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
        surface: 'workspace',
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
          surface: 'workspace',
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
      // Surface gate + per-kind dispatch (cloud artifact vs bundled
      // template, skill vs agent) live in `item-lifecycle.ts` — shared with
      // the user-scoped twin, including the non-installable-kind
      // fall-through semantics. A user-only item 404s here exactly like an
      // unknown id.
      const installed = await installMarketplaceItem(
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger },
        {
          itemId,
          userId: c.var.user.id,
          scope,
          workspace: { id: workspace.id, path: workspace.path },
        },
      )
      return c.json(installed, 201)
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
      // Resolution + per-kind dispatch live in `item-lifecycle.ts`: the
      // SAME resolution the list annotator uses (skills key on skillId,
      // agents on slug === itemId AND source === 'community',
      // workspace-scope preferred) — so the row removed is exactly the one
      // the card shows as "Installed", and a hand-made agent with a
      // colliding slug is never soft-deleted here.
      const removed = await uninstallMarketplaceItem(
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger },
        {
          itemId,
          userId: c.var.user.id,
          workspace: { id: workspace.id, path: workspace.path },
        },
      )
      return c.json(removed)
    },
  )

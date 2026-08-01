// HTTP routes for the `marketplace` domain's WORKSPACE surface, mounted
// under `/workspaces/:workspaceId/marketplace`. Five routes: `GET /items`
// (list, annotated with install status) + `GET /items/:itemId` (detail) +
// `POST /install` + `POST /update` + `POST /uninstall`. Owner-filtered via
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
// in-code template. **All five routes are `x-mcp`-exposed** (task 4b, Chad
// 2026-07-26 — reverses D9's no-exposure call: install/uninstall are genuinely
// useful agent tools, and they need the reads for itemId discovery, which the
// skills lists don't carry).
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
  UpdateMarketplaceItemBodySchema,
  UpdateMarketplaceItemResponseSchema,
  UninstallMarketplaceItemBodySchema,
  UninstallMarketplaceItemResponseSchema,
} from './schemas.js'
import { serializeMarketplaceItem } from './serializers.js'
import {
  marketplaceDepsWith,
  installMarketplaceItem,
  updateMarketplaceItem,
  uninstallMarketplaceItem,
} from './item-lifecycle.js'
import { mcpServersReaderFor } from './mcp-item-lifecycle.js'
import { rulesReaderFor } from './rule-item-lifecycle.js'

export const marketplaceApp = factory
  .createApp()
  .get(
    '/items',
    describeRoute({
      tags: ['marketplace'],
      summary: 'List marketplace items annotated with install status.',
      'x-sdk-name': 'marketplace.listItems',
      'x-mcp': {
        exposed: true,
        name: 'list_marketplace_items',
        description:
          'Browse the marketplace for this workspace — skills, agents, plugins, MCP servers, ' +
          'and rules the user can install, each annotated with its install state. Optional filters: `category`, ' +
          '`publisherTier`, `installState`, `searchQuery`, `sortBy`. Use when the user wants a ' +
          'capability Vynel does not have yet ("can you do X?") — find the item, then ' +
          'install_marketplace_item with its id. Read-only.',
      },
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
      const items = listMarketplaceItems(
        c.var.db,
        input,
        marketplaceDepsWith(
          c.var.marketplaceInstalledPluginsReader,
          mcpServersReaderFor({ path: c.var.workspace!.path }),
          rulesReaderFor({ path: c.var.workspace!.path }),
        ),
      )
      return c.json(items.map(serializeMarketplaceItem))
    },
  )
  .get(
    '/items/:itemId',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Get one marketplace item annotated with install status.',
      'x-sdk-name': 'marketplace.getItem',
      'x-mcp': {
        exposed: true,
        name: 'get_marketplace_item',
        description:
          'Get one marketplace item by `itemId` (from list_marketplace_items) with its full ' +
          'description and install state — read it before installing so you can tell the user ' +
          'what the item does. Read-only.',
      },
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
        marketplaceDepsWith(
          c.var.marketplaceInstalledPluginsReader,
          mcpServersReaderFor({ path: c.var.workspace!.path }),
          rulesReaderFor({ path: c.var.workspace!.path }),
        ),
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
      'x-mcp': {
        exposed: true,
        name: 'install_marketplace_item',
        description:
          'Install a marketplace item (a skill, agent, plugin, MCP server, or rule) into this ' +
          'workspace. `itemId` from list_marketplace_items; `scope` "workspace" or "user" ' +
          '(user-scope = available in every workspace; plugins are always user-scope). Cloud ' +
          'artifacts are downloaded and integrity-verified server-side; plugins install ' +
          'through Claude Code\'s own plugin system; MCP servers are written into the ' +
          'scope\'s Claude config. Reversible via uninstall_marketplace_item. Side effect: ' +
          'the capability becomes available in sessions and appears in the user\'s panels.',
        mutatingApproved: true,
      },
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
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger, pluginDelegate: c.var.marketplacePluginDelegate, listInstalledPlugins: c.var.marketplaceInstalledPluginsReader },
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
    '/update',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Update an installed skill to the catalog’s latest version.',
      'x-sdk-name': 'marketplace.update',
      // Overwrites the installed SKILL.md with the newer official bytes —
      // mutating (cards in ask mode) but not the DELETE tier: nothing is
      // removed and a re-run is a repair.
      'x-mcp': {
        exposed: true,
        name: 'update_marketplace_item',
        description:
          'Update an installed marketplace skill to the newest catalog version, by `itemId`. ' +
          'Use when the item shows a newer version than the installed one. Downloads and ' +
          'integrity-verifies the new artifact server-side, then replaces the installed ' +
          'SKILL.md. Skills only — agents and plugins must be uninstalled and reinstalled ' +
          'instead.',
        mutatingApproved: true,
      },
      responses: {
        200: {
          description: 'The updated installed skill.',
          content: { 'application/json': { schema: resolver(UpdateMarketplaceItemResponseSchema) } },
        },
        400: { description: 'Agent item, no cloud version, or hub unavailable.' },
        404: { description: 'Item not in catalog, not installed, OR workspace not found.' },
      },
    }),
    validator('json', UpdateMarketplaceItemBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { itemId } = c.req.valid('json')
      const workspace = c.var.workspace!
      // Resolution + the skills-only dispatch live in `item-lifecycle.ts`,
      // shared with the user-scoped twin. Targets the SAME row the card
      // shows as "Installed" (the annotator's resolution).
      const updated = await updateMarketplaceItem(
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger, pluginDelegate: c.var.marketplacePluginDelegate, listInstalledPlugins: c.var.marketplaceInstalledPluginsReader },
        {
          itemId,
          userId: c.var.user.id,
          workspace: { id: workspace.id, path: workspace.path },
        },
      )
      return c.json(updated)
    },
  )
  .post(
    '/uninstall',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Uninstall a marketplace item (skill hard-delete or agent soft-delete).',
      'x-sdk-name': 'marketplace.uninstall',
      // A skill uninstall HARD-DELETES its files — destructive, so it opts into
      // the ask-approval tier (cards in ask mode; uncarded in auto/bypass).
      'x-mcp': {
        exposed: true,
        name: 'uninstall_marketplace_item',
        description:
          'Uninstall a marketplace item from this workspace by `itemId`. A skill uninstall ' +
          'hard-deletes its files (re-install is possible but any local edits are lost); an ' +
          'agent uninstall is a soft-delete; a plugin uninstall removes it via Claude Code\'s ' +
          'plugin system; MCP-server and rule uninstalls remove the config entry / rules file. Confirm ' +
          'intent when the user names the item loosely.',
        mutatingApproved: true,
        askApproval: true,
      },
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
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger, pluginDelegate: c.var.marketplacePluginDelegate, listInstalledPlugins: c.var.marketplaceInstalledPluginsReader },
        {
          itemId,
          userId: c.var.user.id,
          workspace: { id: workspace.id, path: workspace.path },
        },
      )
      return c.json(removed)
    },
  )

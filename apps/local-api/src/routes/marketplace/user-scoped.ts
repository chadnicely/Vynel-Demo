// The USER-scoped `marketplace` HTTP surface — the GLOBAL marketplace,
// mounted at `/marketplace` (NO workspace prefix) from `app.ts`, alongside
// the untouched workspace-scoped twin (`/workspaces/:workspaceId/
// marketplace`). Chad's rule: this surface lists items whose scope is
// 'user' or 'both' (`surface: 'global'` to the leaf), annotates against
// USER-scoped installs only, and ALWAYS installs/uninstalls at user scope
// (no workspace in play — a user-scope skill lands in `~/.claude/skills`,
// a user-scope agent row carries `workspaceId: null`).
//
//   GET  /items      -> listMarketplaceItems (surface 'global')  [marketplaceUser.listItems]
//   POST /install    -> user-scope install                       [marketplaceUser.install]
//   POST /uninstall  -> user-scope uninstall (per-kind dispatch) [marketplaceUser.uninstall]
//
// Install resolves the item ON this surface inside `item-lifecycle.ts`
// (the ONE surface gate, shared with the workspace twin) — a workspace-only
// item is not installable from here, and the 404 is identical to an
// unknown id (no enumeration leak). The per-kind dispatch is shared
// verbatim too. **No `x-mcp`** (D9, same as the workspace surface).
//
// Locked Hono protocol: describeRoute -> validator -> `...userScoped` ->
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them). Schemas + serializers are
// REUSED from the workspace-scoped surface.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { listMarketplaceItems } from '@vynel/marketplace'
import {
  ListMarketplaceItemsQuerySchema,
  ListMarketplaceItemsResponseSchema,
  InstallUserMarketplaceItemBodySchema,
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

export const marketplaceUserApp = factory
  .createApp()
  .get(
    '/items',
    describeRoute({
      tags: ['marketplace'],
      summary: 'List the GLOBAL marketplace (user-level items), annotated with install status.',
      'x-sdk-name': 'marketplaceUser.listItems',
      responses: {
        200: {
          description: 'Annotated marketplace items surfaced at the user level.',
          content: { 'application/json': { schema: resolver(ListMarketplaceItemsResponseSchema) } },
        },
      },
    }),
    validator('query', ListMarketplaceItemsQuerySchema),
    ...userScoped,
    (c) => {
      const query = c.req.valid('query')
      // exactOptionalPropertyTypes — conditional assembly, not spread
      // (per the workspaces `listWorkspacesForUser` precedent in MEMORY).
      const input: Parameters<typeof listMarketplaceItems>[1] = {
        userId: c.var.user.id,
        surface: 'global',
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
  .post(
    '/install',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Install a marketplace item at USER scope (available in every workspace).',
      'x-sdk-name': 'marketplaceUser.install',
      responses: {
        201: {
          description: 'The installed item, discriminated by kind.',
          content: { 'application/json': { schema: resolver(InstallMarketplaceItemResponseSchema) } },
        },
        403: { description: 'The caller’s tier may not install this item.' },
        404: { description: 'Item not in the catalog or not surfaced at the user level.' },
        409: { description: 'Already installed at user scope.' },
      },
    }),
    validator('json', InstallUserMarketplaceItemBodySchema),
    ...userScoped,
    async (c) => {
      const { itemId } = c.req.valid('json')
      const installed = await installMarketplaceItem(
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger },
        { itemId, userId: c.var.user.id, scope: 'user', workspace: null },
      )
      return c.json(installed, 201)
    },
  )
  .post(
    '/uninstall',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Uninstall a marketplace item installed at USER scope.',
      'x-sdk-name': 'marketplaceUser.uninstall',
      responses: {
        200: {
          description: 'The removed installation, discriminated by item kind.',
          content: { 'application/json': { schema: resolver(UninstallMarketplaceItemResponseSchema) } },
        },
        403: { description: 'The skill is system-installed; uninstall blocked.' },
        404: { description: 'Item not in the catalog, not surfaced at the user level, OR not installed at user scope.' },
      },
    }),
    validator('json', UninstallMarketplaceItemBodySchema),
    ...userScoped,
    async (c) => {
      const { itemId } = c.req.valid('json')
      // Resolves against USER-scoped installs only (surface 'global') —
      // a workspace-scope install is untouchable from here.
      const removed = await uninstallMarketplaceItem(
        { db: c.var.db, hubSession: c.var.hubSession, logger: c.var.logger },
        { itemId, userId: c.var.user.id, workspace: null },
      )
      return c.json(removed)
    },
  )

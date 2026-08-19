// `/customizations` — everything the user arranges about their app: per-SCOPE
// looks (colours, avatars, menu layout) and the sidebar tree's positions.
// One boot read, whole-row writes (autosave). UI-only surface: no x-mcp.
//   - GET /customizations                     -> listCustomizations
//   - PUT /customizations/scopes/:scopeKey    -> saveScopeCustomization
//   - PUT /customizations/tree-layout         -> saveTreeLayout

import { resolver, validator } from 'hono-openapi/zod'
import { listCustomizations, saveScopeCustomization, saveTreeLayout } from '@vynel/customization'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  CustomizationsResponseSchema,
  SaveScopeCustomizationRequestSchema,
  ScopeCustomizationResponseSchema,
  ScopeKeyParamSchema,
  TreeLayoutSchema,
} from './schemas.js'

export const customizationsApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['customizations'],
      summary: "Everything the user arranged — every scope's look + the tree's positions.",
      'x-sdk-name': 'customizations.list',
      responses: {
        200: {
          description: 'All scope customizations and the tree layout (null until first drag).',
          content: { 'application/json': { schema: resolver(CustomizationsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => c.json(listCustomizations(c.var.db, { userId: c.var.user.id })),
  )
  .put(
    '/scopes/:scopeKey',
    describeRoute({
      tags: ['customizations'],
      summary: "Save one scope's whole customization (autosave writes it entire).",
      'x-sdk-name': 'customizations.saveScope',
      responses: {
        200: {
          description: 'The saved scope customization.',
          content: { 'application/json': { schema: resolver(ScopeCustomizationResponseSchema) } },
        },
        400: { description: 'A colour is not #rrggbb, an image is not a data:image URL, or both colour kinds were set.' },
      },
    }),
    validator('param', ScopeKeyParamSchema),
    validator('json', SaveScopeCustomizationRequestSchema),
    ...userScoped,
    async (c) =>
      c.json(
        saveScopeCustomization(c.var.db, {
          userId: c.var.user.id,
          scopeKey: c.req.valid('param').scopeKey,
          customization: c.req.valid('json'),
        }),
      ),
  )
  .put(
    '/tree-layout',
    describeRoute({
      tags: ['customizations'],
      summary: "Save the sidebar tree's positions whole (one write per drop).",
      'x-sdk-name': 'customizations.saveTreeLayout',
      responses: {
        200: {
          description: 'The saved layout.',
          content: { 'application/json': { schema: resolver(TreeLayoutSchema) } },
        },
      },
    }),
    validator('json', TreeLayoutSchema),
    ...userScoped,
    async (c) =>
      c.json(saveTreeLayout(c.var.db, { userId: c.var.user.id, layout: c.req.valid('json') })),
  )

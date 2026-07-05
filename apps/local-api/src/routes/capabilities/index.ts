// The `capabilities` HTTP surface — 2 routes mounted under
// `/workspaces/:workspaceId/capabilities` from `apps/local-api/src/app.ts`:
//
//   GET  /               -> listCapabilityStatusForWorkspace
//   PUT  /:capabilityId  -> setCapabilityEnabled
//
// Locked Hono protocol: describeRoute (from the local openapi.js wrapper) ->
// validator (from hono-openapi/zod) -> `...workspaceScoped` -> handler.
// Chained methods on `factory.createApp()`.
//
// MCP exposure: NEITHER route carries x-mcp — enabling/disabling a
// capability is a user action, not an agent tool (the source ported this
// as an explicit, rationalized decision, not an oversight).
//
// Error mapping: NONE here. Core ops throw typed `VynelError` subclasses;
// the global `onError` middleware in `app.ts` maps them to HTTP.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  listCapabilityStatusForWorkspace,
  setCapabilityEnabled,
  type CapabilityStatus,
} from '@vynel/capabilities'
import {
  CapabilityIdParamSchema,
  SetCapabilityEnabledBodySchema,
  CapabilityStatusSchema,
  ListCapabilitiesResponseSchema,
} from './schemas.js'
import type { z } from 'zod'

// Return type derives from the response schema (one source of truth) — an
// added/renamed field forces this function to satisfy it or fail typecheck.
function serializeStatus(status: CapabilityStatus): z.infer<typeof CapabilityStatusSchema> {
  return {
    id: status.capability.id,
    displayName: status.capability.displayName,
    description: status.capability.description,
    scope: status.capability.scope,
    isFirstParty: status.capability.isFirstParty,
    isEnabled: status.isEnabled,
  }
}

export const capabilitiesApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['capabilities'],
      summary: 'List capabilities and their enabled state for the active workspace.',
      'x-sdk-name': 'capabilities.list',
      responses: {
        200: {
          description: '{ capabilities: CapabilityStatus[] }.',
          content: { 'application/json': { schema: resolver(ListCapabilitiesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const statuses = listCapabilityStatusForWorkspace(c.var.db, c.var.workspace!.id)
      return c.json({ capabilities: statuses.map(serializeStatus) })
    },
  )
  .put(
    '/:capabilityId',
    describeRoute({
      tags: ['capabilities'],
      summary: 'Enable or disable a capability for the active workspace.',
      'x-sdk-name': 'capabilities.setEnabled',
      responses: {
        200: {
          description: 'The updated CapabilityStatus.',
          content: { 'application/json': { schema: resolver(CapabilityStatusSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('param', CapabilityIdParamSchema),
    validator('json', SetCapabilityEnabledBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { capabilityId } = c.req.valid('param')
      const { isEnabled } = c.req.valid('json')
      setCapabilityEnabled(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        capabilityId,
        isEnabled,
      })
      const updated = listCapabilityStatusForWorkspace(c.var.db, c.var.workspace!.id).find(
        (status) => status.capability.id === capabilityId,
      )!
      return c.json(serializeStatus(updated))
    },
  )

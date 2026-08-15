// The `/tool-policies` HTTP surface — the admin matrix's backend, mounted
// user-scoped from `app.ts`:
//
//   GET    /            -> the EFFECTIVE per-tool matrix (defaults ⊕ overrides)
//   PUT    /:toolName   -> save one tool's override set (full-replace; null =
//                          inherit; an all-null body normalizes to reset)
//   DELETE /:toolName   -> reset to the declared defaults
//
// MCP exposure: NONE, deliberately and permanently — these routes edit the
// very gates that decide which MCP tools a turn gets; an agent that can
// re-enable or un-card its own tools defeats the gate (the capabilities-PUT
// doctrine). No `x-mcp` on any route here.
//
// Error mapping: none here — typed VynelErrors map in app.ts's onError.

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/errors'
import { setToolPolicyOverride, type EffectiveToolPolicy } from '@vynel/capabilities'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { resolveSessionToolPolicies } from '../../sessions/session-tool-catalog.js'
import {
  EffectiveToolPolicySchema,
  ListToolPoliciesResponseSchema,
  SaveToolPolicyBodySchema,
  ToolNameParamSchema,
} from './schemas.js'
import type { z } from 'zod'

function serializePolicy(policy: EffectiveToolPolicy): z.infer<typeof EffectiveToolPolicySchema> {
  return {
    toolName: policy.toolName,
    serverName: policy.serverName,
    enabled: policy.enabled,
    surfaces: [...policy.surfaces],
    cardClass: policy.cardClass,
    ...(policy.featureKey !== undefined ? { featureKey: policy.featureKey } : {}),
    ...(policy.capabilityId !== undefined ? { capabilityId: policy.capabilityId } : {}),
    hasOverride: policy.hasOverride,
  }
}

// The matrix always resolves against the FULL declared surface, desktop
// included — dynamic import keeps the heavy desktop package off boot.
async function resolveFullMatrix(
  db: Parameters<typeof resolveSessionToolPolicies>[0],
  userId: string,
) {
  const { desktopFeatureDescriptor } = await import('@vynel/desktop-control')
  return resolveSessionToolPolicies(db, {
    userId,
    desktopToolNames: desktopFeatureDescriptor.toolNames ?? [],
  })
}

export const toolPoliciesApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['tool-policies'],
      summary: 'List the effective per-tool policy matrix (defaults merged with overrides).',
      'x-sdk-name': 'toolPolicies.list',
      responses: {
        200: {
          description: '{ tools: EffectiveToolPolicy[] } sorted by server then tool.',
          content: { 'application/json': { schema: resolver(ListToolPoliciesResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => {
      const matrix = await resolveFullMatrix(c.var.db, c.var.user.id)
      const tools = [...matrix.values()]
        .sort(
          (a, b) =>
            a.serverName.localeCompare(b.serverName) || a.toolName.localeCompare(b.toolName),
        )
        .map(serializePolicy)
      return c.json({ tools })
    },
  )
  .put(
    '/:toolName',
    describeRoute({
      tags: ['tool-policies'],
      summary: "Save one tool's policy override (full-replace; null fields inherit).",
      'x-sdk-name': 'toolPolicies.save',
      responses: {
        200: {
          description: 'The updated effective policy for the tool.',
          content: { 'application/json': { schema: resolver(EffectiveToolPolicySchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Unknown tool (not in the declared catalog).' },
      },
    }),
    validator('param', ToolNameParamSchema),
    validator('json', SaveToolPolicyBodySchema),
    ...userScoped,
    async (c) => {
      const { toolName } = c.req.valid('param')
      const body = c.req.valid('json')
      const matrix = await resolveFullMatrix(c.var.db, c.var.user.id)
      if (!matrix.has(toolName)) {
        throw new NotFoundError('tool policy', toolName)
      }
      setToolPolicyOverride(c.var.db, {
        userId: c.var.user.id,
        toolName,
        enabled: body.enabled,
        cardClass: body.cardClass,
        surfaces: body.surfaces,
        featureKey: body.featureKey,
        capabilityId: body.capabilityId,
      })
      const updated = (await resolveFullMatrix(c.var.db, c.var.user.id)).get(toolName)!
      return c.json(serializePolicy(updated))
    },
  )
  .delete(
    '/:toolName',
    describeRoute({
      tags: ['tool-policies'],
      summary: "Reset one tool's policy to the declared defaults.",
      'x-sdk-name': 'toolPolicies.reset',
      responses: {
        200: {
          description: 'The tool policy after the reset (its declared defaults).',
          content: { 'application/json': { schema: resolver(EffectiveToolPolicySchema) } },
        },
        404: { description: 'Unknown tool (not in the declared catalog).' },
      },
    }),
    validator('param', ToolNameParamSchema),
    ...userScoped,
    async (c) => {
      const { toolName } = c.req.valid('param')
      const matrix = await resolveFullMatrix(c.var.db, c.var.user.id)
      if (!matrix.has(toolName)) {
        throw new NotFoundError('tool policy', toolName)
      }
      // An all-inherit save IS the reset (the op normalizes it to a delete).
      setToolPolicyOverride(c.var.db, {
        userId: c.var.user.id,
        toolName,
        enabled: null,
        cardClass: null,
        surfaces: null,
        featureKey: null,
        capabilityId: null,
      })
      const updated = (await resolveFullMatrix(c.var.db, c.var.user.id)).get(toolName)!
      return c.json(serializePolicy(updated))
    },
  )

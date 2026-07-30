// The WORKSPACE-scoped `dashboard` HTTP surface — mounted at
// `/workspaces/:workspaceId/dashboard` from `apps/local-api/src/app.ts`,
// alongside the user-scoped twin (`index.ts`). Feeds the per-workspace
// dashboard: same reads, restricted to one workspace's sessions.
//
//   GET /usage -> listDailyModelUsage scoped to the workspace
//                 [no x-mcp — UI-only read]
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// thin handler on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { listDailyModelUsage } from '@vynel/chat'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { DashboardUsageQuerySchema, DashboardUsageResponseSchema } from './schemas.js'

export const dashboardWorkspaceApp = factory.createApp().get(
  '/usage',
  describeRoute({
    tags: ['dashboard'],
    summary: "Get one workspace's token-usage statistics per model per day.",
    'x-sdk-name': 'dashboardWorkspace.getUsage',
    responses: {
      200: {
        description:
          '{ rows: [{ day, model, providerId, inputTokens, outputTokens, assistantMessageCount }] }.',
        content: { 'application/json': { schema: resolver(DashboardUsageResponseSchema) } },
      },
      404: { description: 'No such workspace owned by this user.' },
    },
    // No x-mcp — a UI statistics read, not an agent tool surface.
  }),
  validator('query', DashboardUsageQuerySchema),
  ...workspaceScoped,
  (c) => {
    const { days } = c.req.valid('query')
    const rows = listDailyModelUsage(c.var.db, {
      userId: c.var.user.id,
      workspaceId: c.var.workspace!.id,
      ...(days !== undefined ? { days } : {}),
    })
    return c.json({ rows })
  },
)

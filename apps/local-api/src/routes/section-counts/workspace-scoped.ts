// The WORKSPACE-scoped `section-counts` HTTP surface — mounted at
// `/workspaces/:workspaceId/section-counts` from `apps/local-api/src/app.ts`,
// alongside the user-scoped twin (`index.ts`):
//
//   GET / -> the drilled workspace menu's per-row counts [no x-mcp — a UI read]
//
// Same reads as the global twin plus `apps` (which has no global surface).
//
// Locked Hono protocol: describeRoute → `...workspaceScoped` → thin handler
// on `factory.createApp()`.

import { resolver } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { SectionCountsResponseSchema } from './schemas.js'
import { countSections } from './count-sections.js'

export const sectionCountsWorkspaceApp = factory.createApp().get(
  '/',
  describeRoute({
    tags: ['section-counts'],
    summary: "Get one workspace menu's per-section counts.",
    'x-sdk-name': 'sectionCountsWorkspace.get',
    responses: {
      200: {
        description: '{ counts: { sessions, agents, skills, rules, apps } }.',
        content: { 'application/json': { schema: resolver(SectionCountsResponseSchema) } },
      },
      404: { description: 'No such workspace owned by this user.' },
    },
    // No x-mcp — a menu decoration, not an agent tool surface.
  }),
  ...workspaceScoped,
  async (c) => {
    const workspace = c.var.workspace!
    const counts = await countSections(c.var.db, {
      userId: c.var.user.id,
      workspace: { id: workspace.id, path: workspace.path },
    })
    return c.json({ counts })
  },
)

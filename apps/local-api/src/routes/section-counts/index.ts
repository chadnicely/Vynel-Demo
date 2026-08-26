// The USER-scoped `section-counts` HTTP surface — mounted at
// `/section-counts` from `apps/local-api/src/app.ts`, alongside the
// workspace-scoped twin (`workspace-scoped.ts`):
//
//   GET / -> the Global menu's per-row counts [no x-mcp — a UI read]
//
// Feeds the drilled section menu's right-hand numbers (the canvas's
// `Sessions 13` / `Agents 3` / `Skills 7` / `Rules 2`). Pure assembly over
// existing core reads — see `count-sections.ts` for why each count comes
// from the section's own list function.
//
// Locked Hono protocol: describeRoute → `...userScoped` → thin handler on
// `factory.createApp()`.

import { resolver } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { SectionCountsResponseSchema } from './schemas.js'
import { countSections } from './count-sections.js'

export const sectionCountsApp = factory.createApp().get(
  '/',
  describeRoute({
    tags: ['section-counts'],
    summary: "Get the Global menu's per-section counts.",
    'x-sdk-name': 'sectionCounts.getGlobal',
    responses: {
      200: {
        description: '{ counts: { sessions, agents, skills, rules } } — no `apps` at global scope.',
        content: { 'application/json': { schema: resolver(SectionCountsResponseSchema) } },
      },
    },
    // No x-mcp — a menu decoration, not an agent tool surface.
  }),
  ...userScoped,
  async (c) => {
    const counts = await countSections(c.var.db, {
      userId: c.var.user.id,
      workspace: null,
      provider: c.var.aiProvider,
    })
    return c.json({ counts })
  },
)

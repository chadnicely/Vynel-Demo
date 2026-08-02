// The USER-scoped `skills` HTTP surface — mounted at `/skills` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/skills`). Where that twin FUSES scopes
// (user ∪ that workspace), this one anchors the GLOBAL Skills view: ONLY the
// user-scope installs (available in every workspace).
//
//   GET /installed -> listInstalledSkillsForContext (workspaceId: null)
//
// Read-only: install/uninstall stays on the marketplace + workspace routes.
// No x-mcp: the agent already reads skills through the workspace-scoped
// `list_installed_skills` (which fuses both scopes).

import { resolver } from 'hono-openapi/zod'
import { listInstalledSkillsForContext } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ListInstalledSkillsResponseSchema } from './schemas.js'
import { serializeInstalledSkillWithDefinition } from './serializers.js'

export const skillsUserApp = factory
  .createApp()
  .get(
    '/installed',
    describeRoute({
      tags: ['skills'],
      summary: "List the user's USER-SCOPE installed skills (the global view).",
      'x-sdk-name': 'skillsUser.listInstalled',
      responses: {
        200: {
          description:
            'User-scope installs only (workspaceId null), each joined with its catalog definition.',
          content: { 'application/json': { schema: resolver(ListInstalledSkillsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const list = listInstalledSkillsForContext(c.var.db, {
        userId: c.var.user.id,
        workspaceId: null,
      })
      return c.json(list.map(serializeInstalledSkillWithDefinition))
    },
  )

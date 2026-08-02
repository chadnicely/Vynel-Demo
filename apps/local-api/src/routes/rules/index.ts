// The WORKSPACE-scoped `rules` HTTP surface — mounted at
// `/workspaces/:workspaceId/rules` from `apps/local-api/src/app.ts`. Fuses
// scopes the way Claude Code loads rules in a project (the user's global
// rules + the workspace's own `.claude/rules/`), scope chip per row.
//
//   GET / -> user rows ∪ workspace rows
//
// Read-only v1. No x-mcp (management surface for the human).

import { resolver } from 'hono-openapi/zod'
import { listAllRuleFilesForScope } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { ListRulesResponseSchema } from './schemas.js'
import { serializeRuleFile } from './serializers.js'

export const rulesApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['rules'],
      summary: 'List rule files this workspace resolves: user ∪ workspace.',
      'x-sdk-name': 'rules.list',
      responses: {
        200: {
          description: 'All rule files across both scopes, scope + provenance per row.',
          content: { 'application/json': { schema: resolver(ListRulesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    (c) => {
      const workspacePath = c.var.workspace!.path
      return c.json({
        rules: [
          ...listAllRuleFilesForScope('user').map((rule) => serializeRuleFile(rule, 'user')),
          ...listAllRuleFilesForScope('workspace', workspacePath).map((rule) =>
            serializeRuleFile(rule, 'workspace'),
          ),
        ],
      })
    },
  )

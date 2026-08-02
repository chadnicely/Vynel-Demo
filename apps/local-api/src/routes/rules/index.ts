// The WORKSPACE-scoped `rules` HTTP surface — mounted at
// `/workspaces/:workspaceId/rules` from `apps/local-api/src/app.ts`.
//
//   GET / -> the workspace's OWN `.claude/rules/` files
//
// Scope-exact so the list mirrors the folder on disk. A user-level rule DOES
// still apply to a session here (settingSources loads both) — but it is not
// this workspace's to show or to manage; the Global menu owns it. No composer
// picker reads rules, so there is no `/resolved` twin to build.
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
      summary: "List the workspace's OWN rule files (its folder on disk).",
      'x-sdk-name': 'rules.list',
      responses: {
        200: {
          description: "Rule files in the workspace's `.claude/rules/`, provenance per row.",
          content: { 'application/json': { schema: resolver(ListRulesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    (c) => {
      const workspacePath = c.var.workspace!.path
      return c.json({
        rules: listAllRuleFilesForScope('workspace', workspacePath).map((rule) =>
          serializeRuleFile(rule, 'workspace'),
        ),
      })
    },
  )

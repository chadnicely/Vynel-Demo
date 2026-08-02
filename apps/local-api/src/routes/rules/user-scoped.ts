// The USER-scoped `rules` HTTP surface — mounted at `/rules` from
// `apps/local-api/src/app.ts`, twin of `/workspaces/:workspaceId/rules`.
// The GLOBAL Rules view's anchor: the user's `~/.claude/rules/` folder,
// hand-written files included (the UNFILTERED reader — the marker-filtered
// one stays the marketplace annotator's).
//
//   GET / -> listAllRuleFilesForScope('user')
//
// Read-only v1. No x-mcp (management surface for the human).

import { resolver } from 'hono-openapi/zod'
import { listAllRuleFilesForScope } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ListRulesResponseSchema } from './schemas.js'
import { serializeRuleFile } from './serializers.js'

export const rulesUserApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['rules'],
      summary: "List every rule file in the user's ~/.claude/rules folder.",
      'x-sdk-name': 'rulesUser.list',
      responses: {
        200: {
          description: 'All rule files (hand-written + marketplace), provenance per row.',
          content: { 'application/json': { schema: resolver(ListRulesResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const rules = listAllRuleFilesForScope('user')
      return c.json({ rules: rules.map((rule) => serializeRuleFile(rule, 'user')) })
    },
  )

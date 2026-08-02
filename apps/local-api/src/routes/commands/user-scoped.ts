// The USER-scoped `commands` HTTP surface — mounted at `/commands` from
// `apps/local-api/src/app.ts`, twin of `/workspaces/:workspaceId/commands`.
// The GLOBAL Commands view's anchor: the user's `~/.claude/commands` folder.
//
//   GET / -> listCommandsForScope('user')
//
// Read-only. No x-mcp (management surface for the human).

import { resolver } from 'hono-openapi/zod'
import { listCommandsForScope } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ListCommandsResponseSchema } from './schemas.js'
import { serializeCommandFile } from './serializers.js'

export const commandsUserApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['commands'],
      summary: "List the user's global slash commands (~/.claude/commands).",
      'x-sdk-name': 'commandsUser.list',
      responses: {
        200: {
          description: 'One row per command file, namespaced by subfolder.',
          content: { 'application/json': { schema: resolver(ListCommandsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const commands = listCommandsForScope('user')
      return c.json({
        commands: commands.map((command) => serializeCommandFile(command, 'user')),
      })
    },
  )

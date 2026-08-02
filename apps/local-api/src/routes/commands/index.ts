// The WORKSPACE-scoped `commands` HTTP surface — mounted at
// `/workspaces/:workspaceId/commands` from `apps/local-api/src/app.ts`.
// Fuses scopes the way Claude Code resolves slash commands in a project
// (user + the workspace's `.claude/commands`), scope chip per row.
//
//   GET / -> user rows ∪ workspace rows
//
// Read-only. No x-mcp (management surface for the human).

import { resolver } from 'hono-openapi/zod'
import { listCommandsForScope } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { ListCommandsResponseSchema } from './schemas.js'
import { serializeCommandFile } from './serializers.js'

export const commandsApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['commands'],
      summary: 'List slash commands this workspace resolves: user ∪ workspace.',
      'x-sdk-name': 'commands.list',
      responses: {
        200: {
          description: 'One row per command file across both scopes, scope per row.',
          content: { 'application/json': { schema: resolver(ListCommandsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    (c) => {
      const workspacePath = c.var.workspace!.path
      return c.json({
        commands: [
          ...listCommandsForScope('user').map((command) => serializeCommandFile(command, 'user')),
          ...listCommandsForScope('workspace', workspacePath).map((command) =>
            serializeCommandFile(command, 'workspace'),
          ),
        ],
      })
    },
  )

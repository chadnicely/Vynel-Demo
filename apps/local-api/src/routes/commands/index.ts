// The WORKSPACE-scoped `commands` HTTP surface — mounted at
// `/workspaces/:workspaceId/commands` from `apps/local-api/src/app.ts`.
//
//   GET / -> the workspace's OWN `.claude/commands` rows
//
// The MENU's read: it must mirror the folder on disk — a user-level row
// listed here invites managing a global file from a room that doesn't own
// it. The composer's "/" picker asks the other question ("what can I run
// here", the user ∪ workspace union) and reads `GET /commands/resolved` on
// the top-level mount — one route for the global root and a workspace turn.
//
// Read-only; the write doors live on the top-level mount too (`user-scoped.ts`).

import { resolver } from 'hono-openapi/zod'
import { listCommandsForScope } from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { ListCommandsResponseSchema } from './schemas.js'
import { serializeCommandFile } from './serializers.js'

export const commandsApp = factory.createApp().get(
  '/',
  describeRoute({
    tags: ['commands'],
    summary: "List the workspace's OWN slash commands (its folder on disk).",
    'x-sdk-name': 'commands.list',
    responses: {
      200: {
        description: "One row per command file in the workspace's `.claude/commands`.",
        content: { 'application/json': { schema: resolver(ListCommandsResponseSchema) } },
      },
      404: { description: 'Workspace not found.' },
    },
  }),
  ...workspaceScoped,
  (c) => {
    const workspacePath = c.var.workspace!.path
    return c.json({
      commands: listCommandsForScope('workspace', workspacePath).map((command) =>
        serializeCommandFile(command, 'workspace'),
      ),
    })
  },
)

// The WORKSPACE-scoped `commands` HTTP surface — mounted at
// `/workspaces/:workspaceId/commands` from `apps/local-api/src/app.ts`.
//
//   GET /          -> the workspace's OWN `.claude/commands` rows
//   GET /resolved  -> user ∪ workspace, the way Claude Code resolves a project
//
// Two reads because they answer different questions. The menu asks "what is in
// THIS workspace" and must mirror the folder on disk — a user-level row listed
// there invites managing a global file from a room that doesn't own it. The
// composer's "/" picker asks "what can I run here", which is the union, because
// `settingSources: ['user','project','local']` really does load both.
//
// Read-only. No x-mcp (management surface for the human; Claude reaches its
// commands through the CLI itself).

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
  .get(
    '/resolved',
    describeRoute({
      tags: ['commands'],
      summary: 'List every slash command runnable here: user ∪ workspace.',
      'x-sdk-name': 'commands.listResolved',
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

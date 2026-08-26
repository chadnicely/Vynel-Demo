// The top-level `commands` HTTP surface — mounted at `/commands` from
// `apps/local-api/src/app.ts`; the workspace-OWNED read is its twin at
// `/workspaces/:workspaceId/commands`.
//
//   GET    /               -> the user's own ~/.claude/commands folder (the GLOBAL view)
//   GET    /resolved       -> user folder ∪ one workspace's — what a session there can run
//   PUT    /:commandName   -> create or replace one of the user's own commands
//   DELETE /:commandName   -> delete one command file
//
// Commands are config-is-truth: the `<name>.md` file IS the record (a `:` in
// the name is a subfolder — `git:commit` ↔ `git/commit.md`). The write door
// takes the command's PARTS (description, argument hint, body) — the leaf
// renders the frontmatter and keeps any key a hand-authored file carried.
// Scope-taking routes take `{ scope, workspaceId? }` the way `/agents` does
// (top-level mount, ambient workspace stamp) so ONE tool name serves the
// global root and a workspace conversation alike.
//
// MCP: `list_commands`, `write_command`, `delete_command` on the root +
// workspace-interactive surfaces only. `delete_command` cards as every DELETE
// does; a written command changes nothing until someone runs it, so
// `write_command` stays card class `never` (the create_agent shape).

import { resolver, validator } from 'hono-openapi/zod'
import {
  deleteOwnCommandFileForScope,
  listCommandsForScope,
  readCommandFileForScope,
  writeOwnCommandFileForScope,
} from '@vynel/skills'
import { NotFoundError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { resolveScopeTarget, workspacePathOf } from '../_shared/resolve-scope-target.js'
import {
  CommandNameParamSchema,
  CommandRowSchema,
  CommandScopeQuerySchema,
  ListCommandsResponseSchema,
  ResolvedCommandsQuerySchema,
  WriteCommandBodySchema,
} from './schemas.js'
import { serializeCommandFile } from './serializers.js'

const COMMAND_SCOPE_ARGUMENTS =
  '`scope` is "user" (~/.claude/commands — runnable in every workspace) or "workspace" ' +
  '(<workspace>/.claude/commands; + `workspaceId`, defaults to the active workspace; on the global ' +
  'surface there is none, so pass it explicitly).'

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
  // Declared before `/:commandName` so the static segment is never read as a name.
  .get(
    '/resolved',
    describeRoute({
      tags: ['commands'],
      summary: "List every slash command runnable in a scope: the user folder ∪ one workspace's.",
      'x-sdk-name': 'commands.listResolved',
      'x-mcp': {
        exposed: true,
        name: 'list_commands',
        description:
          "List the user's slash commands — every command file in ~/.claude/commands (scope " +
          '"user", runnable in every workspace) plus the workspace\'s own .claude/commands when ' +
          '`workspaceId` is set (defaults to the active workspace; omit on the global surface). ' +
          'Each row: commandName (what the user types after "/", e.g. "git:commit"), description, ' +
          'argumentHint, the full file content, and scope. A command is a reusable prompt the ' +
          'user runs by name; use this to see what exists before writing one, or when the user ' +
          'asks what commands they have. Read-only.',
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: "User-scope commands first, then the workspace's (when workspaceId is given).",
          content: { 'application/json': { schema: resolver(ListCommandsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ResolvedCommandsQuerySchema),
    ...userScoped,
    async (c) => {
      const { workspaceId } = c.req.valid('query')
      const target =
        workspaceId === undefined
          ? null
          : await resolveScopeTarget(c.var.db, c.var.user.id, { scope: 'workspace', workspaceId })
      const commands = [
        ...listCommandsForScope('user').map((command) => serializeCommandFile(command, 'user')),
        ...(target?.scope === 'workspace'
          ? listCommandsForScope('workspace', target.workspacePath).map((command) =>
              serializeCommandFile(command, 'workspace'),
            )
          : []),
      ]
      return c.json({ commands })
    },
  )
  .put(
    '/:commandName',
    describeRoute({
      tags: ['commands'],
      summary: "Create or replace one of the user's own slash commands.",
      'x-sdk-name': 'commands.write',
      'x-mcp': {
        exposed: true,
        name: 'write_command',
        description:
          'Create or replace ONE slash command — a reusable prompt the user runs by typing ' +
          '"/<commandName>" (kebab-case; a ":" groups commands in a folder, e.g. "git:commit"). ' +
          `${COMMAND_SCOPE_ARGUMENTS} \`body\` is the prompt Claude runs (markdown; "$ARGUMENTS" ` +
          'stands for what the user types after the name); `description` is the one-line summary ' +
          'shown in the "/" menu; `argumentHint` (optional) names the expected arguments, e.g. ' +
          '"[pr-number]". Replaces the file — read it with list_commands first when editing; ' +
          'frontmatter keys you did not send are kept. Only write a command when the user asked ' +
          'for one. Mutating.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: 'The command file as it now reads on disk.',
          content: { 'application/json': { schema: resolver(CommandRowSchema) } },
        },
        400: {
          description:
            'Unsafe command name, empty or oversized parts, or workspaceId missing for the workspace scope.',
        },
        404: { description: 'Workspace not found (or not owned by this user).' },
      },
    }),
    validator('param', CommandNameParamSchema),
    validator('json', WriteCommandBodySchema),
    ...userScoped,
    async (c) => {
      const { commandName } = c.req.valid('param')
      const body = c.req.valid('json')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, body)
      await writeOwnCommandFileForScope({
        scope: target.scope,
        commandName,
        description: body.description ?? null,
        argumentHint: body.argumentHint ?? null,
        body: body.body,
        ...workspacePathOf(target),
      })
      const written = readCommandFileForScope(target.scope, commandName, target.workspacePath)
      if (written === null) throw new NotFoundError('command', commandName)
      return c.json(serializeCommandFile(written, target.scope))
    },
  )
  .delete(
    '/:commandName',
    describeRoute({
      tags: ['commands'],
      summary: 'Delete one slash-command file at a scope.',
      'x-sdk-name': 'commands.delete',
      'x-mcp': {
        exposed: true,
        name: 'delete_command',
        description:
          `Delete ONE slash command by \`commandName\`. ${COMMAND_SCOPE_ARGUMENTS} Removes the file ` +
          'from disk so "/<commandName>" stops working. Irreversible; confirm with the user unless ' +
          'they just asked for exactly this.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        204: { description: 'Deleted (no body).' },
        400: { description: 'Unsafe command name, or workspaceId missing for the workspace scope.' },
        404: { description: 'No such command at that scope, or workspace not found.' },
      },
    }),
    validator('param', CommandNameParamSchema),
    validator('query', CommandScopeQuerySchema),
    ...userScoped,
    async (c) => {
      const { commandName } = c.req.valid('param')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, c.req.valid('query'))
      await deleteOwnCommandFileForScope({
        scope: target.scope,
        commandName,
        ...workspacePathOf(target),
      })
      return c.body(null, 204)
    },
  )

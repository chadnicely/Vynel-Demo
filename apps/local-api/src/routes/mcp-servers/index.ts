// The WORKSPACE-scoped `mcp-servers` HTTP surface — mounted at
// `/workspaces/:workspaceId/mcp-servers` from `apps/local-api/src/app.ts`.
// Every verb here speaks for the workspace's OWN `.mcp.json` and nothing else,
// so the list mirrors that file on disk and the read agrees with the writes
// beside it. A user-scope server still applies to a session here, but it is
// the Global menu's to show and to remove — one config file, one route home.
// (Listing user rows here is what let a click in room A delete a server from
// every room.) No composer picker reads MCP servers: no `/resolved` twin.
//
//   GET    /                   -> the workspace's own rows, masked
//   POST   /                   -> addCustomMcpServerForScope (workspace .mcp.json)
//   POST   /:serverName/login  -> native browser OAuth via the auth delegate
//   DELETE /:serverName        -> removeMcpServerForScope    (workspace .mcp.json)
//
// No x-mcp anywhere (management surface for the human — see the user twin).
// SECURITY: masked responses; logs carry serverName/scope only.

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError, ValidationError } from '@vynel/errors'
import {
  addCustomMcpServerForScope,
  approveProjectMcpjsonServer,
  listMcpServersForScope,
  removeMcpServerForScope,
} from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  AddMcpServerRequestSchema,
  ListMcpServersResponseSchema,
  LoginMcpServerResponseSchema,
  McpServerRowSchema,
  ServerNameParamSchema,
} from './schemas.js'
import { serializeMcpServer, toSkillRequiredMcpServer } from './serializers.js'

export const mcpServersApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['mcp-servers'],
      summary: "List the workspace's OWN MCP servers (its .mcp.json), secrets masked.",
      'x-sdk-name': 'mcpServers.list',
      responses: {
        200: {
          description: "Masked rows from the workspace's own `.mcp.json`.",
          content: { 'application/json': { schema: resolver(ListMcpServersResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    (c) => {
      const workspacePath = c.var.workspace!.path
      return c.json({
        servers: listMcpServersForScope('workspace', workspacePath).map((server) =>
          serializeMcpServer(server, 'workspace'),
        ),
      })
    },
  )
  .post(
    '/',
    describeRoute({
      tags: ['mcp-servers'],
      summary: "Add a custom MCP server to this workspace's .mcp.json.",
      'x-sdk-name': 'mcpServers.add',
      responses: {
        201: {
          description: 'The added server, masked.',
          content: { 'application/json': { schema: resolver(McpServerRowSchema) } },
        },
        400: { description: 'Invalid body, or a non-https remote URL (loopback exempt).' },
        404: { description: 'Workspace not found.' },
        409: { description: "A server with that name already exists in this workspace's config." },
      },
    }),
    validator('json', AddMcpServerRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const workspacePath = c.var.workspace!.path
      await addCustomMcpServerForScope({
        scope: 'workspace',
        workspacePath,
        server: toSkillRequiredMcpServer(body),
      })
      c.var.logger.info(
        { serverName: body.serverName, scope: 'workspace', workspaceId: c.var.workspace!.id },
        'custom mcp server added',
      )
      const added = listMcpServersForScope('workspace', workspacePath).find(
        (server) => server.serverName === body.serverName,
      )!
      return c.json(serializeMcpServer(added, 'workspace'), 201)
    },
  )
  .post(
    '/:serverName/login',
    describeRoute({
      tags: ['mcp-servers'],
      summary: 'Sign in to a remote MCP server via the native browser OAuth flow.',
      'x-sdk-name': 'mcpServers.login',
      responses: {
        200: {
          description: 'The CLI recorded the credential in its native store.',
          content: { 'application/json': { schema: resolver(LoginMcpServerResponseSchema) } },
        },
        400: { description: 'A local (stdio) server, or the sign-in failed/timed out.' },
        404: { description: "Workspace not found, or no such server in this workspace's config." },
      },
    }),
    validator('param', ServerNameParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { serverName } = c.req.valid('param')
      const workspacePath = c.var.workspace!.path
      const server = listMcpServersForScope('workspace', workspacePath).find(
        (entry) => entry.serverName === serverName,
      )
      if (server === undefined) throw new NotFoundError('MCP server', serverName)
      if (server.transport === 'stdio') {
        throw new ValidationError(
          `'${serverName}' runs locally on this machine — there is nothing to sign in to.`,
        )
      }
      // A `.mcp.json` server stays UNTRUSTED to Claude Code until the
      // project approval lands in `~/.claude.json` — the login refuses
      // with "awaiting approval" otherwise. New installs record it at
      // write time; a provenance-marked entry from BEFORE that fix is
      // proof of a past carded consent, so heal it here (idempotent).
      // Hand-added unmarked entries never get auto-approval — that
      // consent belongs to Claude Code's own review flow.
      if (server.provenanceItemId !== null) {
        await approveProjectMcpjsonServer(workspacePath, serverName)
      }
      // The CLI resolves a `.mcp.json` server from its working directory,
      // so the login must run inside the workspace. It opens the user's
      // browser; Vynel never touches the token.
      await c.var.mcpAuthDelegate.login({ serverName, workingDirectory: workspacePath })
      c.var.logger.info(
        { serverName, scope: 'workspace', workspaceId: c.var.workspace!.id },
        'mcp server connected',
      )
      return c.json({ connected: true as const })
    },
  )
  .delete(
    '/:serverName',
    describeRoute({
      tags: ['mcp-servers'],
      summary: "Remove an MCP server from this workspace's .mcp.json.",
      'x-sdk-name': 'mcpServers.remove',
      responses: {
        204: { description: 'Removed.' },
        404: { description: "Workspace not found, or no such server in this workspace's config." },
      },
    }),
    validator('param', ServerNameParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { serverName } = c.req.valid('param')
      const workspacePath = c.var.workspace!.path
      const exists = listMcpServersForScope('workspace', workspacePath).some(
        (server) => server.serverName === serverName,
      )
      if (!exists) throw new NotFoundError('MCP server', serverName)
      await removeMcpServerForScope({ scope: 'workspace', workspacePath, serverName })
      c.var.logger.info(
        { serverName, scope: 'workspace', workspaceId: c.var.workspace!.id },
        'mcp server removed',
      )
      return c.body(null, 204)
    },
  )

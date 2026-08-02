// The WORKSPACE-scoped `mcp-servers` HTTP surface — mounted at
// `/workspaces/:workspaceId/mcp-servers` from `apps/local-api/src/app.ts`.
// Every verb here speaks for the workspace's OWN `.mcp.json` and nothing else,
// so the list mirrors that file on disk and the read agrees with the writes
// beside it. A user-scope server still applies to a session here, but it is
// the Global menu's to show and to remove — one config file, one route home.
// (Listing user rows here is what let a click in room A delete a server from
// every room.) No composer picker reads MCP servers: no `/resolved` twin.
//
//   GET    /             -> the workspace's own rows, masked
//   POST   /             -> addCustomMcpServerForScope (workspace .mcp.json)
//   DELETE /:serverName  -> removeMcpServerForScope    (workspace .mcp.json)
//
// No x-mcp anywhere (management surface for the human — see the user twin).
// SECURITY: masked responses; logs carry serverName/scope only.

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/errors'
import {
  addCustomMcpServerForScope,
  listMcpServersForScope,
  removeMcpServerForScope,
} from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  AddMcpServerRequestSchema,
  ListMcpServersResponseSchema,
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

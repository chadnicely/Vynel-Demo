// The USER-scoped `mcp-servers` HTTP surface — mounted at `/mcp-servers`
// from `apps/local-api/src/app.ts`, alongside the workspace-scoped twin
// (`/workspaces/:workspaceId/mcp-servers`). This one manages the user's
// global Claude MCP config (`~/.claude.json` mcpServers):
//
//   GET    /                   -> listMcpServersForScope('user')   (masked rows)
//   POST   /                   -> addCustomMcpServerForScope       (409 on collision)
//   POST   /:serverName/login  -> native browser OAuth via the auth delegate
//   DELETE /:serverName        -> removeMcpServerForScope          (404 when absent)
//
// No x-mcp on ANY route: this is the human's management surface (the agents-
// routes posture for config would let the model rewrite its own tool wiring).
// Adds are user-initiated from a form — no approval card.
//
// SECURITY: responses are masked (names + presence — see serializers.ts);
// logs carry serverName/scope ONLY, never URLs, header or env values.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler.

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError, ValidationError } from '@vynel/errors'
import {
  addCustomMcpServerForScope,
  listMcpServersForScope,
  removeMcpServerForScope,
} from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  AddMcpServerRequestSchema,
  ListMcpServersResponseSchema,
  LoginMcpServerResponseSchema,
  McpServerRowSchema,
  ServerNameParamSchema,
} from './schemas.js'
import { serializeMcpServer, toSkillRequiredMcpServer } from './serializers.js'

export const mcpServersUserApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['mcp-servers'],
      summary: "List the user's global MCP servers (~/.claude.json), secrets masked.",
      'x-sdk-name': 'mcpServersUser.list',
      responses: {
        200: {
          description: 'Masked rows — header/env values never leave the backend.',
          content: { 'application/json': { schema: resolver(ListMcpServersResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const servers = listMcpServersForScope('user')
      return c.json({ servers: servers.map((server) => serializeMcpServer(server, 'user')) })
    },
  )
  .post(
    '/',
    describeRoute({
      tags: ['mcp-servers'],
      summary: 'Add a custom MCP server to the global config (~/.claude.json).',
      'x-sdk-name': 'mcpServersUser.add',
      responses: {
        201: {
          description: 'The added server, masked.',
          content: { 'application/json': { schema: resolver(McpServerRowSchema) } },
        },
        400: { description: 'Invalid body, or a non-https remote URL (loopback exempt).' },
        409: { description: 'A server with that name already exists in the global config.' },
      },
    }),
    validator('json', AddMcpServerRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      await addCustomMcpServerForScope({ scope: 'user', server: toSkillRequiredMcpServer(body) })
      c.var.logger.info(
        { serverName: body.serverName, scope: 'user' },
        'custom mcp server added',
      )
      // Serve the row from a re-read — the response proves the config write.
      const added = listMcpServersForScope('user').find(
        (server) => server.serverName === body.serverName,
      )!
      return c.json(serializeMcpServer(added, 'user'), 201)
    },
  )
  .post(
    '/:serverName/login',
    describeRoute({
      tags: ['mcp-servers'],
      summary: "Sign in to a remote MCP server via the native browser OAuth flow.",
      'x-sdk-name': 'mcpServersUser.login',
      responses: {
        200: {
          description: 'The CLI recorded the credential in its native store.',
          content: { 'application/json': { schema: resolver(LoginMcpServerResponseSchema) } },
        },
        400: { description: 'A local (stdio) server, or the sign-in failed/timed out.' },
        404: { description: 'No server with that name in the global config.' },
      },
    }),
    validator('param', ServerNameParamSchema),
    ...userScoped,
    async (c) => {
      const { serverName } = c.req.valid('param')
      const server = listMcpServersForScope('user').find(
        (entry) => entry.serverName === serverName,
      )
      if (server === undefined) throw new NotFoundError('MCP server', serverName)
      if (server.transport === 'stdio') {
        throw new ValidationError(
          `'${serverName}' runs locally on this machine — there is nothing to sign in to.`,
        )
      }
      // The delegate opens the user's browser and resolves when the native
      // CLI records the credential — Vynel never touches the token.
      await c.var.mcpAuthDelegate.login({ serverName })
      c.var.logger.info({ serverName, scope: 'user' }, 'mcp server connected')
      return c.json({ connected: true as const })
    },
  )
  .delete(
    '/:serverName',
    describeRoute({
      tags: ['mcp-servers'],
      summary: 'Remove an MCP server from the global config.',
      'x-sdk-name': 'mcpServersUser.remove',
      responses: {
        204: { description: 'Removed.' },
        404: { description: 'No server with that name in the global config.' },
      },
    }),
    validator('param', ServerNameParamSchema),
    ...userScoped,
    async (c) => {
      const { serverName } = c.req.valid('param')
      const exists = listMcpServersForScope('user').some(
        (server) => server.serverName === serverName,
      )
      if (!exists) throw new NotFoundError('MCP server', serverName)
      await removeMcpServerForScope({ scope: 'user', serverName })
      c.var.logger.info({ serverName, scope: 'user' }, 'mcp server removed')
      return c.body(null, 204)
    },
  )

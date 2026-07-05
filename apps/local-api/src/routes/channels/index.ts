// The `channels` HTTP surface — 9 routes mounted under
// `/workspaces/:workspaceId/channels` from `apps/local-api/src/app.ts`:
//
//   GET    /                                          -> listChannelsForWorkspace     [x-mcp]
//   POST   /connect                                   -> connectChannel
//   DELETE /:channelId                                -> disconnectChannel
//   POST   /:channelId/enable                         -> setChannelEnabled(true)
//   POST   /:channelId/disable                        -> setChannelEnabled(false)
//   GET    /:channelId/allowed-senders               -> listAllowedSendersForChannel  [x-mcp]
//   POST   /:channelId/allowed-senders               -> addAllowedSender
//   DELETE /:channelId/allowed-senders/:senderLinkId -> removeAllowedSender
//   GET    /:channelId/history                        -> listChannelHistory
//
// Locked Hono protocol: describeRoute (from the local openapi.js wrapper —
// widens the type for x-mcp + x-sdk-name) → validator (from hono-openapi/zod)
// → `...workspaceScoped` → handler. Chained methods on `factory.createApp()`.
// All routes are workspaceScoped; the single-channel ops verify the channel
// belongs to the resolved workspace in core (getChannelInWorkspaceOrThrow),
// returning 404 across a workspace boundary (tenant scoping).
//
// MCP exposure: the two safe-read GETs are x-mcp pre-annotated
// (list_channels, list_allowed_senders). NO mutating route is exposed —
// connect carries the bot token and must never be an MCP tool.
//
// Error mapping: NONE here. Core ops throw typed `VynelError` subclasses;
// the global `onError` middleware in `app.ts` maps them to HTTP.
//
// The serializer strips botCredentials + lastPolledCursor from every channel
// response (coding.md §1.1).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  connectChannel,
  disconnectChannel,
  listChannelsForWorkspace,
  setChannelEnabled,
  addAllowedSender,
  removeAllowedSender,
  listAllowedSendersForChannel,
  listChannelHistory,
} from '@vynel/channels'
import { serializeChannelForResponse } from './serializers.js'
import {
  ChannelParamSchema,
  SenderLinkParamSchema,
  ConnectChannelRequestSchema,
  AddAllowedSenderRequestSchema,
  InboundHistoryQuerySchema,
  ChannelSchema,
  ChannelListResponseSchema,
  ChannelUserLinkSchema,
  ChannelUserLinkListResponseSchema,
  ChannelInboundMessageListResponseSchema,
} from './schemas.js'

export const channelsApp = factory
  .createApp()
  // GET / — list connected channels (workspace-scoped; credentials stripped)
  .get(
    '/',
    describeRoute({
      tags: ['channels'],
      summary: 'List connected channels for the workspace (owner-scoped; credentials excluded).',
      'x-sdk-name': 'channels.list',
      responses: {
        200: {
          description: 'Array of Channel (without bot credentials).',
          content: { 'application/json': { schema: resolver(ChannelListResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_channels',
        description:
          'List the connected messaging channels for the active workspace (owner-scoped). ' +
          'Returns each channel WITHOUT its bot credentials. Read-only.',
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const channels = listChannelsForWorkspace(c.var.db, c.var.workspace!.id)
      return c.json(channels.map(serializeChannelForResponse))
    },
  )
  // POST /connect — verify the bot token, then persist
  .post(
    '/connect',
    describeRoute({
      tags: ['channels'],
      summary: 'Connect a bot to the workspace (verifies the token before persisting).',
      'x-sdk-name': 'channels.connect',
      responses: {
        201: {
          description: 'Channel connected (credentials excluded).',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        400: { description: 'Bot token invalid or unsupported channel kind.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', ConnectChannelRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const channel = await connectChannel(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          channelKind: body.channelKind,
          displayName: body.displayName,
          botCredentials: body.botCredentials,
          ...(body.initialAllowedSenderId !== undefined
            ? { initialAllowedSenderId: body.initialAllowedSenderId }
            : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeChannelForResponse(channel), 201)
    },
  )
  // DELETE /:channelId — disconnect (hard-delete + cascade)
  .delete(
    '/:channelId',
    describeRoute({
      tags: ['channels'],
      summary: 'Disconnect a channel — hard-deletes it and cascades inbound/queue/allowlist rows.',
      'x-sdk-name': 'channels.disconnect',
      responses: {
        204: { description: 'Channel disconnected.' },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...workspaceScoped,
    async (c) => {
      disconnectChannel(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
      })
      return c.body(null, 204)
    },
  )
  // POST /:channelId/enable
  .post(
    '/:channelId/enable',
    describeRoute({
      tags: ['channels'],
      summary: 'Enable a channel (resume polling).',
      'x-sdk-name': 'channels.enable',
      responses: {
        200: {
          description: 'Updated Channel.',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...workspaceScoped,
    async (c) => {
      const channel = setChannelEnabled(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
        isEnabled: true,
      })
      return c.json(serializeChannelForResponse(channel))
    },
  )
  // POST /:channelId/disable
  .post(
    '/:channelId/disable',
    describeRoute({
      tags: ['channels'],
      summary: 'Disable a channel (pause polling).',
      'x-sdk-name': 'channels.disable',
      responses: {
        200: {
          description: 'Updated Channel.',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...workspaceScoped,
    async (c) => {
      const channel = setChannelEnabled(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
        isEnabled: false,
      })
      return c.json(serializeChannelForResponse(channel))
    },
  )
  // GET /:channelId/allowed-senders — the allowlist (read; MCP-exposed)
  .get(
    '/:channelId/allowed-senders',
    describeRoute({
      tags: ['channels'],
      summary: 'List the allowed senders (allowlist) for a channel (owner-scoped).',
      'x-sdk-name': 'channels.listAllowedSenders',
      responses: {
        200: {
          description: 'Array of ChannelUserLink.',
          content: { 'application/json': { schema: resolver(ChannelUserLinkListResponseSchema) } },
        },
        404: { description: 'No such channel in this workspace.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_allowed_senders',
        description:
          'List the external senders allowed to message a connected channel (owner-scoped — ' +
          '404 if the channel is not in the active workspace). Read-only.',
      },
    }),
    validator('param', ChannelParamSchema),
    ...workspaceScoped,
    async (c) => {
      const senders = listAllowedSendersForChannel(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
      })
      return c.json(senders)
    },
  )
  // POST /:channelId/allowed-senders — add an allowed sender
  .post(
    '/:channelId/allowed-senders',
    describeRoute({
      tags: ['channels'],
      summary: 'Add an allowed sender to a channel.',
      'x-sdk-name': 'channels.addAllowedSender',
      responses: {
        201: {
          description: 'ChannelUserLink.',
          content: { 'application/json': { schema: resolver(ChannelUserLinkSchema) } },
        },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', ChannelParamSchema),
    validator('json', AddAllowedSenderRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const link = addAllowedSender(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
        externalSenderId: body.externalSenderId,
        ...(body.externalSenderHandle !== undefined
          ? { externalSenderHandle: body.externalSenderHandle }
          : {}),
        ...(body.externalSenderDisplayName !== undefined
          ? { externalSenderDisplayName: body.externalSenderDisplayName }
          : {}),
        ...(body.scopeContextId !== undefined ? { scopeContextId: body.scopeContextId } : {}),
      })
      return c.json(link, 201)
    },
  )
  // DELETE /:channelId/allowed-senders/:senderLinkId — remove an allowed sender
  .delete(
    '/:channelId/allowed-senders/:senderLinkId',
    describeRoute({
      tags: ['channels'],
      summary: 'Remove an allowed sender from a channel.',
      'x-sdk-name': 'channels.removeAllowedSender',
      responses: {
        204: { description: 'Sender removed.' },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', SenderLinkParamSchema),
    ...workspaceScoped,
    async (c) => {
      const params = c.req.valid('param')
      removeAllowedSender(c.var.db, {
        channelId: params.channelId,
        workspaceId: c.var.workspace!.id,
        senderLinkId: params.senderLinkId,
      })
      return c.body(null, 204)
    },
  )
  // GET /:channelId/history — inbound history (keyset cursor)
  .get(
    '/:channelId/history',
    describeRoute({
      tags: ['channels'],
      summary: 'List a channel’s inbound message history (keyset cursor-paginated).',
      'x-sdk-name': 'channels.history',
      responses: {
        200: {
          description: 'Array of ChannelInboundMessage (newest first).',
          content: { 'application/json': { schema: resolver(ChannelInboundMessageListResponseSchema) } },
        },
        404: { description: 'No such channel in this workspace.' },
      },
    }),
    validator('param', ChannelParamSchema),
    validator('query', InboundHistoryQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const query = c.req.valid('query')
      const cursor =
        query.cursorReceivedAt !== undefined && query.cursorId !== undefined
          ? { receivedAt: new Date(query.cursorReceivedAt), id: query.cursorId }
          : undefined
      const history = listChannelHistory(c.var.db, {
        channelId: c.req.valid('param').channelId,
        workspaceId: c.var.workspace!.id,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      })
      return c.json(history)
    },
  )

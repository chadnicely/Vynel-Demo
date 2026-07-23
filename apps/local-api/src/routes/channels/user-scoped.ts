// The USER-scoped `channels` HTTP surface — mounted at `/channels` (NO
// workspace prefix) from `apps/local-api/src/app.ts`, alongside the untouched
// workspace-scoped twin (`/workspaces/:workspaceId/channels`). Unlike that twin
// these routes span BOTH scopes: a user's GLOBAL (null-workspace) channels AND
// every workspace channel they own. Every single-channel op authorizes by
// (userId, channelId) via `getChannelForUserOrThrow` — `userId` is the tenant
// boundary — with an identical 404 for "missing" and "owned by another user".
//
//   GET    /                                          -> listChannelsForUser         [x-mcp]
//   POST   /                                          -> connectChannel (scope: global|workspace)
//   GET    /:channelId                                -> getChannelForUserOrThrow
//   PATCH  /:channelId                                -> renameChannelForUser
//   DELETE /:channelId                                -> disconnectChannelForUser
//   POST   /:channelId/enable                         -> setChannelEnabledForUser(true)
//   POST   /:channelId/disable                        -> setChannelEnabledForUser(false)
//   GET    /:channelId/allowed-senders               -> listAllowedSendersForUser
//   POST   /:channelId/allowed-senders               -> addAllowedSenderForUser
//   DELETE /:channelId/allowed-senders/:senderLinkId -> removeAllowedSenderForUser
//   GET    /:channelId/history                        -> listChannelHistoryForUser
//
// Only the safe-read `GET /` is x-mcp exposed (list_my_channels); no mutating
// route is (connect carries the bot token). Serializer + the param/sender
// schemas are REUSED from the workspace-scoped surface (identical shapes).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  connectChannel,
  listChannelsForUser,
  getChannelForUserOrThrow,
  setChannelEnabledForUser,
  renameChannelForUser,
  disconnectChannelForUser,
  addAllowedSenderForUser,
  removeAllowedSenderForUser,
  listAllowedSendersForUser,
  listChannelHistoryForUser,
} from '@vynel/channels'
import { serializeChannelForResponse } from './serializers.js'
import {
  ChannelParamSchema,
  SenderLinkParamSchema,
  ConnectChannelForUserRequestSchema,
  RenameChannelRequestSchema,
  AddAllowedSenderRequestSchema,
  InboundHistoryQuerySchema,
  ChannelSchema,
  ChannelListResponseSchema,
  ChannelUserLinkSchema,
  ChannelUserLinkListResponseSchema,
  ChannelInboundMessageListResponseSchema,
} from './schemas.js'

export const channelsUserApp = factory
  .createApp()
  // GET / — every channel the user owns, both scopes (credentials stripped).
  .get(
    '/',
    describeRoute({
      tags: ['channels'],
      summary: "List every channel the user owns — global + workspace (credentials excluded).",
      'x-sdk-name': 'channelsUser.list',
      responses: {
        200: {
          description: 'Array of Channel (without bot credentials).',
          content: { 'application/json': { schema: resolver(ChannelListResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_my_channels',
        description:
          'List every connected messaging channel the user owns — both global (no workspace) and ' +
          'workspace-scoped. Returns each channel WITHOUT its bot credentials. Read-only.',
      },
    }),
    ...userScoped,
    (c) => {
      const channels = listChannelsForUser(c.var.db, c.var.user.id)
      return c.json(channels.map(serializeChannelForResponse))
    },
  )
  // POST / — connect a bot; scope picks global (null workspace) vs a workspace.
  .post(
    '/',
    describeRoute({
      tags: ['channels'],
      summary: 'Connect a bot as a global or workspace channel (verifies the token before persisting).',
      'x-sdk-name': 'channelsUser.connect',
      responses: {
        201: {
          description: 'Channel connected (credentials excluded).',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        400: { description: 'Bot token invalid, unsupported kind, or workspaceId missing for a workspace scope.' },
      },
    }),
    validator('json', ConnectChannelForUserRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const workspaceId = body.scope === 'global' ? null : body.workspaceId
      const channel = await connectChannel(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId,
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
  // GET /:channelId — one channel the user owns.
  .get(
    '/:channelId',
    describeRoute({
      tags: ['channels'],
      summary: 'Get one channel the user owns (credentials excluded).',
      'x-sdk-name': 'channelsUser.get',
      responses: {
        200: {
          description: 'Channel (without bot credentials).',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...userScoped,
    (c) => {
      const channel = getChannelForUserOrThrow(c.var.db, c.req.valid('param').channelId, c.var.user.id)
      return c.json(serializeChannelForResponse(channel))
    },
  )
  // PATCH /:channelId — rename (the one editable field post-connect).
  .patch(
    '/:channelId',
    describeRoute({
      tags: ['channels'],
      summary: 'Rename a channel the user owns.',
      'x-sdk-name': 'channelsUser.rename',
      responses: {
        200: {
          description: 'Updated Channel (credentials excluded).',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    validator('json', RenameChannelRequestSchema),
    ...userScoped,
    (c) => {
      const channel = renameChannelForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
        displayName: c.req.valid('json').displayName,
      })
      return c.json(serializeChannelForResponse(channel))
    },
  )
  // DELETE /:channelId — disconnect (hard-delete + cascade).
  .delete(
    '/:channelId',
    describeRoute({
      tags: ['channels'],
      summary: 'Disconnect a channel — hard-deletes it and cascades inbound/queue/allowlist rows.',
      'x-sdk-name': 'channelsUser.disconnect',
      responses: {
        204: { description: 'Channel disconnected.' },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...userScoped,
    (c) => {
      disconnectChannelForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
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
      'x-sdk-name': 'channelsUser.enable',
      responses: {
        200: {
          description: 'Updated Channel.',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...userScoped,
    (c) => {
      const channel = setChannelEnabledForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
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
      'x-sdk-name': 'channelsUser.disable',
      responses: {
        200: {
          description: 'Updated Channel.',
          content: { 'application/json': { schema: resolver(ChannelSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...userScoped,
    (c) => {
      const channel = setChannelEnabledForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
        isEnabled: false,
      })
      return c.json(serializeChannelForResponse(channel))
    },
  )
  // GET /:channelId/allowed-senders — the allowlist (read).
  .get(
    '/:channelId/allowed-senders',
    describeRoute({
      tags: ['channels'],
      summary: 'List the allowed senders (allowlist) for a channel the user owns.',
      'x-sdk-name': 'channelsUser.listAllowedSenders',
      responses: {
        200: {
          description: 'Array of ChannelUserLink.',
          content: { 'application/json': { schema: resolver(ChannelUserLinkListResponseSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    ...userScoped,
    (c) => {
      const senders = listAllowedSendersForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
      })
      return c.json(senders)
    },
  )
  // POST /:channelId/allowed-senders — add an allowed sender.
  .post(
    '/:channelId/allowed-senders',
    describeRoute({
      tags: ['channels'],
      summary: 'Add an allowed sender to a channel the user owns.',
      'x-sdk-name': 'channelsUser.addAllowedSender',
      responses: {
        201: {
          description: 'ChannelUserLink.',
          content: { 'application/json': { schema: resolver(ChannelUserLinkSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    validator('json', AddAllowedSenderRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const link = addAllowedSenderForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
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
  // DELETE /:channelId/allowed-senders/:senderLinkId — remove an allowed sender.
  .delete(
    '/:channelId/allowed-senders/:senderLinkId',
    describeRoute({
      tags: ['channels'],
      summary: 'Remove an allowed sender from a channel the user owns.',
      'x-sdk-name': 'channelsUser.removeAllowedSender',
      responses: {
        204: { description: 'Sender removed.' },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', SenderLinkParamSchema),
    ...userScoped,
    (c) => {
      const params = c.req.valid('param')
      removeAllowedSenderForUser(c.var.db, {
        channelId: params.channelId,
        userId: c.var.user.id,
        senderLinkId: params.senderLinkId,
      })
      return c.body(null, 204)
    },
  )
  // GET /:channelId/history — inbound history (keyset cursor).
  .get(
    '/:channelId/history',
    describeRoute({
      tags: ['channels'],
      summary: "List a channel's inbound message history (keyset cursor-paginated).",
      'x-sdk-name': 'channelsUser.history',
      responses: {
        200: {
          description: 'Array of ChannelInboundMessage (newest first).',
          content: { 'application/json': { schema: resolver(ChannelInboundMessageListResponseSchema) } },
        },
        404: { description: 'No such channel owned by this user.' },
      },
    }),
    validator('param', ChannelParamSchema),
    validator('query', InboundHistoryQuerySchema),
    ...userScoped,
    (c) => {
      const query = c.req.valid('query')
      const cursor =
        query.cursorReceivedAt !== undefined && query.cursorId !== undefined
          ? { receivedAt: new Date(query.cursorReceivedAt), id: query.cursorId }
          : undefined
      const history = listChannelHistoryForUser(c.var.db, {
        channelId: c.req.valid('param').channelId,
        userId: c.var.user.id,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      })
      return c.json(history)
    },
  )

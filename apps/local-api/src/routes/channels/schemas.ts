// Zod request schemas for `channels` routes. XxxSchema suffix; API-internal
// (single consumer) so they live beside the routes (coding-standard.md "Zod
// schemas"). Validated via `validator` from `hono-openapi/zod`.
//
// Per `docs/blueprints/channels/blueprint.md §6`.

import { z } from 'zod'

const ChannelKindSchema = z.enum(['telegram', 'discord'])

export const ChannelParamSchema = z.object({
  channelId: z.string().min(1),
})

export const SenderLinkParamSchema = z.object({
  channelId: z.string().min(1),
  senderLinkId: z.string().min(1),
})

export const ConnectChannelRequestSchema = z.object({
  // 'discord' is accepted by the schema (the kind exists) but the adapter
  // registry rejects it with a clear message in Phase 1 (D15).
  channelKind: ChannelKindSchema,
  displayName: z.string().min(1).max(120),
  // Opaque credential bag (e.g. { botToken }). Never returned in responses.
  botCredentials: z.record(z.string(), z.string()),
  initialAllowedSenderId: z.string().min(1).optional(),
})

// The user-scoped `POST /channels` body. `scope` discriminates a GLOBAL channel
// (no workspace) from a WORKSPACE channel; the discriminated union makes
// `workspaceId` REQUIRED in the workspace branch, so the validator rejects a
// workspace scope missing it with 400 at the boundary — no route-level check.
const connectChannelFields = {
  channelKind: ChannelKindSchema,
  displayName: z.string().min(1).max(120),
  botCredentials: z.record(z.string(), z.string()),
  initialAllowedSenderId: z.string().min(1).optional(),
}

export const ConnectChannelForUserRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...connectChannelFields }),
  z.object({ scope: z.literal('workspace'), workspaceId: z.string().min(1), ...connectChannelFields }),
])

export const AddAllowedSenderRequestSchema = z.object({
  externalSenderId: z.string().min(1),
  externalSenderHandle: z.string().optional(),
  externalSenderDisplayName: z.string().optional(),
  scopeContextId: z.string().optional(),
})

export const InboundHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Keyset cursor: (receivedAt as ms epoch, id). Both required to page.
  cursorReceivedAt: z.coerce.number().int().optional(),
  cursorId: z.string().optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// The exact wire shape each route already returns: `serializeChannelForResponse`'s
// output for channel routes, and raw repository rows (Hono's `c.json` turns their
// `Date` columns into ISO strings) for the allowed-senders + history routes. These
// mirror `@vynel/contracts/channels/channel-http` (`ChannelResponse` /
// `ChannelUserLinkResponse` / `ChannelInboundMessageResponse`) field-for-field, so
// the generated SDK gets real return types instead of `never`. Every list route
// here returns a bare JSON array (no envelope object), unlike knowledge's `{ ... }`
// wrappers — so the "response schema" for a list is just `z.array(EntitySchema)`.

const ChannelConnectionStatusSchema = z.enum([
  'healthy',
  'auth-failed',
  'rate-limited',
  'network-error',
  'misconfigured',
])

export const ChannelSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  channelKind: ChannelKindSchema,
  displayName: z.string(),
  botMetadata: z.record(z.string(), z.unknown()),
  connectionStatus: ChannelConnectionStatusSchema,
  connectionStatusMessage: z.string().nullable(),
  lastPolledAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ChannelListResponseSchema = z.array(ChannelSchema)

export const ChannelUserLinkSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  externalSenderId: z.string(),
  externalSenderHandle: z.string().nullable(),
  externalSenderDisplayName: z.string().nullable(),
  scopeContextId: z.string().nullable(),
  addedAt: z.string(),
})

export const ChannelUserLinkListResponseSchema = z.array(ChannelUserLinkSchema)

const InboundIntentKindSchema = z.enum([
  'chat-turn',
  'approval-reply',
  'channel-command',
  'ignored',
])

const InboundMessageStatusSchema = z.enum(['pending', 'routed', 'completed', 'failed', 'ignored'])

export const ChannelInboundMessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  externalMessageId: z.string(),
  externalSenderId: z.string(),
  externalChatContextId: z.string(),
  messageBody: z.string(),
  messageMetadata: z.string(),
  intentKind: InboundIntentKindSchema,
  routedToChatSessionId: z.string().nullable(),
  routedToApprovalRequestId: z.string().nullable(),
  status: InboundMessageStatusSchema,
  statusMessage: z.string().nullable(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
})

export const ChannelInboundMessageListResponseSchema = z.array(ChannelInboundMessageSchema)

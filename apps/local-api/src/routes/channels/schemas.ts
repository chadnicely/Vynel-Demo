// Zod request schemas for `channels` routes. XxxSchema suffix; API-internal
// (single consumer) so they live beside the routes (coding-standard.md "Zod
// schemas"). Validated via `validator` from `hono-openapi/zod`.
//
// Per `docs/blueprints/channels/blueprint.md §6`.

import { z } from 'zod'

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
  channelKind: z.enum(['telegram', 'discord']),
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
  channelKind: z.enum(['telegram', 'discord']),
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

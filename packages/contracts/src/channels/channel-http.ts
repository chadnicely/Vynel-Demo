// HTTP shapes for the `channels` domain. Serialized response shapes
// returned by routes in `apps/local-api/src/routes/channels/index.ts`. Single
// source of truth: `apps/local-api` types `serializeChannelForResponse`'s return
// as `ChannelResponse`; `apps/web` casts SDK responses to these (the routes
// carry no response schema in the OpenAPI spec, so the SDK can't infer —
// the workspaces/approvals cast-from-contracts pattern). Promoted to
// `@vynel/contracts` on the `apps/web` second-consumer trigger.

export type ChannelKind = 'telegram' | 'discord'

export type ChannelConnectionStatus =
  | 'healthy'
  | 'auth-failed'
  | 'rate-limited'
  | 'network-error'
  | 'misconfigured'

// Credential-stripped channel (botCredentials + lastPolledCursor omitted).
export interface ChannelResponse {
  id: string
  userId: string
  // Nullable: NULL = global scope (a user-level channel with no workspace);
  // a non-null value scopes it to that workspace (mirrors the `channels`
  // schema, where `workspaceId` is nullable).
  workspaceId: string | null
  channelKind: ChannelKind
  displayName: string
  botMetadata: Record<string, unknown>
  connectionStatus: ChannelConnectionStatus
  connectionStatusMessage: string | null
  /** ISO-8601 or null */
  lastPolledAt: string | null
  /** ISO-8601 or null */
  lastInboundAt: string | null
  isEnabled: boolean
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

export interface ChannelUserLinkResponse {
  id: string
  channelId: string
  externalSenderId: string
  externalSenderHandle: string | null
  externalSenderDisplayName: string | null
  scopeContextId: string | null
  /** ISO-8601 */
  addedAt: string
}

export type InboundIntentKind = 'chat-turn' | 'approval-reply' | 'channel-command' | 'ignored'

export type InboundMessageStatus = 'pending' | 'routed' | 'completed' | 'failed' | 'ignored'

export interface ChannelInboundMessageResponse {
  id: string
  channelId: string
  externalMessageId: string
  externalSenderId: string
  externalChatContextId: string
  messageBody: string
  messageMetadata: string
  intentKind: InboundIntentKind
  routedToChatSessionId: string | null
  routedToApprovalRequestId: string | null
  status: InboundMessageStatus
  statusMessage: string | null
  /** ISO-8601 */
  receivedAt: string
  /** ISO-8601 or null */
  processedAt: string | null
}

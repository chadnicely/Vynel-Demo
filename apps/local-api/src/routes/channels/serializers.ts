// Response serializers for `channels` HTTP routes. CRITICAL: the channel
// serializer OMITS `botCredentials` (the bot token) AND `lastPolledCursor`
// (an internal field) — they must never appear in a response (coding.md
// §1.1). Date columns emit as ISO strings; `botMetadata` is parsed from its
// stored JSON string for the UI.
//
// Single source of truth for the response shape is `ChannelResponse` in
// `@vynel/contracts/channels/channel-http` — `apps/web` casts SDK responses
// to it (the approvals/workspaces serializer precedent).

import type { Channel } from '@vynel/channels'
import type { ChannelResponse } from '@vynel/contracts/channels/channel-http'

function parseMetadata(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function serializeChannelForResponse(channel: Channel): ChannelResponse {
  // botCredentials + lastPolledCursor are intentionally OMITTED (coding.md §1.1).
  return {
    id: channel.id,
    userId: channel.userId,
    workspaceId: channel.workspaceId,
    channelKind: channel.channelKind,
    displayName: channel.displayName,
    botMetadata: parseMetadata(channel.botMetadata),
    connectionStatus: channel.connectionStatus,
    connectionStatusMessage: channel.connectionStatusMessage,
    lastPolledAt: channel.lastPolledAt ? channel.lastPolledAt.toISOString() : null,
    lastInboundAt: channel.lastInboundAt ? channel.lastInboundAt.toISOString() : null,
    isEnabled: channel.isEnabled,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  }
}

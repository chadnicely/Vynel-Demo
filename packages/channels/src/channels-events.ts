// Outbox event type constants + payload interfaces for the
// `channels` domain — lifecycle events: `channel.connected`,
// `channel.disconnected`, `channel.enabled-changed`, `channel.renamed`,
// `channel.group-discovered`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors the agents
// domain's `agents-events.ts`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future
// subscribers (sync, activity feed) need no producer-side migration.
//
// Payloads are loose-ref FACTS only. Channel rows carry bot
// credentials (`botCredentials`) — those NEVER enter a payload; the
// lifecycle tests assert the seeded token is absent from every event.
//
// `channel.disconnected` records what was severed by the hard delete
// (D16 cascade): the channel loose ref + kind. Child-row counts are
// NOT included — the cascade happens inside SQLite, so the counts are
// never in hand and reading them just for the payload is not worth it.

import type { ChannelKind } from './repositories/index.js'

export const CHANNEL_CONNECTED = 'channel.connected' as const
export const CHANNEL_DISCONNECTED = 'channel.disconnected' as const
export const CHANNEL_ENABLED_CHANGED = 'channel.enabled-changed' as const
export const CHANNEL_RENAMED = 'channel.renamed' as const
export const CHANNEL_GROUP_DISCOVERED = 'channel.group-discovered' as const
export const CHANNEL_GROUP_STATUS_CHANGED = 'channel.group-status-changed' as const
export const CHANNEL_GROUP_POLICY_CHANGED = 'channel.group-policy-changed' as const

export type ChannelConnectedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  channelKind: ChannelKind
  connectedAt: string
}

export type ChannelDisconnectedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  disconnectedAt: string
}

export type ChannelEnabledChangedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  isEnabled: boolean
  changedAt: string
}

export type ChannelRenamedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  displayName: string
  renamedAt: string
}

// The polling tick saw a message from a group the bot hadn't been seen in
// before and recorded it `pending` (discovery-over-configuration,
// channels-groups.md). Loose-ref facts; the group title may be null.
export type ChannelGroupDiscoveredPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  groupId: string
  externalChatContextId: string
  title: string | null
  discoveredAt: string
}

export type ChannelGroupStatusChangedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  groupId: string
  externalChatContextId: string
  status: 'pending' | 'approved' | 'ignored'
  changedAt: string
}

export type ChannelGroupPolicyChangedPayload = {
  channelId: string
  userId: string
  workspaceId: string | null
  channelKind: ChannelKind
  groupId: string
  externalChatContextId: string
  memberPolicy: 'everyone' | 'allowlist'
  changedAt: string
}

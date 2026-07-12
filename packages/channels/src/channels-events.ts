// Outbox event type constants + payload interfaces for the
// `channels` domain — three lifecycle events: `channel.connected`,
// `channel.disconnected`, `channel.enabled-changed`.
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

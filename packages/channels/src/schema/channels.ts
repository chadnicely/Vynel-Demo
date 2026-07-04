// `channels` table for the `channels` domain — one row per connected
// bot install (a Telegram bot in Phase 1). Has NO `deletedAt`:
// `disconnectChannel` hard-deletes and cascades (decisions.md D16).
//
// Spec: `docs/blueprints/channels/blueprint.md §3.1`.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId`
// is the domain scope. Child tables omit `userId` (scoped through
// `channelId -> channels.userId`). Phase 1 SYNC repo discipline applies.
//
// `botCredentials` / `botMetadata` are opaque JSON-encoded strings read
// whole at the core layer (never filtered) — plain `text()`, not
// `json()`. `botCredentials` is sensitive: never returned in a response
// (the serializer strips it), never logged (coding.md §1.1).
// `lastPolledCursor` is the opaque per-channel poll cursor (OQ-2).

import { table, id, text, timestamp, boolean, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type ChannelKind = 'telegram' | 'discord' // discord = Phase 1.5

export type ChannelConnectionStatus =
  | 'healthy' // last poll succeeded
  | 'auth-failed' // token rejected
  | 'rate-limited' // hit channel API rate limit; retry later
  | 'network-error' // transient network issue; retry later
  | 'misconfigured' // user's setup is wrong (e.g. bot lacks permissions)

export const channels = table(
  'channels',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    channelKind: text().$type<ChannelKind>().notNull(),
    displayName: text().notNull(),
    botCredentials: text().notNull(), // JSON-encoded; sensitive — never returned, never logged
    botMetadata: text().notNull(), // JSON-encoded; what the channel API reports (username, id)
    connectionStatus: text().$type<ChannelConnectionStatus>().notNull(),
    connectionStatusMessage: text(),
    lastPolledCursor: text(), // opaque per-channel poll cursor (Telegram update offset)
    lastPolledAt: timestamp(),
    lastInboundAt: timestamp(),
    isEnabled: boolean().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdx: index('idx_channels_user').on(t.userId),
    workspaceIdx: index('idx_channels_workspace').on(t.workspaceId),
    enabledPollingIdx: index('idx_channels_enabled_polling').on(t.isEnabled, t.lastPolledAt),
  }),
)

export type Channel = typeof channels.$inferSelect
export type NewChannel = typeof channels.$inferInsert

// `channel_user_links` table for the `channels` domain — one row per
// allowed sender (the external user IDs allowed to message the bot).
// Scoped through `channelId -> channels.userId`; omits its own `userId`
// per the FK-transitive carve-out (userid-top-level-tables-only).
//
// Spec: `docs/blueprints/channels/blueprint.md §3.2`.

import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { channels } from './channels.js'

export const channelUserLinks = table(
  'channel_user_links',
  {
    id: id().primaryKey(),
    channelId: id().references(() => channels.id, { onDelete: 'cascade' }),
    externalSenderId: text().notNull(), // e.g. Telegram user ID '123456789'
    externalSenderHandle: text(), // e.g. '@alice'; display only, not matched on
    externalSenderDisplayName: text(), // e.g. 'Alice Cohen'; display only
    scopeContextId: text(), // Telegram DM: equals the user ID; group/server support is Phase 1.5
    addedAt: timestamp().notNull(),
  },
  (t) => ({
    channelIdx: index('idx_channel_user_links_channel').on(t.channelId),
    // UNIQUE — the allowlist dedup key (one link per sender per scope).
    senderUniqueIdx: uniqueIndex('uniq_channel_user_links_sender').on(
      t.channelId,
      t.externalSenderId,
      t.scopeContextId,
    ),
  }),
)

export type ChannelUserLink = typeof channelUserLinks.$inferSelect
export type NewChannelUserLink = typeof channelUserLinks.$inferInsert

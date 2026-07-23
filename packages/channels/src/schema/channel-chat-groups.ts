// `channel_chat_groups` table for the `channels` domain — one row per
// GROUP chat context the bot has been seen in (Telegram group/supergroup;
// a Zoom Team Chat channel later). Discovery-over-configuration: the
// polling tick inserts a `pending` row the first time an unknown group
// mentions the bot; the user approves/ignores it in the Manage dialog.
// Scoped through `channelId -> channels.userId` (the child-table
// carve-out, like `channel_user_links`).
//
// Spec: `docs/module-notes/channels-groups.md`.

import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { channels } from './channels.js'

export type ChannelGroupStatus =
  | 'pending' // seen, awaiting the user's approve/ignore
  | 'approved' // messages route (per memberPolicy + mention gate)
  | 'ignored' // the user declined; messages are skipped silently

// Who inside an APPROVED group may talk to the assistant (Chad's decision 1):
// 'everyone' = approving the room trusts the room (default);
// 'allowlist' = the member must also be an allowed sender scoped to this group.
export type ChannelGroupMemberPolicy = 'everyone' | 'allowlist'

export const channelChatGroups = table(
  'channel_chat_groups',
  {
    id: id().primaryKey(),
    channelId: id().references(() => channels.id, { onDelete: 'cascade' }),
    externalChatContextId: text().notNull(), // the group's chat id in the channel
    title: text(), // channel-reported group title; display only
    status: text().$type<ChannelGroupStatus>().notNull(),
    memberPolicy: text().$type<ChannelGroupMemberPolicy>().notNull(),
    firstSeenAt: timestamp().notNull(),
    lastInboundAt: timestamp(),
    approvedAt: timestamp(),
  },
  (t) => ({
    channelStatusIdx: index('idx_channel_chat_groups_channel_status').on(t.channelId, t.status),
    // UNIQUE — one row per group per channel (the discovery dedup key).
    contextUniqueIdx: uniqueIndex('uniq_channel_chat_groups_context').on(
      t.channelId,
      t.externalChatContextId,
    ),
  }),
)

export type ChannelChatGroup = typeof channelChatGroups.$inferSelect
export type NewChannelChatGroup = typeof channelChatGroups.$inferInsert

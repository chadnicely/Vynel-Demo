// Functional repository for the `channel_chat_groups` table (group chat
// contexts the bot has been seen in). `db` first arg; Phase 1 SYNC returns.
//
// Spec: `docs/module-notes/channels-groups.md`.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  channelChatGroups,
  type ChannelChatGroup,
  type NewChannelChatGroup,
} from '../schema/channel-chat-groups.js'

export type {
  ChannelChatGroup,
  NewChannelChatGroup,
} from '../schema/channel-chat-groups.js'
export type {
  ChannelGroupStatus,
  ChannelGroupMemberPolicy,
} from '../schema/channel-chat-groups.js'

// The discovery lookup — the polling tick resolves every group message
// through this before deciding to record, route, or skip.
export function findChannelChatGroup(
  db: Database,
  input: { channelId: string; externalChatContextId: string },
): ChannelChatGroup | null {
  const [row] = db
    .select()
    .from(channelChatGroups)
    .where(
      and(
        eq(channelChatGroups.channelId, input.channelId),
        eq(channelChatGroups.externalChatContextId, input.externalChatContextId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findChannelChatGroupById(
  db: Database,
  groupId: string,
): ChannelChatGroup | null {
  const [row] = db
    .select()
    .from(channelChatGroups)
    .where(eq(channelChatGroups.id, groupId))
    .limit(1)
    .all()
  return row ?? null
}

// A channel is in a handful of groups at most — same defensive-cap
// convention as the allowlist repo.
const MAX_CHAT_GROUPS = 500

export function listChannelChatGroups(db: Database, channelId: string): ChannelChatGroup[] {
  return db
    .select()
    .from(channelChatGroups)
    .where(eq(channelChatGroups.channelId, channelId))
    .orderBy(asc(channelChatGroups.firstSeenAt))
    .limit(MAX_CHAT_GROUPS)
    .all()
}

export function insertChannelChatGroup(
  db: Database,
  row: NewChannelChatGroup,
): ChannelChatGroup {
  const [inserted] = db.insert(channelChatGroups).values(row).returning().all()
  if (!inserted) throw new Error('insertChannelChatGroup: no row returned')
  return inserted
}

// Discovery insert with the unique-index net (overlapping polling ticks can
// both see an unknown group; the loser must degrade to "already recorded",
// never a thrown poll). Returns null when the (channelId, context) row
// already exists.
export function insertChannelChatGroupIfAbsent(
  db: Database,
  row: NewChannelChatGroup,
): ChannelChatGroup | null {
  const [inserted] = db
    .insert(channelChatGroups)
    .values(row)
    .onConflictDoNothing()
    .returning()
    .all()
  return inserted ?? null
}

export function updateChannelChatGroup(
  db: Database,
  groupId: string,
  patch: Partial<Omit<ChannelChatGroup, 'id' | 'channelId' | 'externalChatContextId' | 'firstSeenAt'>>,
): ChannelChatGroup {
  const [updated] = db
    .update(channelChatGroups)
    .set(patch)
    .where(eq(channelChatGroups.id, groupId))
    .returning()
    .all()
  if (!updated) throw new Error(`updateChannelChatGroup: no row for id ${groupId}`)
  return updated
}

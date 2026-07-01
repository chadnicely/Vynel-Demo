// Functional repository for the `channel_user_links` table (the
// allowlist). `db` first arg; Phase 1 SYNC returns.
//
// Spec: `docs/blueprints/channels/blueprint.md §4`.

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  channelUserLinks,
  type ChannelUserLink,
  type NewChannelUserLink,
} from '../../schema/channels/channel-user-links.js'

export type {
  ChannelUserLink,
  NewChannelUserLink,
} from '../../schema/channels/channel-user-links.js'

// The allowlist check — used by the polling tick to classify a sender.
// scopeContextId may be null (uses IS NULL); in Phase 1 Telegram DMs it
// equals the sender id so the match is exact.
export function findAllowedSender(
  db: Database,
  input: { channelId: string; externalSenderId: string; scopeContextId: string | null },
): ChannelUserLink | null {
  const [row] = db
    .select()
    .from(channelUserLinks)
    .where(
      and(
        eq(channelUserLinks.channelId, input.channelId),
        eq(channelUserLinks.externalSenderId, input.externalSenderId),
        input.scopeContextId === null
          ? isNull(channelUserLinks.scopeContextId)
          : eq(channelUserLinks.scopeContextId, input.scopeContextId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// The allowlist is intrinsically small (a handful of senders per channel)
// so it is exempt from cursor pagination, but capped defensively per the
// sibling-repo convention (coding-standard.md "Structure / patterns").
const MAX_ALLOWED_SENDERS = 500

export function listAllowedSenders(db: Database, channelId: string): ChannelUserLink[] {
  return db
    .select()
    .from(channelUserLinks)
    .where(eq(channelUserLinks.channelId, channelId))
    .orderBy(asc(channelUserLinks.addedAt))
    .limit(MAX_ALLOWED_SENDERS)
    .all()
}

export function insertAllowedSender(db: Database, row: NewChannelUserLink): ChannelUserLink {
  const [inserted] = db.insert(channelUserLinks).values(row).returning().all()
  if (!inserted) throw new Error('insertAllowedSender: no row returned')
  return inserted
}

// Scoped by channelId so a link can only be removed through its own
// channel — keeps the delete tenant-safe (the core op verifies the channel
// belongs to the resolved workspace before calling this).
export function deleteAllowedSender(
  db: Database,
  channelId: string,
  senderLinkId: string,
): void {
  db.delete(channelUserLinks)
    .where(and(eq(channelUserLinks.id, senderLinkId), eq(channelUserLinks.channelId, channelId)))
    .run()
}

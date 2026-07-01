// Functional repository for the `channel_inbound_messages` table.
// `db` first arg; Phase 1 SYNC returns. Holds the load-bearing atomic
// claim (the guarded UPDATE that makes concurrent processing safe).
//
// Spec: `docs/blueprints/channels/blueprint.md §4` + `coding.md §6`.

import { and, asc, desc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  channelInboundMessages,
  type ChannelInboundMessage,
  type NewChannelInboundMessage,
  type InboundIntentKind,
  type InboundMessageStatus,
} from '../../schema/channels/channel-inbound-messages.js'

export type {
  ChannelInboundMessage,
  NewChannelInboundMessage,
  InboundIntentKind,
  InboundMessageStatus,
} from '../../schema/channels/channel-inbound-messages.js'

const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 100
const DEFAULT_PENDING_LIMIT = 10
const MAX_PENDING_LIMIT = 50

// The dedup check — channel APIs redeliver across reconnects.
export function findInboundMessageByExternalId(
  db: Database,
  channelId: string,
  externalMessageId: string,
): ChannelInboundMessage | null {
  const [row] = db
    .select()
    .from(channelInboundMessages)
    .where(
      and(
        eq(channelInboundMessages.channelId, channelId),
        eq(channelInboundMessages.externalMessageId, externalMessageId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findInboundMessageById(db: Database, id: string): ChannelInboundMessage | null {
  const [row] = db
    .select()
    .from(channelInboundMessages)
    .where(eq(channelInboundMessages.id, id))
    .limit(1)
    .all()
  return row ?? null
}

// Atomic claim: flips pending -> routed for exactly one caller. Returns
// true if THIS call won the row (better-sqlite3 reports affected-row count
// on .run()). The unique WHERE on status makes the claim atomic without an
// explicit transaction — the fix for concurrent double-dispatch (coding.md §1.2).
export function claimPendingInboundMessage(db: Database, id: string): boolean {
  const updated = db
    .update(channelInboundMessages)
    .set({ status: 'routed' })
    .where(
      and(eq(channelInboundMessages.id, id), eq(channelInboundMessages.status, 'pending')),
    )
    .run()
  return updated.changes > 0
}

// The processing-loop input — pending rows oldest-first.
export function listPendingInboundMessages(
  db: Database,
  options: { limit?: number } = {},
): ChannelInboundMessage[] {
  const limit = Math.min(options.limit ?? DEFAULT_PENDING_LIMIT, MAX_PENDING_LIMIT)
  return db
    .select()
    .from(channelInboundMessages)
    .where(eq(channelInboundMessages.status, 'pending'))
    .orderBy(asc(channelInboundMessages.receivedAt))
    .limit(limit)
    .all()
}

// Keyset cursor history (the one growth-scaling list, §6). Cursor on
// (receivedAt DESC, id DESC) — uses drizzle operators (NOT raw-sql tuple
// interpolation) so the Date is encoded through the timestamp_ms column
// type (the approvals/recent precedent).
export function listInboundMessagesForChannel(
  db: Database,
  channelId: string,
  options: { limit?: number; cursor?: { receivedAt: Date; id: string } } = {},
): ChannelInboundMessage[] {
  const limit = Math.min(options.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
  const filters = [eq(channelInboundMessages.channelId, channelId)]
  if (options.cursor) {
    filters.push(
      or(
        lt(channelInboundMessages.receivedAt, options.cursor.receivedAt),
        and(
          eq(channelInboundMessages.receivedAt, options.cursor.receivedAt),
          lt(channelInboundMessages.id, options.cursor.id),
        ),
      )!,
    )
  }
  return db
    .select()
    .from(channelInboundMessages)
    .where(and(...filters))
    .orderBy(desc(channelInboundMessages.receivedAt), desc(channelInboundMessages.id))
    .limit(limit)
    .all()
}

// Most-recent inbound for a sender that already has a chat session attached
// — used to resume the same session for channel continuity (§5.5 / D11).
export function findRecentSessionedInboundForSender(
  db: Database,
  channelId: string,
  externalSenderId: string,
): ChannelInboundMessage | null {
  const [row] = db
    .select()
    .from(channelInboundMessages)
    .where(
      and(
        eq(channelInboundMessages.channelId, channelId),
        eq(channelInboundMessages.externalSenderId, externalSenderId),
        isNotNull(channelInboundMessages.routedToChatSessionId),
      ),
    )
    .orderBy(desc(channelInboundMessages.receivedAt))
    .limit(1)
    .all()
  return row ?? null
}

// Most-recent inbound for a sender that surfaced an approval — maps a typed
// "approve"/"deny" reply to the pending approval (§5.7 text path).
export function findRecentApprovalAwaitingInboundForSender(
  db: Database,
  channelId: string,
  externalSenderId: string,
): ChannelInboundMessage | null {
  const [row] = db
    .select()
    .from(channelInboundMessages)
    .where(
      and(
        eq(channelInboundMessages.channelId, channelId),
        eq(channelInboundMessages.externalSenderId, externalSenderId),
        isNotNull(channelInboundMessages.routedToApprovalRequestId),
      ),
    )
    .orderBy(desc(channelInboundMessages.receivedAt))
    .limit(1)
    .all()
  return row ?? null
}

export function insertInboundMessage(
  db: Database,
  row: NewChannelInboundMessage,
): ChannelInboundMessage {
  const [inserted] = db.insert(channelInboundMessages).values(row).returning().all()
  if (!inserted) throw new Error('insertInboundMessage: no row returned')
  return inserted
}

export function updateInboundMessage(
  db: Database,
  id: string,
  patch: Partial<Omit<ChannelInboundMessage, 'id' | 'channelId'>>,
): ChannelInboundMessage {
  const [updated] = db
    .update(channelInboundMessages)
    .set(patch)
    .where(eq(channelInboundMessages.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateInboundMessage: no row for id ${id}`)
  return updated
}

// Purge (§7) — deletes terminal rows past the retention window.
export function hardDeleteInboundMessagesBefore(
  db: Database,
  input: { statuses: InboundMessageStatus[]; before: Date },
): number {
  const deleted = db
    .delete(channelInboundMessages)
    .where(
      and(
        inArray(channelInboundMessages.status, input.statuses),
        lt(channelInboundMessages.receivedAt, input.before),
      ),
    )
    .run()
  return deleted.changes
}

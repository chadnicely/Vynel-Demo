// Functional repository for the `channel_message_queue` table (outbound
// delivery). `db` first arg; Phase 1 SYNC returns.
//
// Spec: `docs/blueprints/channels/blueprint.md §4`.

import { and, asc, gte, inArray, eq, lt, lte } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  channelMessageQueue,
  readTurnCorrelationId,
  type ChannelMessageQueueEntry,
  type NewChannelMessageQueueEntry,
  type OutboundMessageStatus,
} from '../schema/channel-message-queue.js'

export type {
  ChannelMessageQueueEntry,
  NewChannelMessageQueueEntry,
  OutboundPayloadKind,
  OutboundMessageStatus,
} from '../schema/channel-message-queue.js'

const DEFAULT_READY_LIMIT = 50
const MAX_READY_LIMIT = 100

// The delivery loop's input — rows due now (pending or failed-retry whose
// backoff anchor has elapsed), oldest-due first.
export function listReadyOutboundMessages(
  db: Database,
  options: { limit?: number } = {},
): ChannelMessageQueueEntry[] {
  const limit = Math.min(options.limit ?? DEFAULT_READY_LIMIT, MAX_READY_LIMIT)
  return db
    .select()
    .from(channelMessageQueue)
    .where(
      and(
        inArray(channelMessageQueue.status, ['pending', 'failed-retry']),
        lte(channelMessageQueue.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(asc(channelMessageQueue.nextAttemptAt))
    .limit(limit)
    .all()
}

// All outbound rows for a channel, oldest-enqueued first, REGARDLESS of status.
// Not part of the delivery loop (which uses `listReadyOutboundMessages`) — it
// backs the `@vynel/channels/test-support` outbound-queue reader so cross-domain
// integration tests can assert what a channel enqueued.
export function listOutboundMessagesForChannel(
  db: Database,
  channelId: string,
): ChannelMessageQueueEntry[] {
  return db
    .select()
    .from(channelMessageQueue)
    .where(eq(channelMessageQueue.channelId, channelId))
    .orderBy(asc(channelMessageQueue.enqueuedAt))
    .all()
}

// How many REPLIES (`chat-stream-final` — the reply_to_channel / send_to_channel
// shape) this conversation has had queued since a moment. The silent-turn
// fallback's one question: "did the turn actually answer?" Status pushes,
// approval cards and ask nudges are deliberately NOT replies — a turn that only
// pushed a card still owes the sender a word.
//
// The time window alone is not enough: inbound messages run CONCURRENTLY, so a
// sibling turn replying in the same chat used to suppress this turn's fallback
// and the sender heard nothing at all. `turnCorrelationId` disqualifies a reply
// that provably belongs to another turn — it NARROWS the window, it does not
// replace it. A reply claiming no turn (a proactive send_to_channel) still
// counts: an unstamped row degrades to the old behaviour, which errs toward
// silence rather than toward two copies of one answer.
export function countChannelRepliesSince(
  db: Database,
  input: {
    channelId: string
    externalChatContextId: string
    since: Date
    /** Group rooms: only replies addressed to the asker answer for them. */
    externalRecipientId?: string
    /** THIS turn's key — replies stamped with a different one are siblings'. */
    turnCorrelationId?: string
  },
): number {
  const rows = db
    .select({ messageStructure: channelMessageQueue.messageStructure })
    .from(channelMessageQueue)
    .where(
      and(
        eq(channelMessageQueue.channelId, input.channelId),
        eq(channelMessageQueue.externalChatContextId, input.externalChatContextId),
        eq(channelMessageQueue.payloadKind, 'chat-stream-final'),
        gte(channelMessageQueue.enqueuedAt, input.since),
        ...(input.externalRecipientId !== undefined
          ? [eq(channelMessageQueue.externalRecipientId, input.externalRecipientId)]
          : []),
      ),
    )
    .all()
  const ownTurn = input.turnCorrelationId
  if (ownTurn === undefined) return rows.length
  return rows.filter((row) => {
    const owner = readTurnCorrelationId(row.messageStructure)
    return owner === null || owner === ownTurn
  }).length
}

export function findOutboundMessageById(
  db: Database,
  id: string,
): ChannelMessageQueueEntry | null {
  const [row] = db.select().from(channelMessageQueue).where(eq(channelMessageQueue.id, id)).limit(1).all()
  return row ?? null
}

export function insertOutboundMessage(
  db: Database,
  row: NewChannelMessageQueueEntry,
): ChannelMessageQueueEntry {
  const [inserted] = db.insert(channelMessageQueue).values(row).returning().all()
  if (!inserted) throw new Error('insertOutboundMessage: no row returned')
  return inserted
}

export function updateOutboundMessage(
  db: Database,
  id: string,
  patch: Partial<Omit<ChannelMessageQueueEntry, 'id' | 'channelId'>>,
): ChannelMessageQueueEntry {
  const [updated] = db
    .update(channelMessageQueue)
    .set(patch)
    .where(eq(channelMessageQueue.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateOutboundMessage: no row for id ${id}`)
  return updated
}

// Purge (§7) — deletes terminal rows past the retention window (by enqueuedAt).
export function hardDeleteOutboundMessagesBefore(
  db: Database,
  input: { statuses: OutboundMessageStatus[]; before: Date },
): number {
  const deleted = db
    .delete(channelMessageQueue)
    .where(
      and(
        inArray(channelMessageQueue.status, input.statuses),
        lt(channelMessageQueue.enqueuedAt, input.before),
      ),
    )
    .run()
  return deleted.changes
}

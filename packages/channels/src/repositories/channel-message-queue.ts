// Functional repository for the `channel_message_queue` table (outbound
// delivery). `db` first arg; Phase 1 SYNC returns.
//
// Spec: `docs/blueprints/channels/blueprint.md §4`.

import { and, asc, count, gte, inArray, eq, lt, lte } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  channelMessageQueue,
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
export function countChannelRepliesSince(
  db: Database,
  input: { channelId: string; externalChatContextId: string; since: Date },
): number {
  const [row] = db
    .select({ value: count() })
    .from(channelMessageQueue)
    .where(
      and(
        eq(channelMessageQueue.channelId, input.channelId),
        eq(channelMessageQueue.externalChatContextId, input.externalChatContextId),
        eq(channelMessageQueue.payloadKind, 'chat-stream-final'),
        gte(channelMessageQueue.enqueuedAt, input.since),
      ),
    )
    .all()
  return row?.value ?? 0
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

// The `memory_entry_mentions` table — one row per reference to a
// memory entry (loaded at session start, returned by a tool, cited
// inline). Drives recency scoring.
// See `docs/blueprints/memory/blueprint.md §3.2`.
//
// Phase 1 SYNC discipline applies.
//
// Cross-domain refs (`sessionId`, `messageId`) are loose `text()`
// per `cross-domain-loose-ref-with-outbox-mirror`. Cleanup via the
// `chat.session-hard-deleted` outbox consumer (memory side).
//
// No `userId` — scopes via `memoryEntryId → memory_entries.userId`
// per the locked "userId on top-level user-owned tables only" rule.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { memoryEntries } from './memory-entries.js'

export type MentionKind = 'session-context-load' | 'tool-output' | 'agent-citation'

export const memoryEntryMentions = table(
  'memory_entry_mentions',
  {
    id: id().primaryKey(),
    memoryEntryId: id()
      .notNull()
      .references(() => memoryEntries.id, { onDelete: 'cascade' }),

    // Loose cross-domain refs — chat owns these rows.
    sessionId: text().notNull(),
    messageId: text().notNull(),

    mentionKind: text().$type<MentionKind>().notNull(),
    mentionedAt: timestamp().notNull(),
  },
  (t) => ({
    entryMentionedIdx: index('idx_memory_entry_mentions_entry').on(t.memoryEntryId, t.mentionedAt),
    sessionIdx: index('idx_memory_entry_mentions_session').on(t.sessionId),
  }),
)

export type MemoryEntryMention = typeof memoryEntryMentions.$inferSelect
export type NewMemoryEntryMention = typeof memoryEntryMentions.$inferInsert

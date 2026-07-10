// The `memory_tags` table — user-defined labels on memory entries, many per
// entry. Tags are open text (normalized lowercase), with ONE reserved
// behavioral tag: `context` (CONTEXT_MEMORY_TAG) — entries wearing it are
// auto-injected into the session-start snapshot, carrying the workspace's
// standing context across fresh sessions. Everything else is topical
// organization (the DEFAULT_MEMORY_TAGS starters + whatever the user coins).
// See `docs/module-notes/memory.md` "tagging + sources".

import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { memoryEntries } from './memory-entries.js'

export const memoryTags = table(
  'memory_tags',
  {
    id: id().primaryKey(),
    memoryEntryId: id().references(() => memoryEntries.id, { onDelete: 'cascade' }),
    // Normalized (trimmed, lowercased) — `normalizeMemoryTag` is the one gate.
    tag: text().notNull(),
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    byEntry: index('idx_memory_tags_entry').on(t.memoryEntryId),
    byTag: index('idx_memory_tags_tag').on(t.tag),
    uniqueEntryTag: uniqueIndex('uniq_memory_tags_entry_tag').on(t.memoryEntryId, t.tag),
  }),
)

export type MemoryTagRow = typeof memoryTags.$inferSelect
export type NewMemoryTagRow = typeof memoryTags.$inferInsert

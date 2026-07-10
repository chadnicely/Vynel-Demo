// The `memory_entries` table for the `memory` domain — one row per
// structured fact (kind: person / preference / business-fact /
// recurring-pattern / note) with embeddings + provenance + lifecycle.
// See `docs/blueprints/memory/blueprint.md §3.1` + `decisions.md` D18
// (bytes() helper).
//
// Phase 1 SYNC discipline applies.
//
// Cross-domain refs (`sourceMessageId`) are loose `text()` per the
// locked `cross-domain-loose-ref-with-outbox-mirror` precedent —
// nulled by memory's `chat.session-hard-deleted` outbox consumer.
//
// The `bytes()` dialect helper is added with this domain (memory is
// the first consumer) per D18. Knowledge will reuse for document-
// chunk embeddings.

import { table, id, text, boolean, timestamp, bytes, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type MemoryEntryKind =
  | 'person'
  | 'preference'
  | 'business-fact'
  | 'recurring-pattern'
  | 'note'

export type MemoryEntryCreatedSource =
  | 'workspace-seed'
  | 'user-manual'
  | 'onboarding-seed'
  | 'file-import'

export type MemoryEntryCategory = 'user' | 'preferences' | 'memory'

export const memoryEntries = table(
  'memory_entries',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),

    kind: text().$type<MemoryEntryKind>().notNull(),
    title: text().notNull(),
    body: text().notNull(),

    category: text().$type<MemoryEntryCategory>().notNull(),
    section: text().notNull(),

    // Loose cross-domain ref — chat may delete the underlying message.
    // Nulled via memory's chat.session-hard-deleted outbox consumer.
    sourceMessageId: text(),

    createdSource: text().$type<MemoryEntryCreatedSource>().notNull(),

    // Generated asynchronously by the embedding worker (§7.1). Null
    // until generated. 384 × float32 = 1536 bytes per row (MiniLM-L6-v2).
    embedding: bytes(),
    embeddingModelVersion: text(),

    isArchived: boolean().notNull(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    lastMentionedAt: timestamp(),
    deletedAt: timestamp(),
  },
  (t) => ({
    userIdIdx: index('idx_memory_entries_user').on(t.userId),
    workspaceKindIdx: index('idx_memory_entries_workspace_kind').on(t.workspaceId, t.kind),
    workspaceArchivedIdx: index('idx_memory_entries_workspace_archived').on(
      t.workspaceId,
      t.isArchived,
    ),
    lastMentionedIdx: index('idx_memory_entries_last_mentioned').on(
      t.workspaceId,
      t.lastMentionedAt,
    ),
    deletedAtIdx: index('idx_memory_entries_deleted_at').on(t.deletedAt),
    sourceMessageIdx: index('idx_memory_entries_source_message').on(t.sourceMessageId),
  }),
)

export type MemoryEntry = typeof memoryEntries.$inferSelect
export type NewMemoryEntry = typeof memoryEntries.$inferInsert

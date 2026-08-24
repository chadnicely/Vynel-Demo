// `journal_entries` table for the `journal` domain — the daily work journal.
// Many entries per day, append-style: each row is a dated moment recording
// what happened, so the assistant can read back and understand the flow of
// recent days' work. Has NO `deletedAt`: `deleteJournalEntry` hard-deletes
// (user door only — docs/module-notes/journal.md).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope — nullable, NULL = global (no workspace); mirrors
// `tasks.workspaceId`. `sessionId` is a LOOSE `text()` cross-domain ref (NO
// FK). `entryDate` is a text `YYYY-MM-DD` day, not a timestamp — calendar
// semantics sort correctly as text and dodge timezone drift. Phase 1 SYNC
// repo discipline.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// Who wrote the entry — the assistant (via its MCP tools) or the user (via
// the UI/CLI). Drives the "Claude / you" chip in the UI.
export type JournalEntrySource = 'assistant' | 'user'

export const journalEntries = table(
  'journal_entries',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: NULL = GLOBAL scope (a user-level entry with no workspace);
    // a non-null value scopes the entry to that workspace. Uses
    // `text().references(...)` since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // The day (`YYYY-MM-DD`) this entry belongs to.
    entryDate: text().notNull(),
    content: text().notNull(),
    source: text().$type<JournalEntrySource>().notNull(),
    // Loose cross-domain ref — the chat session whose turn wrote the entry
    // (NOT a FK).
    sessionId: text(),
    // The commit this entry records, when the work landed as one (Kafi
    // 2026-08-25 — the journal is the workspace's changelog/timeline, and an
    // entry that names its commit is a concrete pointer into history). Free
    // text (a short hash), never resolved against a repo.
    commitRef: text(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_journal_entries_user_workspace').on(t.userId, t.workspaceId),
    userDateIdx: index('idx_journal_entries_user_date').on(t.userId, t.entryDate),
  }),
)

export type JournalEntry = typeof journalEntries.$inferSelect
export type NewJournalEntry = typeof journalEntries.$inferInsert

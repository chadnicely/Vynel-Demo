// Public surface of `@vynel/journal` — the journal leaf. Consumers reach the
// package only through this barrel; schema, repositories and the concern
// folders are internal (imported relatively).

export type { StructuralLogger } from './journal-types.js'

// Row types — the HTTP serializers type their inputs against these (the
// tasks `Task` re-export precedent). Repositories stay internal.
export type { JournalEntry, JournalEntrySource } from './repositories/index.js'

export {
  JOURNAL_ENTRY_CREATED,
  JOURNAL_ENTRY_UPDATED,
  JOURNAL_ENTRY_DELETED,
  type JournalEntryCreatedPayload,
  type JournalEntryUpdatedPayload,
  type JournalEntryDeletedPayload,
} from './journal-events.js'

// CRUD + read ops (sync).
export {
  createJournalEntry,
  type CreateJournalEntryInput,
  JOURNAL_CONTENT_MAX_LENGTH,
  ENTRY_DATE_PATTERN,
} from './lifecycle/create-journal-entry.js'
export {
  updateJournalEntry,
  type UpdateJournalEntryInput,
} from './lifecycle/update-journal-entry.js'
export { deleteJournalEntry } from './lifecycle/delete-journal-entry.js'
export { listJournalEntries, listJournalEntriesForUser } from './queries/list-journal-entries.js'

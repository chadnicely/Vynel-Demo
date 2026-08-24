// HTTP response shape for the `journal` domain. Single source of truth for
// the serialized response: `apps/local-api` types
// `serializeJournalEntryForResponse`'s return as `JournalEntryResponse`;
// `apps/local-web` casts SDK responses to it (the tasks
// cast-from-contracts precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (kept in sync with `packages/journal/src/schema/journal-entries.ts`).

export type JournalEntrySource = 'assistant' | 'user'

export interface JournalEntryResponse {
  id: string
  userId: string
  // Nullable to match the schema (NULL = GLOBAL scope — a user-level entry
  // with no workspace).
  workspaceId: string | null
  /** YYYY-MM-DD — the day this entry belongs to */
  entryDate: string
  content: string
  source: JournalEntrySource
  sessionId: string | null
  /** The writing session's display title, resolved at read time — the label
   *  on the entry's pointer chip (null when no session or none resolvable). */
  sessionTitle: string | null
  /** The commit this entry records, when the work landed as one. */
  commitRef: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

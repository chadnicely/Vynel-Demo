// Outbox event type constants + payload interfaces for the `journal` domain —
// `journal.entry-created`, `journal.entry-updated`, `journal.entry-deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors tasks'
// `tasks-events.ts`.
//
// No "completed" flavor — journal entries have no status; the journal is an
// append-style record, not a checklist.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { JournalEntrySource } from './repositories/index.js'

export const JOURNAL_ENTRY_CREATED = 'journal.entry-created' as const
export const JOURNAL_ENTRY_UPDATED = 'journal.entry-updated' as const
export const JOURNAL_ENTRY_DELETED = 'journal.entry-deleted' as const

export type JournalEntryCreatedPayload = {
  entryId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  entryDate: string
  source: JournalEntrySource
  createdAt: string
}

export type JournalEntryUpdatedPayload = {
  entryId: string
  userId: string
  workspaceId: string | null
  entryDate: string
  updatedAt: string
}

export type JournalEntryDeletedPayload = {
  entryId: string
  userId: string
  workspaceId: string | null
  deletedAt: string
}

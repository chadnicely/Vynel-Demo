// Functional repository for the `journal_entries` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this
// repo.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  journalEntries,
  type JournalEntry,
  type NewJournalEntry,
} from '../schema/journal-entries.js'

// Re-export row + union types so `@vynel/journal` surfaces them via the
// package barrel (the tasks repo precedent).
export type {
  JournalEntry,
  NewJournalEntry,
  JournalEntrySource,
} from '../schema/journal-entries.js'

// A journal grows unbounded — cap reads; the caller narrows with the date
// range when it wants deeper history.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

export interface JournalDateFilter {
  entryDate?: string // exact day — wins over the range when both are sent
  fromDate?: string // inclusive
  toDate?: string // inclusive
}

function dateFilters(filter: JournalDateFilter) {
  if (filter.entryDate) return [eq(journalEntries.entryDate, filter.entryDate)]
  const filters = []
  if (filter.fromDate) filters.push(gte(journalEntries.entryDate, filter.fromDate))
  if (filter.toDate) filters.push(lte(journalEntries.entryDate, filter.toDate))
  return filters
}

export function listJournalEntriesForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string; limit?: number } & JournalDateFilter,
): JournalEntry[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [
    eq(journalEntries.userId, input.userId),
    eq(journalEntries.workspaceId, input.workspaceId),
    ...dateFilters(input),
  ]
  return db
    .select()
    .from(journalEntries)
    .where(and(...filters))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit)
    .all()
}

// All of a user's entries across every workspace + the global
// (null-workspace) scope — the user-scoped `/journal` surface. Filters by
// userId only (the tenant boundary); workspace scope is not narrowed.
export function listJournalEntriesForUser(
  db: Database,
  input: { userId: string; limit?: number } & JournalDateFilter,
): JournalEntry[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(journalEntries.userId, input.userId), ...dateFilters(input)]
  return db
    .select()
    .from(journalEntries)
    .where(and(...filters))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit)
    .all()
}

export function findJournalEntryById(db: Database, id: string): JournalEntry | null {
  const [row] = db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1).all()
  return row ?? null
}

export function insertJournalEntry(db: Database, row: NewJournalEntry): JournalEntry {
  const [inserted] = db.insert(journalEntries).values(row).returning().all()
  if (!inserted) throw new Error('insertJournalEntry: no row returned')
  return inserted
}

export function updateJournalEntry(
  db: Database,
  id: string,
  patch: Partial<NewJournalEntry>,
): JournalEntry {
  const [updated] = db
    .update(journalEntries)
    .set(patch)
    .where(eq(journalEntries.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateJournalEntry: no row for ${id}`)
  return updated
}

export function hardDeleteJournalEntry(db: Database, id: string): void {
  db.delete(journalEntries).where(eq(journalEntries.id, id)).run()
}

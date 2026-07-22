// Read ops — the two list surfaces. Workspace-scoped backs the in-session MCP
// `list_journal_entries`; user-scoped spans every workspace + the global
// (null-workspace) scope and backs the panel + `list_my_journal_entries`.
// Newest first (entryDate desc, createdAt desc), capped; narrow with the
// exact day or the inclusive from/to range for deeper history.

import * as journalRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { JournalDateFilter, JournalEntry } from '../repositories/index.js'

export function listJournalEntries(
  db: Database,
  input: { userId: string; workspaceId: string; limit?: number } & JournalDateFilter,
): JournalEntry[] {
  return journalRepository.listJournalEntriesForWorkspace(db, input)
}

export function listJournalEntriesForUser(
  db: Database,
  input: { userId: string; limit?: number } & JournalDateFilter,
): JournalEntry[] {
  return journalRepository.listJournalEntriesForUser(db, input)
}

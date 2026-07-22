import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, makeJournalEntry, insertJournalEntry } from '../test-support.js'
import { findJournalEntryById } from '../repositories/index.js'
import { deleteJournalEntry } from './delete-journal-entry.js'
import { JOURNAL_ENTRY_DELETED } from '../journal-events.js'

describe('deleteJournalEntry', () => {
  it('hard-deletes and co-commits journal.entry-deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))

      deleteJournalEntry(db, { entryId: entry.id, userId })
      expect(findJournalEntryById(db, entry.id)).toBeNull()

      const events = listOutboxEventsByType(db, JOURNAL_ENTRY_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ entryId: entry.id, userId, workspaceId })
    })
  })

  it('404s identically on missing and not-owned entries', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))

      expect(() => deleteJournalEntry(db, { entryId: 'missing', userId })).toThrow(NotFoundError)
      expect(() => deleteJournalEntry(db, { entryId: entry.id, userId: other.userId })).toThrow(
        NotFoundError,
      )
      expect(findJournalEntryById(db, entry.id)).not.toBeNull()
    })
  })
})

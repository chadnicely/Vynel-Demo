import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace, makeJournalEntry, insertJournalEntry } from '../test-support.js'
import { updateJournalEntry } from './update-journal-entry.js'
import { JOURNAL_ENTRY_UPDATED } from '../journal-events.js'

describe('updateJournalEntry', () => {
  it('patches content/entryDate and emits journal.entry-updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))

      const updated = updateJournalEntry(db, {
        entryId: entry.id,
        userId,
        content: 'Corrected record',
        entryDate: '2026-07-22',
      })
      expect(updated.content).toBe('Corrected record')
      expect(updated.entryDate).toBe('2026-07-22')
      expect(listOutboxEventsByType(db, JOURNAL_ENTRY_UPDATED)).toHaveLength(1)
    })
  })

  it('rejects empty content and a malformed entryDate', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))

      expect(() => updateJournalEntry(db, { entryId: entry.id, userId, content: '  ' })).toThrow(
        ValidationError,
      )
      expect(() =>
        updateJournalEntry(db, { entryId: entry.id, userId, entryDate: 'yesterday' }),
      ).toThrow(ValidationError)
    })
  })

  it('404s identically on missing and not-owned entries', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))

      expect(() => updateJournalEntry(db, { entryId: 'missing', userId, content: 'x' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updateJournalEntry(db, { entryId: entry.id, userId: other.userId, content: 'x' }),
      ).toThrow(NotFoundError)
    })
  })
})

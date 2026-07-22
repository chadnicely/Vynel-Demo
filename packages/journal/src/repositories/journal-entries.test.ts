import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makeJournalEntry } from '../test-support.js'
import {
  insertJournalEntry,
  findJournalEntryById,
  updateJournalEntry,
  hardDeleteJournalEntry,
  listJournalEntriesForWorkspace,
  listJournalEntriesForUser,
} from './index.js'

describe('journal entries repository', () => {
  it('inserts and finds an entry', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))
      expect(findJournalEntryById(db, entry.id)).toEqual(entry)
      expect(findJournalEntryById(db, 'missing')).toBeNull()
    })
  })

  it('lists workspace entries without leaking global or foreign rows', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'in workspace' }))
      insertJournalEntry(db, makeJournalEntry(userId, null, { content: 'global' }))
      insertJournalEntry(
        db,
        makeJournalEntry(other.userId, other.workspaceId, { content: 'foreign' }),
      )

      const rows = listJournalEntriesForWorkspace(db, { userId, workspaceId })
      expect(rows.map((r) => r.content)).toEqual(['in workspace'])
    })
  })

  it('filters by exact day and by inclusive from/to range, newest day first', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'mon', entryDate: '2026-07-20' }))
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'tue', entryDate: '2026-07-21' }))
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'wed', entryDate: '2026-07-22' }))

      const all = listJournalEntriesForWorkspace(db, { userId, workspaceId })
      expect(all.map((r) => r.content)).toEqual(['wed', 'tue', 'mon'])

      const day = listJournalEntriesForWorkspace(db, { userId, workspaceId, entryDate: '2026-07-21' })
      expect(day.map((r) => r.content)).toEqual(['tue'])

      const range = listJournalEntriesForWorkspace(db, {
        userId,
        workspaceId,
        fromDate: '2026-07-21',
        toDate: '2026-07-22',
      })
      expect(range.map((r) => r.content)).toEqual(['wed', 'tue'])
    })
  })

  it('exact day wins over the range when both are sent', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'mon', entryDate: '2026-07-20' }))
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'tue', entryDate: '2026-07-21' }))

      const rows = listJournalEntriesForWorkspace(db, {
        userId,
        workspaceId,
        entryDate: '2026-07-20',
        fromDate: '2026-07-21',
        toDate: '2026-07-21',
      })
      expect(rows.map((r) => r.content)).toEqual(['mon'])
    })
  })

  it('lists user entries across workspace + global scopes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertJournalEntry(db, makeJournalEntry(userId, workspaceId, { content: 'scoped' }))
      insertJournalEntry(db, makeJournalEntry(userId, null, { content: 'global' }))

      expect(listJournalEntriesForUser(db, { userId })).toHaveLength(2)
    })
  })

  it('updates and hard-deletes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = insertJournalEntry(db, makeJournalEntry(userId, workspaceId))
      const updated = updateJournalEntry(db, entry.id, { content: 'edited' })
      expect(updated.content).toBe('edited')
      hardDeleteJournalEntry(db, entry.id)
      expect(findJournalEntryById(db, entry.id)).toBeNull()
    })
  })
})

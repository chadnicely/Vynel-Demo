import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { createJournalEntry, JOURNAL_CONTENT_MAX_LENGTH } from './create-journal-entry.js'
import { JOURNAL_ENTRY_CREATED } from '../journal-events.js'

describe('createJournalEntry', () => {
  it('inserts an entry and co-commits journal.entry-created', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const entry = createJournalEntry(db, {
        userId,
        workspaceId,
        entryDate: '2026-07-23',
        content: '  Shipped the newsletter draft.  ',
        source: 'assistant',
        sessionId: 'session-1',
      })

      expect(entry.content).toBe('Shipped the newsletter draft.') // trimmed
      expect(entry.entryDate).toBe('2026-07-23')
      expect(entry.sessionId).toBe('session-1')

      const events = listOutboxEventsByType(db, JOURNAL_ENTRY_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        entryId: entry.id,
        userId,
        workspaceId,
        entryDate: '2026-07-23',
        source: 'assistant',
        createdAt: entry.createdAt.toISOString(),
      })
    })
  })

  it('creates a GLOBAL entry (null workspaceId)', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const entry = createJournalEntry(db, {
        userId,
        workspaceId: null,
        entryDate: '2026-07-23',
        content: 'Global note',
        source: 'user',
      })
      expect(entry.workspaceId).toBeNull()
    })
  })

  it('rejects empty and over-long content', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createJournalEntry(db, {
          userId,
          workspaceId,
          entryDate: '2026-07-23',
          content: '   ',
          source: 'user',
        }),
      ).toThrow(ValidationError)
      expect(() =>
        createJournalEntry(db, {
          userId,
          workspaceId,
          entryDate: '2026-07-23',
          content: 'x'.repeat(JOURNAL_CONTENT_MAX_LENGTH + 1),
          source: 'user',
        }),
      ).toThrow(ValidationError)
    })
  })

  it('rejects a malformed entryDate', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      for (const bad of ['23-07-2026', '2026/07/23', 'today', '2026-7-3']) {
        expect(() =>
          createJournalEntry(db, {
            userId,
            workspaceId,
            entryDate: bad,
            content: 'Dated',
            source: 'user',
          }),
        ).toThrow(ValidationError)
      }
    })
  })
})

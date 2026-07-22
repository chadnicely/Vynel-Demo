// Core op — remove a journal entry (owner-scoped). USER-door only by design —
// the assistant never deletes history (docs/module-notes/journal.md). Hard
// delete + `journal.entry-deleted` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as journalRepository from '../repositories/index.js'
import { JOURNAL_ENTRY_DELETED, type JournalEntryDeletedPayload } from '../journal-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../journal-types.js'

export function deleteJournalEntry(
  db: Database,
  input: { entryId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const entry = journalRepository.findJournalEntryById(db, input.entryId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!entry || entry.userId !== input.userId) {
    throw new NotFoundError('journal entry', input.entryId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    journalRepository.hardDeleteJournalEntry(tx, entry.id)
    const payload: JournalEntryDeletedPayload = {
      entryId: entry.id,
      userId: entry.userId,
      workspaceId: entry.workspaceId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: JOURNAL_ENTRY_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ entryId: entry.id }, 'journal entry deleted')
}

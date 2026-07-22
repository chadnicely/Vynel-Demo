// Core op — patch a journal entry (owner-scoped): content, entryDate. sync.
// USER-door only by design — the assistant appends and reads, never rewrites
// history (docs/module-notes/journal.md). Patch + `journal.entry-updated`
// co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as journalRepository from '../repositories/index.js'
import { JOURNAL_CONTENT_MAX_LENGTH, assertValidEntryDate } from './create-journal-entry.js'
import { JOURNAL_ENTRY_UPDATED, type JournalEntryUpdatedPayload } from '../journal-events.js'
import type { Database } from '@vynel/db'
import type { JournalEntry, NewJournalEntry } from '../repositories/index.js'
import type { StructuralLogger } from '../journal-types.js'

export interface UpdateJournalEntryInput {
  entryId: string
  userId: string
  content?: string
  entryDate?: string
}

export function updateJournalEntry(
  db: Database,
  input: UpdateJournalEntryInput,
  deps: { logger?: StructuralLogger } = {},
): JournalEntry {
  const entry = journalRepository.findJournalEntryById(db, input.entryId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!entry || entry.userId !== input.userId) {
    throw new NotFoundError('journal entry', input.entryId)
  }

  const now = new Date()
  const patch: Partial<NewJournalEntry> = { updatedAt: now }

  if (input.content !== undefined) {
    const content = input.content.trim()
    if (content.length === 0) {
      throw new ValidationError('A journal entry needs content. Write what happened.')
    }
    if (content.length > JOURNAL_CONTENT_MAX_LENGTH) {
      throw new ValidationError(
        `Journal entries are capped at ${JOURNAL_CONTENT_MAX_LENGTH} characters. Split long days into multiple entries.`,
      )
    }
    patch.content = content
  }
  if (input.entryDate !== undefined) {
    assertValidEntryDate(input.entryDate)
    patch.entryDate = input.entryDate
  }

  const updated = withTransaction(db, (tx) => {
    const row = journalRepository.updateJournalEntry(tx, input.entryId, patch)
    const payload: JournalEntryUpdatedPayload = {
      entryId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      entryDate: row.entryDate,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: JOURNAL_ENTRY_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  deps.logger?.info({ entryId: updated.id }, 'journal entry updated')
  return updated
}

// Core op — append a dated entry to the journal (assistant via its MCP tool,
// or the user via UI/CLI). sync. Insert + `journal.entry-created` co-commit
// in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as journalRepository from '../repositories/index.js'
import { JOURNAL_ENTRY_CREATED, type JournalEntryCreatedPayload } from '../journal-events.js'
import type { Database } from '@vynel/db'
import type { JournalEntry, JournalEntrySource } from '../repositories/index.js'
import type { StructuralLogger } from '../journal-types.js'

// Journal entries are prose moments — longer than task detail, still capped.
export const JOURNAL_CONTENT_MAX_LENGTH = 8000

// The ONE home for the calendar-day shape — the route schemas mirror it.
export const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function assertValidEntryDate(entryDate: string): void {
  if (!ENTRY_DATE_PATTERN.test(entryDate)) {
    throw new ValidationError('Journal entry dates use the YYYY-MM-DD format, e.g. 2026-07-23.')
  }
}

export interface CreateJournalEntryInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  entryDate: string // YYYY-MM-DD — the day this entry belongs to
  content: string
  source: JournalEntrySource
  sessionId?: string // the chat session whose turn wrote the entry
}

export function createJournalEntry(
  db: Database,
  input: CreateJournalEntryInput,
  deps: { logger?: StructuralLogger } = {},
): JournalEntry {
  const content = input.content.trim()
  if (content.length === 0) {
    throw new ValidationError('A journal entry needs content. Write what happened.')
  }
  if (content.length > JOURNAL_CONTENT_MAX_LENGTH) {
    throw new ValidationError(
      `Journal entries are capped at ${JOURNAL_CONTENT_MAX_LENGTH} characters. Split long days into multiple entries.`,
    )
  }
  assertValidEntryDate(input.entryDate)

  const now = new Date()
  const entry = withTransaction(db, (tx) => {
    const inserted = journalRepository.insertJournalEntry(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      content,
      source: input.source,
      sessionId: input.sessionId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: JournalEntryCreatedPayload = {
      entryId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      entryDate: inserted.entryDate,
      source: inserted.source,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: JOURNAL_ENTRY_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info(
    { entryId: entry.id, entryDate: entry.entryDate, source: entry.source },
    'journal entry created',
  )
  return entry
}

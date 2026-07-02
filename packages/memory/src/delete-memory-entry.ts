// `deleteMemoryEntry` — soft-deletes a memory entry (sets
// `deletedAt`) + removes its vec0 row + emits a
// `memory.entry-archived` outbox event. The 30-day retention purge
// worker hard-deletes after the window.
//
// `deleteVectorIndex` MUST be called explicitly because sqlite-vec
// does NOT honor SQL FK constraints or triggers. The vec row is
// dropped inside the same transaction as the soft-delete + outbox
// emit.
//
// Throws `NotFoundError` when the row doesn't exist or is already
// soft-deleted (idempotent soft-delete returning false from the
// repo signals the second case).

import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { findEntryById, softDeleteEntry } from '@vynel/db/repositories/memory'
import { deleteVectorIndex } from '@vynel/db/repositories/memory'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { MEMORY_ENTRY_ARCHIVED, type MemoryEntryArchivedPayload } from './memory-events.js'

export function deleteMemoryEntry(db: Database, entryId: string): void {
  withTransaction(db, (tx) => {
    const entry = findEntryById(tx, entryId)
    if (!entry || entry.deletedAt) {
      throw new NotFoundError('memory-entry', entryId)
    }
    const now = new Date()
    const ok = softDeleteEntry(tx, entryId, now)
    if (!ok) throw new NotFoundError('memory-entry', entryId)

    deleteVectorIndex(tx, entryId)

    const payload: MemoryEntryArchivedPayload = {
      userId: entry.userId,
      workspaceId: entry.workspaceId,
      category: entry.category,
      section: entry.section,
      count: 1,
      archivedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MEMORY_ENTRY_ARCHIVED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })
}

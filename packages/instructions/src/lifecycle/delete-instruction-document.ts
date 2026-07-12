// `deleteInstructionDocument` — hard-deletes a USER document (small
// human-curated rows; no soft-delete lifecycle like memory's fact stream).
// Co-commits an `instruction.deleted` outbox event; throws
// `NotFoundError('instruction-document', id)` when no row matches.

import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { findDocumentById, deleteDocument } from '../repositories/index.js'
import { INSTRUCTION_DELETED, type InstructionDeletedPayload } from '../instructions-events.js'

export function deleteInstructionDocument(db: Database, documentId: string): void {
  const now = new Date()
  withTransaction(db, (tx) => {
    const existing = findDocumentById(tx, documentId)
    if (!existing) throw new NotFoundError('instruction-document', documentId)

    deleteDocument(tx, documentId)

    const payload: InstructionDeletedPayload = {
      documentId: existing.id,
      userId: existing.userId,
      scope: existing.scope,
      workspaceId: existing.workspaceId,
      mode: existing.mode,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: INSTRUCTION_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })
}

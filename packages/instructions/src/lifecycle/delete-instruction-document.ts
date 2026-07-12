// `deleteInstructionDocument` — hard-deletes a USER document (small
// human-curated rows; no soft-delete lifecycle like memory's fact stream).
// OWN docs only: the op is the ownership gate (see updateInstructionDocument);
// not-found and not-owned throw the identical
// `NotFoundError('instruction-document', id)` (no enumeration leak).
// Co-commits an `instruction.deleted` outbox event.

import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { findDocumentById, deleteDocument } from '../repositories/index.js'
import { INSTRUCTION_DELETED, type InstructionDeletedPayload } from '../instructions-events.js'
import type { InstructionDocumentSelector } from './update-instruction-document.js'

export function deleteInstructionDocument(
  db: Database,
  selector: InstructionDocumentSelector,
): void {
  const { documentId, userId } = selector
  const now = new Date()
  withTransaction(db, (tx) => {
    const existing = findDocumentById(tx, documentId)
    if (!existing || existing.userId !== userId) {
      throw new NotFoundError('instruction-document', documentId)
    }

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

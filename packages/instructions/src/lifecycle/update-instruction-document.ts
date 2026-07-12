// `updateInstructionDocument` — patches a USER document's mutable fields
// (title, body, enabled, sortOrder). Scope/mode/owner are immutable after
// creation (delete + recreate to move a doc). System notebooks are untouchable
// by construction — they never have a row here. Co-commits an
// `instruction.updated` outbox event; throws
// `NotFoundError('instruction-document', id)` when no row matches.

import { randomUUID } from 'node:crypto'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  findDocumentById,
  updateDocument,
  type InstructionDocument,
  type UpdateDocumentPatch,
} from '../repositories/index.js'
import { validateTitle, validateBody } from './validate-instruction-document.js'
import { INSTRUCTION_UPDATED, type InstructionUpdatedPayload } from '../instructions-events.js'

// `| undefined` (the registry patch-type precedent): a route's Zod `.optional()`
// output carries present-but-undefined keys, and the op filters them below.
export type UpdateInstructionDocumentInput = {
  title?: string | undefined
  body?: string | undefined
  enabled?: boolean | undefined
  sortOrder?: number | undefined
}

export function updateInstructionDocument(
  db: Database,
  documentId: string,
  input: UpdateInstructionDocumentInput,
): InstructionDocument {
  // A present-but-undefined key is not an update — only real values count, so
  // the event's `updatedFields` never names a field that didn't change. An
  // effectively-empty patch is a caller bug, not a no-op success (the
  // UpdateCatalogItemMetadataSchema `.refine` precedent).
  const updatedFields = Object.keys(input).filter(
    (key) => input[key as keyof UpdateInstructionDocumentInput] !== undefined,
  )
  if (updatedFields.length === 0) {
    throw new ValidationError(
      'Instruction document patch is empty — provide at least one field to update.',
    )
  }

  // Validate BEFORE the transaction — a bad patch never opens one.
  const patch: UpdateDocumentPatch = {}
  if (input.title !== undefined) patch.title = validateTitle(input.title)
  if (input.body !== undefined) patch.body = validateBody(input.body)
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

  return withTransaction(db, (tx) => {
    const before = findDocumentById(tx, documentId)
    if (!before) throw new NotFoundError('instruction-document', documentId)

    const updated = updateDocument(tx, documentId, patch)
    if (!updated) throw new NotFoundError('instruction-document', documentId)

    const payload: InstructionUpdatedPayload = {
      documentId: updated.id,
      userId: updated.userId,
      scope: updated.scope,
      workspaceId: updated.workspaceId,
      mode: updated.mode,
      updatedFields,
      updatedAt: updated.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: INSTRUCTION_UPDATED,
      payload,
      createdAt: updated.updatedAt,
      processedAt: null,
    })
    return updated
  })
}

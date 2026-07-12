// `createInstructionDocument` — the UI's POST entry point (routes land next
// slice). USER documents only, by construction: verified system notebooks
// ship from the repo directory and never touch this table (settled fork #1).
// Co-commits the row + an `instruction.created` outbox event in one
// transaction.
//
// Mode is pinned to 'notebook' — the 'always' injected-instructions arc is
// deferred (scope change 2026-07-12); the column exists so that arc needs no
// migration, but no op in this slice writes it.

import { randomUUID } from 'node:crypto'
import { ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  insertDocument,
  type InstructionDocument,
  type InstructionScope,
} from '../repositories/index.js'
import { validateTitle, validateBody } from './validate-instruction-document.js'
import { INSTRUCTION_CREATED, type InstructionCreatedPayload } from '../instructions-events.js'

export type CreateInstructionDocumentInput = {
  userId: string
  scope: InstructionScope
  /** Required when scope is 'workspace'; must be absent for 'global'. */
  workspaceId?: string
  title: string
  body: string
  enabled?: boolean
  sortOrder?: number
}

export function createInstructionDocument(
  db: Database,
  input: CreateInstructionDocumentInput,
): InstructionDocument {
  const title = validateTitle(input.title)
  const body = validateBody(input.body)
  if (input.scope === 'workspace' && input.workspaceId === undefined) {
    throw new ValidationError(
      "A workspace-scoped instruction document needs a workspaceId — pass one, or use scope 'global'.",
    )
  }
  if (input.scope === 'global' && input.workspaceId !== undefined) {
    throw new ValidationError(
      "A global instruction document must not carry a workspaceId — drop it, or use scope 'workspace'.",
    )
  }

  const now = new Date()
  return withTransaction(db, (tx) => {
    const row = insertDocument(tx, {
      id: randomUUID(),
      userId: input.userId,
      scope: input.scope,
      workspaceId: input.workspaceId ?? null,
      mode: 'notebook',
      title,
      body,
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    const payload: InstructionCreatedPayload = {
      documentId: row.id,
      userId: row.userId,
      scope: row.scope,
      workspaceId: row.workspaceId,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: INSTRUCTION_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })
}

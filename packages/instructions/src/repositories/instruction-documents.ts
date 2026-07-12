// Functional repository for the `instruction_documents` table. `db` is the
// first argument; stateless; `findX` returns null. Mode is a plain column
// filter here — the NOTEBOOK-ONLY policy of this slice lives at the op layer
// (`queries/` + `lifecycle/`), not in the repo, so the deferred 'always' arc
// reuses these functions unchanged.

import { and, asc, eq, or } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  instructionDocuments,
  type InstructionDocument,
  type NewInstructionDocument,
  type InstructionMode,
} from '../schema/instruction-documents.js'

export type {
  InstructionDocument,
  NewInstructionDocument,
  InstructionScope,
  InstructionMode,
} from '../schema/instruction-documents.js'

// Defensive cap — every list* that scales with tenant data is capped at the
// repo layer too (the HTTP boundary clamps again when the routes land).
const MAX_LIST_LIMIT = 200

export function insertDocument(
  db: Database,
  newDocument: NewInstructionDocument,
): InstructionDocument {
  const [inserted] = db.insert(instructionDocuments).values(newDocument).returning().all()
  if (!inserted) throw new Error('insertDocument: no row returned')
  return inserted
}

export function findDocumentById(db: Database, documentId: string): InstructionDocument | null {
  const [row] = db
    .select()
    .from(instructionDocuments)
    .where(eq(instructionDocuments.id, documentId))
    .limit(1)
    .all()
  return row ?? null
}

export type ListDocumentsOptions = {
  mode?: InstructionMode
  /** 'global' → global-scope docs only; a workspace id → global docs PLUS that
   *  workspace's docs (a workspace turn sees both, per the module notes). */
  visibleFrom?: 'global' | { workspaceId: string }
  enabledOnly?: boolean
}

export function listDocumentsForUser(
  db: Database,
  userId: string,
  options: ListDocumentsOptions = {},
): InstructionDocument[] {
  const conditions = [eq(instructionDocuments.userId, userId)]
  if (options.mode !== undefined) conditions.push(eq(instructionDocuments.mode, options.mode))
  if (options.enabledOnly === true) conditions.push(eq(instructionDocuments.enabled, true))
  if (options.visibleFrom === 'global') {
    conditions.push(eq(instructionDocuments.scope, 'global'))
  } else if (options.visibleFrom !== undefined) {
    conditions.push(
      or(
        eq(instructionDocuments.scope, 'global'),
        eq(instructionDocuments.workspaceId, options.visibleFrom.workspaceId),
      )!,
    )
  }
  return db
    .select()
    .from(instructionDocuments)
    .where(and(...conditions))
    .orderBy(asc(instructionDocuments.sortOrder), asc(instructionDocuments.createdAt))
    .limit(MAX_LIST_LIMIT)
    .all()
}

export type UpdateDocumentPatch = Partial<
  Pick<InstructionDocument, 'title' | 'body' | 'enabled' | 'sortOrder'>
>

export function updateDocument(
  db: Database,
  documentId: string,
  patch: UpdateDocumentPatch,
): InstructionDocument | null {
  const [updated] = db
    .update(instructionDocuments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(instructionDocuments.id, documentId))
    .returning()
    .all()
  return updated ?? null
}

export function deleteDocument(db: Database, documentId: string): boolean {
  const deleted = db
    .delete(instructionDocuments)
    .where(eq(instructionDocuments.id, documentId))
    .returning({ id: instructionDocuments.id })
    .all()
  return deleted.length > 0
}

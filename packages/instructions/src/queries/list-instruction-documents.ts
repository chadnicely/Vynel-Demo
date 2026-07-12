// `listInstructionDocuments` — the UI list read + the notebook tools' user-doc
// source. NOTEBOOK-MODE ONLY in this slice: the 'always' injected-instructions
// arc is deferred (scope change 2026-07-12), so every read here pins
// mode='notebook' rather than exposing the mode as a filter.

import type { Database } from '@vynel/db'
import {
  listDocumentsForUser,
  type InstructionDocument,
  type InstructionScope,
} from '../repositories/index.js'

export type ListInstructionDocumentsInput = {
  userId: string
  /** Narrow to one scope; omit for all of the user's documents (the UI list). */
  scope?: InstructionScope
  /** Scope the read to a turn's visibility: 'global' (a global-root turn) or a
   *  workspace id (that workspace's turn sees global + its own docs). */
  visibleFrom?: 'global' | { workspaceId: string }
  enabledOnly?: boolean
}

export function listInstructionDocuments(
  db: Database,
  input: ListInstructionDocumentsInput,
): InstructionDocument[] {
  const documents = listDocumentsForUser(db, input.userId, {
    mode: 'notebook',
    ...(input.visibleFrom !== undefined ? { visibleFrom: input.visibleFrom } : {}),
    ...(input.enabledOnly !== undefined ? { enabledOnly: input.enabledOnly } : {}),
  })
  return input.scope !== undefined
    ? documents.filter((document) => document.scope === input.scope)
    : documents
}

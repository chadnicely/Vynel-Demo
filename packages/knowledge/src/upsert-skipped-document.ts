// `upsertSkippedDocument` — internal helper for `indexFile`. Records
// a row with `parseStatus: 'skipped'` and the SkipReason as the
// parseErrorMessage field (intentional dual-use: the column carries
// both real parse errors AND the reason a file was deliberately
// skipped — see the schema header note).
//
// Used for the three pre-parse skip rules:
//   - in-skipped-folder (.vynel/, Archive/)
//   - too-large (>50 MB)
//   - unsupported-format (extension not in the parser registry)
//
// Extracted from index-file.ts to keep that load-bearing orchestrator
// under the 300-line cap per structure-standard.md.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import {
  findKnowledgeDocumentByPath,
  findKnowledgeDocumentById,
  insertKnowledgeDocument,
  updateKnowledgeDocument,
} from '@vynel/db/repositories/knowledge'
import { deriveDocumentKindFromPath } from '@vynel/indexer'
import type { KnowledgeDocumentRow, SkipReason } from './knowledge-types.js'
import type { IndexFileInput } from './index-file.js'

export function upsertSkippedDocument(
  db: Database,
  input: IndexFileInput,
  normalizedRelative: string,
  reason: SkipReason,
  fileStat: { size: number; mtime: Date } | null,
  now: Date,
): KnowledgeDocumentRow {
  const existing = findKnowledgeDocumentByPath(db, input.workspaceId, normalizedRelative)
  const documentId = existing?.id ?? randomUUID()
  const documentKind = deriveDocumentKindFromPath(normalizedRelative)
  withTransaction(db, (tx) => {
    if (existing) {
      updateKnowledgeDocument(tx, documentId, {
        parseStatus: 'skipped',
        parseErrorMessage: reason,
        fileSizeBytes: fileStat?.size ?? existing.fileSizeBytes,
        fileModifiedAt: fileStat?.mtime ?? existing.fileModifiedAt,
      })
    } else {
      insertKnowledgeDocument(tx, {
        id: documentId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        relativePath: normalizedRelative,
        documentKind,
        contentHash: '',
        fileSizeBytes: fileStat?.size ?? 0,
        fileModifiedAt: fileStat?.mtime ?? new Date(0),
        chunkCount: 0,
        parseStatus: 'skipped',
        parseErrorMessage: reason,
        indexedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  })
  const row = findKnowledgeDocumentById(db, documentId)
  if (!row) throw new Error('upsertSkippedDocument: row vanished after upsert')
  return row
}

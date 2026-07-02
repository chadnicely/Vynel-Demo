// `getDocumentDetail` — sync core op. Fetches a single document
// plus its chunks for the detail view. Throws `NotFoundError(
// 'knowledge-document', id)` when the document doesn't exist (per
// `.claude/rules/error-handling.md` — generic taxonomy, no
// `KnowledgeDocumentNotFoundError` wrapper per D14).
//
// Per blueprint §8.4.

import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import {
  findKnowledgeDocumentById,
  listKnowledgeChunksForDocument,
} from '../repositories/index.js'
import type { KnowledgeDocumentRow, KnowledgeChunkRow } from '../schema/index.js'

export type DocumentDetailResult = {
  document: KnowledgeDocumentRow
  chunks: KnowledgeChunkRow[]
}

export function getDocumentDetail(db: Database, documentId: string): DocumentDetailResult {
  const document = findKnowledgeDocumentById(db, documentId)
  if (!document) throw new NotFoundError('knowledge-document', documentId)
  const chunks = listKnowledgeChunksForDocument(db, documentId)
  return { document, chunks }
}

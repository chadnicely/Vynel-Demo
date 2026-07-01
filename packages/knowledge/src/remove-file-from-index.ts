// `removeFileFromIndex` — sync core op. Called by the FileWatcherService
// (Cluster 6) on `unlink` events and by `indexFile` when a file stat
// fails (the file vanished between watcher fire and the read).
//
// Cascade: deletes the `knowledge_documents` row; chunk rows cascade
// via the FK. The sqlite-vec virtual table does NOT honor FK cascades
// (per memory's locked behavior), so we explicitly purge vec rows by
// `documentId` before the document delete.
//
// Co-commits a `knowledge.document-removed` outbox event in the same
// transaction. Phase 1 SYNC discipline per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Idempotent: no-op when the document doesn't exist (the watcher may
// fire `unlink` for files we never indexed — e.g. files in
// `node_modules/` that arrived briefly before chokidar's ignore
// matched). Per blueprint §8.4.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import {
  findKnowledgeDocumentByPath,
  hardDeleteKnowledgeDocument,
  deleteVectorIndexForDocument,
} from '@vynel/db/repositories/knowledge'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  KNOWLEDGE_DOCUMENT_REMOVED,
  type KnowledgeDocumentRemovedPayload,
} from './knowledge-events.js'

export type RemoveFileFromIndexInput = {
  workspaceId: string
  userId: string
  relativePath: string
}

export function removeFileFromIndex(db: Database, input: RemoveFileFromIndexInput): void {
  const document = findKnowledgeDocumentByPath(db, input.workspaceId, input.relativePath)
  if (!document) return

  const now = new Date()
  withTransaction(db, (tx) => {
    // sqlite-vec doesn't honor FK cascades — explicit purge first.
    deleteVectorIndexForDocument(tx, document.id)
    // Document delete cascades to knowledge_chunks via the FK.
    hardDeleteKnowledgeDocument(tx, document.id)
    const payload: KnowledgeDocumentRemovedPayload = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      documentId: document.id,
      relativePath: input.relativePath,
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: KNOWLEDGE_DOCUMENT_REMOVED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })
}

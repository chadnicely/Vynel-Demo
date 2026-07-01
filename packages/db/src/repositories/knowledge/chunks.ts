// Functional repository for the `knowledge_chunks` table. Phase 1
// SYNC. `db` is the first argument.
//
// Function shape per blueprint §1 + coding.md §6.1:
//   insertMany, deleteForDocument, listForDocument (ordered by
//   chunkIndex ASC), listNeedingEmbedding, updateEmbedding.
//
// See `docs/blueprints/knowledge/blueprint.md §1` + `coding.md §6.1`.

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  knowledgeChunks,
  type KnowledgeChunkRow,
  type NewKnowledgeChunkRow,
} from '../../schema/knowledge/chunks.js'

export type { KnowledgeChunkRow, NewKnowledgeChunkRow } from '../../schema/knowledge/chunks.js'

const DEFAULT_NEEDING_EMBEDDING_LIMIT = 100

export function insertKnowledgeChunks(db: Database, rows: NewKnowledgeChunkRow[]): void {
  if (rows.length === 0) return
  db.insert(knowledgeChunks).values(rows).run()
}

export function hardDeleteKnowledgeChunksForDocument(db: Database, documentId: string): void {
  db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId)).run()
}

export function listKnowledgeChunksForDocument(
  db: Database,
  documentId: string,
): KnowledgeChunkRow[] {
  return db
    .select()
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.documentId, documentId))
    .orderBy(asc(knowledgeChunks.chunkIndex))
    .all()
}

export function listKnowledgeChunksNeedingEmbedding(
  db: Database,
  options: { limit?: number } = {},
): KnowledgeChunkRow[] {
  return db
    .select()
    .from(knowledgeChunks)
    .where(isNull(knowledgeChunks.embedding))
    .limit(options.limit ?? DEFAULT_NEEDING_EMBEDDING_LIMIT)
    .all()
}

export function updateKnowledgeChunkEmbedding(
  db: Database,
  chunkId: string,
  embedding: Buffer,
  modelVersion: string,
): void {
  db.update(knowledgeChunks)
    .set({ embedding, embeddingModelVersion: modelVersion })
    .where(eq(knowledgeChunks.id, chunkId))
    .run()
}

export function countUnindexedKnowledgeChunksForWorkspace(
  db: Database,
  workspaceId: string,
): number {
  const rows = db
    .select({ id: knowledgeChunks.id })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.workspaceId, workspaceId), isNull(knowledgeChunks.embedding)))
    .all()
  return rows.length
}

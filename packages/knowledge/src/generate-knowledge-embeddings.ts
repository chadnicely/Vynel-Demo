// `generateKnowledgeEmbeddings` — worker core op. Phase 1: cron-tick
// every minute (per D9 + apps/worker bootstrap). Finds chunks with
// `embedding IS NULL`, runs each chunk's text through
// `@vynel/embeddings.generateEmbedding`, then upserts the `embedding`
// column AND the `knowledge_chunks_vec` virtual table — inside a
// transaction PER chunk (the model call lives OUTSIDE the tx; one
// failed embedding doesn't poison the batch).
//
// First consumer of the real MiniLM-L6-v2 implementation knowledge
// ships (replacing memory's throwing stub). The lazy first-use
// cached singleton in `@vynel/embeddings` means whichever worker tick
// fires first triggers the ~25 MB model load + ~1 s warm-up.
//
// Async at the boundary; the DB work inside `withTransaction` is
// sync per Phase 1 discipline. Same shape as memory's
// `generateMemoryEmbeddings`. Spec: blueprint §13.1 + decisions D9 +
// D18 + D23.

import { withTransaction, type Database } from '@vynel/db'
import {
  listKnowledgeChunksNeedingEmbedding,
  updateKnowledgeChunkEmbedding,
  upsertVectorIndexForChunk,
} from '@vynel/db/repositories/knowledge'
import { EMBEDDING_MODEL_VERSION, generateEmbedding } from '@vynel/embeddings'
import type { StructuralLogger } from './knowledge-types.js'

export type GenerateKnowledgeEmbeddingsResult = {
  attempted: number
  succeeded: number
  failed: number
}

export async function generateKnowledgeEmbeddings(
  db: Database,
  options: { batchSize?: number } = {},
  deps: { logger?: StructuralLogger } = {},
): Promise<GenerateKnowledgeEmbeddingsResult> {
  const batchSize = options.batchSize ?? 50
  const batch = listKnowledgeChunksNeedingEmbedding(db, { limit: batchSize })
  let succeeded = 0
  let failed = 0

  for (const chunk of batch) {
    try {
      // Model call OUTSIDE the tx — provider/CPU work never inside a
      // better-sqlite3 transaction (it rejects promise-returning
      // callbacks at runtime per phase-1-sync-transactions).
      const embedding = await generateEmbedding(chunk.chunkText)
      withTransaction(db, (tx) => {
        updateKnowledgeChunkEmbedding(tx, chunk.id, embedding, EMBEDDING_MODEL_VERSION)
        upsertVectorIndexForChunk(tx, {
          chunkId: chunk.id,
          workspaceId: chunk.workspaceId,
          documentId: chunk.documentId,
          embedding,
        })
      })
      succeeded += 1
    } catch (err) {
      failed += 1
      deps.logger?.warn(
        { err, chunkId: chunk.id, documentId: chunk.documentId, workspaceId: chunk.workspaceId },
        'generateKnowledgeEmbeddings: embedding failed for one chunk; batch continues',
      )
    }
  }

  if (succeeded > 0 || failed > 0) {
    deps.logger?.info(
      { attempted: batch.length, succeeded, failed },
      'generateKnowledgeEmbeddings: batch complete',
    )
  }
  return { attempted: batch.length, succeeded, failed }
}

// `generateMemoryEmbeddings` — worker core op. Phase 1: cron-tick
// every minute (per apps/worker bootstrap). Finds entries with
// `embedding IS NULL`, runs each through `@vynel/embeddings.generate
// Embedding`, then upserts into both `memory_entries.embedding` and
// the `memory_entries_vec` virtual table — inside a transaction
// PER entry (the model call lives OUTSIDE the tx; one failed
// entry doesn't poison the batch).
//
// Async at the boundary because the model call is async. The DB
// work inside `withTransaction` is sync per Phase 1 discipline.

import { withTransaction, type Database } from '@vynel/db'
import { findEntriesNeedingEmbedding, updateEntryEmbedding } from '../repositories/index.js'
import { upsertVectorIndex } from '../repositories/index.js'
import {
  EMBEDDING_MODEL_VERSION,
  EmbeddingModelNotInstalledError,
  generateEmbedding,
} from '@vynel/embeddings'
import type { StructuralLogger } from '../memory-types.js'

export type GenerateMemoryEmbeddingsResult = {
  attempted: number
  succeeded: number
  failed: number
}

export async function generateMemoryEmbeddings(
  db: Database,
  options: { batchSize?: number } = {},
  deps: { logger?: StructuralLogger } = {},
): Promise<GenerateMemoryEmbeddingsResult> {
  const batchSize = options.batchSize ?? 50
  const batch = findEntriesNeedingEmbedding(db, { limit: batchSize })
  let succeeded = 0
  let failed = 0

  for (const entry of batch) {
    try {
      // Model call OUTSIDE the tx — provider/CPU work never inside a
      // better-sqlite3 transaction (it rejects promise-returning
      // callbacks at runtime).
      const embedding = await generateEmbedding(`${entry.title}\n\n${entry.body}`)
      withTransaction(db, (tx) => {
        updateEntryEmbedding(tx, entry.id, embedding, EMBEDDING_MODEL_VERSION)
        // The vec0 index partitions by workspace, so a USER-level (global)
        // memory has no partition to sit in — it stays out until cross-
        // workspace on-demand retrieval is designed. The embedding itself is
        // still stored on the row, so that build has its data waiting.
        if (entry.workspaceId !== null) {
          upsertVectorIndex(tx, entry.id, entry.workspaceId, embedding)
        }
      })
      succeeded += 1
    } catch (err) {
      failed += 1
      // No model on the disk is not an entry's failure and not a retry-next-
      // tick matter — it is the caller's to act on (the engine starts the
      // download), so it propagates as the typed error.
      if (err instanceof EmbeddingModelNotInstalledError) throw err
      // A failure before ANY success is the MODEL (load), not this entry —
      // abort with ONE actionable error instead of a stack trace per entry;
      // the next tick retries fresh (a corrupt model file is evicted —
      // @vynel/embeddings).
      if (succeeded === 0) {
        deps.logger?.error(
          { err, entryId: entry.id },
          'generateMemoryEmbeddings: embedding model unavailable — batch aborted, retrying next tick',
        )
        break
      }
      deps.logger?.warn(
        { err, entryId: entry.id, workspaceId: entry.workspaceId },
        'generateMemoryEmbeddings: embedding failed for one entry; batch continues',
      )
    }
  }

  if (succeeded > 0 || failed > 0) {
    deps.logger?.info(
      { attempted: batch.length, succeeded, failed },
      'generateMemoryEmbeddings: batch complete',
    )
  }
  return { attempted: batch.length, succeeded, failed }
}

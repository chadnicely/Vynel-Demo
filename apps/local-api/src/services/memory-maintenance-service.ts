// The api-side memory maintenance service — the memory twin of the knowledge
// indexing service's embeddings tick. The desktop app runs no `apps/worker`,
// and memory's jobs were never registered there anyway, so without this:
//  - `memory_entries.embedding` stays null forever → semantic/hybrid memory
//    search silently degrades to FTS-only;
//  - soft-deleted entries never hard-purge after their 30-day retention.
// Embeddings tick every minute (idempotent per entry); the purge runs once
// per day — it's a retention sweep, not a hot path.

import { generateMemoryEmbeddings, purgeSoftDeletedMemoryEntries } from '@vynel/memory'
import { EmbeddingModelNotInstalledError } from '@vynel/embeddings'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const EMBEDDING_TICK_INTERVAL_MS = 60_000
const PURGE_TICK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface MemoryMaintenanceServiceOptions {
  db: Database
  logger: Logger
  /** Test seam — production uses the defaults. */
  embeddingIntervalMs?: number
  /** The tick found work but no model on the disk — boot answers by starting
   *  the download, so first use still installs the model (now visibly, in
   *  Settings → Embedding) instead of failing every minute. */
  onEmbeddingModelMissing?: () => void
}

export function startMemoryMaintenanceService(
  options: MemoryMaintenanceServiceOptions,
): { stop: () => void } {
  const { db, logger } = options
  const embeddingIntervalMs = options.embeddingIntervalMs ?? EMBEDDING_TICK_INTERVAL_MS

  let embeddingInFlight = false
  const runEmbeddingTick = (): void => {
    if (embeddingInFlight) return
    embeddingInFlight = true
    generateMemoryEmbeddings(db, {}, { logger })
      .catch((err: unknown) => {
        if (err instanceof EmbeddingModelNotInstalledError) {
          logger.warn('memory embedding tick: the embedding model is not installed yet')
          options.onEmbeddingModelMissing?.()
          return
        }
        logger.error({ err }, 'memory embedding tick failed')
      })
      .finally(() => {
        embeddingInFlight = false
      })
  }

  const runPurgeTick = (): void => {
    try {
      const result = purgeSoftDeletedMemoryEntries(db, { logger })
      if (result.purgedCount > 0) {
        logger.info({ purgedCount: result.purgedCount }, 'memory purge: retention sweep complete')
      }
    } catch (err) {
      logger.error({ err }, 'memory purge tick failed')
    }
  }

  const embeddingTimer = setInterval(runEmbeddingTick, embeddingIntervalMs)
  const purgeTimer = setInterval(runPurgeTick, PURGE_TICK_INTERVAL_MS)
  // First passes right away — a restart shouldn't defer overdue work a day.
  runEmbeddingTick()
  runPurgeTick()

  logger.info({ embeddingIntervalMs }, 'memory maintenance service started')

  return {
    stop: () => {
      clearInterval(embeddingTimer)
      clearInterval(purgeTimer)
    },
  }
}

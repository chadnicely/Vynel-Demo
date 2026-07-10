// The api-side knowledge indexing service — what makes "add a folder and it
// stays indexed" TRUE across restarts in the one-process desktop app:
//
//  1. On boot, re-open a watcher for every registered source (watchers are
//     in-memory, they don't survive a restart) and run a catch-up scan in the
//     background — a file added or edited while the app was closed still lands.
//     Hash-skip keeps unchanged files nearly free.
//  2. Every minute, generate missing chunk embeddings IN-PROCESS. The desktop
//     app runs no `apps/worker`, so without this tick the `embedding` column
//     stays null forever and semantic search silently degrades to FTS-only.
//     (apps/worker keeps its cron twin for a split-process deployment; the op
//     is idempotent per chunk, so an overlap is harmless.)

import {
  generateKnowledgeEmbeddings,
  indexSource,
  listAllKnowledgeSources,
  type FileWatcherService,
} from '@vynel/knowledge'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const EMBEDDING_TICK_INTERVAL_MS = 60_000

export interface KnowledgeIndexingServiceOptions {
  db: Database
  logger: Logger
  fileWatcher: FileWatcherService
  /** Test seam — production uses the 60 s default. */
  embeddingIntervalMs?: number
}

export function startKnowledgeIndexingService(
  options: KnowledgeIndexingServiceOptions,
): { stop: () => void } {
  const { db, logger, fileWatcher } = options
  const embeddingIntervalMs = options.embeddingIntervalMs ?? EMBEDDING_TICK_INTERVAL_MS

  // The embeddings tick. `inFlight` guards the first tick's ~1 s model warm-up
  // (and any slow batch) from overlapping the next interval.
  let inFlight = false
  const runEmbeddingTick = (): void => {
    if (inFlight) return
    inFlight = true
    generateKnowledgeEmbeddings(db, {}, { logger })
      .catch((err) => logger.error({ err }, 'knowledge embedding tick failed'))
      .finally(() => {
        inFlight = false
      })
  }

  const sources = listAllKnowledgeSources(db)
  for (const source of sources) fileWatcher.startWatchingSource(source)
  if (sources.length > 0) {
    logger.info({ sourceCount: sources.length }, 'knowledge indexing: watchers restored')
  }

  // Catch-up scan in the background — boot must not wait on a large vault.
  // Embed right after it finishes so the freshly indexed chunks don't sit
  // unembedded until the next interval. `stopped` lets shutdown cut a long
  // scan between sources instead of indexing against a closing DB.
  let stopped = false
  void (async () => {
    for (const source of sources) {
      if (stopped) return
      try {
        const result = await indexSource(db, source, { logger })
        if (result.indexedCount > 0 || result.failedCount > 0) {
          logger.info(
            { sourceId: source.id, ...result },
            'knowledge indexing: catch-up scan finished for source',
          )
        }
      } catch (err) {
        logger.warn({ err, sourceId: source.id }, 'knowledge indexing: catch-up scan failed')
      }
    }
    if (!stopped) runEmbeddingTick()
  })()

  const embeddingTimer = setInterval(runEmbeddingTick, embeddingIntervalMs)

  logger.info(
    { embeddingIntervalMs },
    'knowledge indexing service started',
  )

  return {
    stop: () => {
      stopped = true
      clearInterval(embeddingTimer)
    },
  }
}

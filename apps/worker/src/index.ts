// Entry point for `apps/worker` — a separate Node process from `apps/local-api`
// that runs scheduled background jobs. In the knowledge slice it runs one
// job (embedding generation); each feature adds its own `WorkerJob` entry
// to the list below as it lands (the scheduler + factory stay generic).
//
// Boot sequence:
//   1. `createWorkerContext()` — parses env, opens the SQLite db, wires pino.
//   2. `startScheduler(ctx, jobs)` — registers each cron job via node-cron.
//   3. SIGINT / SIGTERM → stop the scheduler + closeDatabase + exit.
//
// MIGRATION ORDERING — Phase 1 single-user: the api process owns migrations
// at its own boot; the worker assumes they've run and does NOT call
// `runMigrations`. Both processes must open the SAME db file (see `env.ts`).

import { closeDatabase } from '@vynel/db'
import { createWorkerContext } from './factory.js'
import { startScheduler, type WorkerJob } from './scheduler.js'
import { generateKnowledgeEmbeddings } from './jobs/knowledge/generate-knowledge-embeddings.js'

function start(): void {
  const ctx = createWorkerContext()

  const jobs: WorkerJob[] = [
    {
      name: 'generate-knowledge-embeddings',
      // Every minute (knowledge D9: cron-only; signal-on-write deferred).
      // First consumer of the real @vynel/embeddings MiniLM-L6-v2 impl (D23) —
      // the lazy-loaded model singleton warms on the first tick with pending chunks.
      cron: '*/1 * * * *',
      run: () => generateKnowledgeEmbeddings(ctx.db, ctx.logger),
    },
  ]

  const stopScheduler = startScheduler(ctx, jobs)
  ctx.logger.info({ jobCount: jobs.length }, 'worker started')

  const shutdown = (signal: NodeJS.Signals): void => {
    ctx.logger.info({ signal }, 'worker shutdown initiated')
    stopScheduler()
    closeDatabase(ctx.db)
    ctx.logger.info({}, 'worker shutdown complete')
    // eslint-disable-next-line n/no-process-exit -- explicit exit at the end of a graceful shutdown
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start()

// Dependency-injection factory for `apps/worker`. Returns the
// `WorkerContext` that `scheduler.ts` job callbacks receive.
//
// First app to wire pino at the boundary per MEMORY's structural-logger
// precedent (2026-05-21) — pino's `Logger` structurally satisfies the
// `{ info, warn }` shape core ops expect, so `ctx.logger` is passed
// straight through to `purgeDeletedChatSessions` (core) without a cast.

import pino, { type Logger } from 'pino'
import { createDatabase, type Database } from '@vynel/db'
import { loadEnv } from './env.js'

export interface WorkerContext {
  readonly db: Database
  readonly logger: Logger
}

export function createWorkerContext(): WorkerContext {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })
  const db = createDatabase({
    dialect: env.DB_DIALECT,
    ...(env.DB_PATH !== undefined ? { path: env.DB_PATH } : {}),
    ...(env.DB_URL !== undefined ? { url: env.DB_URL } : {}),
  })
  return { db, logger }
}

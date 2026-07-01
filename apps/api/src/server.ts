// Boots the HTTP listener. Phase 1 entry point.
//
// Boot: loadEnv → createDatabase → runMigrations → getOrCreateLocalUser →
// createApp → serve on 127.0.0.1:PORT. SIGINT/SIGTERM → close + exit.
//
// (Knowledge-slice pull: the provider / desktop-notification / channels /
// schedules / delegation boot services return as their features land.)

import { serve } from '@hono/node-server'
import pino from 'pino'
import { createDatabase, closeDatabase, runMigrations, sqliteMigrationsFolder } from '@vynel/db'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { loadEnv } from './env.js'
import { createApp } from './app.js'

export async function boot(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  logger.info({ dialect: env.DB_DIALECT }, 'api boot: opening database')
  const db = createDatabase({
    dialect: env.DB_DIALECT,
    ...(env.DB_PATH !== undefined ? { path: env.DB_PATH } : {}),
    ...(env.DB_URL !== undefined ? { url: env.DB_URL } : {}),
  })

  logger.info({ migrationsFolder: sqliteMigrationsFolder }, 'api boot: running migrations')
  runMigrations(db, { migrationsFolder: sqliteMigrationsFolder })

  const user = getOrCreateLocalUser(db, { logger })
  logger.info({ userId: user.id, displayName: user.displayName }, 'api boot: local user ready')

  const app = createApp({ db, logger })

  // Bind to loopback only in Phase 1 — the local API is unauthenticated.
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'api listening')
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'api shutdown initiated')
    server.close(() => {
      closeDatabase(db)
      logger.info({}, 'api shutdown complete')
      // eslint-disable-next-line n/no-process-exit -- explicit exit at the end of a graceful shutdown
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

boot().catch((err) => {
  // Pino may not be wired before crash — use console.error so the dev sees it.
  // eslint-disable-next-line no-console -- pre-pino bootstrap failure
  console.error('api boot failed:', err)
  // eslint-disable-next-line n/no-process-exit -- boot-failure exit
  process.exit(1)
})

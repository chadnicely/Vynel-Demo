// Boots the HTTP listener. Phase 1 entry point.
//
// Boot: loadEnv → createDatabase → runMigrations → getOrCreateLocalUser →
// createApp → serve on 127.0.0.1:PORT. SIGINT/SIGTERM → close + exit.
//
// (Knowledge-slice pull: the provider / desktop-notification / channels /
// schedules / delegation boot services return as their features land.)

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import pino from 'pino'
import { createDatabase, closeDatabase, runMigrations, sqliteMigrationsFolder } from '@vynel/db'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { configureEmbeddingsCacheDir } from '@vynel/embeddings'
import { expireAskRequests } from '@vynel/asks'
import { AppProcessSupervisor, publishAppExitOutcome } from '@vynel/apps'
import { FileWatcherService } from '@vynel/knowledge'
import { hostname } from 'node:os'
import {
  createEntitlementVerifier,
  createHubClient,
  createHubSession,
  createKeyringEntitlementVault,
  createKeyringRefreshTokenVault,
  type HubSession,
} from '@vynel/hub-account'
import { loadEnv } from './env.js'
import { createApp } from './app.js'
import { createGatewayApp } from './gateway.js'
import { startHubSessionService, type HubSessionService } from './services/hub-session-service.js'
import { startCatalogSyncService, type CatalogSyncService } from './services/catalog-sync-service.js'
import { startSchedulesService } from './services/schedules-service.js'
import { startKnowledgeIndexingService } from './services/knowledge-indexing-service.js'
import { startMemoryMaintenanceService } from './services/memory-maintenance-service.js'
import { startChannelsService } from './services/channels-service.js'
import { startOutboxRelayService } from './services/outbox-relay-service.js'
import { startDelegationService } from './services/delegation-service.js'
import { startApprovalsRecoveryService } from './services/approvals-recovery-service.js'
import { TurnEventBroadcaster } from '@vynel/session/delegation'
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'

export async function boot(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  // Before any embedding tick can lazily load the model — the cache must live
  // outside node_modules (see @vynel/embeddings).
  if (env.VYNEL_EMBEDDINGS_CACHE_DIR !== undefined) {
    configureEmbeddingsCacheDir(env.VYNEL_EMBEDDINGS_CACHE_DIR)
  }

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

  // Boot-owned so shutdown can close every chokidar watcher. The knowledge
  // indexing service (below) restores watchers for already-registered sources.
  const fileWatcher = new FileWatcherService(db, logger)

  // Boot-owned so shutdown can stopAll() — quitting Vynel never orphans a dev
  // server. A SELF-exit publishes its runtime fact through the leaf op.
  const appSupervisor = new AppProcessSupervisor({
    logger,
    onExit: (appId, outcome) => publishAppExitOutcome(db, { appId, ...outcome }),
  })

  // ONE turn-event pub/sub per process — the delegation service publishes a routed
  // turn's live events; the SSE observe route streams them to the Watch panel.
  const turnEvents = new TurnEventBroadcaster()

  // The hub link (accounts) — only when a hub is configured; the refresh
  // token lives in the OS credential store, never a file.
  let hubSession: HubSession | undefined
  let hubSessionService: HubSessionService | undefined
  let catalogSyncService: CatalogSyncService | undefined
  if (env.VYNEL_HUB_URL !== undefined && env.VYNEL_HUB_PUBLIC_KEY !== undefined) {
    hubSession = createHubSession({
      client: createHubClient({ baseUrl: env.VYNEL_HUB_URL }),
      vault: createKeyringRefreshTokenVault(),
      entitlementVault: createKeyringEntitlementVault(),
      entitlements: await createEntitlementVerifier({
        publicKeyPem: env.VYNEL_HUB_PUBLIC_KEY,
      }),
      // appVersion is a dev placeholder until the D2 installer stamps real
      // release versions.
      device: { deviceName: hostname(), devicePlatform: process.platform, appVersion: '0.0.0' },
      logger,
    })
    hubSessionService = startHubSessionService({ hubSession, logger })
    catalogSyncService = startCatalogSyncService({ hubSession, db, logger })
    logger.info({ hubUrl: env.VYNEL_HUB_URL }, 'api boot: hub link enabled')
  }

  const app = createApp({
    db,
    logger,
    fileWatcher,
    turnEvents,
    appSupervisor,
    enableFirstLaunchGate: env.VYNEL_FIRST_LAUNCH_GATE_ENABLED,
    ...(hubSession !== undefined ? { hubSession } : {}),
  })

  // The in-process Hono dispatcher for headless turns (the schedule fire path's
  // MCP server re-enters the api through this). Bound AFTER createApp, like the
  // route-side `c.var.appRequest`.
  const appRequest = app.request.bind(app)
  // The per-minute schedule poll — claims due schedules + fires each via a
  // headless workspace turn. MCP-intrinsic, so it lives in the api process (not
  // the worker). Stopped on shutdown, like the file watcher.
  const schedulesService = await startSchedulesService({ db, logger, appRequest })
  // Watcher restore + catch-up scan for every registered knowledge source, plus
  // the in-process embeddings tick (the desktop app runs no apps/worker).
  const knowledgeIndexingService = startKnowledgeIndexingService({ db, logger, fileWatcher })
  // Memory's embeddings + retention purge — same in-process reasoning.
  const memoryMaintenanceService = startMemoryMaintenanceService({ db, logger })
  // The channel poll(5s) / process(1s) / deliver(2s) loops — fetch inbound messages
  // from each enabled channel's adapter and persist them; run a global-root turn per
  // pending inbound message and queue the answer; send queued outbound messages.
  // Sub-minute cadence + MCP-intrinsic processing, so it lives in the api process
  // (not the worker); `appRequest` re-enters the api from each processing turn.
  const channelsService = startChannelsService({ db, logger, appRequest })
  // The delegation claim-and-run tick — claims one pending routing job per tick,
  // runs it as a workspace turn, records the terminal state; at startup it fails
  // the jobs a crash left stuck `claimed`. Same api-process reasoning as above.
  const provider = resolveAiAgentProvider(DEFAULT_PROVIDER_ID)
  const delegationService = startDelegationService({ db, logger, provider, turnEvents })
  // The stale-approval reaper (surface-up's unanswered bound) — denies the provider
  // approval so a parked turn resumes, then marks the row timed-out.
  const approvalsRecoveryService = startApprovalsRecoveryService({ db, logger, provider })
  // Boot recovery for asks: the ask_user waiter registry died with the previous
  // process, so every still-pending ask row is unanswerable — expire them once
  // at boot so the UI never shows a zombie wizard (docs/module-notes/ask.md).
  expireAskRequests(db, {}, { logger })
  // The outbox relay — dispatches published cross-domain events to their
  // registered consumers (schedules→channel delivery, the ask nudge).
  const outboxRelayService = startOutboxRelayService({ db, logger })

  // The gateway fronts the api: /api mount, /voice daemon proxy, and — when a
  // built local-web dist exists — the whole desktop UI (sidecar mode, the Tauri
  // shell loads its windows from this port). Checked once at boot: build the
  // web ui, then restart the daemon, to switch modes.
  const webUiDistDir =
    env.VYNEL_WEB_UI_DIST !== undefined && existsSync(join(env.VYNEL_WEB_UI_DIST, 'index.html'))
      ? env.VYNEL_WEB_UI_DIST
      : undefined
  if (webUiDistDir !== undefined) {
    logger.info({ webUiDistDir }, 'api boot: serving the built web ui (sidecar mode)')
  } else {
    logger.info(
      { checked: env.VYNEL_WEB_UI_DIST },
      'api boot: no built web ui found — api only (the vite dev server fronts the ui)',
    )
  }
  const gateway = createGatewayApp({
    apiApp: app,
    ...(webUiDistDir !== undefined ? { webUiDistDir } : {}),
    voiceDaemonUrl: env.VYNEL_VOICE_DAEMON_URL,
    logger,
  })

  // Bind to loopback only in Phase 1 — the local API is unauthenticated.
  const server = serve({ fetch: gateway.fetch, hostname: '127.0.0.1', port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'api listening')
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'api shutdown initiated')
    server.close(() => {
      schedulesService.stop()
      knowledgeIndexingService.stop()
      memoryMaintenanceService.stop()
      channelsService.stop()
      delegationService.stop()
      approvalsRecoveryService.stop()
      outboxRelayService.stop()
      // Quitting Vynel never orphans a dev server (docs/module-notes/apps.md).
      void appSupervisor.stopAll()
      hubSessionService?.stop()
      catalogSyncService?.stop()
      void fileWatcher.stopAll()
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

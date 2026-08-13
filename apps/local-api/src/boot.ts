// Boots the HTTP listener — the body behind the `server.ts` entry.
//
// Boot: loadEnv → createDatabase → runMigrations → getOrCreateLocalUser →
// createApp → serve on 127.0.0.1:PORT. SIGINT/SIGTERM → close + exit.
//
// (Knowledge-slice pull: the provider boot service returns as its feature
// lands.)

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import pino from 'pino'
import {
  createDatabase,
  closeDatabase,
  runMigrations,
  backupBeforePendingMigrations,
  sqliteMigrationsFolder,
} from '@vynel/db'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { configureEmbeddingsCacheDir } from '@vynel/embeddings'
import { expireAskRequests } from '@vynel/asks'
import { recoverStalePendingApprovals } from '@vynel/approvals'
import { reapAllStartedChatToolCalls } from '@vynel/chat'
import { AppProcessSupervisor, publishAppExitOutcome } from '@vynel/apps'
import { FileWatcherService } from '@vynel/knowledge'
import { createFileMasterKeyVault, resolveMasterKey } from '@vynel/sealing'
import { hostname } from 'node:os'
import {
  createEntitlementVerifier,
  createHubClient,
  createHubSession,
  createKeyringEntitlementVault,
  createKeyringRefreshTokenVault,
  type HubSession,
} from '@vynel/hub-account'
import {
  defaultUserDataDir,
  enginePortFilePath,
  removePortFileIfOwn,
  writePortFile,
} from '@vynel/contracts/network/port-file'
import { loadEnv } from './env.js'
import { createApp } from './app.js'
import { resolveServerPayloadArchive } from './server-payload-archive.js'
import { createGatewayApp } from './gateway.js'
import { startHubSessionService, type HubSessionService } from './services/hub-session-service.js'
import { startCatalogSyncService, type CatalogSyncService } from './services/catalog-sync-service.js'
import { startSchedulesService } from './services/schedules-service.js'
import { startKnowledgeIndexingService } from './services/knowledge-indexing-service.js'
import { startMemoryMaintenanceService } from './services/memory-maintenance-service.js'
import { startChannelsService } from './services/channels-service.js'
import { startOutboxRelayService } from './services/outbox-relay-service.js'
import { startDelegationService } from './services/delegation-service.js'
import { buildDelegatedTurnMcpComposer } from './sessions/build-workspace-background-mcp.js'
import { buildEnabledFeatureKeysReader } from './sessions/enabled-feature-keys.js'
import { buildGlobalRootReportTurnRunner } from './sessions/run-global-root-turn.js'
import { startApprovalsRecoveryService } from './services/approvals-recovery-service.js'
import { startMonitorsService } from './services/monitors-service.js'
import {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import {
  SessionActivityFeed,
  buildSessionTurnRecorder,
  reapOrphanedSessionTurns,
} from '@vynel/session/runtime'
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import {
  createDesktopNotificationListener,
  resolveDesktopOs,
  type DesktopNotificationListener,
} from '@vynel/desktop-control'

export async function boot(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })
  // The shell stamps VYNEL_APP_VERSION when it spawns the bundled daemon; dev
  // runs stay on the 0.0.0 placeholder. One home for the sentinel — the hub
  // device stamp and the gateway's /health both read this.
  const appVersion = env.VYNEL_APP_VERSION ?? '0.0.0'

  // The instructions content root was already pointed at the shipped assets by
  // the server.ts entry (it must precede every feature-module import) — here we
  // only surface the fact in the boot log.
  if (env.VYNEL_ASSETS_DIR !== undefined) {
    logger.info({ assetsDir: env.VYNEL_ASSETS_DIR }, 'api boot: bundled assets dir active')
  }

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

  const migrationsFolder =
    env.VYNEL_ASSETS_DIR !== undefined
      ? join(env.VYNEL_ASSETS_DIR, 'migrations-sqlite')
      : sqliteMigrationsFolder
  // First boot after an app update: snapshot the DB before its migrations run
  // (the one non-rollbackable update step). No-op on fresh installs and
  // ordinary boots; a file path is the sqlite marker (the backup is
  // sqlite-only by nature — VACUUM INTO through the live connection).
  if (env.DB_PATH !== undefined) {
    const backupPath = backupBeforePendingMigrations(db, {
      migrationsFolder,
      databasePath: env.DB_PATH,
    })
    if (backupPath !== null) {
      logger.info({ backupPath }, 'api boot: database backed up before pending migrations')
    }
  }
  logger.info({ migrationsFolder }, 'api boot: running migrations')
  runMigrations(db, { migrationsFolder })

  const user = getOrCreateLocalUser(db, { logger })
  logger.info({ userId: user.id, displayName: user.displayName }, 'api boot: local user ready')

  // Boot-owned so shutdown can close every chokidar watcher. The knowledge
  // indexing service (below) restores watchers for already-registered sources.
  const fileWatcher = new FileWatcherService(db, logger)

  // The ssh sealing master key, minted on first boot — the SQLite file alone
  // is useless ciphertext without it. Desktop = the OS keyring; headless
  // servers (VYNEL_MASTER_KEY_FILE set) = an owner-only key file, because no
  // Secret Service exists there and USING the keyring throws. The dynamic
  // import keeps dev/tsx lazy only — esbuild hoists it static in the bundled
  // payload, which is safe because merely LOADING the addon works headless
  // (the glibc pin ships a loadable .node); do not prune the keyring dep
  // from linux payloads.
  const masterKeyVault =
    env.VYNEL_MASTER_KEY_FILE !== undefined
      ? createFileMasterKeyVault(env.VYNEL_MASTER_KEY_FILE)
      : (await import('@vynel/sealing/keyring')).createKeyringMasterKeyVault()
  const sshMasterKey = resolveMasterKey(masterKeyVault)

  // Boot-owned so shutdown can stopAll() — quitting Vynel never orphans a dev
  // server. A SELF-exit publishes its runtime fact through the leaf op.
  const appSupervisor = new AppProcessSupervisor({
    logger,
    onExit: (appId, outcome) => publishAppExitOutcome(db, { appId, ...outcome }),
  })

  // ONE turn-event pub/sub per process — the delegation service publishes a routed
  // turn's live events; the SSE observe route streams them to the Watch panel.
  const turnEvents = new TurnEventBroadcaster()
  // ONE turn-liveness registry per process — every turn producer (web/voice
  // streams, channel turns, schedule fires) announces here; /activity/stream
  // subscribes. Shared with the channels service below. The recorder mirrors
  // every turn into the durable `session_turns` envelope (persona-sessions),
  // so a refresh/restart rebuilds the live picture.
  const activityFeed = new SessionActivityFeed({
    turnRecorder: buildSessionTurnRecorder(db, logger),
  })
  // ONE delegation stop bridge per process — the delegation tick registers each
  // claimed run; the /root delegation-stop route cancels through it.
  const delegationCancels = new DelegationCancelRegistry()
  // ONE per-target single-writer lock registry per process — the delegation
  // pool holds each claimed run's target key in it, and the session-turn route
  // FIFO-queues user turns on the same keys (sessions-surface Slice ③a: a user
  // turn and a delegated run never write one spawned session concurrently).
  const sessionTargetLocks = new SessionTargetLocks()

  // The desktop-notification listener — Windows only (the guard here, not just
  // inside start(), so off-Windows the reader stays undefined and the whole
  // desktop MCP feature — tools + prompt — stays off every turn). Resilient by
  // design: a spawn failure logs and leaves it idle, never crashes boot.
  let desktopNotifications: DesktopNotificationListener | undefined
  if (resolveDesktopOs() === 'windows') {
    desktopNotifications = createDesktopNotificationListener({ logger })
    await desktopNotifications.start()
    logger.info(
      { actionsEnabled: env.VYNEL_DESKTOP_ACT_ENABLED },
      'api boot: desktop-control enabled (windows)',
    )
  }

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
      device: {
        deviceName: hostname(),
        devicePlatform: process.platform,
        appVersion,
      },
      ...(env.VYNEL_HUB_ARTIFACT_KEY !== undefined
        ? { artifactSigningPublicKeyPem: env.VYNEL_HUB_ARTIFACT_KEY }
        : {}),
      logger,
    })
    hubSessionService = startHubSessionService({ hubSession, logger })
    catalogSyncService = startCatalogSyncService({ hubSession, db, logger })
    logger.info({ hubUrl: env.VYNEL_HUB_URL }, 'api boot: hub link enabled')
  }

  const serverPayloadArchive = resolveServerPayloadArchive(env.VYNEL_SERVER_PAYLOAD_ARCHIVE, logger)

  const app = createApp({
    db,
    logger,
    fileWatcher,
    turnEvents,
    activityFeed,
    delegationCancels,
    sessionTargetLocks,
    appSupervisor,
    enableFirstLaunchGate: env.VYNEL_FIRST_LAUNCH_GATE_ENABLED,
    sshMasterKeyBase64: sshMasterKey,
    desktopActionsEnabled: env.VYNEL_DESKTOP_ACT_ENABLED,
    remoteEngine: env.VYNEL_REMOTE_ENGINE,
    appVersion,
    ...(serverPayloadArchive !== null ? { serverPayloadArchive } : {}),
    ...(desktopNotifications !== undefined ? { desktopNotifications } : {}),
    ...(hubSession !== undefined ? { hubSession } : {}),
  })

  // The in-process Hono dispatcher for headless turns (the schedule fire path's
  // MCP server re-enters the api through this). Bound AFTER createApp, like the
  // route-side `c.var.appRequest`.
  const appRequest = app.request.bind(app)
  // Boot recovery for TOOL-CALL rows BEFORE any service can start a turn (a
  // timer-fired turn beginning mid-reap would be closed while live): the turn
  // generators died with the previous process, so a row still 'started' can
  // never receive its completion event — reap to 'cancelled' so no tool/Agent
  // card renders "running" forever after a crash or app exit. Best-effort:
  // recovery must never take down boot.
  try {
    const reapedToolCallCount = reapAllStartedChatToolCalls(db, new Date())
    if (reapedToolCallCount > 0) {
      logger.info({ reapedToolCallCount }, 'boot tool-call reap settled orphaned started rows')
    }
  } catch (err) {
    logger.error({ err }, 'boot tool-call reap failed')
  }
  // Boot recovery for the durable turn envelope (persona-sessions), same
  // reasoning + same ordering: the previous process died with these turns
  // running — close them 'orphaned' so the rebuild read never reports a ghost.
  try {
    const reapedTurnCount = reapOrphanedSessionTurns(db, new Date())
    if (reapedTurnCount > 0) {
      logger.info({ reapedTurnCount }, 'boot session-turn reap closed orphaned running rows')
    }
  } catch (err) {
    logger.error({ err }, 'boot session-turn reap failed')
  }

  // The per-minute schedule poll — claims due schedules + fires each via a
  // headless workspace turn. MCP-intrinsic, so it lives in the api process (not
  // the worker). Stopped on shutdown, like the file watcher.
  // Boot services read the entitlement PER COMPOSITION through this reader —
  // tier filtering follows a mid-process sign-in/upgrade without a restart.
  const readEnabledFeatureKeys = buildEnabledFeatureKeysReader(hubSession)
  const schedulesService = await startSchedulesService({
    db,
    logger,
    appRequest,
    activityFeed,
    turnEvents,
    readEnabledFeatureKeys,
  })
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
  const channelsService = startChannelsService({
    db,
    logger,
    appRequest,
    activityFeed,
    turnEvents,
    desktopReader: desktopNotifications,
    enableDesktopActions: env.VYNEL_DESKTOP_ACT_ENABLED,
    readEnabledFeatureKeys,
  })
  // The delegation claim-and-run tick — claims one pending routing job per tick,
  // runs it as a workspace turn, records the terminal state; at startup it fails
  // the jobs a crash left stuck `claimed`. Same api-process reasoning as above.
  // Routed turns attach per target: a workspace-root turn carries the SAME
  // interactive set the chat has (session-routing trio included — no per-origin
  // toolset flip-flop on the primary); a spawned-session target keeps the plain
  // background set. A bare turn would strip the resumed session's deferred
  // tools ("server disconnected").
  const provider = resolveAiAgentProvider(DEFAULT_PROVIDER_ID)
  // Desktop rides the delegated composer too, for the targets named in
  // `DESKTOP_CAPABLE_DELEGATED_TARGETS` — a task handed to a spawned session is
  // the only way desktop work runs WHILE the user does something else, since a
  // global-root turn holds the per-user root lock for its whole duration.
  const composeWorkspaceMcpServers = await buildDelegatedTurnMcpComposer(
    appRequest,
    {
      desktopReader: desktopNotifications,
      enableDesktopActions: env.VYNEL_DESKTOP_ACT_ENABLED,
    },
    readEnabledFeatureKeys,
  )
  // The GLOBAL-root notify runner (session-comms): a completed delegation's
  // report runs a REAL turn on the root — the assistant absorbs the result in
  // its own flow instead of receiving a detached pushed row.
  const runGlobalRootReportTurn = buildGlobalRootReportTurnRunner({
    db,
    logger,
    appRequest,
    activityFeed,
    turnEvents,
    readEnabledFeatureKeys,
  })
  const delegationService = startDelegationService({
    db,
    logger,
    provider,
    activityFeed,
    turnEvents,
    cancelRegistry: delegationCancels,
    composeWorkspaceMcpServers,
    runGlobalRootReportTurn,
    targetLocks: sessionTargetLocks,
  })
  // The stale-approval reaper (surface-up's unanswered bound) — denies the provider
  // approval so a parked turn resumes, then marks the row timed-out.
  const approvalsRecoveryService = startApprovalsRecoveryService({ db, logger, provider })
  const monitorsService = startMonitorsService({ db, logger })
  // Boot recovery for asks: the ask_user waiter registry died with the previous
  // process, so every still-pending ask row is unanswerable — expire them once
  // at boot so the UI never shows a zombie wizard (docs/module-notes/ask.md).
  expireAskRequests(db, {}, { logger })
  // Boot recovery for APPROVALS, same reasoning: the pending-approval waiter
  // registry died with the previous process, so every pending row is an orphan
  // — reap them all now (no unblockProvider: there is nothing parked to
  // unblock). Without this, a restart mid-turn leaves ghost cards for up to
  // timeoutMs × 2 (the running reaper's live-turn safety window).
  recoverStalePendingApprovals(db, { logger, reapAllPending: true }).catch((err) =>
    logger.error({ err }, 'boot approval reap failed'),
  )
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
  if (env.VYNEL_AUTH_TOKEN !== undefined) {
    logger.info('api boot: bearer gate active (remote engine mode) — /health stays open')
  }
  const gateway = createGatewayApp({
    apiApp: app,
    ...(webUiDistDir !== undefined ? { webUiDistDir } : {}),
    voiceDaemonUrl: env.VYNEL_VOICE_DAEMON_URL,
    appVersion,
    ...(env.VYNEL_AUTH_TOKEN !== undefined ? { authToken: env.VYNEL_AUTH_TOKEN } : {}),
    logger,
  })

  // Loopback only, always — local mode by design (Phase 1), and in remote
  // mode the SSH tunnel is the sole door (the bearer gate covers other local
  // users on the server). Never widen this bind.
  const portFilePath = enginePortFilePath(
    env.VYNEL_PORT_BASE,
    env.VYNEL_USER_DATA_DIR ?? defaultUserDataDir(),
  )
  const server = serve({ fetch: gateway.fetch, hostname: '127.0.0.1', port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'api listening')
    // Advertise where we ACTUALLY bound — clients (cli/mcp/voice/shell)
    // resolve through this when no explicit URL is set, which is what makes
    // per-boot port allocation safe. Best-effort: discovery degrades to the
    // band default, the daemon itself is fine.
    try {
      writePortFile(portFilePath, { port: info.port, pid: process.pid })
    } catch (error) {
      logger.warn(
        { portFilePath, error: error instanceof Error ? error.message : String(error) },
        'could not write the engine port file — clients fall back to the band default port',
      )
    }
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'api shutdown initiated')
    removePortFileIfOwn(portFilePath)
    server.close(() => {
      schedulesService.stop()
      knowledgeIndexingService.stop()
      memoryMaintenanceService.stop()
      channelsService.stop()
      delegationService.stop()
      approvalsRecoveryService.stop()
      monitorsService.stop()
      outboxRelayService.stop()
      // Quitting Vynel never orphans a dev server (docs/module-notes/apps.md).
      void appSupervisor.stopAll()
      hubSessionService?.stop()
      catalogSyncService?.stop()
      desktopNotifications?.stop()
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


// Boots the HTTP listener — the body behind the `server.ts` entry.
//
// Boot: loadEnv → createDatabase → runMigrations → getOrCreateLocalUser →
// createApp → serve on 127.0.0.1:PORT. SIGINT/SIGTERM → close + exit.
//
// (Knowledge-slice pull: the provider boot service returns as its feature
// lands.)

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve, type WebSocketServerLike } from '@hono/node-server'
import { WebSocketServer } from 'ws'
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
import { expireAskRequests, PendingAskRegistry } from '@vynel/asks'
import { recoverStalePendingApprovals } from '@vynel/approvals'
import { reapAllStartedChatToolCalls } from '@vynel/chat'
import { AppProcessSupervisor, publishAppExitOutcome } from '@vynel/apps'
import {
  BackgroundProcessRunner,
  settleBackgroundProcess,
  sweepOrphanedBackgroundProcesses,
} from '@vynel/processes'
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
import {
  buildLiveChannelAuthorizer,
  createLiveChannelUpgradeHandler,
} from './live/live-channel-route.js'
import { createVoiceDaemonRelay } from './live/voice-daemon-relay.js'
import { createHubDisplayLiveSink } from './live/display-live-sink.js'
import { startHubSessionService, type HubSessionService } from './services/hub-session-service.js'
import { startCatalogSyncService, type CatalogSyncService } from './services/catalog-sync-service.js'
import { ScheduleFirePool } from '@vynel/schedules'
import { startSchedulesService } from './services/schedules-service.js'
import { startKnowledgeIndexingService } from './services/knowledge-indexing-service.js'
import { startMemoryMaintenanceService } from './services/memory-maintenance-service.js'
import { startChannelsService } from './services/channels-service.js'
import { startOutboxRelayService } from './services/outbox-relay-service.js'
import { startDelegationService } from './services/delegation-service.js'
import { primeBakedToolPolicyDefaults } from './sessions/baked-tool-policy-defaults.js'
import { buildDelegatedTurnMcpComposer } from './sessions/build-workspace-background-mcp.js'
import { buildEnabledFeatureKeysReader } from './sessions/enabled-feature-keys.js'
import { buildGlobalRootReportTurnRunner } from './sessions/run-global-root-turn.js'
import { startApprovalsRecoveryService } from './services/approvals-recovery-service.js'
import { startAsksRecoveryService } from './services/asks-recovery-service.js'
import { startMonitorsService } from './services/monitors-service.js'
import {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import {
  LiveChannelHub,
  SessionActivityFeed,
  buildSessionTurnRecorder,
  reapOrphanedSessionTurns,
} from '@vynel/session/runtime'
import { surfaceCheckpointSurvivors } from '@vynel/session/continuity'
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { refreshDiscoveredModels } from './sessions/refresh-discovered-models.js'
import { ensureGlobalRootWorkspaceDir } from './sessions/global-root-workspace.js'
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
    // The baked operator tool-policy map rides the same assets dir — primed
    // once here, read by every resolveSessionToolPolicies call thereafter.
    primeBakedToolPolicyDefaults({ assetsDir: env.VYNEL_ASSETS_DIR, logger })
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

  // The background-process runner (the supervisor's one-shot sibling). Sweep
  // FIRST: at startup nothing is running, so every `running` row is a restart
  // orphan — settle it and let its failure event fire, so a session whose
  // monitor waits on `pnpm test` learns instead of waiting forever.
  sweepOrphanedBackgroundProcesses(db, { logger })
  const processRunner = new BackgroundProcessRunner({
    logger,
    onExit: (processId, outcome) =>
      void settleBackgroundProcess(
        db,
        {
          processId,
          exitCode: outcome.exitCode,
          ...(outcome.failureReason !== undefined
            ? { failureReason: outcome.failureReason }
            : {}),
          outputTail: outcome.outputTail,
        },
        { logger },
      ),
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

  const askWaiters = new PendingAskRegistry()
  // ONE schedule fire pool per process, owned here like `sessionTargetLocks`:
  // the poll tick AND the user-facing `fire-now` routes admit through it, so
  // "Run now" is bounded by the same knob and a schedule the tick already
  // claimed is declined instead of fired a second time (background-turns BT3).
  const scheduleFirePool = new ScheduleFirePool(env.VYNEL_MAX_CONCURRENT_DELEGATIONS)
  // ONE voice-daemon link per surface, fanned to the windows over their live
  // socket (the browsers used to hold one EventSource each).
  const voiceDaemonRelay = createVoiceDaemonRelay({
    voiceDaemonUrl: env.VYNEL_VOICE_DAEMON_URL,
    logger,
  })
  // ONE live-channel hub per process — every window's single WebSocket lands
  // here and subscribes to the feed / display / session / trace / voice
  // channels it displays. Built BEFORE the app because the Display routes push
  // through it: `createApp` takes the sink, so the hub has to exist first (the
  // socket door below only needs it later).
  const liveChannelHub = new LiveChannelHub({
    turnEvents,
    activityFeed,
    voice: voiceDaemonRelay,
    authorizeChannel: buildLiveChannelAuthorizer(db),
    logger,
  })
  const app = createApp({
    db,
    logger,
    fileWatcher,
    turnEvents,
    activityFeed,
    delegationCancels,
    sessionTargetLocks,
    scheduleFirePool,
    appSupervisor,
    processRunner,
    enableFirstLaunchGate: env.VYNEL_FIRST_LAUNCH_GATE_ENABLED,
    sshMasterKeyBase64: sshMasterKey,
    desktopActionsEnabled: env.VYNEL_DESKTOP_ACT_ENABLED,
    remoteEngine: env.VYNEL_REMOTE_ENGINE,
    appVersion,
    ...(serverPayloadArchive !== null ? { serverPayloadArchive } : {}),
    ...(desktopNotifications !== undefined ? { desktopNotifications } : {}),
    ...(hubSession !== undefined ? { hubSession } : {}),
    // The Display's fast path: a widget route publishes its frame the moment
    // its transaction commits, so the card appears while Claude is still
    // talking. The outbox row stays the durable record for slower consumers.
    displayLiveSink: createHubDisplayLiveSink(liveChannelHub),
    // ONE parked-ask registry shared by the routes (answer/dismiss resolve)
    // and the channel runner (ask_user on channel turns) — a runner-parked
    // ask must be resolvable by the route the app answers through.
    askWaiters,
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
  // Boot recovery for the durable CHECKPOINT slot (audit r2 R2-H): nothing is
  // running yet, so every pending slot outlived a restart. Vynel never starts
  // work at boot (Kafi 2026-08-20) — each survivor becomes a NOTE on its own
  // thread and rides the next turn's provider input, while the spoken thread's
  // (which never continues work by itself) is dropped with the same note. Must
  // precede the services below: a turn that consumed the survivor first would
  // make the note a lie.
  try {
    surfaceCheckpointSurvivors(db, { logger })
  } catch (err) {
    logger.error({ err }, 'boot checkpoint-survivor pass failed')
  }

  // Warm the model roster from the ENGINE (2026-08-17). Fire-and-forget: the
  // picker's list is account-scoped and used to arrive only as a side-effect
  // of the user's first chat turn, so a fresh app showed the curated floor and
  // a roster that changed between sessions never caught up. Discovery costs no
  // tokens (the engine's startup handshake) and a failed one changes nothing —
  // so boot never waits on it and never degrades what is already stored.
  void refreshDiscoveredModels(
    db,
    resolveAiAgentProvider(DEFAULT_PROVIDER_ID),
    { userId: user.id, workspacePath: ensureGlobalRootWorkspaceDir() },
    { logger },
  )
    .then((refreshed) => {
      if (refreshed) logger.info('boot model discovery refreshed the roster')
    })
    .catch((err: unknown) => {
      logger.warn({ err }, 'boot model discovery failed — keeping the known roster')
    })

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
    // A fired workspace turn holds the workspace key in the SAME registry the
    // delegation pool + the session-turn route hold theirs in (background-turns BT3).
    targetLocks: sessionTargetLocks,
    turnEvents,
    readEnabledFeatureKeys,
    firePool: scheduleFirePool,
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
    askWaiters,
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
    // The swap-threshold smoke knob reaches the delegated runners too — every
    // runner swaps at one point, and whoami's report is true on all of them.
    ...(env.VYNEL_CONTEXT_PRESSURE_THRESHOLD !== undefined
      ? { pressureThreshold: env.VYNEL_CONTEXT_PRESSURE_THRESHOLD }
      : {}),
    maxConcurrentDelegations: env.VYNEL_MAX_CONCURRENT_DELEGATIONS,
  })
  // The stale-approval reaper (surface-up's unanswered bound) — denies the provider
  // approval so a parked turn resumes, then marks the row timed-out.
  const approvalsRecoveryService = startApprovalsRecoveryService({ db, logger, provider })
  // The stale-ask reaper (session-hardening D5) — a pending form older than the
  // interactive bound has outlived every waiter that could answer it.
  const asksRecoveryService = startAsksRecoveryService({
    db,
    logger,
    maxAgeMs: env.VYNEL_INTERACTIVE_ASK_MAX_MS,
  })
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
  const liveChannelUpgrade = createLiveChannelUpgradeHandler({
    hub: liveChannelHub,
    resolveUserId: () => getOrCreateLocalUser(db, { logger }).id,
    logger,
  })
  const gateway = createGatewayApp({
    apiApp: app,
    liveChannelUpgrade,
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
  const server = serve(
    {
      fetch: gateway.fetch,
      hostname: '127.0.0.1',
      port: env.PORT,
      // The live channel's upgrade path (the adapter completes the handshake).
      // `@types/ws` types `noServer` as optional; the adapter's structural type
      // wants it definite — it is set right here, so the cast states a fact.
      websocket: {
        server: new WebSocketServer({ noServer: true }) as unknown as WebSocketServerLike,
      },
    },
    (info) => {
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
  },
  )

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'api shutdown initiated')
    removePortFileIfOwn(portFilePath)
    liveChannelHub.dispose()
    voiceDaemonRelay.dispose()
    server.close(() => {
      schedulesService.stop()
      knowledgeIndexingService.stop()
      memoryMaintenanceService.stop()
      channelsService.stop()
      delegationService.stop()
      approvalsRecoveryService.stop()
      asksRecoveryService.stop()
      monitorsService.stop()
      outboxRelayService.stop()
      // Quitting Vynel never orphans a dev server (docs/module-notes/apps.md)
      // — nor a headless background command (Windows children outlive their
      // parent; taskkill runs synchronously, so the trees die before exit).
      // The killed rows settle at the NEXT boot's sweep as 'restart' — the
      // settle callbacks are async and this handler exits first.
      void appSupervisor.stopAll()
      processRunner.killAll()
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


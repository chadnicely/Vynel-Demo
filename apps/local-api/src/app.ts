// The `createApp` DI factory. Returns the Hono `app` that `server.ts` listens
// on. Wires request-scoped `c.var.{db,logger,appRequest}`, the single
// `instanceof VynelError` onError, the `/openapi.json` spec, and the mounted
// routes. (Knowledge-slice pull — more routes + the first-launch gate mount as
// their features land.)

import { Hono } from 'hono'
import { openAPISpecs } from 'hono-openapi'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { VynelError } from '@vynel/errors'
import { FileWatcherService } from '@vynel/knowledge'
import type { PayloadArchive as ServerPayloadArchive } from '@vynel/server-install'
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AiAgentProvider } from '@vynel/providers'
import type { HubSession } from '@vynel/hub-account'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { DesktopNotificationReader } from '@vynel/desktop-control'
import type { AppEnv } from './factory.js'
import { openApiInfo } from './openapi.js'
import { knowledgeApp } from './routes/knowledge/index.js'
import { knowledgeUserApp } from './routes/knowledge/user-scoped.js'
import { skillsApp } from './routes/skills/index.js'
import { skillsUserApp } from './routes/skills/user-scoped.js'
import { rulesApp } from './routes/rules/index.js'
import { rulesUserApp } from './routes/rules/user-scoped.js'
import { commandsApp } from './routes/commands/index.js'
import { commandsUserApp } from './routes/commands/user-scoped.js'
import { mcpServersApp } from './routes/mcp-servers/index.js'
import { mcpServersUserApp } from './routes/mcp-servers/user-scoped.js'
import { marketplaceApp } from './routes/marketplace/index.js'
import { marketplaceUserApp } from './routes/marketplace/user-scoped.js'
import { marketplaceSourcesApp } from './routes/marketplace/sources.js'
import { channelsApp } from './routes/channels/index.js'
import { channelsUserApp } from './routes/channels/user-scoped.js'
import { schedulesApp } from './routes/schedules/index.js'
import { schedulesUserApp } from './routes/schedules/user-scoped.js'
import { tasksApp } from './routes/tasks/index.js'
import { tasksUserApp } from './routes/tasks/user-scoped.js'
import { todosApp } from './routes/todos/index.js'
import { plansApp } from './routes/plans/index.js'
import { plansUserApp } from './routes/plans/user-scoped.js'
import { phasesApp } from './routes/phases/index.js'
import { featuresApp } from './routes/features/index.js'
import { monitorsApp } from './routes/monitors/index.js'
import { monitorsUserApp } from './routes/monitors/user-scoped.js'
import { journalApp } from './routes/journal/index.js'
import { journalUserApp } from './routes/journal/user-scoped.js'
import { asksApp } from './routes/asks/index.js'
import { sshServersApp } from './routes/ssh-servers/index.js'
import { serverInstallApp } from './routes/server-install/index.js'
import { PendingAskRegistry } from '@vynel/asks'
import { workspaceAppsApp } from './routes/workspace-apps/index.js'
import { AppProcessSupervisor, publishAppExitOutcome } from '@vynel/apps'
import { approvalsApp, approvalRulesApp } from './routes/approvals/index.js'
import { approvalsUserApp } from './routes/approvals/user-scoped.js'
import { chatApp } from './routes/chat/index.js'
import { filesApp } from './routes/files/index.js'
import { memoryApp } from './routes/memory/index.js'
import { memoryUserApp } from './routes/memory/user-scoped.js'
import { notebookApp } from './routes/notebook/index.js'
import { capabilitiesApp } from './routes/capabilities/index.js'
import { usersApp } from './routes/users/index.js'
import { agentsApp } from './routes/agents/index.js'
import { toolPoliciesApp } from './routes/tool-policies/index.js'
import { providersApp } from './routes/providers/index.js'
import { onboardingApp } from './routes/onboarding/index.js'
import { firstLaunchGateMiddleware } from './middleware/first-launch-gate.js'
import {
  claudePluginDelegate,
  type MarketplacePluginDelegate,
} from './services/marketplace-plugin-delegate.js'
import { claudeMcpAuthDelegate, type McpAuthDelegate } from './services/mcp-auth-delegate.js'
import { listClaudeMarketplaceSources } from './services/claude-marketplaces-reader.js'
import type { ClaudeMarketplaceSourceView } from '@vynel/marketplace'
import {
  listInstalledClaudePlugins,
  listMcpOauthCredentialStatuses,
  type InstalledClaudePluginView,
  type McpOauthCredentialStatus,
} from '@vynel/providers'
import { featureGate } from './middleware/feature-gate.js'
import { workspacesApp } from './routes/workspaces/index.js'
import { hubApp } from './routes/hub/index.js'
import { rootApp } from './routes/root/index.js'
import { routingApp } from './routes/routing/index.js'
import { voiceApp } from './routes/voice/index.js'
import { dashboardApp } from './routes/dashboard/index.js'
import { dashboardWorkspaceApp } from './routes/dashboard/workspace-scoped.js'
import { sectionCountsApp } from './routes/section-counts/index.js'
import { sectionCountsWorkspaceApp } from './routes/section-counts/workspace-scoped.js'
import { sessionsApp } from './routes/sessions/index.js'
import {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { activityApp } from './routes/activity/index.js'

export interface CreateAppOptions {
  readonly db: Database
  readonly logger: Logger
  // The boot-owned file watcher. `server.ts` creates it so it can `stopAll()`
  // on shutdown; omitted by the SDK/MCP generators (which only mount the app to
  // read route shapes) — createApp then makes an inert default (never started).
  readonly fileWatcher?: FileWatcherService
  // Test-only override for the schedule fire path. When set, the `fire-now`
  // routes fire with THESE deps (a fake `startChatTurn`) instead of building
  // the real turn machinery — so a route test records a run with no live AI.
  // Production omits it; the routes lazily build the real deps.
  readonly scheduleFireDeps?: FireScheduleDeps
  // Override the AI-agent provider. Omitted in production (createApp resolves
  // the real `claude` provider); a test injects a FAKE so provider-reaching
  // routes (skills `/synchronize`) run through the HTTP stack without the live
  // Claude runtime reading the dev's real `~/.claude/skills`.
  readonly aiProvider?: AiAgentProvider
  // Mount the first-launch gate (412s non-onboarding routes until onboarding
  // completes). The middleware skips `/openapi.json` BEFORE touching `c.var.db`,
  // so the SDK generator's stub-deps spec request is safe. Off by default
  // (domain route tests aren't gated); `server.ts` enables it for production.
  readonly enableFirstLaunchGate?: boolean
  // The turn-event pub/sub shared with the delegation service. `server.ts`
  // creates ONE instance and hands it to both; omitted (tests / generators) →
  // createApp makes its own (routes still work, nothing publishes).
  readonly turnEvents?: TurnEventBroadcaster
  // The turn-liveness registry shared with the channels service (its background
  // root turns must announce themselves too). Same wiring shape as `turnEvents`.
  readonly activityFeed?: SessionActivityFeed
  // The delegation stop bridge shared with the delegation service (its tick
  // registers each claimed run). Same wiring shape as `turnEvents`.
  readonly delegationCancels?: DelegationCancelRegistry
  // The per-target single-writer lock registry shared with the delegation
  // service (the session-turn route queues user turns behind its claimed
  // runs). Same wiring shape as `turnEvents`.
  readonly sessionTargetLocks?: SessionTargetLocks
  // The daemon's hub-account session — present only when VYNEL_HUB_URL is
  // configured (server.ts); the /hub routes answer `not-configured` without it.
  readonly hubSession?: HubSession
  // Override the marketplace's plugin-install delegate (the Claude-plugin
  // CLI seam). Production omits it (the real CLI); a route test injects a
  // fake so the HTTP stack never runs `claude plugin` commands.
  readonly marketplacePluginDelegate?: MarketplacePluginDelegate
  // Override the marketplace's installed-plugin registry reader (the
  // delegate's read twin). Production omits it (the provider's real
  // `~/.claude/plugins` reader); a route test injects a stub so unmocked
  // list routes never read this machine's registry.
  readonly marketplaceInstalledPluginsReader?: () => InstalledClaudePluginView[]
  // Override the MCP-server auth delegate (the `claude mcp login/logout`
  // CLI seam). Production omits it (the real CLI); a route test injects a
  // fake so the HTTP stack never opens a browser.
  readonly mcpAuthDelegate?: McpAuthDelegate
  // Override the credential-store presence reader behind the rows'
  // persisted `signedIn`. Production omits it (Claude Code's real store,
  // metadata only); a route test injects a stub.
  readonly mcpCredentialStatusesReader?: () => McpOauthCredentialStatus[]
  // Override the user-registered Claude marketplaces reader (the plugin
  // reader's sibling). Production omits it (the provider's real
  // ~/.claude/plugins reads); a route test injects a stub.
  readonly claudeMarketplacesReader?: () => ClaudeMarketplaceSourceView[]
  // The `ask_user` waiter registry — one per process. Injectable so a test can
  // park/resolve waiters around a route call; production omits it and gets a
  // fresh instance.
  readonly askWaiters?: PendingAskRegistry
  // The workspace-app process supervisor — one per process. Injectable so a
  // test can inspect/stop the processes a route started; production omits it.
  readonly appSupervisor?: AppProcessSupervisor
  // The ssh sealing master key (base64, 32 bytes) — `server.ts` resolves it
  // from the OS keyring at boot; omitted by generators/tests that don't need
  // ssh (the routes then answer that ssh is unavailable).
  readonly sshMasterKeyBase64?: string
  // The process-wide desktop-notification reader — `server.ts` constructs the
  // listener on Windows only; omitted (tests / generators / off-Windows) the
  // desktop MCP feature stays off every turn (descriptor `build` → null).
  readonly desktopNotifications?: DesktopNotificationReader
  // Enable the MUTATING desktop `act_on_app` tool (VYNEL_DESKTOP_ACT_ENABLED).
  // Fail-closed default: false.
  readonly desktopActionsEnabled?: boolean
  // This daemon is a REMOTE engine (VYNEL_REMOTE_ENGINE — Phase D server
  // install). Local-machine surfaces answer honestly instead of probing dead
  // loopbacks: `speak` reports voice unavailable without a daemon round-trip.
  readonly remoteEngine?: boolean
  // The product version this daemon runs as (VYNEL_APP_VERSION, '0.0.0' in
  // dev) — provisioning stamps it into the remote engine's env.
  readonly appVersion?: string
  // The linux engine payload the server-install routes provision with —
  // resolved at boot (dev: VYNEL_SERVER_PAYLOAD_ARCHIVE + its .sha256
  // sidecar); absent = the routes answer that no payload is available.
  readonly serverPayloadArchive?: ServerPayloadArchive
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Captured at construction so handlers can re-enter via `c.var.appRequest(...)`.
  const appRequest = app.request.bind(app)
  // One watcher singleton for the app's lifetime (NOT per-request).
  const fileWatcher = options.fileWatcher ?? new FileWatcherService(options.db, options.logger)
  // The AI-agent provider — a process-level singleton (`resolveAiAgentProvider`
  // is a Map lookup of an already-constructed instance, cheap at boot), or a
  // fake for tests. Set once, like `fileWatcher`.
  const aiProvider = options.aiProvider ?? resolveAiAgentProvider(DEFAULT_PROVIDER_ID)
  // The turn-event pub/sub — one per process (see CreateAppOptions).
  const turnEvents = options.turnEvents ?? new TurnEventBroadcaster()
  // The turn-liveness registry — one per process (see CreateAppOptions).
  const activityFeed = options.activityFeed ?? new SessionActivityFeed()
  // The delegation stop bridge — one per process (see CreateAppOptions).
  const delegationCancels = options.delegationCancels ?? new DelegationCancelRegistry()
  // The per-target single-writer locks — one per process (see CreateAppOptions).
  const sessionTargetLocks = options.sessionTargetLocks ?? new SessionTargetLocks()
  // The ask blocking bridge's in-memory half — one per process, like fileWatcher.
  const askWaiters = options.askWaiters ?? new PendingAskRegistry()
  // The app supervisor — one per process; a SELF-exit publishes its runtime
  // fact (app.crashed / clean app.stopped) through the leaf op.
  const appSupervisor =
    options.appSupervisor ??
    new AppProcessSupervisor({
      logger: options.logger,
      onExit: (appId, outcome) => publishAppExitOutcome(options.db, { appId, ...outcome }),
    })

  app.use('*', async (c, next) => {
    c.set('db', options.db)
    c.set('logger', options.logger)
    c.set('appRequest', appRequest)
    c.set('fileWatcher', fileWatcher)
    c.set('aiProvider', aiProvider)
    c.set('turnEvents', turnEvents)
    c.set('activityFeed', activityFeed)
    c.set('delegationCancels', delegationCancels)
    c.set('sessionTargetLocks', sessionTargetLocks)
    c.set('askWaiters', askWaiters)
    c.set('appSupervisor', appSupervisor)
    c.set('sshMasterKey', options.sshMasterKeyBase64 ?? null)
    c.set('desktopActionsEnabled', options.desktopActionsEnabled ?? false)
    c.set('remoteEngine', options.remoteEngine ?? false)
    c.set('appVersion', options.appVersion ?? '0.0.0')
    c.set('serverPayloadArchive', options.serverPayloadArchive ?? null)
    if (options.desktopNotifications !== undefined)
      c.set('desktopNotifications', options.desktopNotifications)
    if (options.scheduleFireDeps !== undefined) c.set('scheduleFireDeps', options.scheduleFireDeps)
    if (options.hubSession !== undefined) c.set('hubSession', options.hubSession)
    c.set('marketplacePluginDelegate', options.marketplacePluginDelegate ?? claudePluginDelegate)
    c.set(
      'marketplaceInstalledPluginsReader',
      options.marketplaceInstalledPluginsReader ?? listInstalledClaudePlugins,
    )
    c.set('mcpAuthDelegate', options.mcpAuthDelegate ?? claudeMcpAuthDelegate)
    c.set(
      'mcpCredentialStatusesReader',
      options.mcpCredentialStatusesReader ?? (() => listMcpOauthCredentialStatuses()),
    )
    c.set('claudeMarketplacesReader', options.claudeMarketplacesReader ?? listClaudeMarketplaceSources)
    await next()
  })

  if (options.enableFirstLaunchGate) {
    app.use('*', firstLaunchGateMiddleware)
  }

  // Tier gates (Chad's matrix: basic = channels only). Path-scoped BEFORE the
  // route mounts; permissive without a live entitlement (feature-gate.ts).
  // Channels + chat + workspaces + skills stay ungated (core assistant).
  app.use('/workspaces/:workspaceId/schedules/*', featureGate('schedules'))
  app.use('/schedules/*', featureGate('schedules'))
  app.use('/workspaces/:workspaceId/apps/*', featureGate('apps'))
  app.use('/ssh-servers/*', featureGate('ssh'))
  app.use('/workspaces/:workspaceId/knowledge/*', featureGate('knowledge'))
  app.use('/workspaces/:workspaceId/memory/*', featureGate('memory'))
  app.use('/workspaces/:workspaceId/marketplace/*', featureGate('marketplace'))
  app.use('/marketplace/*', featureGate('marketplace'))
  app.use('/voice/*', featureGate('voice'))

  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json(
        { code: err.code, message: err.message },
        err.httpStatus as ContentfulStatusCode,
      )
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })

  // OpenAPI 3.1 spec — served by hono-openapi at request time (routes mounted
  // after this still flatten correctly). Consumed by scripts/generators.
  app.get('/openapi.json', openAPISpecs(app, openApiInfo))

  app.route('/workspaces/:workspaceId/knowledge', knowledgeApp)
  app.route('/workspaces/:workspaceId/skills', skillsApp)
  // Claude-config surfaces (rules / commands / mcp-servers): the workspace
  // twins FUSE scopes the way Claude Code resolves them in a project.
  app.route('/workspaces/:workspaceId/rules', rulesApp)
  app.route('/workspaces/:workspaceId/commands', commandsApp)
  app.route('/workspaces/:workspaceId/mcp-servers', mcpServersApp)
  app.route('/workspaces/:workspaceId/marketplace', marketplaceApp)
  app.route('/workspaces/:workspaceId/channels', channelsApp)
  app.route('/workspaces/:workspaceId/schedules', schedulesApp)
  // Tasks are NOT feature-gated — the task list is part of the core "one
  // brain you can trust" experience, like chat and workspaces. Plans and the
  // journal ride the same reasoning (the date-wise layer + the daily record).
  app.route('/workspaces/:workspaceId/tasks', tasksApp)
  app.route('/workspaces/:workspaceId/plans', plansApp)
  // Phases + features are the engineering-plan layer (the build plan + the
  // app's feature catalog) — core like tasks/plans, so not feature-gated.
  app.route('/workspaces/:workspaceId/phases', phasesApp)
  app.route('/workspaces/:workspaceId/features', featuresApp)
  app.route('/workspaces/:workspaceId/monitors', monitorsApp)
  app.route('/workspaces/:workspaceId/journal', journalApp)
  app.route('/workspaces/:workspaceId/apps', workspaceAppsApp)
  app.route('/workspaces/:workspaceId/chat', chatApp)
  app.route('/workspaces/:workspaceId/files', filesApp)
  app.route('/workspaces/:workspaceId/memory', memoryApp)
  app.route('/workspaces/:workspaceId/capabilities', capabilitiesApp)
  app.route('/workspaces/:workspaceId/approvals', approvalsApp)
  app.route('/workspaces/:workspaceId/approval-rules', approvalRulesApp)
  // The per-workspace dashboard reads (usage statistics) — twin of `/dashboard`.
  app.route('/workspaces/:workspaceId/dashboard', dashboardWorkspaceApp)
  // The drilled menu's per-section counts — twin of `/section-counts`.
  app.route('/workspaces/:workspaceId/section-counts', sectionCountsWorkspaceApp)
  // User-scoped (no workspace prefix) — GLOBAL (null-workspace) + cross-workspace
  // resources. `/channels` + `/schedules` span a user's whole set (both scopes)
  // so global channels/schedules are creatable, listable, and manageable; the
  // global approval queue spans every workspace + the brain, answerable from any
  // surface. These sit alongside the untouched workspace-scoped mounts above.
  app.route('/channels', channelsUserApp)
  app.route('/schedules', schedulesUserApp)
  // `/tasks` spans a user's whole set (both scopes) — the panel + dashboard +
  // CLI surface; global tasks are creatable, listable, and manageable here.
  // `/plans` + `/journal` are its date-wise + daily-record twins.
  app.route('/tasks', tasksUserApp)
  // `/todos` — the working-steps dock under the chat (session-scoped steps, the
  // step-level half of the tasks leaf). Both doors live here: `PUT /` is the
  // agent's whole-list replace, the rest is the user's dock.
  app.route('/todos', todosApp)
  app.route('/plans', plansUserApp)
  app.route('/monitors', monitorsUserApp)
  app.route('/journal', journalUserApp)
  // `/asks` — the ask_user answering surface (always the user; the agent's
  // surface is the `vynel-ask` descriptor tool). Core plumbing, not gated.
  app.route('/asks', asksApp)
  // `/ssh-servers` — USER-scoped only (servers live at global or workspace
  // scope but registration/removal is always the user's door; the agent's
  // surface is the `vynel-ssh` descriptor). Gated pro above.
  app.route('/ssh-servers', sshServersApp)
  app.route('/server-install', serverInstallApp)
  // `/marketplace` is the GLOBAL marketplace — user+both items, user-scope
  // installs (Chad's rule). The workspace surface stays mounted above.
  app.route('/marketplace/sources', marketplaceSourcesApp)
  app.route('/marketplace', marketplaceUserApp)
  // `/notebook` is user-scoped like `/schedules`: books live at either scope
  // (global or one workspace) and the shelf read takes an optional
  // `workspaceId` for a workspace turn's view.
  app.route('/notebook', notebookApp)
  // `/knowledge` + `/memory` are the GLOBAL surfaces' anchors: unlike their
  // workspace-scoped twins (which FUSE a workspace's rows with the user's
  // global ones) these list ONLY the null-workspace rows, so the global menu
  // shows global items and nothing else.
  app.route('/knowledge', knowledgeUserApp)
  app.route('/memory', memoryUserApp)
  // `/skills` + the Claude-config surfaces: the GLOBAL anchors — user-scope
  // entries only (their workspace twins above fuse scopes).
  app.route('/skills', skillsUserApp)
  app.route('/rules', rulesUserApp)
  app.route('/commands', commandsUserApp)
  app.route('/mcp-servers', mcpServersUserApp)
  app.route('/approvals', approvalsUserApp)
  // The admin tool-policy matrix — deliberately x-mcp-free (an agent must
  // never edit its own gates; the capabilities-PUT doctrine).
  app.route('/tool-policies', toolPoliciesApp)
  app.route('/users', usersApp)
  app.route('/onboarding', onboardingApp)
  app.route('/providers', providersApp)
  app.route('/agents', agentsApp)
  app.route('/root', rootApp)
  app.route('/routing', routingApp)
  // `/activity` — the per-user session-activity SSE feed (turn liveness across
  // every surface: web tabs, voice, channel turns, schedule fires).
  app.route('/activity', activityApp)
  app.route('/voice', voiceApp)
  app.route('/dashboard', dashboardApp)
  app.route('/section-counts', sectionCountsApp)
  // The unified session list (session-library Slice ③) — user-scoped.
  app.route('/sessions', sessionsApp)
  app.route('/hub', hubApp)
  // Bare `/workspaces` mounts AFTER every `/workspaces/:workspaceId/*` sub-app
  // (source order) so the param-scoped feature routes keep precedence.
  app.route('/workspaces', workspacesApp)

  return app
}

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
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AiAgentProvider } from '@vynel/providers'
import type { HubSession } from '@vynel/hub-account'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { AppEnv } from './factory.js'
import { openApiInfo } from './openapi.js'
import { knowledgeApp } from './routes/knowledge/index.js'
import { skillsApp } from './routes/skills/index.js'
import { marketplaceApp } from './routes/marketplace/index.js'
import { marketplaceUserApp } from './routes/marketplace/user-scoped.js'
import { channelsApp } from './routes/channels/index.js'
import { channelsUserApp } from './routes/channels/user-scoped.js'
import { schedulesApp } from './routes/schedules/index.js'
import { schedulesUserApp } from './routes/schedules/user-scoped.js'
import { approvalsApp, approvalRulesApp } from './routes/approvals/index.js'
import { approvalsUserApp } from './routes/approvals/user-scoped.js'
import { chatApp } from './routes/chat/index.js'
import { filesApp } from './routes/files/index.js'
import { memoryApp } from './routes/memory/index.js'
import { notebookApp } from './routes/notebook/index.js'
import { capabilitiesApp } from './routes/capabilities/index.js'
import { usersApp } from './routes/users/index.js'
import { agentsApp } from './routes/agents/index.js'
import { providersApp } from './routes/providers/index.js'
import { onboardingApp } from './routes/onboarding/index.js'
import { firstLaunchGateMiddleware } from './middleware/first-launch-gate.js'
import { featureGate } from './middleware/feature-gate.js'
import { workspacesApp } from './routes/workspaces/index.js'
import { hubApp } from './routes/hub/index.js'
import { rootApp } from './routes/root/index.js'
import { routingApp } from './routes/routing/index.js'
import { voiceApp } from './routes/voice/index.js'
import { dashboardApp } from './routes/dashboard/index.js'
import { TurnEventBroadcaster } from '@vynel/session/delegation'

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
  // The daemon's hub-account session — present only when VYNEL_HUB_URL is
  // configured (server.ts); the /hub routes answer `not-configured` without it.
  readonly hubSession?: HubSession
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

  app.use('*', async (c, next) => {
    c.set('db', options.db)
    c.set('logger', options.logger)
    c.set('appRequest', appRequest)
    c.set('fileWatcher', fileWatcher)
    c.set('aiProvider', aiProvider)
    c.set('turnEvents', turnEvents)
    if (options.scheduleFireDeps !== undefined) c.set('scheduleFireDeps', options.scheduleFireDeps)
    if (options.hubSession !== undefined) c.set('hubSession', options.hubSession)
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
  app.route('/workspaces/:workspaceId/marketplace', marketplaceApp)
  app.route('/workspaces/:workspaceId/channels', channelsApp)
  app.route('/workspaces/:workspaceId/schedules', schedulesApp)
  app.route('/workspaces/:workspaceId/chat', chatApp)
  app.route('/workspaces/:workspaceId/files', filesApp)
  app.route('/workspaces/:workspaceId/memory', memoryApp)
  app.route('/workspaces/:workspaceId/capabilities', capabilitiesApp)
  app.route('/workspaces/:workspaceId/approvals', approvalsApp)
  app.route('/workspaces/:workspaceId/approval-rules', approvalRulesApp)
  // User-scoped (no workspace prefix) — GLOBAL (null-workspace) + cross-workspace
  // resources. `/channels` + `/schedules` span a user's whole set (both scopes)
  // so global channels/schedules are creatable, listable, and manageable; the
  // global approval queue spans every workspace + the brain, answerable from any
  // surface. These sit alongside the untouched workspace-scoped mounts above.
  app.route('/channels', channelsUserApp)
  app.route('/schedules', schedulesUserApp)
  // `/marketplace` is the GLOBAL marketplace — user+both items, user-scope
  // installs (Chad's rule). The workspace surface stays mounted above.
  app.route('/marketplace', marketplaceUserApp)
  // `/notebook` is user-scoped like `/schedules`: books live at either scope
  // (global or one workspace) and the shelf read takes an optional
  // `workspaceId` for a workspace turn's view.
  app.route('/notebook', notebookApp)
  app.route('/approvals', approvalsUserApp)
  app.route('/users', usersApp)
  app.route('/onboarding', onboardingApp)
  app.route('/providers', providersApp)
  app.route('/agents', agentsApp)
  app.route('/root', rootApp)
  app.route('/routing', routingApp)
  app.route('/voice', voiceApp)
  app.route('/dashboard', dashboardApp)
  app.route('/hub', hubApp)
  // Bare `/workspaces` mounts AFTER every `/workspaces/:workspaceId/*` sub-app
  // (source order) so the param-scoped feature routes keep precedence.
  app.route('/workspaces', workspacesApp)

  return app
}

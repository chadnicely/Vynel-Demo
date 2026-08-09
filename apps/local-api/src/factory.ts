// The Hono factory + `AppEnv` type. Every route bundle/middleware in
// `apps/local-api` builds on this. Per `docs/coding-guideline.md §4.1`.
//
// `c.var` shape:
//   - `db` — the `Database` from `@vynel/db`, injected per request by the DI
//     factory in `app.ts`.
//   - `logger` — the request-scoped pino logger.
//   - `user` — the resolved user, populated by `userResolverMiddleware`.
//   - `workspace` — the resolved workspace, populated by
//     `workspaceResolverMiddleware` on `...workspaceScoped` routes.
//
// (Knowledge-slice pull: `chatSession` returns to `AppEnv` when the chat
// feature lands.)

import { createFactory } from 'hono/factory'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { User } from '@vynel/core/users'
import type { Workspace } from '@vynel/workspaces'
import type { FileWatcherService } from '@vynel/knowledge'
import type { PayloadArchive as ServerPayloadArchive } from '@vynel/server-install'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { PendingAskRegistry } from '@vynel/asks'
import type { AppProcessSupervisor } from '@vynel/apps'
import type { ChatSession } from '@vynel/chat'
import type { AiAgentProvider } from '@vynel/providers'
import type { HubSession } from '@vynel/hub-account'
import type { InstalledPluginView } from '@vynel/marketplace'
import type { MarketplacePluginDelegate } from './services/marketplace-plugin-delegate.js'
import type { McpAuthDelegate } from './services/mcp-auth-delegate.js'
import type { ClaudeMarketplaceSourceView } from '@vynel/marketplace'
import type {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { DesktopNotificationReader } from '@vynel/desktop-control'

// In-process Hono request dispatcher — bound at construction (`app.ts`) and
// stashed on `c.var.appRequest` so handlers can re-enter the app (the mcp
// in-process dispatcher, per the locked `sdk-mcp.md` "wrap via HTTP" rule).
export type HonoAppRequestFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response>

export interface AppEnv {
  Variables: {
    db: Database
    logger: Logger
    user: User
    workspace?: Workspace
    appRequest: HonoAppRequestFn
    // The boot singleton holding one chokidar watcher per registered knowledge
    // source. Created once at construction (`app.ts`), like `appRequest`.
    fileWatcher: FileWatcherService
    // The AI-agent provider for routes that reach the runtime (e.g. skills
    // `/synchronize` reconciles against what the provider sees on disk). Set
    // once at construction (`app.ts`) — the real `claude` provider in
    // production, or a FAKE injected via `CreateAppOptions` for tests. Like
    // `fileWatcher`, it always has a value (a real default), so the routes read
    // `c.var.aiProvider` instead of resolving a hardcoded id inline.
    aiProvider: AiAgentProvider
    // The schedule fire path's injected deps (startChatTurn + MCP/capability
    // composition). Set ONLY when `createApp` is given an override — the
    // `fire-now` routes then use it instead of building the real deps, so a
    // route test can fire with a FAKE turn (no live AI). Absent in production;
    // the routes lazily build the real deps via `buildScheduleFireDeps`.
    scheduleFireDeps?: FireScheduleDeps
    // The in-process turn-event pub/sub — a BACKGROUND turn (the delegation
    // tick) publishes; the SSE observe routes subscribe. One instance per
    // process, shared with the delegation service via `server.ts`.
    turnEvents: TurnEventBroadcaster
    // The per-user turn-liveness registry — every turn producer begins/ends a
    // turn here; `GET /activity/stream` subscribes. One instance per process,
    // shared with the channels service via `server.ts`.
    activityFeed: SessionActivityFeed
    // The delegation stop bridge — the tick registers each claimed run; the
    // stop route flags it cancelled + interrupts its session. One instance per
    // process, shared with the delegation service via `server.ts`.
    delegationCancels: DelegationCancelRegistry
    // The single-writer lock per delegation target (a workspace id or a
    // spawned primary id) — the session-turn route queues user turns on it
    // while the delegation pool holds its claimed keys in it. One instance per
    // process, shared with the delegation service via `server.ts`.
    sessionTargetLocks: SessionTargetLocks
    // Set by the chat-session-resolver middleware (the session-scoped handler
    // bundle's triple-check) — present only inside `/chat/sessions/:sessionId`
    // routes, absent everywhere else.
    chatSession?: ChatSession
    // The daemon's hub-account session (`@vynel/hub-account`) — present only
    // when VYNEL_HUB_URL is configured; the /hub routes answer
    // `not-configured` without it.
    hubSession?: HubSession
    // The marketplace's plugin-install delegate (the Claude-plugin CLI seam).
    // Set once at construction (`app.ts`) — real CLI in production, a fake in
    // route tests.
    marketplacePluginDelegate: MarketplacePluginDelegate
    // The marketplace's installed-plugin registry reader (the delegate's
    // read twin). Set once at construction (`app.ts`) — the provider's real
    // `~/.claude/plugins` reader in production, a stub in route tests so an
    // unmocked list route never depends on the developer's machine.
    marketplaceInstalledPluginsReader: () => InstalledPluginView[]
    // The MCP-server auth delegate (`claude mcp login/logout` CLI seam).
    // Set once at construction (`app.ts`) — real CLI in production, a fake
    // in route tests (a test must never open a browser).
    mcpAuthDelegate: McpAuthDelegate
    // The user-registered Claude marketplaces reader (the plugin reader's
    // sibling) — real ~/.claude/plugins reads in production, a stub in
    // route tests.
    claudeMarketplacesReader: () => ClaudeMarketplaceSourceView[]
    // The process-wide map of `ask_user` tool calls awaiting the user's answer
    // (the blocking bridge's in-memory half). Set once at construction
    // (`app.ts`), like `fileWatcher` — the turn streams park waiters on it and
    // the /asks answer/dismiss routes resolve them.
    askWaiters: PendingAskRegistry
    // The process-wide supervisor of running workspace apps (dev servers etc.).
    // Set once at construction (`app.ts`); `server.ts` stopAll()s it on
    // shutdown so quitting Vynel never orphans a dev server.
    appSupervisor: AppProcessSupervisor
    // The ssh sealing master key (base64, 32 bytes) — resolved from the OS
    // keyring at boot by server.ts; null in generator/test contexts that
    // don't pass one (the ssh routes then refuse to seal/open credentials).
    sshMasterKey: string | null
    // The process-wide desktop-notification reader — present only when boot
    // constructed the Windows listener (server.ts); absent in tests /
    // off-Windows, which also keeps the whole desktop MCP feature off a turn
    // (the descriptor's `build` returns null without a reader).
    desktopNotifications?: DesktopNotificationReader
    // Whether the MUTATING desktop `act_on_app` tool is enabled — the
    // VYNEL_DESKTOP_ACT_ENABLED env flag, stamped once at construction.
    // Fail-closed: tests that omit it get `false`.
    desktopActionsEnabled: boolean
    // Whether this daemon is a REMOTE engine (VYNEL_REMOTE_ENGINE, Phase D) —
    // local-machine surfaces (voice) answer honestly instead of probing.
    remoteEngine: boolean
    // The product version (VYNEL_APP_VERSION; '0.0.0' in dev) — provisioning
    // stamps it into the remote engine's env.
    appVersion: string
    // The linux engine payload server-install provisions with; null = none
    // available on this machine (the routes refuse with a 409).
    serverPayloadArchive: ServerPayloadArchive | null
  }
}

export const factory = createFactory<AppEnv>()

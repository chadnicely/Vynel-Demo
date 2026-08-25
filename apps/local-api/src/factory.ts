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
import type { FireScheduleDeps, ScheduleFirePool } from '@vynel/schedules'
import type { PendingAskRegistry } from '@vynel/asks'
import type { AppProcessSupervisor } from '@vynel/apps'
import type { BackgroundProcessRunner } from '@vynel/processes'
import type { ChatSession } from '@vynel/chat'
import type { AiAgentProvider } from '@vynel/providers'
import type { GitHubConnection } from '@vynel/github'
import type { HubSession } from '@vynel/hub-account'
import type { InstalledClaudePluginView, McpOauthCredentialStatus } from '@vynel/providers'
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
import type { DisplayLiveSink } from '@vynel/display'
import type { LocalModelsDeps } from '@vynel/models'
import type { VoiceControlSink } from './live/voice-control-sink.js'

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
    // The app's ONE GitHub connection (global) over the GitHub CLI — set once
    // at construction; the real CLI in production, a fake-I/O one in tests.
    githubConnection: GitHubConnection
    // The schedule fire path's injected deps (startChatTurn + MCP/capability
    // composition). Set ONLY when `createApp` is given an override — the
    // `fire-now` routes then use it instead of building the real deps, so a
    // route test can fire with a FAKE turn (no live AI). Absent in production;
    // the routes lazily build the real deps via `buildScheduleFireDeps`.
    scheduleFireDeps?: FireScheduleDeps
    // The process-wide bound on concurrent schedule fires (background-turns
    // BT3) — SHARED with the poll service via `server.ts`, so a "Run now"
    // queues behind the same slots the tick uses and a schedule already
    // queued/running is declined instead of fired twice.
    scheduleFirePool: ScheduleFirePool
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
    marketplaceInstalledPluginsReader: () => InstalledClaudePluginView[]
    // The MCP-server auth delegate (`claude mcp login/logout` CLI seam).
    // Set once at construction (`app.ts`) — real CLI in production, a fake
    // in route tests (a test must never open a browser).
    mcpAuthDelegate: McpAuthDelegate
    // Which remote servers hold a usable OAuth credential in Claude Code's
    // native store (metadata only, never token values) — powers the rows'
    // persisted `signedIn`. Real store read in production, a stub in route
    // tests so listings never depend on the developer's machine.
    mcpCredentialStatusesReader: () => McpOauthCredentialStatus[]
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
    // The process-wide runner of BACKGROUND processes (one-shot commands whose
    // exit wakes their owner via a monitor) — the app supervisor's one-shot
    // sibling. Set once at construction (`app.ts`); boot sweeps orphans at
    // start and killAll()s at shutdown.
    processRunner: BackgroundProcessRunner
    // The ssh sealing master key (base64, 32 bytes) — resolved from the OS
    // keyring at boot by server.ts; null in generator/test contexts that
    // don't pass one (the ssh routes then refuse to seal/open credentials).
    // It is THE sealing master key: voice-provider credentials seal against
    // the same key (a rename to `sealingMasterKey` is a parked follow-up).
    sshMasterKey: string | null
    // The fetch every cloud voice-provider call goes through — the global
    // fetch in production, a fake in route tests (a test must never call a
    // cloud API). Set once at construction (`app.ts`).
    voiceProviderFetch: typeof fetch
    // The process-wide desktop-notification reader — present only when boot
    // constructed the Windows listener (server.ts); absent in tests /
    // off-Windows, which also keeps the whole desktop MCP feature off a turn
    // (the descriptor's `build` returns null without a reader).
    desktopNotifications?: DesktopNotificationReader
    // Whether this daemon is a REMOTE engine (VYNEL_REMOTE_ENGINE, Phase D) —
    // local-machine surfaces (voice) answer honestly instead of probing.
    remoteEngine: boolean
    // The product version (VYNEL_APP_VERSION; '0.0.0' in dev) — provisioning
    // stamps it into the remote engine's env.
    appVersion: string
    // The linux engine payload server-install provisions with; null = none
    // available on this machine (the routes refuse with a 409).
    serverPayloadArchive: ServerPayloadArchive | null
    // The local models on this computer (the Settings → Embedding / Voice
    // screens): where each kind lives + the one download runner. null = this
    // engine does not manage models (generators, tests, a remote engine) and
    // the `/models` routes say so with a 409.
    localModels: LocalModelsDeps | null
    // The Display's in-process live push — the `display` handlers hand it to
    // the leaf ops so a widget reaches a watching window the moment its
    // transaction commits (the outbox relay's tick is far too slow for
    // "appears as Claude says it"). ABSENT is a legal state: tests, the
    // generators and any daemon booted without the hub simply publish nothing,
    // and the outbox row stays the durable record.
    displayLiveSink?: DisplayLiveSink
    // The cross-window voice push — `POST /voice/display-active` hands the app
    // window's Display state to every other window of the user (the display
    // dock reads it to decide whether to hide). ABSENT is a legal state, like
    // `displayLiveSink`: without the hub the fact simply reaches nobody.
    voiceControlSink?: VoiceControlSink
  }
}

export const factory = createFactory<AppEnv>()

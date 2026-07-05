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
// (Knowledge-slice pull: `chatSession` + `desktopNotifications` return to
// `AppEnv` when the chat / desktop-control features land.)

import { createFactory } from 'hono/factory'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { User } from '@vynel/core/users'
import type { Workspace } from '@vynel/workspaces'
import type { FileWatcherService } from '@vynel/knowledge'
import type { FireScheduleDeps } from '@vynel/schedules'
import type { AiAgentProvider } from '@vynel/providers'

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
  }
}

export const factory = createFactory<AppEnv>()

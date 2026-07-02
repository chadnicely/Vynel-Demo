// Domain-only types for the `@vynel/mcp` producer layer — the scope +
// dispatcher + factory shapes the generated tool registry is typed
// against. See `docs/architecture.md` (the MCP layer) + `CLAUDE.md`.

import type { Database } from '@vynel/db'

// Per-session credentials baked into each tool handler's closure.
// `workspaceId` is optional — workspace-scope-free tools (e.g.
// `list_workspaces`) leave it out.
export type McpScope = {
  db: Database
  userId: string
  workspaceId?: string
}

// Hono's `app.request(input, init)` surface — the live api app
// exposes this; tool handlers dispatch through it (the in-process
// equivalent of "wrap API via HTTP, never call core directly").
// Returns Response | Promise<Response> — matches Hono's actual sig;
// generated handlers `await` the call which handles both.
export type HonoAppRequestFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response>

// Factory shape every generated tool entry exports: tools are
// constructed per-session with the live (scope, app) injected, never as
// global module-load-time values (race risk).
//
// Return stays `unknown` to keep this type module SDK-free; the consumer
// that narrows it to the SDK's `SdkMcpToolDefinition`
// (`build-in-process-server.ts`) lands with `packages/providers`.
export type McpToolFactory = (scope: McpScope, app: HonoAppRequestFn) => unknown

// Domain-only types for the `channels` core layer. Per
// `.claude/rules/structure-standard.md` "packages/core/src/".
//
// Spec: `docs/blueprints/channels/coding.md §3`.

import type { Database } from '@vynel/db'

// The subset of pino the core logs against (matches the chat domain's
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// The app.request dispatcher signature, declared STRUCTURALLY here — core
// must NOT import HonoAppRequestFn from apps/api (a package importing an
// app inverts the dependency direction, the exact thing the @vynel/errors
// extraction exists to prevent). The api-side service supplies the real
// bound app.request; this type just describes its shape. Structurally
// identical to apps/api/src/factory.ts's HonoAppRequestFn.
export type AppRequestFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response>

// Deps injected into the turn path by the api-side service. Keeps Hono's app.request + the
// global-root runner OUT of packages/core (core stays unit-testable with stubs). The pre-Ch4
// workspace-turn deps (buildInProcessMcpServer + composeSessionCapabilities) were removed when
// route-as-chat-turn switched to the global root — the workspace turn no longer runs here.
export interface ProcessInboundDeps {
  logger?: StructuralLogger
  appRequest: AppRequestFn
  // Run a GLOBAL-ROOT turn (brain-tree Ch4) — the api-side service injects `runGlobalRootTurn`,
  // typed STRUCTURALLY here so core never imports apps/api or the orchestration runner. The origin
  // (channel coordinates) rides onto any delegation the root enqueues, so its report is delivered
  // back to this channel. The result is the root's answer text (delivered as the channel reply).
  runRootTurn: (
    db: Database,
    input: {
      userId: string
      userMessageText: string
      origin: { channelId: string; externalSenderId: string; externalChatContextId: string }
    },
  ) => Promise<{ resultText: string }>
  // Resolve an approval at the sender's direction (the channel approval-reply path). Injected +
  // typed STRUCTURALLY here so the channels leaf never imports the approvals leaf (invariant #2 —
  // no sibling-leaf import). The api-side service supplies the real `resolveApproval`; this type
  // only describes the call shape route-as-approval-reply invokes it with. `workspaceId` is passed
  // faithfully by the caller though the current approvals resolve is user-scoped — the injected
  // adapter drops it (the deferred app-wiring maps the wider call to the narrower op).
  resolveApproval: (
    db: Database,
    input: {
      providerApprovalId: string
      userId: string
      workspaceId: string
      providerId: string
      decision: { kind: 'approved' } | { kind: 'denied'; reason: string }
    },
    deps?: { logger?: StructuralLogger },
  ) => Promise<unknown>
}

// Re-export the adapter contract types so core ops import everything
// channels-related from this one module (the canonical definitions live
// in adapters/channel-adapter.ts).
export type {
  BotCredentials,
  VerifyCredentialsResult,
  NormalizedInboundMessage,
  NormalizedMessageStructure,
} from './adapters/channel-adapter.js'

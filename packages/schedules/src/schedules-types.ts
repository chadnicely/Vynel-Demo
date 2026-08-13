// Domain-only types for the `schedules` leaf. Per
// `.claude/rules/structure-standard.md` "packages/schedules/src/".
//
// Spec: `docs/blueprints/schedules/coding.md §3`.

import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'

// The subset of pino the core logs against (matches the chat/channels
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// Deps injected into the fire path by the api-side service. Keeps @vynel/mcp +
// apps/api OUT of packages/schedules (the leaf stays unit-testable with stubs) —
// the chat turn, the MCP composition, and the capability composition are all
// declared STRUCTURALLY here and supplied by the api-side schedules service.
export interface FireScheduleDeps {
  logger?: StructuralLogger
  // Run the headless chat turn for a fired schedule. Injected + typed
  // STRUCTURALLY here (the exact call shape fire-schedule invokes) so the
  // schedules leaf never imports the chat leaf's `startChatTurn` — a leaf→leaf
  // runtime import (invariant #2). The api-side service binds the real one. The
  // stream yields the `ChatTurnEvent` wire union (contracts); the fired turn
  // reads `session-created`/`text-chunk`/`session-errored` off it.
  startChatTurn: (
    db: Database,
    input: {
      userId: string
      workspaceId: string
      workspacePath: string
      providerId: string
      userMessageText: string
      permissionMode: string
      mcpServers: Record<string, unknown>
      deniedToolNames: string[]
      systemPromptAppend: string
      alwaysRequireApprovalToolNames?: string[]
    },
    deps?: { logger?: StructuralLogger },
  ) => AsyncIterable<ChatTurnEvent>
  // The workspace MCP attachment for a fired turn — the route-derived `vynel`
  // server + the deny of a disabled capability's tools. The api-side service
  // binds it to composeSessionMcpServers([vynelWorkspaceDescriptor], …) with
  // the workspace's enabled-capability set, closing over the app.request
  // dispatcher; core never imports @vynel/mcp or the composer. Returns only
  // what the fired turn forwards to startChatTurn.
  composeWorkspaceMcpServers: (input: {
    db: Database
    userId: string
    workspaceId: string
  }) => {
    mcpServers: Record<string, unknown>
    deniedMcpToolPatterns: string[]
    // The feature mutating tools to card even under bypass (additive to the
    // provider's static floor) — forwarded to startChatTurn's alwaysRequireApprovalToolNames.
    mutatingToolNames: string[]
    // The destructive tier — carded ONLY when the fired turn runs in ask mode.
    askModeApprovalToolNames: string[]
    // The MCP composer's per-feature prompt sections (the notebook/tasks
    // standing lines). Joined with composeSessionCapabilities' prompt in the
    // fired turn — previously dropped (the chat-turn divergence, fixed in the
    // ask build).
    systemPromptAppend: string
  }
  // The per-workspace capability PROMPT composition (Vynel rules + enabled-capability
  // contributions like the memory snapshot). The tool-deny gate moved to
  // composeWorkspaceMcpServers in the C4 build. Declared STRUCTURALLY here — core
  // must NOT import composeSessionCapabilities from apps/api. Required — no turn
  // skips composition.
  composeSessionCapabilities: (
    db: Database,
    input: { workspaceId: string },
  ) => {
    systemPromptAppend: string
  }
}

// Domain-only types for the `schedules` leaf. Per
// `.claude/rules/structure-standard.md` "packages/schedules/src/".
//
// Spec: `docs/blueprints/schedules/coding.md §3`.

import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'

// The subset of pino the core logs against (matches the chat/channels
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// The settings a fired turn runs under — `target row ?? DEFAULT` (session-
// hardening D5 shape with no tool arg: the mode / model / effort the user chose
// for the target conversation, else the one default; autopilot off the row,
// D8). Resolved by the api-side binder with the delegated paths' resolver —
// the leaf only declares the shape it forwards to the turn.
export interface FiredTurnSettings {
  permissionMode: string
  model: string | undefined
  thinkingEffort: ThinkingEffortLevel | undefined
  autoBuildout: boolean
}

// The FRAME on a fired prompt (schedule-fire framing, 2026-08-20): an
// unframed fire persisted as the user's own row and read to the model as the
// user typing — a "Remind me for tea" schedule fired as the user ASKING for a
// reminder (the model asked back, then set a `sleep` timer). Composed ONCE per
// fire in `fire-schedule.ts` and applied by both LLM paths: the marker rides
// the PROVIDER input only; the persisted row keeps the plain rendered prompt,
// attributed to the schedule as a quiet system notice.
export interface ScheduleFireFrame {
  /** The model-facing marker ("this is the scheduler firing <name> now …"),
   *  rendered by the injected `renderScheduleFireMarker`. Never persisted. */
  marker: string
  /** The persisted user row's source label — `scheduleSourceLabel(displayName)`
   *  ("Schedule · Tea"), the UI's system-notice author line. */
  sourceLabel: string
}

// Deps injected into the fire path by the api-side service. Keeps @vynel/mcp,
// @vynel/session + apps/api OUT of packages/schedules (the leaf stays
// unit-testable with stubs) — the workspace turn, the global-root turn, the
// settings resolution, the MCP composition, and the capability composition are
// all declared STRUCTURALLY here and supplied by the api-side binder
// (`apps/local-api/src/sessions/build-schedule-fire-deps.ts`), which also
// wraps each turn in its bound + lock (background-turns BT3).
export interface FireScheduleDeps {
  logger?: StructuralLogger
  // Run the headless WORKSPACE turn for a fired schedule. Injected + typed
  // STRUCTURALLY here (the exact call shape fire-schedule invokes) so the
  // schedules leaf never imports the chat leaf's `startChatTurn` — a leaf→leaf
  // runtime import (invariant #2). The api-side binder wraps the real one in
  // the workspace target lock + the delegated hard cap (a capped turn ends by
  // THROWING the cap error after its stream settles). The stream yields the
  // `ChatTurnEvent` wire union (contracts); the fired turn reads
  // `session-created`/`text-chunk`/`session-errored` off it.
  startChatTurn: (
    db: Database,
    input: {
      userId: string
      workspaceId: string
      workspacePath: string
      providerId: string
      userMessageText: string
      /** The MODEL-facing text — the rendered prompt plus the fire marker
       *  (schedule-fire framing). The persisted row keeps `userMessageText`. */
      providerUserMessageText: string
      /** The persisted user row's attribution: the schedule speaking as a
       *  system notice, never the user. */
      messageAttribution: { userSourceKind: 'system'; userSourceLabel: string }
      /** The run this turn belongs to — the binder's log + cap-lever key. */
      scheduleRunId: string
      permissionMode: string
      model?: string
      thinkingEffort?: ThinkingEffortLevel
      /** Autopilot (D8): the binder's runtime appends the per-message marker. */
      autoBuildout?: boolean
      mcpServers: Record<string, unknown>
      deniedToolNames: string[]
      systemPromptAppend: string
      alwaysRequireApprovalToolNames?: string[]
      askModeApprovalToolNames?: string[]
    },
    deps?: { logger?: StructuralLogger },
  ) => AsyncIterable<ChatTurnEvent>
  // Run a GLOBAL-ROOT turn for a fired GLOBAL schedule (null workspaceId,
  // non-verbatim template — background-turns BT1): the rendered prompt is the
  // user message on the user's global conversation. Bound api-side to the same
  // runner channels use (it holds the per-user root-turn lock itself); the
  // binder adds the delegated hard cap. Resolves to the chat session the turn
  // ran on + the answer text; rejects on a failed turn (the run is marked
  // failed). `onSessionResolved` fires as soon as the stream names its session
  // (and again on a mid-turn swap) so the run row can bind it while running.
  startGlobalRootTurn: (
    db: Database,
    input: {
      userId: string
      userMessageText: string
      /** The fire frame: the binder appends `marker` to the PROVIDER input
       *  (the per-message marker seam) and attributes the persisted row as a
       *  system notice under `sourceLabel` — never the user speaking. */
      frame: ScheduleFireFrame
      onSessionResolved?: (chatSessionId: string) => void
    },
  ) => Promise<{ sessionId: string; resultText: string }>
  // Render the model-facing fire marker from the schedule's facts. Injected
  // (api-side: `@vynel/instructions`' `renderScheduleFireMarker`) because the
  // instruction files live in a sibling leaf this one must not import
  // (invariant #2); the leaf owns WHAT is framed, the binder owns the words.
  renderScheduleFireMarker: (input: {
    scheduleDisplayName: string
    /** The fire time already rendered in the schedule's timezone — this
     *  leaf's `formatScheduledTime`, the one home for schedule-time text. */
    firedAtLocal: string
  }) => string
  // The settings a fired WORKSPACE turn runs under — what the user chose for
  // that workspace's continuing conversation (its primary row), else the
  // defaults; the model fit-clamped like every other delegated pick (BT2).
  // Injected so the leaf never imports @vynel/session's resolver.
  resolveWorkspaceTurnSettings: (
    db: Database,
    input: { userId: string; workspaceId: string },
  ) => FiredTurnSettings
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

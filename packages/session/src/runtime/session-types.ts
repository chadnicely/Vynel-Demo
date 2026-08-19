// The session-runtime type surface for `@vynel/session`. Describes the runner
// contract — the sink the runner drives with the unified `ChatTurnEvent` stream.
// Consumed by the runner here (`run-global-root-turn-core.ts`) and by the apps/api
// sink-builders that drive it; the generic `runSessionTurn` (all scopes) lands in a
// later unit.
//
// IMPORTANT — kept OUT of the package barrel (`../index.ts`, which re-exports the
// web-safe mode model ONLY). This module is reached via the `@vynel/session/runtime`
// subpath so `apps/web` (which imports the mode model) never pulls `@vynel/chat` /
// `@vynel/providers` into the web bundle. The `import type` below is erased at
// compile time; bundle-safety comes from the import graph, not the manifest.

import type { Database } from '@vynel/db'
import type {
  AttachedImageBytes,
  ChatTurnEvent,
  StructuralLogger,
  TurnMessageAttribution,
} from '@vynel/chat'
import type {
  AiAgentProvider,
  DiscoveredProviderModel,
  ProviderRateLimitReading,
} from '@vynel/providers'
import type { SessionPermissionMode } from '../session-mode.js'
import type { TurnEventBroadcaster } from '../delegation/turn-event-broadcaster.js'

/**
 * The single per-path divergence axis of a session turn. The runner drives the
 * unified `ChatTurnEvent` stream (translated + persisted by
 * `consumeSessionEventStream`); everything that differs BY DESTINATION — stream to
 * SSE, accumulate for a background drain — lives behind this sink.
 *
 * Error handling is deliberately TWO channels, and they are NOT interchangeable
 * (collapsing them changes the wire bytes — the additive invariant in the migration
 * roadmap):
 * - An in-stream `session-errored` event flows through `onEvent` like any other
 *   event (an SSE sink writes the full event frame; a drain sink captures it). The
 *   stream then ends normally, so `onEnd` still fires.
 * - A THROWN exception (provider/setup failure) is caught by the runner and routed
 *   to `onError`; `onEnd` is NOT reached. An SSE sink writes a minimal
 *   `session-errored` frame here — a DIFFERENT shape from the in-stream event; a
 *   drain sink omits `onError` so the runner re-throws to its caller.
 */
export interface SessionSink {
  /** Called for every `ChatTurnEvent`, in order, as the runner drains the turn. */
  onEvent(event: ChatTurnEvent): void | Promise<void>

  /**
   * Called once after the stream drains cleanly (no thrown exception). An SSE sink
   * emits its `turn-stream-ended` frame here; a drain sink may throw here to surface
   * an in-stream error it captured during `onEvent`.
   */
  onEnd?(): void | Promise<void>

  /**
   * Called when the runner catches a thrown exception — NOT for an in-stream
   * `session-errored` event (that goes through `onEvent`). An SSE sink writes its
   * error frame; a drain sink omits this so the runner re-throws.
   */
  onError?(error: unknown): void | Promise<void>
}

/**
 * The resolved global-root conversation target — what `resolveTarget` returns.
 * Structurally mirrors apps/api's `GlobalRootConversationTarget` (kept structural —
 * the package must not import an apps/api type).
 */
export interface GlobalRootTarget {
  primarySessionId: string
  /** The SDK session the global root currently runs on — resume this. `null` on the
   *  first-ever turn (start fresh, then link). */
  resumeSdkSessionId: string | null
  /** The global root's SDK cwd — the hidden user-data dir (NOT a workspace). */
  workspacePath: string
}

export interface RunGlobalRootTurnCoreDeps {
  db: Database
  logger: StructuralLogger
  /**
   * Resolve (get-or-create) the global root + the SDK session to resume + the SDK
   * cwd, AND ensure the cwd exists on disk. Injected by apps/api (it owns the
   * env-coupled user-data-dir resolution + the get-or-create). Called INSIDE the
   * per-user lock.
   */
  resolveTarget: () => Promise<GlobalRootTarget>
  /** The shared live-turn pub/sub — when present, the turn's events tee onto
   *  its `session:<id>` channel (Watch everywhere, session-library Slice ③).
   *  Omit → sink-only (tests). */
  turnEvents?: TurnEventBroadcaster
  /** Provider override — defaults to the registry singleton. Injected in tests
   *  to drive the whole turn + its boundary continuity without a live SDK (the
   *  `BridgePrimarySessionAfterTurnDeps.provider` precedent). */
  provider?: AiAgentProvider
}

export interface RunGlobalRootTurnCoreInput {
  userId: string
  userMessageText: string
  /** Attachments for this turn — inline base64; sent to the provider + persisted
   *  for re-display under the root's hidden user-data cwd (same D22 layout the
   *  workspace turn uses). */
  attachedImages?: AttachedImageBytes[]
  model?: string
  /** Reasoning effort for this turn (the composer's picker). Omit for the
   *  SDK's adaptive default (background turns). */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** The provider permission mode for the brain's OWN tools this turn (the caller maps
   *  the user-facing `SessionMode` via `toPermissionMode`). Omit → the one default
   *  (`DEFAULT_SESSION_MODE`, `auto` — session-hardening D3). */
  permissionMode?: SessionPermissionMode
  /** The conversation runs on AUTOPILOT (`autoBuildout`, decision D8): the
   *  per-message marker rides the provider input. The callers resolve it
   *  from the row (`input ?? row`) like the other settings. */
  autoBuildout?: boolean
  /** A STABLE id for this turn's inbound user row (a report delivery passes
   *  its job id) so a retried notify turn re-uses the row it already landed
   *  (session-hardening A3c). Omit for a fresh random id. */
  userMessageId?: string
  /** Pre-composed MCP servers (composed by the apps/api caller — composition stays
   *  at the api edge per `api-side-turn-execution-with-mcp`). Opaque to the core. */
  mcpServers: Record<string, unknown>
  /** The composer's capability denials — forwarded to the provider's
   *  deniedToolNames → SDK disallowedTools (removed from the agent). Was
   *  silently dropped on this path before the tool-policy re-plumb. */
  deniedMcpToolPatterns: string[]
  /** Feature-declared mutating tools that card even under bypass (additive to the floor). */
  mutatingToolNames: string[]
  /** The destructive tier — cards ONLY when the root turn runs in ask mode. */
  askModeApprovalToolNames: string[]
  /** The MCP/feature system-prompt contribution; the core prepends the `global-root` instruction. */
  mcpSystemPromptAppend: string
  /** Enabled USER-scope agents (subagents) for this global session, composed at
   *  the api edge (`composeSessionAgents` with a null workspaceId) — same
   *  spawn lifecycle the workspace turn gets. Opaque here; the provider casts
   *  at the SDK edge (the `mcpServers` precedent). */
  agents?: Record<string, unknown>
  /** This turn arrived by VOICE — append the spoken directive: the thread is HEARD
   *  as it writes (short spoken sentences, streamed clause by clause by the voice
   *  clients); the `speak` tool is denied on voice turns (voice-realtime VR1). */
  voice?: boolean
  /** The inbound channel this turn arrived through — stamped on the persisted
   *  user row ("via Voice" / "via Telegram"). Set by the EDGES (the SSE route
   *  maps `voice`, the channel runner its kind); the core only passes it through. */
  originChannel?: 'voice' | 'telegram' | 'discord' | 'zoom'
  /** CHANNEL turn (the channel pipeline, locked 2026-07-27): the per-message
   *  reply instruction — "reply by CALLING reply_to_channel; text is not
   *  delivered". PROVIDER INPUT ONLY (the voice-turn-marker precedent: the
   *  system-prompt block decays on the long root session; recency wins), the
   *  persisted row stays the clean inbound text. Composed at the channels
   *  edge, which knows the sender/group facts. */
  channelReplyMarker?: string
  /** REPORT-DELIVERY notify turn (session-comms): attribute this turn's rows —
   *  the inbound message reads as coming FROM the reporting child
   *  ('workspace-manager' + its label), trace-keyed. Omit → rows stay null
   *  (every shipped turn, byte-for-byte). */
  messageAttribution?: TurnMessageAttribution
  /** REPORT-DELIVERY notify turn: an extra steer appended to the system prompt
   *  (absorb the report; act if needed; never re-run the work). Omit → the
   *  shipped prompt, byte-for-byte. */
  steerPromptAppend?: string
  /** Model-roster discovery (best-effort): forwarded to the provider; the
   *  caller persists the roster the engine reports. See `StartChatTurnInput`. */
  onModelsDiscovered?: (models: DiscoveredProviderModel[]) => void | Promise<void>
  /** Subscription-limit reporting (best-effort, the same shape): forwarded to
   *  the provider; the caller persists the reading per window. */
  onRateLimitReported?: (reading: ProviderRateLimitReading) => void | Promise<void>
  /** Context-pressure threshold override for the post-turn swap (default
   *  0.85). The apps edge forwards `VYNEL_CONTEXT_PRESSURE_THRESHOLD` (the
   *  live-smoke knob) — the core stays env-free. */
  pressureThreshold?: number
  /** False for a DELIVERY turn (a report / update / note the root absorbs —
   *  never work): no mid-turn context nudge, and a checkpoint the model still
   *  leaves is dropped instead of continued (session-continuity §4.6). Omit
   *  (true) for every genuine turn — the user's, a channel's. */
  autoContinue?: boolean
}

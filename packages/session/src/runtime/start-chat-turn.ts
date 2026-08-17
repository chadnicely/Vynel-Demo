// The SSE entry point — loads attached images, resolves the provider, kicks
// off the chat session, and yields UI-bound events as the consumer
// translates them. The HTTP route consumes the iterable via Hono's
// streamSSE.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.1`.
//
// Three locked behaviors:
// 1. The user-message INPUT is constructed here (Vynel UUID pre-assigned
//    so optimistic client UI can echo the id) but the row is INSERTED by
//    consume-session-event-stream's `session-started` handler — co-
//    committed with the chat_sessions row so the FK target exists for
//    new sessions, or inserted immediately for resumed sessions where the
//    session row already exists.
// 2. The provider is resolved per-op (D23) — the registry singleton makes
//    this O(1).
// 3. Attached images arrive inline (base64) and go straight to the provider;
//    the bytes are persisted to `.vynel/transcripts/<sessionId>/images/` by the
//    consumer once the session id resolves (D22 — chat owns that layout).

import { resolveAiAgentProvider } from '@vynel/providers'
import type { Database } from '@vynel/db'
import type {
  AiAgentProviderId,
  ChatMessageImage,
  ClaudePermissionMode,
  DiscoveredProviderModel,
} from '@vynel/providers'
import {
  consumeSessionEventStream,
  attachedImagesMetadataFor,
  type AttachedImageBytes,
  type ChatTurnEvent,
  type NewSessionOptions,
  type StructuralLogger,
  type TurnMessageAttribution,
} from '@vynel/chat'
import { buildCompactionCapture, buildContextNudge } from '../continuity/index.js'
import type { TurnEventBroadcaster } from '../delegation/turn-event-broadcaster.js'
import { publishTurnEventsToSessionChannel } from './session-turn-channel.js'
import { withBoundaryContinuity } from './with-boundary-continuity.js'

export type StartChatTurnInput = {
  userId: string
  /** The identity's OWN ground: a workspace turn's workspace; a spawned
   *  session's or colleague's grounding workspace (null when global-grounded)
   *  — the same value its delegated runner passes, so its rows, approvals and
   *  swap segments file under the room that owns it. */
  workspaceId: string | null
  workspacePath: string
  providerId: AiAgentProviderId
  /** Omit to start a new session; provide to resume an existing one. */
  resumeSessionId?: string
  userMessageText: string
  /**
   * PROVIDER INPUT ONLY — what the model reads when it differs from the
   * persisted body (the voice-marker precedent). A continuation turn persists
   * a short "continuing after patching context" row and hands the model the
   * fuller instruction. Omit → the model reads `userMessageText`.
   */
  providerUserMessageText?: string
  /**
   * The persisted rows' attribution when the turn is not the user speaking as
   * themselves — a continuation turn's row is "from Vynel". Omit → the plain
   * user shape (unchanged).
   */
  messageAttribution?: TurnMessageAttribution
  /** Images attached to this turn — inline base64; sent to the provider + persisted for re-display. */
  attachedImages?: AttachedImageBytes[]
  /** The model to run this turn (per-chat picker). Omit to inherit the CLI default. */
  model?: string
  /** Reasoning effort for this turn (the composer's picker). Omit = Auto. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Provider permission mode (the route maps the user-facing `SessionMode`
   *  here via `@vynel/session`'s `toPermissionMode`). Forwarded to the provider. */
  permissionMode: ClaudePermissionMode
  /**
   * Optional MCP servers to register with the underlying SDK call.
   * Per `docs/blueprints/mcp/` D2 + D5: caller (apps/api chat route)
   * constructs the in-process server via `@vynel/mcp.buildInProcessMcpServer`
   * and passes the pre-built instance — chat just forwards.
   */
  mcpServers?: Record<string, unknown>
  /** Composed system-prompt append (Vynel rules + enabled-capability contributions). Forwarded to the provider. */
  systemPromptAppend?: string
  /** MCP tool names to deny — a disabled capability's tools. Forwarded to the provider's deniedToolNames -> SDK disallowedTools (removed from the agent). */
  deniedToolNames?: string[]
  /**
   * Enabled agents (subagents) for this session, composed by
   * `composeSessionAgents` (`@vynel/orchestration`). Forwarded verbatim
   * to the provider's `StartChatSessionInput.agents` → `query({ agents })`.
   * `Record<string, unknown>` keeps the SDK type out of the chat layer.
   */
  agents?: Record<string, unknown>
  /**
   * Tool names that MUST card even under a bypass mode — the per-turn feature
   * mutating set (`composeSessionMcpServers`' `mutatingToolNames`). Forwarded
   * verbatim to the provider's `alwaysRequireApprovalToolNames` (ADDITIVE to the static
   * floor). See the C4 seam.
   */
  alwaysRequireApprovalToolNames?: string[]
  /**
   * The destructive tier (`composeSessionMcpServers`' `askModeApprovalToolNames`)
   * — cards ONLY when the turn runs in ask mode. Forwarded verbatim.
   */
  askModeApprovalToolNames?: string[]
  /**
   * Presentation overrides for a session row created MID-TURN — an SDK
   * compaction swap on a resumed spawned session keeps the stock hidden
   * presentation (the `delegateToSpawnedSession` shape). Omitted by the
   * workspace path → defaults (`'listed'`, auto-titled).
   */
  newSessionOptions?: NewSessionOptions

  /**
   * Model-roster discovery (best-effort, the `onCompaction` shape): called
   * with the models the engine reports once the session starts. The caller
   * persists the roster (feeds the model picker); forwarded verbatim to the
   * provider. A failure never affects the turn.
   */
  onModelsDiscovered?: (models: DiscoveredProviderModel[]) => void | Promise<void>
  /**
   * The CONTINUING identity this turn runs as, when there is one (a workspace's
   * primary conversation, a spawned session / colleague DM'd directly). Turns
   * the boundary continuity step on: after the turn's events the stream carries
   * `context-patching` / `context-patched` around the seed-fresh swap, inside
   * the session-channel tee so Watch sees it too (`with-boundary-continuity.ts`).
   * Omit for a plain conversation (opened by id / started fresh) — it neither
   * swaps nor carries context.
   */
  continuity?: {
    primarySessionId: string
    /** Pressure threshold override (the env smoke knob); omit for 0.85. */
    threshold?: number
  }
}

export type StartChatTurnDeps = {
  logger?: StructuralLogger
  /** The shared live-turn pub/sub — when present, the turn's events tee onto
   *  its `session:<id>` channel so ANY observer can Watch it (session-library
   *  Slice ③). Omit → stream-only (tests, callers without live observers). */
  turnEvents?: TurnEventBroadcaster
}

export async function* startChatTurn(
  db: Database,
  input: StartChatTurnInput,
  deps: StartChatTurnDeps = {},
): AsyncIterable<ChatTurnEvent> {
  const userMessageId = crypto.randomUUID()
  const attachedImages = input.attachedImages ?? []

  // 1. Attachments reach the provider INLINE as base64 — it writes its own temp
  //    files + inlines `[Image: path]` / `[Attached file: path]` into the prompt
  //    (handle-attached-images). The DB row stores only references
  //    (filename/mimeType/sizeBytes); the bytes are persisted to
  //    `<workspace>/.vynel/transcripts/<sessionId>/images/` by the consumer once
  //    the real session id exists (D22 + attached-images.ts).
  const attachedImagesMetadata = attachedImagesMetadataFor(attachedImages)
  const chatMessageImages: ChatMessageImage[] | undefined =
    attachedImages.length > 0 ? attachedImages : undefined

  // 2. Resolve provider + start the underlying session. Conditional spread
  //    for optional fields per `exactOptionalPropertyTypes` (MEMORY foot-gun).
  const provider = resolveAiAgentProvider(input.providerId)
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.workspacePath,
    ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
    userMessageText: input.providerUserMessageText ?? input.userMessageText,
    ...(chatMessageImages !== undefined ? { attachedImages: chatMessageImages } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
    permissionMode: input.permissionMode,
    allowedToolNames: [],
    deniedToolNames: input.deniedToolNames ?? [],
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    ...(input.mcpServers !== undefined ? { mcpServers: input.mcpServers } : {}),
    ...(input.systemPromptAppend !== undefined
      ? { systemPromptAppend: input.systemPromptAppend }
      : {}),
    ...(input.agents !== undefined ? { agents: input.agents } : {}),
    ...(input.alwaysRequireApprovalToolNames !== undefined
      ? { alwaysRequireApprovalToolNames: input.alwaysRequireApprovalToolNames }
      : {}),
    ...(input.askModeApprovalToolNames !== undefined
      ? { askModeApprovalToolNames: input.askModeApprovalToolNames }
      : {}),
    // Session-continuity Layer 1 (Q2): the best-effort compaction-capture
    // bridge. If the SDK auto-compacts, the provider's PostCompact hook
    // calls this, which records the summary via the session.compacted
    // outbox event. Dormant-but-correct: a no-op until a primary_session is
    // linked to this SDK session (the swap unit) AND the SDK fires
    // PostCompact. Layer 2 (the explicit swap) does NOT depend on it.
    onCompaction: buildCompactionCapture(db, deps.logger !== undefined ? { logger: deps.logger } : {}),
    // The mid-turn context nudge rides only a CONTINUING identity's turns (a
    // plain conversation neither swaps nor continues) — one nudge per turn,
    // armed at the same threshold the boundary swap uses.
    ...(input.continuity !== undefined
      ? {
          onToolResultContext: buildContextNudge(
            input.continuity.threshold !== undefined ? { threshold: input.continuity.threshold } : {},
          ),
        }
      : {}),
    ...(input.onModelsDiscovered !== undefined
      ? { onModelsDiscovered: input.onModelsDiscovered }
      : {}),
  })

  // 3. Consume the normalized events; consumer persists the user message in the
  //    session-started handler (FK-safe), writes the image bytes to disk once
  //    the session id exists, and yields UI events — teed onto the session's
  //    live channel when a broadcaster is wired (Watch everywhere).
  const turnStream = consumeSessionEventStream({
    db,
    sessionEventStream,
    userMessageInput: {
      id: userMessageId,
      body: input.userMessageText,
      attachedImagesMetadata,
      ...(attachedImages.length > 0 ? { attachedImages } : {}),
    },
    userId: input.userId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    providerId: input.providerId,
    isNewSession: !input.resumeSessionId,
    // Durability-first: a resumed turn's user row persists before provider
    // startup (the unbounded hang point), so a stuck start never loses it.
    ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.newSessionOptions !== undefined ? { newSessionOptions: input.newSessionOptions } : {}),
    ...(input.messageAttribution !== undefined ? { messageAttribution: input.messageAttribution } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  })
  // 4. A continuing identity gets its boundary continuity ON the stream — the
  //    wrapper announces the swap as events, so it must sit INSIDE the tee.
  const continuedStream =
    input.continuity !== undefined
      ? withBoundaryContinuity(
          turnStream,
          {
            primarySessionId: input.continuity.primarySessionId,
            priorSdkSessionId: input.resumeSessionId ?? null,
            userId: input.userId,
            workspacePath: input.workspacePath,
            providerId: input.providerId,
            ...(input.continuity.threshold !== undefined
              ? { threshold: input.continuity.threshold }
              : {}),
          },
          { db, provider, ...(deps.logger !== undefined ? { logger: deps.logger } : {}) },
        )
      : turnStream
  yield* deps.turnEvents !== undefined
    ? publishTurnEventsToSessionChannel(continuedStream, deps.turnEvents)
    : continuedStream
}

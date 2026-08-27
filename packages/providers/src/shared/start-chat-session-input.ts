// `StartChatSessionInput` + `ChatMessageImage` — the input shape for starting
// (or resuming) a chat session on a provider.
// See `docs/blueprints/providers/blueprint.md §7.1`.

export type ChatMessageImage = {
  /** Original filename — when present the temp file keeps it, so the agent
   *  sees "report.pdf", not a UUID. Display-name only; sanitized before use. */
  filename?: string
  mimeType: string
  base64Data: string
}

/**
 * Permission mode for a session. Maps to the Agent SDK `permissionMode`.
 * - `ask` — carding tools raise an approval card (SDK `default`); every MCP
 *   tool outside the declared card tiers resolves allow from the policy map
 *   in `canUseTool` (`tool-approval-policy.ts`).
 * - `auto` — NOTHING cards (SDK `auto`): no Vynel floor, and `canUseTool`
 *   allows outright, so not even a classifier escalation can park a turn
 *   (Kafi 2026-08-11). Still not SDK `bypassPermissions`, so an outright
 *   provider refusal stands.
 * - `bypass` — nothing cards, ever (SDK `bypassPermissions`; `canUseTool` is
 *   not even bound). The USER's explicit composer pick only (Chad,
 *   2026-07-30: bypass means bypass).
 * - `bypass-with-behavior-gate` — tools run silently except the irreversible
 *   floor + declared mutating set, which card via `canUseTool` (SDK
 *   `default` + the policy map; the PreToolUse backstop still rescues
 *   skip-mode subagents). The UNATTENDED default (schedules, delegated
 *   leaves, report delivery) — a background turn carries no user trust pick,
 *   so the floor holds.
 * - `plan-only` — the agent plans but does not execute tools (SDK `plan`).
 *
 * The single source of truth for the session permission mode — the SDK-options
 * builder + the canUseTool callback import this rather than re-declaring it.
 */
export type ClaudePermissionMode =
  | 'ask'
  | 'auto'
  | 'bypass'
  | 'bypass-with-behavior-gate'
  | 'plan-only'

/**
 * The mode, or a way to READ the mode. The approval gates take this rather
 * than a plain value because the mode can change mid-turn (Chad, 2026-08-25:
 * a switch to Ask has to card the very next tool call, not the next turn) —
 * a captured value would keep gating on the mode the turn started in.
 */
export type PermissionModeSource = ClaudePermissionMode | (() => ClaudePermissionMode)

export function readPermissionMode(source: PermissionModeSource): ClaudePermissionMode {
  return typeof source === 'function' ? source() : source
}

export type StartChatSessionInput = {
  /** Workspace folder path — becomes the agent's cwd. */
  workspacePath: string

  /** If provided, resumes an existing session. If absent, starts fresh. */
  resumeSessionId?: string

  /** The user's message that begins this turn. */
  userMessageText: string

  /** Optional images attached to the message. */
  attachedImages?: ChatMessageImage[]

  /** The Claude model to run (e.g. 'claude-opus-4-8'). Omit to inherit the
   *  Claude Code CLI default. Maps to the Agent SDK `options.model`. */
  model?: string

  /** Reasoning effort for this turn (the composer's picker). Maps to the
   *  Agent SDK `options.effort`; the SDK silently downgrades a level the
   *  model doesn't support. Omit (background turns) for the SDK's adaptive
   *  default. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'

  /** Turn extended thinking OFF for this turn entirely (the voice lean tier:
   *  on a spoken surface the first syllable beats reasoning depth, and a
   *  thought block is pure dead air). When true the runtime runs with thinking
   *  disabled and `thinkingEffort` is NOT sent (effort only guides thinking
   *  depth, and some models reject it without thinking). Omit = the runtime's
   *  default thinking behavior, byte-for-byte. */
  disableThinking?: boolean

  /** Permission mode for this session — see `ClaudePermissionMode`. */
  permissionMode: ClaudePermissionMode

  /**
   * What the runtime loads from the HOST machine (voice-lean tier, 2026-08-27).
   * `'full'` (the default, every shipped caller) — the runtime reads the
   * user's and workspace's own Claude configuration (CLAUDE.md, settings) and
   * attaches its native toolset. `'none'` — a bare runtime: no host
   * configuration is read and no native tools attach; the session's tools are
   * exactly the MCP servers the caller registers. The spoken thread runs bare:
   * its identity is Vynel's own prompt, and host files are foreign text on a
   * latency-critical surface.
   */
  hostResources?: 'full' | 'none'

  /** Allowed tool names — empty array means "use runtime defaults". */
  allowedToolNames: string[]

  /** Denied tool names — always denied regardless of session state. */
  deniedToolNames: string[]

  /**
   * Optional structural logger for session-event logging. A structural shape
   * (not a `@vynel/logger` import) per the MEMORY "structural-logger pattern"
   * precedent — `@vynel/logger` is still an empty placeholder.
   */
  logger?: {
    info(payload: object, message?: string): void
    warn(payload: object, message?: string): void
  }

  /**
   * Optional MCP servers to register with the underlying Claude SDK
   * `query()` call. Per `docs/blueprints/mcp/decisions.md` D2 + D5,
   * the caller constructs the in-process server (or external HTTP
   * client) and passes the pre-built instance here; providers forwards
   * verbatim into the SDK options without knowing about `@vynel/mcp`.
   * Type is `unknown` to avoid pulling the SDK type into this contract.
   */
  mcpServers?: Record<string, unknown>

  /**
   * Vynel's whole standing prompt: the identity stack (base + kind, composed by
   * `composeSessionInstruction`) plus, per enabled capability, its "how to use"
   * instruction + context snapshot. Composed by the caller; the provider sends
   * it as the runtime's CUSTOM system prompt — Claude Code's preset is not used
   * (2026-08-26; `docs/module-notes/instructions/`). The runtime still frames
   * it with its own one-line identity, hence "append". Applies every turn,
   * incl. resumed sessions.
   */
  systemPromptAppend?: string

  /**
   * Enabled agents (subagents) for this session — the SDK
   * `Record<string, AgentDefinition>` passed to `query({ agents })`, making
   * each agent invokable via the Agent tool. Composed by the caller
   * (`composeSessionAgents` in `@vynel/orchestration`) and forwarded
   * verbatim. Type is `Record<string, unknown>` to keep the SDK type out of
   * this contract — same pattern as `mcpServers` (the agent-base
   * `orchestration` piece). Every irreversible (sub)agent tool call still
   * cards via the always-on PreToolUse backstop in `buildClaudeSdkOptions`.
   */
  agents?: Record<string, unknown>

  /**
   * Tool names that MUST card EVEN under a bypass permission mode — UNIONED with
   * the provider's static floor (Bash/Write/Edit/NotebookEdit). Lets a feature's
   * destructive MCP tool (e.g. the desktop `act_on_app`) card automatically once
   * it declares itself in its descriptor's `mutatingToolNames`. ADDITIVE — the
   * provider never removes the static floor, so a missing value cannot drop
   * today's carding. Composed by the caller (`composeSessionMcpServers`). See
   * the C4 seam + `build-claude-pre-tool-use-hook`.
   */
  alwaysRequireApprovalToolNames?: string[]

  /**
   * Tool names that card ONLY in `ask` mode — the destructive tier (deletes and
   * purges) of a feature's MCP surface. Enforced by the `canUseTool` policy map
   * (every MCP call reaches the callback now that no wildcard pre-approves
   * them) and by the PreToolUse backstop for skip-mode subagents; in
   * auto/bypass they run uncarded, per the approval stance. Composed by the
   * caller (`composeSessionMcpServers`).
   */
  askModeApprovalToolNames?: string[]

  /**
   * Session-continuity Layer 1 (best-effort bonus). When provided, the
   * provider binds a `PostCompact` hook that calls this with the SDK's
   * compaction summary IF the SDK auto-compacts. The caller (chat-core)
   * routes it to `captureCompactionSummary` (which emits the
   * `session.compacted` outbox event). Per-session dep — the `canUseTool`
   * flow precedent (NOT on the `AiAgentProvider` signature; CEO Q2,
   * 2026-06-21). Structural shape (no SDK/core type leak into this
   * contract). Layer 2 (the explicit swap) is the PRIMARY continuity
   * mechanism and must NOT depend on this firing.
   */
  onCompaction?: (capture: { sdkSessionId: string; summary: string }) => void | Promise<void>

  /**
   * MID-TURN context channel (session-continuity's nudge). Called after every
   * tool result on the main thread with the session's live context occupancy
   * (the last assistant request's input side + the model); return a line to
   * deliver to the model beside the tool result, or null to say nothing. A
   * long agentic turn has no next user message to ride, so this is the only
   * way to tell the model it crossed the swap threshold while it works.
   * Structural (no core type leak); best-effort inside the provider.
   */
  onToolResultContext?: (state: { usedTokens: number; model: string | null }) => string | null

  /**
   * Model-roster discovery (best-effort bonus, the `onCompaction` shape).
   * When provided, the provider reads the runtime's initialize response once
   * the session starts and calls this with the models the engine actually
   * supports. The caller persists the roster (it feeds the model picker);
   * a failure must never affect the turn. Structural type — providers stays
   * contracts-free (the model/mode precedent).
   */
  onModelsDiscovered?: (models: DiscoveredProviderModel[]) => void | Promise<void>

  /**
   * Subscription-limit reporting (best-effort bonus, the `onModelsDiscovered`
   * shape). When provided, the provider calls this each time the runtime
   * announces the account's rate-limit state mid-stream — the popup's Limits
   * tab persists the latest reading per window. Identity metadata riding the
   * stream Vynel already consumes; never a credential (D14). A failure must
   * never affect the turn. Structural type — providers stays contracts-free.
   */
  onRateLimitReported?: (reading: ProviderRateLimitReading) => void | Promise<void>
}

/** One rate-limit reading the runtime reports — structurally identical to the
 *  snapshot the caller persists (providers deliberately doesn't import it). */
export type ProviderRateLimitReading = {
  /** The provider's window vocabulary ('five_hour', 'seven_day', …). */
  windowKind: string
  status: 'allowed' | 'allowed_warning' | 'rejected'
  /** Percent of the window used (0–100). Null when the runtime didn't say. */
  utilization: number | null
  resetsAt: Date | null
}

/** One model the runtime reports — structurally identical to the contracts'
 *  `DiscoveredChatModel` (providers deliberately doesn't import contracts). */
export type DiscoveredProviderModel = {
  /** The canonical wire id (`claude-…`). */
  id: string
  label: string
  description: string | null
  supportedEffortLevels: ('low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null
}

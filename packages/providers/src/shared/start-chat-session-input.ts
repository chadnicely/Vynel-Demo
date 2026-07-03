// `StartChatSessionInput` + `ChatMessageImage` — the input shape for starting
// (or resuming) a chat session on a provider.
// See `docs/blueprints/providers/blueprint.md §7.1`.

export type ChatMessageImage = {
  mimeType: string
  base64Data: string
}

/**
 * Permission mode for a session. Maps to the Agent SDK `permissionMode`.
 * - `ask` — every tool use triggers an approval card (SDK `default`).
 * - `auto` — Anthropic's safety classifier auto-approves/denies each action
 *   (SDK `auto`); the irreversible floor still cards via the PreToolUse backstop.
 * - `bypass-with-behavior-gate` — tools run silently except the irreversible
 *   floor, which still cards (SDK `bypassPermissions` + the backstop).
 * - `plan-only` — the agent plans but does not execute tools (SDK `plan`).
 *
 * The single source of truth for the session permission mode — the SDK-options
 * builder + the canUseTool callback import this rather than re-declaring it.
 */
export type ClaudePermissionMode = 'ask' | 'auto' | 'bypass-with-behavior-gate' | 'plan-only'

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

  /** Permission mode for this session — see `ClaudePermissionMode`. */
  permissionMode: ClaudePermissionMode

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
   * Tool-name patterns (e.g. `'mcp__vynel__*'`) added to the SDK's
   * `allowedTools` list alongside `allowedToolNames`. Lets the
   * caller auto-allow an entire MCP server's tools without listing
   * each one. Per `docs/blueprints/mcp/blueprint.md` Q3 resolution +
   * the Claude Agent SDK MCP docs.
   */
  allowedMcpToolPatterns?: string[]

  /**
   * Text appended to the Claude Code preset system prompt
   * (`systemPrompt.append`). Carries Vynel's always-on operating rules plus,
   * per enabled capability, its "how to use" instruction + context snapshot.
   * Composed by the caller (apps/api session-build); providers forwards it
   * verbatim into the SDK options. Applies every turn, incl. resumed sessions.
   * See `.claude/plans/capability-platform.md`.
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
   * the provider's static floor (Bash/Write/Edit/NotebookEdit + the route-derived
   * memory write). Lets a feature's destructive MCP tool (e.g. the desktop
   * `act_on_app`) card automatically once it declares itself in its descriptor's
   * `mutatingToolNames`. ADDITIVE — the provider never removes the static floor,
   * so a missing value cannot drop today's carding. Composed by the caller
   * (`composeSessionMcpServers`). See the C4 seam + `build-claude-pre-tool-use-hook`.
   */
  alwaysRequireApprovalToolNames?: string[]

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
}

// `buildClaudeSdkOptions` — assembles the `@anthropic-ai/claude-agent-sdk`
// `Options` object for a chat session from a `StartChatSessionInput`'s
// session-shaping fields. `canUseTool` is bound separately by
// `runClaudeChatSession` after this returns (blueprint §11.2).
// See `docs/blueprints/providers/blueprint.md §11.5`.

import type { HookCallback, Options } from './claude-agent-sdk.js'
import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import { buildClaudePreToolUseHook } from '../approvals/build-claude-pre-tool-use-hook.js'

export type BuildClaudeSdkOptionsInput = {
  workspacePath: string
  resumeSessionId?: string
  /** The Claude model to run (Agent SDK `options.model`). Omit for the CLI default. */
  model?: string
  permissionMode: ClaudePermissionMode
  allowedToolNames: string[]
  deniedToolNames: string[]
  /**
   * Pre-built MCP servers (per-session — see `docs/blueprints/mcp/`
   * D5). Caller constructs via `@vynel/mcp.buildInProcessMcpServer`;
   * forwarded verbatim into the SDK `Options.mcpServers`.
   */
  mcpServers?: Options['mcpServers']
  /**
   * Allowed-tool patterns specific to MCP servers (e.g.
   * `'mcp__vynel__*'`). Appended to `allowedToolNames` before being
   * sent to the SDK.
   */
  allowedMcpToolPatterns?: string[]
  /**
   * Text appended to the Claude Code preset system prompt
   * (`systemPrompt.append`). Vynel's operating rules + per-enabled-capability
   * instructions/snapshot, composed by the caller. See
   * `.claude/plans/capability-platform.md`.
   */
  systemPromptAppend?: string
  /**
   * Enabled agents → SDK `options.agents` (`Record<string, AgentDefinition>`).
   * Typed as the SDK's `Options['agents']` here (same pattern as
   * `mcpServers`); the `StartChatSessionInput` contract keeps the looser
   * `Record<string, unknown>` and `run-claude-chat-session` casts at the
   * boundary.
   */
  agents?: Options['agents']
  /**
   * Optional PostCompact hook (session-continuity Layer 1). When provided,
   * it is registered in `options.hooks` ALONGSIDE the always-on PreToolUse
   * backstop, so the SDK fires it when a session auto-compacts. Built +
   * bound per-session by the caller (the stateful pattern `canUseTool`
   * uses), via `buildClaudePostCompactHook`. The caller→core bridge that
   * supplies the callback is a flagged fork — see OVERNIGHT-STATUS.
   */
  postCompactHook?: HookCallback
  /**
   * Per-turn feature mutating tools, forwarded to the PreToolUse backstop and
   * UNIONED with the static floor there. ADDITIVE; the floor always cards.
   */
  alwaysRequireApprovalToolNames?: ReadonlySet<string>
}

// Vynel permission mode -> SDK `PermissionMode`. `bypass-with-behavior-gate`
// maps to the SDK's `bypassPermissions` (read-only tools run silently; the
// behavior gate lives in `buildClaudeCanUseToolCallback`). `auto` maps to the
// SDK's `auto` — Anthropic's safety classifier gates each action; the
// irreversible floor still cards via the always-on PreToolUse backstop (below).
const SDK_PERMISSION_MODE = {
  ask: 'default',
  auto: 'auto',
  'bypass-with-behavior-gate': 'bypassPermissions',
  'plan-only': 'plan',
} as const

export function buildClaudeSdkOptions(input: BuildClaudeSdkOptionsInput): Options {
  const sdkPermissionMode = SDK_PERMISSION_MODE[input.permissionMode]

  const options: Options = {
    cwd: input.workspacePath,
    permissionMode: sdkPermissionMode,
    // Streaming deltas are required — `translateClaudeSdkEvent` maps
    // `SDKPartialAssistantMessage` events into text/thinking chunks.
    includePartialMessages: true,
    // Load the workspace's own settings + CLAUDE.md so Vynel wraps Claude
    // Code as the user experiences it (Implement decision — blueprint §11.5
    // gave only the input shape).
    settingSources: ['user', 'project', 'local'],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      ...(input.systemPromptAppend !== undefined ? { append: input.systemPromptAppend } : {}),
    },
    // The can't-be-skipped safety backstop (always on, every session). A
    // PreToolUse hook fires for EVERY tool call — including a subagent in a
    // bypass permission mode that would skip `canUseTool` — and forces
    // irreversible tools back through the approval card. See
    // `build-claude-pre-tool-use-hook.ts`. Stateless, so it lives here in
    // the static options; `canUseTool` (stateful) is bound in
    // `run-claude-chat-session`.
    //
    // SAFETY-CRITICAL: this PROGRAMMATIC hook survives a workspace
    // `.claude/settings.json` with `disableAllHooks: true` — verified by a
    // live smoke (2026-06-21). `settingSources` (below) loads workspace
    // settings, but `disableAllHooks` suppresses only SETTINGS-FILE hooks,
    // not hooks passed in `options.hooks`. Do not move this hook into a
    // settings file; do not assume `disableAllHooks` can turn it off.
    hooks: {
      PreToolUse: [
        { hooks: [buildClaudePreToolUseHook(input.permissionMode, input.alwaysRequireApprovalToolNames)] },
      ],
      // Session-continuity Layer 1: capture the compaction summary. Only
      // registered when the caller supplies the (stateful) hook — same
      // site as PreToolUse, per the session-continuity brief.
      ...(input.postCompactHook !== undefined
        ? { PostCompact: [{ hooks: [input.postCompactHook] }] }
        : {}),
    },
  }

  if (input.resumeSessionId !== undefined) {
    options.resume = input.resumeSessionId
  }
  if (input.model !== undefined) {
    options.model = input.model
  }
  // The SDK requires this acknowledgement flag whenever bypassPermissions is set.
  if (sdkPermissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true
  }
  // Merge MCP tool patterns with the existing allowedToolNames before
  // emitting. The SDK's `allowedTools` is a single string[]; we accept
  // them in two inputs for clarity at the caller (chat-time tool names
  // vs MCP server wildcards).
  const mergedAllowed = [...input.allowedToolNames, ...(input.allowedMcpToolPatterns ?? [])]
  if (mergedAllowed.length > 0) {
    options.allowedTools = mergedAllowed
  }
  if (input.deniedToolNames.length > 0) {
    options.disallowedTools = input.deniedToolNames
  }
  if (input.mcpServers !== undefined) {
    options.mcpServers = input.mcpServers
  }
  if (input.agents !== undefined) {
    options.agents = input.agents
  }

  return options
}

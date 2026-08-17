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
  /** Reasoning effort (Agent SDK `options.effort`). Omit for the adaptive default. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode: ClaudePermissionMode
  allowedToolNames: string[]
  deniedToolNames: string[]
  /**
   * Pre-built MCP servers (per-session — see `docs/blueprints/mcp/`
   * D5). Caller constructs via `@vynel/mcp.buildInProcessMcpServer`;
   * forwarded verbatim into the SDK `Options.mcpServers`. Deliberately NO
   * `mcp__<server>__*` allow patterns ride along: a bare `allowedTools`
   * entry auto-approves the whole server UPSTREAM of `canUseTool`
   * (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), which silently un-gated every MCP
   * tool in ask mode. MCP calls now fall through to the callback, where
   * `tool-approval-policy.ts` decides allow-vs-card from the declared tiers.
   */
  mcpServers?: Options['mcpServers']
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
   * Optional PostToolUse hook (session-continuity's mid-turn context channel):
   * delivers a line of `additionalContext` to the model after a tool result.
   * Built + bound per-session by the caller (`buildClaudePostToolUseHook`).
   */
  postToolUseHook?: HookCallback
  /**
   * Per-turn feature mutating tools, forwarded to the PreToolUse backstop and
   * UNIONED with the static floor there. ADDITIVE; the floor always cards.
   */
  alwaysRequireApprovalToolNames?: ReadonlySet<string>
  /**
   * Per-turn destructive tier — cards under `ask`/`plan-only`, enforced by
   * the canUseTool policy map (every MCP call reaches the callback now) and
   * rescued for skip-mode subagents by the same PreToolUse backstop. See
   * `tool-approval-policy.ts`.
   */
  askModeApprovalToolNames?: ReadonlySet<string>
}

// Vynel permission mode -> SDK `PermissionMode`.
// - `bypass` (the user's composer pick) is the ONLY `bypassPermissions`
//   mapping left: nothing cards there, `canUseTool` is genuinely dead (the
//   runner does not bind it), so the SDK's shadowed-callback warning cannot
//   fire.
// - `bypass-with-behavior-gate` now maps to `default` (was
//   `bypassPermissions`): with no MCP wildcards in `allowedTools`, every
//   tool call falls through to `canUseTool`, whose policy map allows
//   everything except the floor + declared mutating set — the SAME net
//   behavior the bypassPermissions+backstop pair produced, minus the SDK
//   warning, and with `canUseTool` live for the floor without needing the
//   hook's rescue on the main session (the hook still rescues subagents).
// - `auto` maps to the SDK's `auto` and raises NO Vynel card at all
//   (Kafi 2026-08-11) — note it is still NOT the SDK's `bypassPermissions`,
//   so whatever the provider's own classifier refuses outright it still
//   refuses.
const SDK_PERMISSION_MODE = {
  ask: 'default',
  auto: 'auto',
  bypass: 'bypassPermissions',
  'bypass-with-behavior-gate': 'default',
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
    // Without this the SDK forwards only a subagent's tool_use/tool_result;
    // its streamed TEXT never leaves the CLI — the reason an agent's work was
    // invisible beyond a bare tool card. The translator marks every subagent
    // event with `parentToolUseId` so it renders nested under the spawning
    // Agent card, never merged into the main transcript.
    forwardSubagentText: true,
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
        {
          hooks: [
            buildClaudePreToolUseHook(
              input.permissionMode,
              input.alwaysRequireApprovalToolNames,
              input.askModeApprovalToolNames,
            ),
          ],
        },
      ],
      // Session-continuity Layer 1: capture the compaction summary. Only
      // registered when the caller supplies the (stateful) hook — same
      // site as PreToolUse, per the session-continuity brief.
      ...(input.postCompactHook !== undefined
        ? { PostCompact: [{ hooks: [input.postCompactHook] }] }
        : {}),
      // Session-continuity's mid-turn nudge: a line of context after a tool
      // result. Only registered when the caller supplied the callback.
      ...(input.postToolUseHook !== undefined
        ? { PostToolUse: [{ hooks: [input.postToolUseHook] }] }
        : {}),
    },
  }

  if (input.resumeSessionId !== undefined) {
    options.resume = input.resumeSessionId
  }
  if (input.model !== undefined) {
    options.model = input.model
  }
  if (input.thinkingEffort !== undefined) {
    options.effort = input.thinkingEffort
  }
  // The SDK requires this acknowledgement flag whenever bypassPermissions is set.
  if (sdkPermissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true
  }
  if (input.allowedToolNames.length > 0) {
    options.allowedTools = input.allowedToolNames
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

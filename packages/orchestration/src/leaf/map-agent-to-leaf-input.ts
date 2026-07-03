// `mapAgentToLeafInput` — maps a Vynel `agents` row → a standalone leaf
// `StartChatSessionInput` (Mode B, by-reference). The by-reference sibling of
// `mapAgentToDefinition` (Mode A, inline `query({ agents })`): the SAME agent row
// is the single source of truth, mapped either to an SDK `AgentDefinition` (Mode
// A) or to a full leaf session's input (Mode B). The agent's prompt becomes the
// leaf's `systemPromptAppend`; its tool grants become the leaf's allow/deny lists.
//
// The leaf always runs under Vynel's default `bypass-with-behavior-gate` mode, so
// the `PreToolUse` + `canUseTool` safety backstop cards every irreversible tool
// REGARDLESS of the agent's own `permissionMode` — the non-negotiable safety
// invariant (`.claude/docs/agent-base/root-session-architecture.md §11`). Mapping
// the agent's 6-mode `permissionMode` / `effort` / `background` onto the leaf is a
// later refinement (the safety backstop holds regardless).

import type { AgentRow } from '@vynel/db/repositories/agents'
import type { StartChatSessionInput } from '@vynel/providers'

export type MapAgentToLeafInputOptions = {
  /** The leaf's cwd — the target workspace folder. */
  workspacePath: string
  /** The task the root delegates — the leaf's first user message. */
  taskText: string
  /** Overrides the agent's model for this leaf turn. */
  model?: string
}

export function mapAgentToLeafInput(
  agent: AgentRow,
  options: MapAgentToLeafInputOptions,
): StartChatSessionInput {
  const leafInput: StartChatSessionInput = {
    workspacePath: options.workspacePath,
    userMessageText: options.taskText,
    permissionMode: 'bypass-with-behavior-gate',
    allowedToolNames: agent.allowedTools ?? [],
    deniedToolNames: agent.disallowedTools ?? [],
    systemPromptAppend: agent.prompt,
  }
  // No `mcpServers` here — Mode-B leaves are native-tool only, so the desktop
  // `act_on_app` is unreachable and the provider's static approval floor suffices.
  // If a leaf ever gains MCP-server attachment, it MUST also forward the composed
  // `alwaysRequireApprovalToolNames` (the feature mutating set): under the hardcoded
  // bypass above, a non-floor mutating MCP tool would otherwise run uncarded.
  // `exactOptionalPropertyTypes`: only assign `model` when present (explicit
  // override wins; else the agent's own model; else inherit the runtime default).
  const model = options.model ?? agent.model ?? undefined
  if (model !== undefined) leafInput.model = model
  return leafInput
}

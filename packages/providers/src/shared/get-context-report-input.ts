// Input for `AiAgentProvider.getContextReport` — reads a session's
// context-window composition by dispatching the runtime's `/context` command.
// Mirrors the session-shaping fields of `StartChatSessionInput` (minus the user
// message) so the report reflects the SAME context the session runs with —
// system prompt, tools, MCP servers, model — resumed to include its messages.
// See `docs/blueprints/providers/blueprint.md §7`.

import type { ProviderLogger } from './provider-logger.js'

export type GetContextReportInput = {
  /** Workspace folder path — the agent's cwd. */
  workspacePath: string

  /** Resume an existing session so the report includes its conversation. */
  resumeSessionId?: string

  /** The model the session runs with (maps to the Agent SDK `options.model`). */
  model?: string

  /** Permission mode for the dispatch. `/context` uses no tools, so this only
   *  shapes session options, not approvals. */
  permissionMode: 'ask' | 'bypass-with-behavior-gate' | 'plan-only'

  /** Allowed tool names — for accurate tool counts in the report. */
  allowedToolNames: string[]

  /** Denied tool names. */
  deniedToolNames: string[]

  /** Pre-built MCP servers (so MCP tools are counted in the report). */
  mcpServers?: Record<string, unknown>

  /** Optional structural logger (a failed read is logged, not thrown). */
  logger?: ProviderLogger
}

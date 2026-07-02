// Input for `AiAgentProvider.summarizeSession` — produces a concise hand-off
// summary of a session's conversation, used as the CARRY for the
// session-continuity seed-fresh swap (the distilled state seeded into the
// fresh session). Mirrors the session-shaping fields of
// `GetContextReportInput` (minus MCP — a read-only summary needs no tools) so
// the summary is generated over the SAME resumed conversation the session ran.
// See `docs/agent-base/session-continuity.md`.

import type { ProviderLogger } from './provider-logger.js'

export type SummarizeSessionInput = {
  /** Workspace folder path — the agent's cwd. */
  workspacePath: string

  /** The session to summarize — resumed so the summary covers its full conversation. */
  resumeSessionId: string

  /**
   * The model to summarize with. Omit for the CLI default; callers pass a
   * cheap/small model (the summary is a short, mechanical read-and-distill).
   */
  model?: string

  /** Permission mode for the dispatch. Summarization uses no tools. */
  permissionMode: 'ask' | 'bypass-with-behavior-gate' | 'plan-only'

  /** Allowed tool names — forwarded for faithful session options. */
  allowedToolNames: string[]

  /** Denied tool names. */
  deniedToolNames: string[]

  /** Optional structural logger (a failed summary is logged, not thrown). */
  logger?: ProviderLogger
}

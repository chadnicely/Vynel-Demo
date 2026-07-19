// Input for `AiAgentProvider.summarizeSession` — produces a concise hand-off
// summary of a session's conversation, used as the CARRY for the
// session-continuity seed-fresh swap (the distilled state seeded into the
// fresh session). A summary is a read-and-distill: its dispatch discipline
// (single turn, truly toolless, no session write) is the PROVIDER's
// non-negotiable wall, not a caller choice — which is why this input carries
// no permission or tool fields. See `docs/agent-base/session-continuity.md`.

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

  /** Optional structural logger (a failed summary is logged, not thrown). */
  logger?: ProviderLogger
}

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
   * The model to summarize with. The distill RESUMES the session, so this
   * model's context window must cover the session's content — pass the model
   * the session itself ran on (a smaller-window "cheap" model overflows at
   * exactly the moment a swap fires and degenerates the carry; tester-DB
   * incident 2026-08-14). Omit for the CLI default.
   */
  model?: string

  /** Optional structural logger (a failed summary is logged, not thrown). */
  logger?: ProviderLogger
}

// `ChatSessionTranscript` + `FetchTranscriptInput` — a reconstructed (NOT
// live) normalized event stream for a previously-persisted session, read for
// chat history. See `docs/blueprints/providers/blueprint.md §7.1`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'
import type { NormalizedSessionEvent } from './normalized-session-event.js'

export type FetchTranscriptInput = {
  workspacePath: string
  sessionId: string
}

export type ChatSessionTranscript = {
  providerId: AiAgentProviderId
  sessionId: string
  startedAt: Date
  /**
   * Reconstructed normalized event stream from the persisted artifacts.
   * NOT live — these are events as they were emitted in the original session.
   */
  events: NormalizedSessionEvent[]
}

// `PersistedSessionRecord` — metadata for a session discovered in the
// runtime's own on-disk storage. The `chat` domain uses this to populate its
// sessions list. See `docs/blueprints/providers/blueprint.md §7.1`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'

export type PersistedSessionRecord = {
  providerId: AiAgentProviderId
  sessionId: string
  /** The workspace folder this session was created in (decoded from the SDK's path encoding). */
  workspacePath: string
  /** When the session was first opened. */
  startedAt: Date
  /** Latest activity timestamp from the JSONL file. */
  lastModifiedAt: Date
  /** Truncated text of the user's first message — for chat-list display. */
  firstUserMessagePreview: string | null
  /** Number of turns recorded so far. */
  turnCount: number
  /** True if the JSONL ends with an unresolved tool-use (Phase 1 restart mitigation — §2 + §19). */
  hasUnresolvedToolUse: boolean
}

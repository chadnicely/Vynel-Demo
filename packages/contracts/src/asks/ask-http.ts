// HTTP response shape for the `asks` domain. Single source of truth for the
// serialized response: `apps/local-api` types `serializeAskRequestForResponse`'s
// return as `AskRequestResponse`; `apps/local-web` casts SDK responses to it
// (the tasks/schedules cast-from-contracts precedent).

import type { AskAnswers, AskQuestion } from './ask-questions.js'

export type AskRequestStatus = 'pending' | 'answered' | 'dismissed' | 'expired'

export interface AskRequestResponse {
  id: string
  userId: string
  // Nullable to match the schema (NULL = the ask came from a global-root turn).
  workspaceId: string | null
  sessionId: string | null
  // Loose cross-feature ref — the task this ask clears (no FK).
  taskId: string | null
  questions: AskQuestion[]
  answers: AskAnswers | null
  status: AskRequestStatus
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 or null */
  resolvedAt: string | null
}

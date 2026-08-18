// Response serializer for `asks` HTTP routes. The JSON columns were validated
// at every WRITE boundary, so this read-side decode is a plain parse+cast —
// the load-bearing read (resolve validating answers against stored questions)
// re-validates through the zod schema instead. Date columns emit as ISO strings.

import type { AskRequest } from '@vynel/asks'
import type { AskRequestResponse } from '@vynel/contracts/asks/ask-http'
import type { AskAnswers, AskQuestion } from '@vynel/contracts/asks/ask-questions'

export function serializeAskRequestForResponse(ask: AskRequest): AskRequestResponse {
  return {
    id: ask.id,
    userId: ask.userId,
    workspaceId: ask.workspaceId,
    sessionId: ask.sessionId,
    taskId: ask.taskId,
    questions: JSON.parse(ask.questionsJson) as AskQuestion[],
    answers: ask.answersJson !== null ? (JSON.parse(ask.answersJson) as AskAnswers) : null,
    status: ask.status,
    createdAt: ask.createdAt.toISOString(),
    resolvedAt: ask.resolvedAt ? ask.resolvedAt.toISOString() : null,
  }
}

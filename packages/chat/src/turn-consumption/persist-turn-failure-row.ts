// A turn that dies before ANY assistant output — an API-overload retry loop
// (529), a failed resume — used to persist nothing: after a reload the thread
// showed the user's message with no reply and no explanation (the 2026-07-30
// smoke). The `session-errored` handler only marked the LAST assistant row,
// and a zero-output turn has none. This persists the failure as its own
// assistant row so the transcript says WHY there is no answer.

import * as chatRepository from '../repositories/index.js'
import { withTransaction, type Database } from '@vynel/db'
import type { ChatMessage } from '../repositories/index.js'
import type { AssistantRowAttribution } from './ensure-assistant-message-row.js'

export function persistTurnFailureRow(input: {
  db: Database
  /** The session the turn ran on (or tried to resume) — null when the failure
   *  predates any session id. */
  sessionId: string | null
  errorCode: string
  errorMessage: string
  erroredAt: Date
  attribution?: AssistantRowAttribution
}): ChatMessage | null {
  const { db, sessionId, errorCode, errorMessage, erroredAt, attribution } = input
  // A failure BEFORE session-started on a NEW session has no session row to
  // attach to — and nothing else of the turn persisted either, so there is no
  // half-told transcript to explain. The live client still gets the event.
  if (sessionId === null || chatRepository.findChatSessionById(db, sessionId) === null) {
    return null
  }
  return withTransaction(db, (tx) => {
    const inserted = chatRepository.insertChatMessage(tx, {
      id: crypto.randomUUID(),
      sessionId,
      role: 'assistant',
      body: '',
      sourceKind: attribution?.sourceKind ?? null,
      sourceLabel: attribution?.sourceLabel ?? null,
      partialSessionId: attribution?.partialSessionId ?? null,
      threadId: attribution?.threadId ?? null,
      thinkingBody: null,
      inputTokens: null,
      outputTokens: null,
      attachedImagesMetadata: null,
      errorCode,
      errorMessage,
      startedAt: erroredAt,
      completedAt: erroredAt,
      createdAt: erroredAt,
    })
    chatRepository.updateChatSession(tx, sessionId, { lastMessageAt: erroredAt })
    return inserted
  })
}

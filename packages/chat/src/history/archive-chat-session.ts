// Core ops — archive + unarchive a chat session. File holds BOTH per the
// workspaces precedent (mirror operations colocate in one file).
//
// Archive emits CHAT_SESSION_ARCHIVED via the outbox (co-committed in the
// same transaction); unarchive emits NO event per D20 (downstream consumers
// derive from the absence of an archived state).
//
// Throws NotFoundError when the session id is missing.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import * as chatRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { CHAT_SESSION_ARCHIVED } from '../chat-events.js'
import { withTransaction, type Database } from '@vynel/db'
import type { ChatSession } from '../repositories/index.js'

export function archiveChatSession(db: Database, sessionId: string): ChatSession {
  return withTransaction(db, (tx) => {
    const next = chatRepository.updateChatSession(tx, sessionId, { isArchived: true })
    if (!next) throw new NotFoundError('chat-session', sessionId)
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_ARCHIVED,
      payload: { userId: next.userId, workspaceId: next.workspaceId, sessionId: next.id },
      createdAt: new Date(),
      processedAt: null,
    })
    return next
  })
}

export function unarchiveChatSession(db: Database, sessionId: string): ChatSession {
  const updated = chatRepository.updateChatSession(db, sessionId, { isArchived: false })
  if (!updated) throw new NotFoundError('chat-session', sessionId)
  return updated
}

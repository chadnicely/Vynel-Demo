// Core op — rename a chat session. Title length is constrained (1–120
// chars; the Zod schema at the route boundary enforces this too — defense
// in depth). Throws NotFoundError when the session id is missing.
//
// No outbox event for rename — title changes are user-only metadata, not
// state downstream consumers track.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import * as chatRepository from '../repositories/index.js'
import { NotFoundError, ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { ChatSession } from '../repositories/index.js'

const MIN_TITLE_LENGTH = 1
const MAX_TITLE_LENGTH = 120

export function renameChatSession(db: Database, sessionId: string, newTitle: string): ChatSession {
  const trimmed = newTitle.trim()
  if (trimmed.length < MIN_TITLE_LENGTH || trimmed.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      `Chat session title must be ${MIN_TITLE_LENGTH}-${MAX_TITLE_LENGTH} characters.`,
    )
  }
  const updated = chatRepository.updateChatSession(db, sessionId, { title: trimmed })
  if (!updated) throw new NotFoundError('chat-session', sessionId)
  return updated
}

// Core op — fetch a chat session + its messages + tool calls grouped by
// parent message. Returns a plain `Record<string, ChatToolCall[]>` (NOT a
// Map) so `c.json(detail)` serializes correctly at the route layer.
//
// Throws `NotFoundError('chat-session', sessionId)` if the session is
// missing or soft-deleted (no enumeration leak — same response shape).
//
// `options.ownerUserId` (brain-tree Ch3) is an OPTIONAL tenant gate: when given, a
// session owned by a different user throws the SAME NotFoundError (no enumeration leak).
// The workspace chat route omits it — its `c.var.chatSession` resolver middleware already
// scoped ownership upstream; a user-scoped route that lacks that middleware (the Ch3
// `/root/sessions/:sessionId`) passes it to close the IDOR. `data-standard`: tenant-scoped
// reads filter on userId.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import * as chatRepository from '../repositories/index.js'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { ChatSession, ChatMessage, ChatToolCall } from '../repositories/index.js'
import type { ChatSessionScope } from '../schema/index.js'

export type ChatSessionDetail = {
  session: ChatSession
  messages: ChatMessage[]
  toolCallsByMessageId: Record<string, ChatToolCall[]>
}

export type GetChatSessionDetailOptions = {
  /** When set, the session must belong to this user — else NotFound (no leak). */
  ownerUserId?: string
  /** Scopes that 404 as if absent (same NotFound — no leak). The cross-session
   *  tool read passes `['global']` so the brain's private thread never leaves
   *  through it; checked BEFORE the messages load, so a walled read costs one
   *  row fetch. */
  forbiddenScopes?: readonly ChatSessionScope[]
}

export function getChatSessionDetail(
  db: Database,
  sessionId: string,
  options: GetChatSessionDetailOptions = {},
): ChatSessionDetail {
  const session = chatRepository.findChatSessionById(db, sessionId)
  if (!session || session.deletedAt) throw new NotFoundError('chat-session', sessionId)
  if (options.ownerUserId !== undefined && session.userId !== options.ownerUserId) {
    throw new NotFoundError('chat-session', sessionId)
  }
  if (options.forbiddenScopes?.includes(session.scope)) {
    throw new NotFoundError('chat-session', sessionId)
  }

  const messages = chatRepository.listChatMessagesForSession(db, sessionId)
  const toolCalls = chatRepository.listChatToolCallsForSession(db, sessionId)

  const toolCallsByMessageId: Record<string, ChatToolCall[]> = {}
  for (const toolCall of toolCalls) {
    if (!toolCallsByMessageId[toolCall.parentMessageId]) {
      toolCallsByMessageId[toolCall.parentMessageId] = []
    }
    toolCallsByMessageId[toolCall.parentMessageId]!.push(toolCall)
  }

  return { session, messages, toolCallsByMessageId }
}

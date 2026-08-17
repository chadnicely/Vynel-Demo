// Set the assistant's SESSION status (Move 3, 2026-08-17) — the
// `setWorkspaceStatus` sibling, per conversation: completed / problem /
// needs_input with an optional one-line note. The row is a FACT ("the
// assistant set X at T"), never cleared by a write — the user's next message
// supersedes it at read time (`deriveSessionStatus` in contracts), which is
// exactly "completed shows until the next message". Owner-scoped: a foreign
// session 404s like a missing one.
//
// Phase 1 sync transaction callback per
// .claude/memory/decisions/phase-1-sync-transactions.md.

import * as chatRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { ChatSession, ChatSessionSetStatus } from '../repositories/index.js'
import { CHAT_SESSION_STATUS_SET, type ChatSessionStatusSetPayload } from '../chat-events.js'

export type SetSessionStatusInput = {
  userId: string
  sessionId: string
  status: ChatSessionSetStatus
  /** The assistant's one-line why — surfaced beside the status light. */
  note?: string | null
}

export function setSessionStatus(db: Database, input: SetSessionStatusInput): ChatSession {
  return withTransaction(db, (tx) => {
    const existing = chatRepository.findChatSessionById(tx, input.sessionId)
    if (!existing || existing.userId !== input.userId) {
      throw new NotFoundError('session', input.sessionId)
    }
    const setAt = new Date()
    const updated = chatRepository.updateChatSession(tx, input.sessionId, {
      status: input.status,
      statusNote: input.note ?? null,
      statusSetAt: setAt,
    })
    if (!updated) throw new NotFoundError('session', input.sessionId)
    const payload: ChatSessionStatusSetPayload = {
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      sessionId: updated.id,
      status: input.status,
      note: input.note ?? null,
      setAt: setAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_STATUS_SET,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
    return updated
  })
}

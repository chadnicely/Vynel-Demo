// Core op — soft-delete a chat session per D14. Sets `deletedAt = now()`
// (the repo guard makes this idempotent — calling on an already-deleted
// session is a no-op silently). Emits CHAT_SESSION_SOFT_DELETED via the
// outbox (co-committed in the same transaction).
//
// Throws NotFoundError when the session id is missing (different from "already
// soft-deleted" — the repo returns null in both cases; this op distinguishes
// by re-checking existence).
//
// The 30-day retention window is enforced by the
// `apps/worker/src/jobs/chat/purge-deleted-chat-sessions.ts` job (cluster 8).
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5` + decisions D14.

import * as chatRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { CHAT_SESSION_SOFT_DELETED } from '../chat-events.js'
import { withTransaction, type Database } from '@vynel/db'

export function softDeleteChatSession(db: Database, sessionId: string): void {
  withTransaction(db, (tx) => {
    const deleted = chatRepository.softDeleteChatSession(tx, sessionId)
    if (!deleted) {
      // Distinguish "missing" from "already soft-deleted" — both produce null
      // from the idempotent repo. Re-check existence; missing is NotFound,
      // already-deleted is silent success.
      const existing = chatRepository.findChatSessionById(tx, sessionId)
      if (!existing) throw new NotFoundError('chat-session', sessionId)
      return // already soft-deleted; idempotent no-op (no second event)
    }
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_SOFT_DELETED,
      payload: { userId: deleted.userId, workspaceId: deleted.workspaceId, sessionId: deleted.id },
      createdAt: new Date(),
      processedAt: null,
    })
  })
}

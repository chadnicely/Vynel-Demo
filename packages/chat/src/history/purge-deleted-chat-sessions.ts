// Core op — hard-delete chat sessions whose `deletedAt < now - retentionDays`
// per D14 (30-day retention). The on-disk delete cascades to chat_messages
// + chat_tool_calls via FK ON DELETE CASCADE; the FTS5 sync triggers fire
// on each chat_messages DELETE, keeping the search index clean. One
// CHAT_SESSION_HARD_DELETED outbox event is emitted per purged session,
// co-committed in the same transaction.
//
// Loop body lives HERE (core), not in the worker file. The worker is a
// thin (db, logger) => coreOp(db, ...) delegator per
// `docs/foundation.md §2 row 1` + `.claude/rules/structure-standard.md`
// "apps/worker/src/" — keeps the op testable against `withTestDatabase`
// and sets the precedent for future workers (memory GC, knowledge re-index,
// schedules tick).
//
// Phase 1 sync transaction discipline per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Spec: `docs/blueprints/chat/blueprint.md §9` + decisions D14.
// Blueprint §9 currently shows the loop inside the worker file — that drift
// is queued for Cluster 10 doc reconciliation.

import * as chatRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { withTransaction, type Database } from '@vynel/db'
import { CHAT_SESSION_HARD_DELETED } from '../chat-events.js'
import type { StructuralLogger } from '../chat-types.js'

export interface PurgeDeletedChatSessionsInput {
  /** Override the 30-day default (mainly for tests + future tuning). */
  readonly retentionDays?: number
}

export interface PurgeDeletedChatSessionsResult {
  readonly purgedCount: number
  readonly purgedSessionIds: string[]
}

export interface PurgeDeletedChatSessionsDependencies {
  readonly logger?: StructuralLogger
}

const DEFAULT_RETENTION_DAYS = 30
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

export function purgeDeletedChatSessions(
  db: Database,
  input: PurgeDeletedChatSessionsInput = {},
  deps: PurgeDeletedChatSessionsDependencies = {},
): PurgeDeletedChatSessionsResult {
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS
  const cutoff = new Date(Date.now() - retentionDays * MILLIS_PER_DAY)
  const expired = chatRepository.listChatSessionsDeletedBefore(db, cutoff)

  const purgedSessionIds: string[] = []
  for (const session of expired) {
    withTransaction(db, (tx) => {
      const removed = chatRepository.hardDeleteChatSession(tx, session.id)
      // hardDeleteChatSession returns false only on a row-already-gone race
      // (e.g. a concurrent process did it first). Phase 1 single-process =
      // never happens; the guard is here so Phase 2 multi-pod stays safe.
      if (!removed) return
      insertOutboxEvent(tx, {
        id: crypto.randomUUID(),
        type: CHAT_SESSION_HARD_DELETED,
        payload: {
          userId: session.userId,
          workspaceId: session.workspaceId,
          sessionId: session.id,
        },
        createdAt: new Date(),
        processedAt: null,
      })
      purgedSessionIds.push(session.id)
    })
  }

  deps.logger?.info(
    {
      purgedCount: purgedSessionIds.length,
      retentionDays,
      cutoffIso: cutoff.toISOString(),
    },
    'purge-deleted-chat-sessions: completed',
  )

  return { purgedCount: purgedSessionIds.length, purgedSessionIds }
}

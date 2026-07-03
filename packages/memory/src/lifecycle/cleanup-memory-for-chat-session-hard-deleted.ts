// `cleanupMemoryForChatSessionHardDeleted` — outbox-consumer-driven
// cleanup of memory's loose cross-domain refs to chat. Triggered by
// `chat.session-hard-deleted` (the purge worker emits this when a
// session crosses its retention horizon).
//
// Two distinct cleanups in one tx:
//   1. Delete `memory_entry_mentions` rows that reference the
//      hard-deleted session (sessionId match).
//   2. Null any `memory_entries.sourceMessageId` whose value
//      appears in `hardDeletedMessageIds` (the payload extension
//      tracked as a foundation-hardening item; until that lands, the
//      array will be empty in the wild and this step is a no-op).
//
// Phase 1: the chat outbox payload only carries `sessionId` — the
// `hardDeletedMessageIds` extension is on the foundation-hardening
// backlog. This op is API-ready (accepts the list) so the wire-up
// is just "pass the array through" once chat surfaces it.

import { withTransaction, type Database } from '@vynel/db'
import {
  deleteMentionsForSessionIds,
  nullSourceMessageIdsForMessageIds,
} from '../repositories/index.js'

export type CleanupMemoryForChatSessionHardDeletedInput = {
  sessionId: string
  hardDeletedMessageIds: string[]
}

export type CleanupMemoryForChatSessionHardDeletedResult = {
  mentionsDeleted: number
  sourceMessageIdsNulled: number
}

export function cleanupMemoryForChatSessionHardDeleted(
  db: Database,
  input: CleanupMemoryForChatSessionHardDeletedInput,
): CleanupMemoryForChatSessionHardDeletedResult {
  return withTransaction(db, (tx) => {
    const mentionsDeleted = deleteMentionsForSessionIds(tx, [input.sessionId])
    const sourceMessageIdsNulled = nullSourceMessageIdsForMessageIds(
      tx,
      input.hardDeletedMessageIds,
    )
    return { mentionsDeleted, sourceMessageIdsNulled }
  })
}

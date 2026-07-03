// `recordDelegation` — emits the `session.delegated` outbox event: the parent→
// child SESSION-TREE EDGE captured at delegation time (Slice 3a). This is the
// audit signal the monitor (Slice 5a) consumes to reconstruct the
// global→workspace→agent tree, because a by-reference leaf is NOT an SDK
// `SubagentStart` event (gold §7 "everything is recorded").
//
// Orchestration owns this event, so the emit lives here (not in the chat
// recording op). Cross-domain stays clean: it writes only the `_shared` outbox.
// The apps/api composition (`delegate-to-leaf-session.ts`) calls this right after
// recording the leaf's chat row.

import type { Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '../orchestration-events.js'

export type RecordDelegationInput = {
  /** The delegating (parent) session id — a root or manager. */
  parentSessionId: string
  /** The delegated-to (child) leaf session id. */
  childSessionId: string
  /** The delegated agent's slug (the edge role). */
  role: string
  userId: string
}

export function recordDelegation(db: Database, input: RecordDelegationInput): void {
  const payload: SessionDelegatedPayload = {
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
    role: input.role,
    userId: input.userId,
    ts: new Date().toISOString(),
  }
  insertOutboxEvent(db, {
    id: crypto.randomUUID(),
    type: SESSION_DELEGATED,
    payload,
    createdAt: new Date(),
    processedAt: null,
  })
}

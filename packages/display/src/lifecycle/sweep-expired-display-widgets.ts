// Core op — drop every card whose `expiresAt` has passed, in two modes:
//   - BOOT PASS (no selector): process-wide, so a machine that was asleep past
//     an expiry comes up showing the board the user would expect rather than
//     yesterday's countdown (the `listAllPendingAskRequests` precedent).
//   - LAZY (a user): what `listDisplayWidgets` runs before it reads. There is
//     no ticking timer — a widget expires the moment someone looks, which is
//     the only moment it matters.
//
// One transaction covers the deletes AND their removed events; the frames go
// out after it commits. `add` reuses the tx-scoped half below so an expired
// card never squats a slot at the twelve-card cap.

import { withTransaction } from '@vynel/db'
import * as displayWidgetsRepository from '../repositories/index.js'
import { recordDisplayWidgetRemoved } from '../display-outbox.js'
import type { Database } from '@vynel/db'
import type { DisplayOpDeps } from '../display-live-sink.js'
import type { DisplayWidgetRow } from '../repositories/index.js'

export interface SweepExpiredDisplayWidgetsInput {
  userId?: string
  scopeKey?: string
  /** Overridable so a caller can sweep against its own clock; defaults to now. */
  now?: Date
}

/** The transaction-scoped half: delete + record, no transaction of its own and
 *  no publishing. `add` calls this inside its existing tx to free a slot before
 *  the cap check; `sweepExpiredDisplayWidgets` is the tx-opening wrapper. */
export function sweepExpiredWithinTransaction(
  tx: Database,
  input: SweepExpiredDisplayWidgetsInput & { now: Date },
): DisplayWidgetRow[] {
  const expired = displayWidgetsRepository.deleteExpiredDisplayWidgets(tx, {
    now: input.now,
    userId: input.userId,
    scopeKey: input.scopeKey,
  })
  for (const row of expired) recordDisplayWidgetRemoved(tx, row, 'expired', input.now)
  return expired
}

export function sweepExpiredDisplayWidgets(
  db: Database,
  input: SweepExpiredDisplayWidgetsInput = {},
  deps: DisplayOpDeps = {},
): { sweptCount: number } {
  const now = input.now ?? new Date()

  const swept = withTransaction(db, (tx) => sweepExpiredWithinTransaction(tx, { ...input, now }))

  // Only a user-scoped sweep publishes. A frame carries `scopeKey` but no
  // `userId` and the channel is per-user, so a process-wide pass has no one to
  // address — it would hand one user's sink another user's removals. The boot
  // pass therefore stays silent (nothing is connected yet) and the lazy
  // per-user sweep on every list is what reaches live windows.
  if (input.userId !== undefined) {
    for (const row of swept) {
      deps.liveSink?.publish({ kind: 'removed', widgetId: row.id, scopeKey: row.scopeKey })
    }
  }
  return { sweptCount: swept.length }
}

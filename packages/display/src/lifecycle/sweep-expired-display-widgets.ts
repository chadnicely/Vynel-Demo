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

  // Only a user-scoped sweep publishes. The process-wide pass is the BOOT pass
  // and nothing is connected yet, so its frames would address windows that do
  // not exist; the lazy per-user sweep on every list is what reaches live ones.
  if (input.userId !== undefined) {
    for (const row of swept) {
      deps.liveSink?.publish(input.userId, {
        kind: 'removed',
        widgetId: row.id,
        scopeKey: row.scopeKey,
      })
    }
  }
  return { sweptCount: swept.length }
}

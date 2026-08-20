// Core op — wipe one scope's board in a single stroke (the "Clear" affordance
// and the `display_clear` tool).
//
// ONE `display.cleared` event carrying the count, not N removed events: the
// user did one thing, and a client redrawing an empty board has no use for the
// individual ids. An empty board writes nothing at all — no state changed, so
// there is no event and no frame to send.

import { withTransaction } from '@vynel/db'
import * as displayWidgetsRepository from '../repositories/index.js'
import { recordDisplayCleared } from '../display-outbox.js'
import type { Database } from '@vynel/db'
import type { DisplayOpDeps } from '../display-live-sink.js'

export interface ClearDisplayWidgetsInput {
  userId: string
  scopeKey: string
}

export function clearDisplayWidgets(
  db: Database,
  input: ClearDisplayWidgetsInput,
  deps: DisplayOpDeps = {},
): { clearedCount: number } {
  const scope = { userId: input.userId, scopeKey: input.scopeKey }
  const now = new Date()

  const clearedCount = withTransaction(db, (tx) => {
    const removed = displayWidgetsRepository.deleteDisplayWidgetsByScope(tx, scope)
    if (removed.length > 0) recordDisplayCleared(tx, scope, removed.length, now)
    return removed.length
  })

  if (clearedCount > 0) deps.liveSink?.publish({ kind: 'cleared', scopeKey: input.scopeKey })
  return { clearedCount }
}

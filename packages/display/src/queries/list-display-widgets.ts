// Read op — one scope's board, in presentation order.
//
// Sweeps expired cards FIRST, in their own transaction: expiry has no timer,
// so the read is what makes it happen. Doing it here rather than in the
// repository keeps the removed events (and their frames) with the state change
// that caused them.

import { sweepExpiredDisplayWidgets } from '../lifecycle/sweep-expired-display-widgets.js'
import * as displayWidgetsRepository from '../repositories/index.js'
import { toDisplayWidgetView } from '../display-widget-view.js'
import type { Database } from '@vynel/db'
import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import type { DisplayOpDeps } from '../display-live-sink.js'

export interface ListDisplayWidgetsInput {
  userId: string
  scopeKey: string
}

export function listDisplayWidgets(
  db: Database,
  input: ListDisplayWidgetsInput,
  deps: DisplayOpDeps = {},
): DisplayWidgetView[] {
  sweepExpiredDisplayWidgets(db, { userId: input.userId, scopeKey: input.scopeKey }, deps)
  return displayWidgetsRepository
    .listDisplayWidgetsForScope(db, { userId: input.userId, scopeKey: input.scopeKey })
    .map(toDisplayWidgetView)
}

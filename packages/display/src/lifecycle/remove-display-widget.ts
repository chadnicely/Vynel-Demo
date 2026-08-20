// Core op — take one card off the board ("remove it"). The delete and its
// outbox event share one transaction; the frame goes out after the commit.

import { withTransaction } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as displayWidgetsRepository from '../repositories/index.js'
import { recordDisplayWidgetRemoved } from '../display-outbox.js'
import { toDisplayWidgetView } from '../display-widget-view.js'
import type { Database } from '@vynel/db'
import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import type { DisplayOpDeps } from '../display-live-sink.js'

export interface RemoveDisplayWidgetInput {
  userId: string
  widgetId: string
}

export function removeDisplayWidget(
  db: Database,
  input: RemoveDisplayWidgetInput,
  deps: DisplayOpDeps = {},
): DisplayWidgetView {
  const now = new Date()
  const removed = withTransaction(db, (tx) => {
    // The delete is itself the ownership check — its WHERE carries `userId`,
    // so another user's widget comes back null, same as a missing one.
    const row = displayWidgetsRepository.deleteDisplayWidget(tx, {
      userId: input.userId,
      widgetId: input.widgetId,
    })
    if (!row) throw new NotFoundError('Display widget', input.widgetId)
    recordDisplayWidgetRemoved(tx, row, 'requested', now)
    return row
  })

  deps.liveSink?.publish({ kind: 'removed', widgetId: removed.id, scopeKey: removed.scopeKey })
  return toDisplayWidgetView(removed)
}

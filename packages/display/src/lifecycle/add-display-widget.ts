// Core op — put a card on the Display. Validates title + content against the
// contracts schema, then writes the row AND its outbox event in ONE
// transaction; the live frame goes out only once that has committed.
//
// The board holds twelve per scope: a thirteenth EVICTS the oldest rather than
// erroring, so Claude never has to reason about a full board mid-answer. The
// eviction is part of the same transaction — the two events are one atomic
// "this replaced that", and a rollback leaves the old card standing.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { DISPLAY_MAX_WIDGETS_PER_SCOPE } from '@vynel/contracts/display/display-widget-content'
import * as displayWidgetsRepository from '../repositories/index.js'
import { recordDisplayWidgetRemoved, recordDisplayWidgetUpserted } from '../display-outbox.js'
import { sweepExpiredWithinTransaction } from './sweep-expired-display-widgets.js'
import {
  parseDisplayWidgetContent,
  parseDisplayWidgetSize,
  parseDisplayWidgetSlot,
  parseDisplayWidgetTitle,
} from '../display-widget-input.js'
import { toDisplayWidgetView } from '../display-widget-view.js'
import type { Database } from '@vynel/db'
import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import type {
  DisplayWidgetContent,
  DisplayWidgetSize,
  DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'
import type { DisplayOpDeps } from '../display-live-sink.js'
import type { DisplayWidgetRow } from '../repositories/index.js'

/** Where an unplaced card lands: the middle of the board, the region
 *  `DisplayView.vue` gives the most room to. */
const DEFAULT_SLOT: DisplayWidgetSlot = 'stage'
const DEFAULT_SIZE: DisplayWidgetSize = 'md'

export interface AddDisplayWidgetInput {
  userId: string
  /** `'global'` or a workspace id — the surface decides the scope. */
  scopeKey: string
  title: string
  /** `kind` is NOT a separate field: the row's kind IS `content.kind`. */
  content: DisplayWidgetContent
  slot?: DisplayWidgetSlot
  size?: DisplayWidgetSize
  createdBySessionId?: string | null
  expiresAt?: Date | null
}

export function addDisplayWidget(
  db: Database,
  input: AddDisplayWidgetInput,
  deps: DisplayOpDeps = {},
): DisplayWidgetView {
  const title = parseDisplayWidgetTitle(input.title)
  const content = parseDisplayWidgetContent(input.content)
  const slot = parseDisplayWidgetSlot(input.slot ?? DEFAULT_SLOT)
  const size = parseDisplayWidgetSize(input.size ?? DEFAULT_SIZE)
  const scope = { userId: input.userId, scopeKey: input.scopeKey }
  const now = new Date()

  const written = withTransaction(db, (tx) => {
    // Sweep before counting: a card that has already expired must not squat a
    // slot at the cap, or the eviction drops a live card to make room for one
    // the user can no longer see. A freed slot means no eviction at all.
    const expired = sweepExpiredWithinTransaction(tx, { ...scope, now })

    // Evict BEFORE reading the slot's high-water mark: the card being dropped
    // may be the one holding it, and reusing its `sortOrder` is correct.
    let evicted: DisplayWidgetRow | null = null
    if (displayWidgetsRepository.countDisplayWidgetsByScope(tx, scope) >= DISPLAY_MAX_WIDGETS_PER_SCOPE) {
      evicted = displayWidgetsRepository.findOldestDisplayWidgetInScope(tx, scope)
      if (evicted) {
        displayWidgetsRepository.deleteDisplayWidget(tx, {
          userId: input.userId,
          widgetId: evicted.id,
        })
        recordDisplayWidgetRemoved(tx, evicted, 'evicted', now)
      }
    }

    const inserted = displayWidgetsRepository.insertDisplayWidget(tx, {
      id: randomUUID(),
      userId: input.userId,
      scopeKey: input.scopeKey,
      title,
      kind: content.kind,
      content,
      slot,
      size,
      sortOrder: displayWidgetsRepository.maxSortOrderInSlot(tx, { ...scope, slot }) + 1,
      createdBySessionId: input.createdBySessionId ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    recordDisplayWidgetUpserted(tx, inserted, now)
    return { widget: inserted, evicted, expired }
  })

  // Every removal first, so a watching window never holds thirteen cards.
  for (const row of written.expired) {
    deps.liveSink?.publish({ kind: 'removed', widgetId: row.id, scopeKey: row.scopeKey })
  }
  if (written.evicted) {
    deps.liveSink?.publish({
      kind: 'removed',
      widgetId: written.evicted.id,
      scopeKey: written.evicted.scopeKey,
    })
  }
  const view = toDisplayWidgetView(written.widget)
  deps.liveSink?.publish({ kind: 'upserted', widget: view })
  return view
}

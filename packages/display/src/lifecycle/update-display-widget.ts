// Core op — change a card already on the board (the "update the matching
// widget rather than adding a near-duplicate" half of the tool contract).
//
// Re-validates exactly like `add`: an update is a write boundary too. Patching
// `content` also rewrites `kind`, because the row's kind IS `content.kind` —
// letting them diverge would leave a row a renderer cannot draw.

import { withTransaction } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as displayWidgetsRepository from '../repositories/index.js'
import { recordDisplayWidgetUpserted } from '../display-outbox.js'
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
import type { NewDisplayWidget } from '../repositories/index.js'

export interface UpdateDisplayWidgetInput {
  userId: string
  widgetId: string
  title?: string
  content?: DisplayWidgetContent
  slot?: DisplayWidgetSlot
  size?: DisplayWidgetSize
  /** Pass `null` to make a temporary card permanent. */
  expiresAt?: Date | null
}

export function updateDisplayWidget(
  db: Database,
  input: UpdateDisplayWidgetInput,
  deps: DisplayOpDeps = {},
): DisplayWidgetView {
  const title = input.title === undefined ? undefined : parseDisplayWidgetTitle(input.title)
  const content = input.content === undefined ? undefined : parseDisplayWidgetContent(input.content)
  const slot = input.slot === undefined ? undefined : parseDisplayWidgetSlot(input.slot)
  const size = input.size === undefined ? undefined : parseDisplayWidgetSize(input.size)
  const ref = { userId: input.userId, widgetId: input.widgetId }
  const now = new Date()

  const updated = withTransaction(db, (tx) => {
    // Reads are userId-scoped, so someone else's widget is indistinguishable
    // from one that never existed — the same NotFound either way.
    const existing = displayWidgetsRepository.findDisplayWidget(tx, ref)
    if (!existing) throw new NotFoundError('Display widget', input.widgetId)

    const patch: Partial<NewDisplayWidget> = { updatedAt: now }
    if (title !== undefined) patch.title = title
    if (content !== undefined) {
      patch.content = content
      patch.kind = content.kind
    }
    if (size !== undefined) patch.size = size
    if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt
    if (slot !== undefined && slot !== existing.slot) {
      // A moved card joins the end of its new slot; keeping the old position
      // would drop it at an arbitrary point among the cards already there.
      patch.slot = slot
      patch.sortOrder =
        displayWidgetsRepository.maxSortOrderInSlot(tx, {
          userId: existing.userId,
          scopeKey: existing.scopeKey,
          slot,
        }) + 1
    }

    const row = displayWidgetsRepository.updateDisplayWidget(tx, ref, patch)
    recordDisplayWidgetUpserted(tx, row, now)
    return row
  })

  const view = toDisplayWidgetView(updated)
  deps.liveSink?.publish(input.userId, { kind: 'upserted', widget: view })
  return view
}

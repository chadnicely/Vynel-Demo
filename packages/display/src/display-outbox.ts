// The ONE place a display state change becomes an outbox row. Every caller is
// already inside its op's `withTransaction`, so the event co-commits with the
// row it describes (architecture invariant 5) — passing `tx`, never `db`, is
// what makes that true.
//
// Three writers share `removed` (eviction, an explicit take-down, an expiry
// sweep) and they differ only in `reason`; keeping the row shape here is what
// stops three near-identical payload literals from drifting.

import { randomUUID } from 'node:crypto'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  DISPLAY_CLEARED,
  DISPLAY_WIDGET_REMOVED,
  DISPLAY_WIDGET_UPSERTED,
  type DisplayClearedPayload,
  type DisplayWidgetRemovalReason,
  type DisplayWidgetRemovedPayload,
  type DisplayWidgetUpsertedPayload,
} from './display-events.js'
import type { Database } from '@vynel/db'
import type { DisplayWidgetRow } from './repositories/index.js'

export function recordDisplayWidgetUpserted(tx: Database, row: DisplayWidgetRow, at: Date): void {
  const payload: DisplayWidgetUpsertedPayload = {
    widgetId: row.id,
    userId: row.userId,
    scopeKey: row.scopeKey,
    title: row.title,
    kind: row.kind,
    slot: row.slot,
    createdBySessionId: row.createdBySessionId,
    upsertedAt: at.toISOString(),
  }
  insertOutboxEvent(tx, {
    id: randomUUID(),
    type: DISPLAY_WIDGET_UPSERTED,
    payload,
    createdAt: at,
    processedAt: null,
  })
}

export function recordDisplayWidgetRemoved(
  tx: Database,
  row: DisplayWidgetRow,
  reason: DisplayWidgetRemovalReason,
  at: Date,
): void {
  const payload: DisplayWidgetRemovedPayload = {
    widgetId: row.id,
    userId: row.userId,
    scopeKey: row.scopeKey,
    reason,
    removedAt: at.toISOString(),
  }
  insertOutboxEvent(tx, {
    id: randomUUID(),
    type: DISPLAY_WIDGET_REMOVED,
    payload,
    createdAt: at,
    processedAt: null,
  })
}

export function recordDisplayCleared(
  tx: Database,
  scope: { userId: string; scopeKey: string },
  widgetCount: number,
  at: Date,
): void {
  const payload: DisplayClearedPayload = {
    userId: scope.userId,
    scopeKey: scope.scopeKey,
    widgetCount,
    clearedAt: at.toISOString(),
  }
  insertOutboxEvent(tx, {
    id: randomUUID(),
    type: DISPLAY_CLEARED,
    payload,
    createdAt: at,
    processedAt: null,
  })
}

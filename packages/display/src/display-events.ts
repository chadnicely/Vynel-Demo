// Outbox event constants + payload interfaces for the `display` domain —
// `display.widget-upserted`, `display.widget-removed`, `display.cleared`.
//
// Each row is co-committed in the same sync `withTransaction(db, (tx) => …)`
// block as the state change (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors
// `features-events.ts`.
//
// These are the DURABLE record. The live push (`DisplayLiveSink`) is the fast
// path a watching window sees within milliseconds; the outbox row is what any
// later consumer — a relay, an audit, a channel — reads at its own pace.
// Payloads are loose-ref FACTS only, and deliberately carry no `content`: a
// widget body can be 32 KB, and no consumer of the trail needs it.

import type {
  DisplayWidgetKind,
  DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'

export const DISPLAY_WIDGET_UPSERTED = 'display.widget-upserted' as const
export const DISPLAY_WIDGET_REMOVED = 'display.widget-removed' as const
export const DISPLAY_CLEARED = 'display.cleared' as const

/** Why a card left the board — `evicted` is the twelve-card cap making room,
 *  `expired` is a sweep, `requested` is the user or Claude taking it down. */
export type DisplayWidgetRemovalReason = 'requested' | 'evicted' | 'expired'

export type DisplayWidgetUpsertedPayload = {
  widgetId: string
  userId: string
  scopeKey: string
  title: string
  kind: DisplayWidgetKind
  slot: DisplayWidgetSlot
  createdBySessionId: string | null
  upsertedAt: string
}

export type DisplayWidgetRemovedPayload = {
  widgetId: string
  userId: string
  scopeKey: string
  reason: DisplayWidgetRemovalReason
  removedAt: string
}

export type DisplayClearedPayload = {
  userId: string
  scopeKey: string
  widgetCount: number
  clearedAt: string
}

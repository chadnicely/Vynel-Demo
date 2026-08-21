// The wire shape of one Display widget — what the HTTP list/add responses
// return AND what an `upserted` live frame carries. One home so the route
// (P2b) and the channel (P2c) can never drift into two near-identical widget
// types (`live-channel.ts` importing `ChatTurnEvent` from `chat-http.ts` is
// the same move).
//
// Dates are ISO strings, not `Date`: this crosses JSON both ways. `userId` is
// absent by design — a widget is only ever read by the user who owns it.

import type {
  DisplayWidgetContent,
  DisplayWidgetKind,
  DisplayWidgetSize,
  DisplayWidgetSlot,
} from './display-widget-content.js'

export interface DisplayWidgetView {
  id: string
  /** `'global'` or a workspace id — a LOOSE ref, never resolved here. */
  scopeKey: string
  title: string
  kind: DisplayWidgetKind
  content: DisplayWidgetContent
  slot: DisplayWidgetSlot
  size: DisplayWidgetSize
  /** Position WITHIN the slot, ascending. Not unique across slots. */
  sortOrder: number
  createdBySessionId: string | null
  /** null = stays until removed, cleared or evicted. */
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

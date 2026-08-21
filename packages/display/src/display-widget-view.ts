// Row → wire. The ONE place a stored widget becomes the shape the HTTP
// responses (P2b) and the `upserted` live frame (P2c) carry, so the two can
// never drift into two different widget JSONs.

import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import type { DisplayWidgetRow } from './repositories/index.js'

export function toDisplayWidgetView(row: DisplayWidgetRow): DisplayWidgetView {
  return {
    id: row.id,
    scopeKey: row.scopeKey,
    title: row.title,
    kind: row.kind,
    content: row.content,
    slot: row.slot,
    size: row.size,
    sortOrder: row.sortOrder,
    createdBySessionId: row.createdBySessionId,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

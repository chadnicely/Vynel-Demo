// `display_widgets` — one row per card on the Display, the glanceable board
// beside the conversation. Widgets PERSIST: a restart must find the board the
// way the user left it, so the row (not a memory map) is the truth.
//
// Schema files import from `@vynel/db/dialect` ONLY. `userId` is the tenant
// boundary (kernel FK, cascade). `scopeKey` is a LOOSE text ref — `'global'`
// or a workspace id — with no FK, because the board is a display concern and a
// deleted workspace's widgets are simply unreachable. `createdBySessionId` is
// likewise loose (the session leaf is a sibling). `content` is opaque JSON,
// validated against `@vynel/contracts/display/display-widget-content` at every
// WRITE boundary — reads hand the stored object straight to the wire, which is
// sound precisely because nothing reaches the column unvalidated.

import { table, id, text, integer, json, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import type {
  DisplayWidgetContent,
  DisplayWidgetKind,
  DisplayWidgetSize,
  DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'

export const displayWidgets = table(
  'display_widgets',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    scopeKey: text().notNull(),
    title: text().notNull(),
    kind: text().$type<DisplayWidgetKind>().notNull(),
    content: json<DisplayWidgetContent>().notNull(),
    slot: text().$type<DisplayWidgetSlot>().notNull(),
    size: text().$type<DisplayWidgetSize>().notNull(),
    // Position WITHIN the slot (max + 1 on add) — NOT unique across slots.
    sortOrder: integer().notNull(),
    createdBySessionId: text(), // loose ref — the session whose turn put it up
    expiresAt: timestamp(), // null = stays until removed, cleared or evicted
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (row) => [
    index('idx_display_widgets_user_scope_order').on(row.userId, row.scopeKey, row.sortOrder),
  ],
)

export type DisplayWidgetRow = typeof displayWidgets.$inferSelect
export type NewDisplayWidget = typeof displayWidgets.$inferInsert

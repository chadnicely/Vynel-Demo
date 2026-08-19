// `scope_customizations` — one row per (user, scope): how the user dressed
// that scope's persona and workspace (colours, avatars) and arranged its
// sidebar menu. `scopeKey` is a workspace id or `global`; a LOOSE text ref
// (the workspace row lives in the kernel; a deleted workspace's row is just
// unreachable, and cheap). Written whole on every autosave, read all-at-once
// at boot — no partial updates, so the row IS the customization.
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary. Phase 1 SYNC repo
// discipline.

import { table, id, text, integer, json, timestamp, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import type { MenuEntryLayout, MenuGroupLayout } from '@vynel/contracts/customization/customization-http'

/** The sidebar menu arrangement — stored as one JSON value, replaced whole. */
export type MenuLayout = { groups: MenuGroupLayout[]; entries: MenuEntryLayout[] }

export const scopeCustomizations = table(
  'scope_customizations',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    scopeKey: text().notNull(),
    // The workspace accent (icon, chips, rail): a palette slot OR a hex.
    accentColorSlot: integer(),
    accentCustomColor: text(),
    // The conversation (persona) icon's own colour — Kafi's two-colour model.
    personaColorSlot: integer(),
    personaCustomColor: text(),
    // Data-URL avatars (small, produced by the app's avatar resizer).
    personaImage: text(),
    workspaceImage: text(),
    menuLayout: json<MenuLayout>().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (row) => [uniqueIndex('scope_customizations_user_scope_unique').on(row.userId, row.scopeKey)],
)

export type ScopeCustomization = typeof scopeCustomizations.$inferSelect
export type NewScopeCustomization = typeof scopeCustomizations.$inferInsert

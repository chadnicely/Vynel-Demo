// The `desktop_app_grants` table — one row per (user, app) the user has
// granted desktop access to, at a tier (`read` < `click` < `full`, see
// `access/desktop-access-tiers.ts`). NO row = NO access: every desktop
// operation fails closed until the user approves the app via the
// `request_desktop_access` approval card. `appName` stores the NORMALIZED
// key (`normalizeDesktopAppKey`), never the raw query string, so enforcement
// is exact-match — a grant can never fuzzily cover a different app.

import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import type { DesktopAccessTier } from '../access/desktop-access-tiers.js'

export const desktopAppGrants = table(
  'desktop_app_grants',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Normalized grant key — `normalizeDesktopAppKey` is the one gate.
    appName: text().notNull(),
    tier: text().$type<DesktopAccessTier>().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    byUser: index('idx_desktop_app_grants_user').on(t.userId),
    uniqueUserApp: uniqueIndex('uniq_desktop_app_grants_user_app').on(t.userId, t.appName),
  }),
)

export type DesktopAppGrantRow = typeof desktopAppGrants.$inferSelect
export type NewDesktopAppGrantRow = typeof desktopAppGrants.$inferInsert

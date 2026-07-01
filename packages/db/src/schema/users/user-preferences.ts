// The `user_preferences` table — extensible key-value preferences per user
// (theme, default workspace, etc.). Values are JSON-encoded strings.
// Composite PK on [userId, preferenceKey] covers `WHERE userId = ?` reads
// via the PK prefix. Spec: `docs/blueprints/users/blueprint.md §3.2`.

import { table, id, text, timestamp, primaryKey } from '@vynel/db/dialect'
import { users } from './users.js'

export const userPreferences = table(
  'user_preferences',
  {
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    preferenceKey: text().notNull(),
    preferenceValue: text().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.preferenceKey] }),
  }),
)

export type UserPreference = typeof userPreferences.$inferSelect
export type NewUserPreference = typeof userPreferences.$inferInsert

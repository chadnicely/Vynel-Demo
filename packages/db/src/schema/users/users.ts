// The `users` table — the local user record. Phase 1: exactly one row,
// generated on first run. Holds the `userId` every other row carries.
// Spec: `docs/blueprints/users/blueprint.md §3.1`.

import { table, id, text, timestamp, boolean } from '@vynel/db/dialect'

export const users = table('users', {
  id: id().primaryKey(),
  displayName: text().notNull(),
  emailAddress: text(),
  locale: text().notNull(),
  timezone: text().notNull(),
  hasCompletedOnboarding: boolean().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

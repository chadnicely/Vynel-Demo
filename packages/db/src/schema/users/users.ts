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
  // The folder new projects are minted into (`resolveNewProjectDirectory`).
  // Null = the shared default (`~/Documents/Vynel`); the durable seam for a
  // future Settings field that lets the user choose their own — no onboarding
  // step writes it today (the name-workspace step was dropped, 2026-08-27).
  projectsDirectory: text(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

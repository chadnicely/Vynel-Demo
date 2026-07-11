// The hub's account rows — kernel-core like `users` in `@vynel/db`: every
// future cloud leaf (registry, plans/grants) references `accountId`.
// Accounts are NOT self-serve: Chad's platform provisions them over webhooks
// (docs/module-notes/cloud-api.md §4); the desktop app only signs in.

import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const accounts = pgTable(
  'accounts',
  {
    id: text().primaryKey(),
    // Stored ALREADY-LOWERCASED — the repository normalizes on insert and
    // lookup, so a plain unique index gives case-insensitive uniqueness
    // without citext or an expression index (one home for the rule).
    email: text().notNull(),
    displayName: text().notNull(),
    // Null until the set-your-password email link is used — the platform
    // never sends us a password (cloud-api.md §3).
    passwordHash: text(),
    // The provisioning platform's own user id — the idempotency key for its
    // webhooks. Null for accounts created by the hub-side admin fallback.
    platformUserId: text(),
    // 'active' | 'disabled' — disabled by user.removed / revocation; checked
    // at sign-in and refresh, enforced as app logic (not a DB enum: adding a
    // status must not need a migration).
    status: text().notNull().default('active'),
    // The access tier ('basic' | 'pro' — app-enforced union, contracts
    // TIER_FEATURES is the matrix). Set by the platform's tier.updated
    // webhook / the admin fallback; stamped into the entitlement JWT.
    tier: text().notNull().default('basic'),
    // Null = no expiry (until the platform says otherwise). A lapsed term
    // means the entitlement stamps `basic` regardless of `tier`.
    tierExpiresAt: timestamp({ withTimezone: true, mode: 'date' }),
    // 'member' | 'admin' — admin unlocks the catalog-management surface
    // (cloud-admin-web). App-enforced union like `status`; authority is read
    // FRESH per request, never from the ~7-day token claim.
    role: text().notNull().default('member'),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_email_unique').on(table.email),
    uniqueIndex('accounts_platform_user_id_unique').on(table.platformUserId),
  ],
)

export type AccountRow = typeof accounts.$inferSelect
export type AccountStatus = 'active' | 'disabled'
export type AccountRole = 'member' | 'admin'

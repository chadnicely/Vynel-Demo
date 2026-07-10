// One row per issued refresh token. A DEVICE is a token FAMILY: sign-in
// creates a family (familyId = first token's id); every rotation revokes the
// old row and inserts a new one in the same family. Presenting a REVOKED
// token is the reuse-detection signal (a stolen token was replayed after
// rotation) — the whole family is revoked (cloud-api.md §3).

import { pgTable, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { accounts } from '@vynel/cloud-db/schema/accounts'

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    familyId: text().notNull(),
    // sha256 of the random secret — NOT argon2: a 256-bit random secret
    // doesn't need a slow hash, and the unique index needs a deterministic
    // unsalted digest for O(1) lookup.
    tokenHash: text().notNull(),
    deviceName: text().notNull(),
    devicePlatform: text().notNull(),
    appVersion: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Sliding ~1-year window, re-stamped on every rotation — the
    // "log in once" half of the two-token split.
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    // Null = active. Set by rotation (superseded), sign-out, device
    // revocation, family revocation, and account disable.
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(table.tokenHash),
    index('refresh_tokens_account_id_idx').on(table.accountId),
    index('refresh_tokens_family_id_idx').on(table.familyId),
  ],
)

export type RefreshTokenRow = typeof refreshTokens.$inferSelect

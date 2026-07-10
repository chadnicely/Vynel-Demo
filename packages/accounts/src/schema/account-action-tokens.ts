// Single-use email-link tokens: the platform-provisioned "set your password"
// invite and the password-reset link share one table + one confirm flow —
// both end in "the user proves email control and sets a password"
// (cloud-api.md §3: the platform never sends us a password).

import { pgTable, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { accounts } from '@vynel/cloud-db/schema/accounts'

export const accountActionTokens = pgTable(
  'account_action_tokens',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    // 'invite' | 'password-reset' — app-enforced, not a DB enum (a new kind
    // must not need a migration).
    kind: text().notNull(),
    // sha256 of the random link secret — same reasoning as refresh_tokens.
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    // Null = outstanding. Set on confirm; re-requesting expires outstanding
    // tokens of the same kind first (one live link per kind per account).
    usedAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_action_tokens_token_hash_unique').on(table.tokenHash),
    index('account_action_tokens_account_id_idx').on(table.accountId),
  ],
)

export type AccountActionTokenRow = typeof accountActionTokens.$inferSelect
export type AccountActionTokenKind = 'invite' | 'password-reset'

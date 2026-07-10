// Functional action-token repository (set-password email links) — `db` first
// arg, stateless, async.

import { and, eq, isNull } from 'drizzle-orm'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  accountActionTokens,
  type AccountActionTokenKind,
  type AccountActionTokenRow,
} from '../../schema/account-action-tokens.js'

export interface InsertActionTokenInput {
  readonly id: string
  readonly accountId: string
  readonly kind: AccountActionTokenKind
  readonly tokenHash: string
  readonly expiresAt: Date
}

export async function insertActionToken(
  db: CloudDatabase,
  input: InsertActionTokenInput,
): Promise<AccountActionTokenRow> {
  const rows = await db.insert(accountActionTokens).values(input).returning()
  return rows[0] as AccountActionTokenRow
}

export async function findActionTokenByHash(
  db: CloudDatabase,
  tokenHash: string,
): Promise<AccountActionTokenRow | null> {
  const rows = await db
    .select()
    .from(accountActionTokens)
    .where(eq(accountActionTokens.tokenHash, tokenHash))
    .limit(1)
  return rows[0] ?? null
}

/** Claims the single-use token: returns 0 when it was already used —
 * including a CONCURRENT confirm that won the race. */
export async function markActionTokenUsed(
  db: CloudDatabase,
  input: { readonly actionTokenId: string; readonly usedAt: Date },
): Promise<number> {
  const used = await db
    .update(accountActionTokens)
    .set({ usedAt: input.usedAt })
    .where(
      and(eq(accountActionTokens.id, input.actionTokenId), isNull(accountActionTokens.usedAt)),
    )
    .returning({ id: accountActionTokens.id })
  return used.length
}

/** One live link per kind per account: re-requesting kills the old link. */
export async function expireOutstandingActionTokens(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly kind: AccountActionTokenKind; readonly now: Date },
): Promise<void> {
  await db
    .update(accountActionTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(accountActionTokens.accountId, input.accountId),
        eq(accountActionTokens.kind, input.kind),
        isNull(accountActionTokens.usedAt),
      ),
    )
}

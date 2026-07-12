// Functional accounts repository — `db` first arg, stateless, async (pg).
// Email normalization lives HERE (insert + lookup lowercase) so the plain
// unique index on `email` is case-insensitive in practice — see the schema
// comment; callers never lowercase themselves.

import { desc, eq } from 'drizzle-orm'
import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '../../client.js'
import {
  accounts,
  type AccountRow,
  type AccountRole,
  type AccountStatus,
} from '../../schema/accounts/accounts.js'

export interface InsertAccountInput {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly platformUserId?: string
  readonly passwordHash?: string
}

export async function insertAccount(
  db: CloudDatabase,
  input: InsertAccountInput,
): Promise<AccountRow> {
  const rows = await db
    .insert(accounts)
    .values({
      id: input.id,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      platformUserId: input.platformUserId ?? null,
      passwordHash: input.passwordHash ?? null,
    })
    .returning()
  // `.returning()` on a single-row insert always yields exactly one row.
  return rows[0] as AccountRow
}

export async function findAccountByEmail(
  db: CloudDatabase,
  email: string,
): Promise<AccountRow | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email.toLowerCase()))
    .limit(1)
  return rows[0] ?? null
}

export async function findAccountById(
  db: CloudDatabase,
  accountId: string,
): Promise<AccountRow | null> {
  const rows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1)
  return rows[0] ?? null
}

export async function getAccountByIdOrThrow(
  db: CloudDatabase,
  accountId: string,
): Promise<AccountRow> {
  const account = await findAccountById(db, accountId)
  if (account === null) throw new NotFoundError('account', accountId)
  return account
}

/** What the admin surface may see of an account. An explicit allowlist —
 * never the full row, so `passwordHash` and platform internals cannot leak
 * onto the wire by accident. */
export interface AccountAdminListRow {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly role: string
  readonly tier: string
  readonly tierExpiresAt: Date | null
  readonly status: string
  readonly createdAt: Date
}

export async function listAccountsForAdmin(db: CloudDatabase): Promise<AccountAdminListRow[]> {
  return db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      role: accounts.role,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
}

export async function updateAccountPasswordHash(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly passwordHash: string },
): Promise<void> {
  await db
    .update(accounts)
    .set({ passwordHash: input.passwordHash, updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

export async function setAccountStatus(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly status: AccountStatus },
): Promise<void> {
  await db
    .update(accounts)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

export async function setAccountTier(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly tier: string; readonly tierExpiresAt: Date | null },
): Promise<void> {
  await db
    .update(accounts)
    .set({ tier: input.tier, tierExpiresAt: input.tierExpiresAt, updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

export async function setAccountRole(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<void> {
  await db
    .update(accounts)
    .set({ role: input.role, updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

export async function findAccountByPlatformUserId(
  db: CloudDatabase,
  platformUserId: string,
): Promise<AccountRow | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.platformUserId, platformUserId))
    .limit(1)
  return rows[0] ?? null
}

export async function updateAccountDisplayName(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly displayName: string },
): Promise<void> {
  await db
    .update(accounts)
    .set({ displayName: input.displayName, updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

/** Stored lowercased (case-insensitive uniqueness). Throws a pg 23505 if the
 * email now belongs to another account — the caller maps that to a conflict. */
export async function updateAccountEmail(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly email: string },
): Promise<void> {
  await db
    .update(accounts)
    .set({ email: input.email.toLowerCase(), updatedAt: new Date() })
    .where(eq(accounts.id, input.accountId))
}

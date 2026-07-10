// Functional refresh-token repository — `db` first arg, stateless, async.
// A device = a token FAMILY (see the schema comment); rows are revoked, never
// deleted, so reuse detection can recognize a replayed superseded token.

import { and, eq, gt, isNull } from 'drizzle-orm'
import type { CloudDatabase } from '@vynel/cloud-db'
import { refreshTokens, type RefreshTokenRow } from '../../schema/refresh-tokens.js'

export interface InsertRefreshTokenInput {
  readonly id: string
  readonly accountId: string
  readonly familyId: string
  readonly tokenHash: string
  readonly deviceName: string
  readonly devicePlatform: string
  readonly appVersion: string
  readonly expiresAt: Date
}

export async function insertRefreshToken(
  db: CloudDatabase,
  input: InsertRefreshTokenInput,
): Promise<RefreshTokenRow> {
  const rows = await db.insert(refreshTokens).values(input).returning()
  return rows[0] as RefreshTokenRow
}

export async function findRefreshTokenByHash(
  db: CloudDatabase,
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)
  return rows[0] ?? null
}

/** Returns how many rows were revoked: 0 means someone else consumed the
 * token concurrently — the caller's reuse-detection signal. */
export async function revokeRefreshToken(
  db: CloudDatabase,
  input: { readonly refreshTokenId: string; readonly revokedAt: Date },
): Promise<number> {
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: input.revokedAt })
    .where(and(eq(refreshTokens.id, input.refreshTokenId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id })
  return revoked.length
}

export async function revokeRefreshTokenFamily(
  db: CloudDatabase,
  input: { readonly familyId: string; readonly revokedAt: Date },
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: input.revokedAt })
    .where(and(eq(refreshTokens.familyId, input.familyId), isNull(refreshTokens.revokedAt)))
}

export async function revokeAllRefreshTokensForAccount(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly revokedAt: Date },
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: input.revokedAt })
    .where(and(eq(refreshTokens.accountId, input.accountId), isNull(refreshTokens.revokedAt)))
}

/** The account's live sessions — one active row per device family. */
export async function listActiveRefreshTokensForAccount(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly now: Date },
): Promise<RefreshTokenRow[]> {
  return db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.accountId, input.accountId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, input.now),
      ),
    )
}

export async function findRefreshTokenById(
  db: CloudDatabase,
  refreshTokenId: string,
): Promise<RefreshTokenRow | null> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.id, refreshTokenId))
    .limit(1)
  return rows[0] ?? null
}

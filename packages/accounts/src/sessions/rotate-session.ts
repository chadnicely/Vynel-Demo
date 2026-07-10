// The boot-time account-status check (cloud-api.md §4): the desktop presents
// its refresh token; a good account gets a rotated refresh token + fresh
// access JWT; a revoked/disabled account gets its whole session torn down.
// Reuse detection: a REVOKED token presented again means a superseded secret
// was replayed (theft signal) — the entire family dies.

import { randomUUID } from 'node:crypto'
import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountById } from '@vynel/cloud-db/repositories/accounts'
import { hashOpaqueSecret, generateOpaqueSecret } from '../tokens/opaque-secret.js'
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokenFamily,
} from '../repositories/refresh-tokens/index.js'
import { refreshTokenExpiry, type AuthenticatedSession, type SessionDeps } from './session-types.js'

const SESSION_EXPIRED_MESSAGE = 'Session expired — sign in again.'

export async function rotateSession(
  db: CloudDatabase,
  input: { readonly refreshToken: string },
  deps: SessionDeps,
): Promise<AuthenticatedSession> {
  const now = deps.now?.() ?? new Date()
  const presented = await findRefreshTokenByHash(db, hashOpaqueSecret(input.refreshToken))
  if (presented === null) {
    throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE)
  }
  if (presented.revokedAt !== null) {
    await revokeRefreshTokenFamily(db, { familyId: presented.familyId, revokedAt: now })
    throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE)
  }
  if (presented.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE)
  }

  const account = await findAccountById(db, presented.accountId)
  if (account === null || account.status !== 'active') {
    // The revocation moment: tier pulled / user.removed → next boot check
    // lands here, every device session dies, the app locks to sign-in.
    await revokeRefreshTokenFamily(db, { familyId: presented.familyId, revokedAt: now })
    throw new ForbiddenError('This account is disabled. Contact support.')
  }

  const nextSecret = generateOpaqueSecret()
  // Revoke-then-insert runs atomically, and the revoke must claim EXACTLY
  // this live row: zero rows revoked means a concurrent rotation consumed the
  // same secret first (a replay landing inside the victim's rotation window)
  // — the reuse signal, so the family dies instead of forking two live chains.
  // The family kill happens OUTSIDE the transaction: a throw inside would
  // roll it back.
  const rotated = await db.transaction(async (tx) => {
    const revokedCount = await revokeRefreshToken(tx, {
      refreshTokenId: presented.id,
      revokedAt: now,
    })
    if (revokedCount === 0) return false
    await insertRefreshToken(tx, {
      id: randomUUID(),
      accountId: presented.accountId,
      familyId: presented.familyId,
      tokenHash: hashOpaqueSecret(nextSecret),
      deviceName: presented.deviceName,
      devicePlatform: presented.devicePlatform,
      appVersion: presented.appVersion,
      expiresAt: refreshTokenExpiry(now),
    })
    return true
  })
  if (!rotated) {
    await revokeRefreshTokenFamily(db, { familyId: presented.familyId, revokedAt: now })
    throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE)
  }

  const access = await deps.accessTokens.issue({
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
  })
  const entitlementToken = await deps.entitlements.issue({
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    tier: account.tier,
    tierExpiresAt: account.tierExpiresAt,
  })
  return {
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: nextSecret,
    entitlementToken,
  }
}

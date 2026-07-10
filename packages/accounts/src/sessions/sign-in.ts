// Email + password sign-in. Anti-enumeration discipline: ONE generic error
// for wrong-email and wrong-password, and a real argon2 verify runs even when
// the account is missing so response timing stays flat (cloud-api.md §3).

import { randomUUID } from 'node:crypto'
import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountByEmail } from '@vynel/cloud-db/repositories/accounts'
import { getTimingDummyPasswordHash, verifyPassword } from '../passwords/password-hash.js'
import { generateOpaqueSecret, hashOpaqueSecret } from '../tokens/opaque-secret.js'
import { insertRefreshToken } from '../repositories/refresh-tokens/index.js'
import {
  refreshTokenExpiry,
  type AuthenticatedSession,
  type DeviceDescription,
  type SessionDeps,
} from './session-types.js'

const WRONG_CREDENTIALS_MESSAGE = 'Wrong email or password.'

export interface SignInWithPasswordInput {
  readonly email: string
  readonly password: string
  readonly device: DeviceDescription
}

export async function signInWithPassword(
  db: CloudDatabase,
  input: SignInWithPasswordInput,
  deps: SessionDeps,
): Promise<AuthenticatedSession> {
  const now = deps.now?.() ?? new Date()
  const account = await findAccountByEmail(db, input.email)

  if (account === null || account.passwordHash === null) {
    await verifyPassword(await getTimingDummyPasswordHash(), input.password)
    throw new UnauthorizedError(WRONG_CREDENTIALS_MESSAGE)
  }
  const passwordMatches = await verifyPassword(account.passwordHash, input.password)
  if (!passwordMatches) {
    throw new UnauthorizedError(WRONG_CREDENTIALS_MESSAGE)
  }
  // Status is checked only AFTER password proof: "disabled" is not a secret
  // to the account's owner (the desktop needs the distinct 403 to lock), but
  // it must not be probeable by anyone typing random passwords.
  if (account.status !== 'active') {
    throw new ForbiddenError('This account is disabled. Contact support.')
  }

  const refreshSecret = generateOpaqueSecret()
  const refreshTokenId = randomUUID()
  await insertRefreshToken(db, {
    id: refreshTokenId,
    accountId: account.id,
    // A fresh sign-in starts a fresh family — the device identity.
    familyId: refreshTokenId,
    tokenHash: hashOpaqueSecret(refreshSecret),
    deviceName: input.device.deviceName,
    devicePlatform: input.device.devicePlatform,
    appVersion: input.device.appVersion,
    expiresAt: refreshTokenExpiry(now),
  })

  const access = await deps.accessTokens.issue({
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
  })
  return {
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refreshSecret,
  }
}

// The devices surface: list an account's live sessions, revoke one (family
// kill), and sign out the presenting device. Chad's revocable-devices ask
// (cloud-api.md §3).

import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import { hashOpaqueSecret } from '../tokens/opaque-secret.js'
import {
  findRefreshTokenByHash,
  findRefreshTokenById,
  listActiveRefreshTokensForAccount,
  revokeRefreshTokenFamily,
} from '../repositories/refresh-tokens/index.js'

export interface DeviceView {
  /** The device's current refresh-token row id — pass to revokeDevice. */
  readonly id: string
  readonly deviceName: string
  readonly devicePlatform: string
  readonly appVersion: string
  readonly lastUsedAt: Date
  readonly expiresAt: Date
}

export async function listDevices(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly now?: Date },
): Promise<DeviceView[]> {
  const rows = await listActiveRefreshTokensForAccount(db, {
    accountId: input.accountId,
    now: input.now ?? new Date(),
  })
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    devicePlatform: row.devicePlatform,
    appVersion: row.appVersion,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  }))
}

export async function revokeDevice(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly deviceId: string; readonly now?: Date },
): Promise<void> {
  const row = await findRefreshTokenById(db, input.deviceId)
  // Ownership check folded into existence — another account's device id is
  // indistinguishable from a missing one (no cross-account probing).
  if (row === null || row.accountId !== input.accountId) {
    throw new NotFoundError('device', input.deviceId)
  }
  await revokeRefreshTokenFamily(db, { familyId: row.familyId, revokedAt: input.now ?? new Date() })
}

/** Sign-out: kill the presenting device's family. Unknown token = no-op
 * (the outcome the caller wanted already holds). */
export async function signOut(
  db: CloudDatabase,
  input: { readonly refreshToken: string; readonly now?: Date },
): Promise<void> {
  const row = await findRefreshTokenByHash(db, hashOpaqueSecret(input.refreshToken))
  if (row === null) return
  await revokeRefreshTokenFamily(db, { familyId: row.familyId, revokedAt: input.now ?? new Date() })
}

// Shared shapes for the session flows (sign-in / rotate / devices).

import type { AccessTokenIssuer } from '../tokens/access-token.js'
import type { EntitlementTokenIssuer } from '../tokens/entitlement-token.js'

// Sliding window re-stamped on every rotation — Chad's "log in once" call
// (cloud-api.md §3: the LONG lifetime lives in the refresh token, never in
// the signed JWT).
export const REFRESH_TOKEN_TTL_DAYS = 365

export interface DeviceDescription {
  readonly deviceName: string
  readonly devicePlatform: string
  readonly appVersion: string
}

export interface SessionDeps {
  readonly accessTokens: AccessTokenIssuer
  readonly entitlements: EntitlementTokenIssuer
  readonly now?: () => Date
}

export interface AuthenticatedSession {
  readonly accountId: string
  readonly email: string
  readonly displayName: string
  readonly accessToken: string
  readonly accessTokenExpiresAt: Date
  /** The raw refresh secret — returned once, stored hashed. */
  readonly refreshToken: string
  /** Signed tier+features proof, verified offline by the desktop (§4). */
  readonly entitlementToken: string
}

export function refreshTokenExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
}

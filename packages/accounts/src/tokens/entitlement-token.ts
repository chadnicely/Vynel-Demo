// The signed ENTITLEMENT JWT — the offline-verifiable proof of tier +
// features (cloud-api.md §4). ~7-day expiry IS the offline grace window.
// Same Ed25519 keypair as the access token, but with a `kid` header from day
// one: the desktop PINS the public key, so rotation must be able to overlap
// two keys without a breaking change (reviewer precondition, M2a).
// Identity claims (email/displayName) ride along so an offline boot can show
// who is signed in from this one stored token.
//
// The VERIFY side lives in `@vynel/hub-account` (the desktop leaf) — issue
// and verify are different systems with different key material access.

import { SignJWT } from 'jose'
import type { KeyLike } from 'jose'
import { importPKCS8 } from 'jose'
import {
  TIER_FEATURES,
  HUB_TOKEN_ISSUER,
  HUB_ENTITLEMENT_TOKEN_USE,
  type HubTier,
} from '@vynel/contracts/hub/entitlements'

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

export interface EntitlementTokenIssuer {
  issue(account: {
    readonly accountId: string
    readonly email: string
    readonly displayName: string
    readonly tier: string
    readonly tierExpiresAt: Date | null
  }): Promise<string>
}

/** A lapsed term or an unknown tier string stamps `basic` — the entitlement
 * NEVER grants more than the hub can currently vouch for. */
export function resolveEffectiveTier(
  tier: string,
  tierExpiresAt: Date | null,
  now: Date,
): HubTier {
  if (tierExpiresAt !== null && tierExpiresAt.getTime() <= now.getTime()) return 'basic'
  return tier === 'pro' ? 'pro' : 'basic'
}

export async function createEntitlementTokenIssuer(options: {
  readonly privateKeyPem: string
  readonly keyId: string
  readonly ttlSeconds?: number
  readonly now?: () => Date
}): Promise<EntitlementTokenIssuer> {
  const privateKey: KeyLike = await importPKCS8(options.privateKeyPem, 'EdDSA')
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const now = options.now ?? (() => new Date())
  return {
    async issue(account) {
      const issuedAt = now()
      const tier = resolveEffectiveTier(account.tier, account.tierExpiresAt, issuedAt)
      return new SignJWT({
        email: account.email,
        displayName: account.displayName,
        tier,
        features: [...TIER_FEATURES[tier]],
        token_use: HUB_ENTITLEMENT_TOKEN_USE,
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: options.keyId })
        .setSubject(account.accountId)
        .setIssuer(HUB_TOKEN_ISSUER)
        .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
        .setExpirationTime(Math.floor(issuedAt.getTime() / 1000) + ttlSeconds)
        .sign(privateKey)
    },
  }
}

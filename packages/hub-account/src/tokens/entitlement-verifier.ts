// Verifies the hub's entitlement JWT against the PINNED public key — fully
// offline, which is the whole point: tier + features stay provable through
// the ~7-day grace window without connectivity (cloud-api.md §4). The issue
// side lives in `@vynel/accounts` (hub-only key material); verification is
// the desktop's half.

import { jwtVerify, importSPKI } from 'jose'
import type { KeyLike } from 'jose'
import { UnauthorizedError } from '@vynel/errors'
import {
  HUB_TOKEN_ISSUER,
  HUB_ENTITLEMENT_TOKEN_USE,
  type HubEntitlementClaims,
  type HubFeatureKey,
  type HubTier,
} from '@vynel/contracts/hub/entitlements'

export interface EntitlementVerifier {
  /** Throws UnauthorizedError for expired/invalid — callers treat that as
   * "no entitlement", never as a crash. */
  verify(token: string): Promise<HubEntitlementClaims>
}

export async function createEntitlementVerifier(options: {
  readonly publicKeyPem: string
}): Promise<EntitlementVerifier> {
  const publicKey: KeyLike = await importSPKI(options.publicKeyPem, 'EdDSA')
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: HUB_TOKEN_ISSUER,
          algorithms: ['EdDSA'],
        })
        // token_use MUST be 'entitlement' — the access token shares this key
        // + issuer (an access token lacks tier/features so it would fail
        // below anyway, but the check is the real defense, not luck).
        if (
          payload['token_use'] !== HUB_ENTITLEMENT_TOKEN_USE ||
          typeof payload.sub !== 'string' ||
          typeof payload['email'] !== 'string' ||
          typeof payload['tier'] !== 'string' ||
          !Array.isArray(payload['features']) ||
          payload.exp === undefined
        ) {
          throw new Error('missing or wrong claims')
        }
        return {
          accountId: payload.sub,
          email: payload['email'],
          displayName:
            typeof payload['displayName'] === 'string' ? payload['displayName'] : '',
          tier: payload['tier'] as HubTier,
          features: payload['features'].filter(
            (f): f is HubFeatureKey => typeof f === 'string',
          ),
          expiresAtMs: payload.exp * 1000,
        }
      } catch {
        throw new UnauthorizedError('Entitlement token invalid or expired.')
      }
    },
  }
}

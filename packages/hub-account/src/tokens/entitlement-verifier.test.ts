// The desktop's entitlement verifier: reads a valid entitlement token,
// enforces expiry, and rejects a same-key/same-issuer token that carries the
// wrong `token_use` (the access token — the confusion the hub issues both
// from one key). Tokens are hand-signed inline so this leaf stays free of the
// hub-side `@vynel/accounts` issuer (no cross-leaf import).

import { generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, SignJWT } from 'jose'
import type { KeyLike } from 'jose'
import { describe, it, expect, beforeAll } from 'vitest'
import { HUB_TOKEN_ISSUER } from '@vynel/contracts/hub/entitlements'
import { createEntitlementVerifier, type EntitlementVerifier } from './entitlement-verifier.js'

let signingKey: KeyLike
let verifier: EntitlementVerifier

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  signingKey = await importPKCS8(await exportPKCS8(privateKey), 'EdDSA')
  verifier = await createEntitlementVerifier({ publicKeyPem: await exportSPKI(publicKey) })
})

function signToken(
  claims: Record<string, unknown>,
  options: { expSecondsFromNow?: number } = {},
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setSubject('a1')
    .setIssuer(HUB_TOKEN_ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + (options.expSecondsFromNow ?? 3600))
    .sign(signingKey)
}

describe('createEntitlementVerifier', () => {
  it('verifies a valid entitlement token and exposes tier + features', async () => {
    const token = await signToken({
      email: 'c@e.com',
      displayName: 'C',
      tier: 'pro',
      features: ['channels', 'voice'],
      token_use: 'entitlement',
    })
    const claims = await verifier.verify(token)
    expect(claims).toMatchObject({ accountId: 'a1', tier: 'pro', email: 'c@e.com' })
    expect(claims.features).toContain('voice')
  })

  it('rejects a token with the wrong token_use (an access token)', async () => {
    const accessShaped = await signToken({ email: 'c@e.com', displayName: 'C', token_use: 'access' })
    await expect(verifier.verify(accessShaped)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects an expired entitlement token', async () => {
    const expired = await signToken(
      { email: 'c@e.com', displayName: 'C', tier: 'pro', features: ['channels'], token_use: 'entitlement' },
      { expSecondsFromNow: -10 },
    )
    await expect(verifier.verify(expired)).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

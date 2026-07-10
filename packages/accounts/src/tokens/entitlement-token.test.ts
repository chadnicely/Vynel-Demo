// resolveEffectiveTier (the security-critical downgrades) + the issuer/
// token_use separation that keeps an entitlement token from authenticating
// as an access token.

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import { describe, it, expect } from 'vitest'
import {
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  resolveEffectiveTier,
} from '../index.js'

describe('resolveEffectiveTier', () => {
  const now = new Date('2026-07-10T00:00:00Z')

  it('honors pro only while the term is live', () => {
    expect(resolveEffectiveTier('pro', null, now)).toBe('pro')
    const future = new Date(now.getTime() + 1000)
    expect(resolveEffectiveTier('pro', future, now)).toBe('pro')
  })

  it('downgrades a lapsed term to basic', () => {
    const past = new Date(now.getTime() - 1000)
    expect(resolveEffectiveTier('pro', past, now)).toBe('basic')
  })

  it('treats an unknown tier string as basic', () => {
    expect(resolveEffectiveTier('enterprise', null, now)).toBe('basic')
    expect(resolveEffectiveTier('', null, now)).toBe('basic')
  })
})

describe('token separation', () => {
  it('an entitlement token does NOT authenticate as an access token', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
    const entitlements = await createEntitlementTokenIssuer({
      privateKeyPem: await exportPKCS8(privateKey),
      keyId: 'k1',
    })
    const entToken = await entitlements.issue({
      accountId: 'a1',
      email: 'c@e.com',
      displayName: 'C',
      tier: 'pro',
      tierExpiresAt: null,
    })
    // Same key + issuer — but the access verifier must reject it (token_use).
    // The reverse (entitlement verifier rejects an access token) is covered in
    // @vynel/hub-account, which owns the entitlement verifier.
    const accessVerifier = await createAccessTokenVerifier({
      publicKeyPem: await exportSPKI(publicKey),
    })
    await expect(accessVerifier.verify(entToken)).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

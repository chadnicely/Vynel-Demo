// The short-lived signed access JWT — the offline-verifiable half of the
// two-token split (cloud-api.md §3). EdDSA (Ed25519): the private key exists
// only in the hub's env; surfaces verify with the public key. M3's
// entitlement claims (tier/features/limits) extend this same token.

import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose'
import type { KeyLike } from 'jose'
import { UnauthorizedError } from '@vynel/errors'

const ACCESS_TOKEN_ISSUER = 'vynel-hub'

export interface AccessTokenClaims {
  readonly accountId: string
  readonly email: string
  readonly displayName: string
}

export interface AccessTokenIssuer {
  issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }>
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessTokenClaims>
}

export async function createAccessTokenIssuer(options: {
  readonly privateKeyPem: string
  readonly ttlSeconds: number
}): Promise<AccessTokenIssuer> {
  const privateKey: KeyLike = await importPKCS8(options.privateKeyPem, 'EdDSA')
  return {
    async issue(claims) {
      const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000)
      const token = await new SignJWT({ email: claims.email, displayName: claims.displayName })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject(claims.accountId)
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(privateKey)
      return { token, expiresAt }
    },
  }
}

export async function createAccessTokenVerifier(options: {
  readonly publicKeyPem: string
}): Promise<AccessTokenVerifier> {
  const publicKey: KeyLike = await importSPKI(options.publicKeyPem, 'EdDSA')
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, { issuer: ACCESS_TOKEN_ISSUER })
        if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
          throw new Error('missing claims')
        }
        return {
          accountId: payload.sub,
          email: payload['email'],
          displayName: typeof payload['displayName'] === 'string' ? payload['displayName'] : '',
        }
      } catch {
        // One generic error for expired/malformed/wrong-key — the client's
        // move is the same either way: refresh, then sign in again.
        throw new UnauthorizedError('Access token invalid or expired — refresh the session.')
      }
    },
  }
}

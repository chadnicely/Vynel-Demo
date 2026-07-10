// Access-JWT bearer guard for account-scoped routes. Verification is offline
// (public key) — no DB read; the claims land on c.var for the handler.

import type { MiddlewareHandler } from 'hono'
import { UnauthorizedError } from '@vynel/errors'
import type { AccessTokenVerifier, AccessTokenClaims } from '@vynel/accounts'

export interface AccountVariables {
  account: AccessTokenClaims
}

export function requireAccount(
  verifier: AccessTokenVerifier,
): MiddlewareHandler<{ Variables: AccountVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    if (!header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Sign in to use this route.')
    }
    c.set('account', await verifier.verify(header.slice('Bearer '.length)))
    await next()
  }
}

// Guards for the /admin surface. Two doors, one core:
//   - the static CLOUD_ADMIN_TOKEN bearer (server-to-server: the publish CLI,
//     bootstrap role grants) — sha256-digested timingSafeEqual comparison;
//   - a signed-in account whose role is 'admin', read FRESH from the DB on
//     every request (the tier staleness rule applied to authority — a demoted
//     admin loses the surface immediately, not at token expiry).

import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import { resolveActiveAccountRole, type AccessTokenVerifier } from '@vynel/accounts'
import type { CloudDatabase } from '@vynel/cloud-db'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export interface RequireAdminAccessOptions {
  readonly adminToken: string
  readonly accessTokenVerifier: AccessTokenVerifier
  readonly db: CloudDatabase
}

export function requireAdminAccess(options: RequireAdminAccessOptions): MiddlewareHandler {
  const expected = digest(options.adminToken)
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (presented === '') {
      throw new UnauthorizedError('Admin access needs a bearer token.')
    }
    // Door 1: the static server-to-server token.
    if (timingSafeEqual(digest(presented), expected)) {
      await next()
      return
    }
    // Door 2: a signed-in admin account. Verify the access JWT, then read the
    // role FRESH — never from the token.
    let accountId: string
    try {
      accountId = (await options.accessTokenVerifier.verify(presented)).accountId
    } catch {
      throw new UnauthorizedError('Admin token or an admin sign-in is required.')
    }
    const role = await resolveActiveAccountRole(options.db, accountId)
    if (role !== 'admin') {
      throw new ForbiddenError('This account is not an admin.')
    }
    await next()
  }
}

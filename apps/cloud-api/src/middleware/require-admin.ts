// Bearer guard for the /admin fallback surface. Compares sha256 digests via
// timingSafeEqual — digesting first makes the comparison length-independent.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { UnauthorizedError } from '@vynel/errors'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function requireAdminToken(adminToken: string): MiddlewareHandler {
  const expected = digest(adminToken)
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (presented === '' || !timingSafeEqual(digest(presented), expected)) {
      throw new UnauthorizedError('Admin token missing or wrong.')
    }
    await next()
  }
}

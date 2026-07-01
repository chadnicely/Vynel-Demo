// The Phase 1 → Phase 2 auth seam. Phase 1: resolves the single local
// user via `getOrCreateLocalUser` (the only middleware allowed to call
// that core op besides `server.ts` boot). Phase 2: the `auth` domain
// rewrites this file to validate sessions and return the authenticated
// user instead.
//
// Robust to a missing user row even though the boot sequence should
// prevent that — falls back to creating one. Spec:
// `docs/blueprints/users/blueprint.md §6` + decision D6.

import { getOrCreateLocalUser } from '@vynel/core/users'
import { factory } from '../factory.js'

export const userResolverMiddleware = factory.createMiddleware(async (c, next) => {
  const user = getOrCreateLocalUser(c.var.db, { logger: c.var.logger })
  c.set('user', user)
  await next()
})

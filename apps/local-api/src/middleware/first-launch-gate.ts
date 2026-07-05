// The first-launch gate. Returns 412 `onboarding_required` for any
// non-onboarding route while the single local user hasn't completed onboarding
// (D6); the web client maps the 412 to a wizard redirect (carrying the
// inProgressRunId). It is a cross-cutting PRECONDITION gate (like a Phase-2 auth
// 401), not a domain error — so it lives in middleware and returns inline.
//
// It resolves the user via the READ-ONLY `findSingleLocalUser` (NOT
// getOrCreateLocalUser — that's D7-restricted to boot + the user-resolver), so
// it never mutates and never trips the SDK generator (which builds the app with
// stub deps and only requests `/openapi.json` — skipped below before any db
// access). Spec: blueprint.md §12.1 + decisions.md D6 + D7.
//
// Wired in `createApp` behind `enableFirstLaunchGate` — OFF by default (domain
// route tests stay ungated), enabled by `server.ts` for production.

import { findSingleLocalUser } from '@vynel/db/repositories/users'
import { checkIfOnboardingNeeded } from '@vynel/onboarding'
import { factory } from '../factory.js'

export const firstLaunchGateMiddleware = factory.createMiddleware(async (c, next) => {
  const path = c.req.path
  // Onboarding routes + the OpenAPI spec are always allowed (and the skip
  // happens BEFORE any c.var.db access, keeping the SDK generator's stub-deps
  // /openapi.json request safe).
  if (path === '/openapi.json' || path === '/onboarding' || path.startsWith('/onboarding/')) {
    await next()
    return
  }

  const user = findSingleLocalUser(c.var.db)
  if (!user) {
    return c.json(
      { code: 'onboarding_required', message: 'Complete setup first.', inProgressRunId: null },
      412,
    )
  }

  const status = checkIfOnboardingNeeded(c.var.db, user.id)
  if (status.needsOnboarding) {
    return c.json(
      {
        code: 'onboarding_required',
        message: 'Complete setup first.',
        inProgressRunId: status.inProgressRunId,
      },
      412,
    )
  }

  await next()
})

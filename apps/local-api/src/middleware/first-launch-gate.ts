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

// `GET /providers/:id/auth` + the sign-in handshake under it.
const PROVIDER_AUTH_PATH = /^\/providers\/[^/]+\/auth(\/login(\/.*)?)?$/
// The GitHub device-flow handshake.
const GITHUB_SIGN_IN_PATH = /^\/github\/connection\/sign-in(\/.*)?$/

// The reads + sign-in doors setup ITSELF needs: "Connect a brain" asks whether
// Claude is signed in and "A safe copy on GitHub" whether `gh` is. Gating
// those deadlocks setup — the brain step would always read as not-connected,
// and its own rule ("nothing builds without a brain") blocks the run forever.
//
// Deliberately narrow: status reads + handshakes only. The rest of
// `/providers/*` (models, limits, skills) and `DELETE /github/connection` stay
// gated, and no response here carries a secret — the CLIs hold their own
// credentials.
function isAllowedDuringOnboarding(method: string, path: string): boolean {
  if (path === '/openapi.json') return true
  if (path === '/onboarding' || path.startsWith('/onboarding/')) return true
  if (PROVIDER_AUTH_PATH.test(path)) return true
  if (path === '/github/connection') return method === 'GET'
  return GITHUB_SIGN_IN_PATH.test(path)
}

export const firstLaunchGateMiddleware = factory.createMiddleware(async (c, next) => {
  // The skip happens BEFORE any c.var.db access, keeping the SDK generator's
  // stub-deps /openapi.json request safe.
  if (isAllowedDuringOnboarding(c.req.method, c.req.path)) {
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

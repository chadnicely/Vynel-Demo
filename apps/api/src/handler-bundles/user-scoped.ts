// The `userScoped` handler bundle. Composes `userResolverMiddleware` into
// a typed handler tuple that route files spread into route definitions
// with `...userScoped`. Phase 2's `auth` domain may replace the
// underlying middleware here without route-level edits — the bundle is
// the stable seam.
//
// Spec in `docs/blueprints/users/blueprint.md §6` + `docs/blueprints/users/
// coding.md §6.4`. Body filled by `/build-domain users` TDD step 20.

import { factory } from '../factory.js'
import { userResolverMiddleware } from '../middleware/user-resolver.js'

export const userScoped = factory.createHandlers(userResolverMiddleware)

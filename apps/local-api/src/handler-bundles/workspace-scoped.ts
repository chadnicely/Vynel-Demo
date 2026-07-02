// The `workspaceScoped` handler bundle. Composes `userResolverMiddleware`
// + `workspaceResolverMiddleware` into a typed handler tuple that route
// files spread into route definitions with `...workspaceScoped`.
//
// Spec: `docs/blueprints/workspaces/blueprint.md §7`. Body filled by
// `/build-domain workspaces` TDD step 18.

import { factory } from '../factory.js'
import { userResolverMiddleware } from '../middleware/user-resolver.js'
import { workspaceResolverMiddleware } from '../middleware/workspace-resolver.js'

export const workspaceScoped = factory.createHandlers(
  userResolverMiddleware,
  workspaceResolverMiddleware,
)

// The `sessionScoped` handler bundle for chat session-detail routes.
// Composes `userResolverMiddleware` + `workspaceResolverMiddleware` +
// `chatSessionResolverMiddleware` into a typed handler tuple per D21
// triple-check. Spread into route definitions with `...sessionScoped`.
//
// Spec: `docs/blueprints/chat/blueprint.md §7.3`.

import { factory } from '../factory.js'
import { userResolverMiddleware } from '../middleware/user-resolver.js'
import { workspaceResolverMiddleware } from '../middleware/workspace-resolver.js'
import { chatSessionResolverMiddleware } from '../middleware/chat-session-resolver.js'

export const sessionScoped = factory.createHandlers(
  userResolverMiddleware,
  workspaceResolverMiddleware,
  chatSessionResolverMiddleware,
)

// The workspace-resolver middleware. Reads `:workspaceId` from the
// request path, scopes by `c.var.user.id`, injects `c.var.workspace`,
// and fire-and-forgets `touchWorkspaceLastAccessedAt` (the only
// sanctioned fire-and-forget in this domain per
// `docs/blueprints/workspaces/coding.md §1.5`).
//
// `getWorkspaceById` returns the same `NotFoundError('workspace', id)`
// for both not-found and not-owned (no enumeration leak — D17 + D18).
//
// Spec: `docs/blueprints/workspaces/blueprint.md §7`. Composed into the
// `workspaceScoped` handler bundle. No standalone test — exercised by
// the route integration tests (§10.3), matching the `user-resolver.ts`
// precedent.

import { getWorkspaceById } from '@vynel/workspaces'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import { factory } from '../factory.js'

export const workspaceResolverMiddleware = factory.createMiddleware(async (c, next) => {
  const workspaceId = c.req.param('workspaceId')
  if (!workspaceId) {
    throw new Error('workspaceResolverMiddleware: route is missing the :workspaceId param')
  }

  const workspace = await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
  c.set('workspace', workspace)

  // Phase 1: touchWorkspaceLastAccessedAt is sync. Wrap in a microtask so
  // a throw never reaches the handler; the catch logs rather than
  // swallows. The only sanctioned fire-and-forget in this domain
  // (coding.md §1.5). Phase 2 Postgres flips this to a promise + .catch.
  queueMicrotask(() => {
    try {
      workspacesRepository.touchWorkspaceLastAccessedAt(c.var.db, workspaceId)
    } catch (err) {
      c.var.logger.warn({ err, workspaceId }, 'failed to touch workspace lastAccessedAt')
    }
  })

  await next()
})

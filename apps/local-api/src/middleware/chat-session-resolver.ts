// The chat-session-resolver middleware. Reads `:sessionId` from the request
// path, triple-checks user + workspace + soft-delete (per D21), sets
// `c.var.chatSession`. Mirrors `workspace-resolver.ts` shape (sync repo call;
// plain Error for missing param; NotFoundError for any of the 4 resolution
// failure modes — no enumeration leak).
//
// Spec: `docs/blueprints/chat/blueprint.md §7.3`.

import { findChatSessionById } from '@vynel/chat/repositories'
import { NotFoundError } from '@vynel/errors'
import { factory } from '../factory.js'

export const chatSessionResolverMiddleware = factory.createMiddleware(async (c, next) => {
  const sessionId = c.req.param('sessionId')
  if (!sessionId) {
    throw new Error('chatSessionResolverMiddleware: route is missing the :sessionId param')
  }

  const session = findChatSessionById(c.var.db, sessionId)

  // Triple-check (D21): user ownership + workspace ownership + soft-delete
  // filter. All 4 failure modes return the same NotFoundError — no
  // enumeration leak (workspaces D14 precedent).
  if (
    !session ||
    session.userId !== c.var.user.id ||
    session.workspaceId !== c.var.workspace!.id ||
    session.deletedAt !== null
  ) {
    throw new NotFoundError('chat-session', sessionId)
  }

  c.set('chatSession', session)
  await next()
})

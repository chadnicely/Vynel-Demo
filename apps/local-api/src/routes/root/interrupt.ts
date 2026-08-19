// POST /turn/interrupt — stop a RUNNING turn on the user's own top-level
// threads, server-side. The composer's Stop used to only abort the client
// stream: the server-side turn kept running detached to completion (and could
// keep delegating). This is the missing lever.
//
// IDENTITY-SHAPED (session-hardening D3): the caller names the session its
// Stop belongs to. Before this the route always resolved the GLOBAL primary,
// so the Voice chat panel's Stop interrupted the global thread — a control on
// one thread killing work on another, reachable since the lock split let
// global and voice run concurrently. Omitting `sessionId` keeps the old
// behaviour for callers that know no session id yet.
//
// Split out of `index.ts` (D4). No `x-mcp` — a human stop control, never an
// agent tool.

import { resolver, validator } from 'hono-openapi/zod'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { NotFoundError } from '@vynel/errors'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { interruptChatSession } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  InterruptGlobalTurnRequestSchema,
  InterruptGlobalTurnResponseSchema,
} from './schemas.js'

// The two chains this door may stop. A workspace room has its own interrupt
// (`/workspaces/:id/chat/sessions/:id/interrupt`) and a spawned session is
// stopped through its delegation, so admitting them here would only widen the
// blast radius of a mis-sent Stop.
const INTERRUPTIBLE_SCOPES = new Set(['global', 'voice'])

export const interruptRoutes = factory
  .createApp()
  .post(
    '/turn/interrupt',
    describeRoute({
      tags: ['root'],
      summary: "Interrupt a running turn on the caller's global or voice thread.",
      'x-sdk-name': 'root.interruptTurn',
      responses: {
        200: {
          description:
            '{ interrupted } — false when the named session (or the global root) has no session to interrupt.',
          content: {
            'application/json': { schema: resolver(InterruptGlobalTurnResponseSchema) },
          },
        },
        404: {
          description: 'The named session is unknown, not owned, or not a global/voice chain.',
        },
      },
    }),
    validator('json', InterruptGlobalTurnRequestSchema),
    ...userScoped,
    async (c) => {
      const { sessionId: namedSessionId } = c.req.valid('json')
      if (namedSessionId !== undefined) {
        const session = findChatSessionById(c.var.db, namedSessionId)
        // Unknown, not-owned and out-of-scope answer the same 404 — the
        // enumeration-leak rule this file's siblings already follow.
        if (
          session === null ||
          session.userId !== c.var.user.id ||
          !INTERRUPTIBLE_SCOPES.has(session.scope)
        ) {
          throw new NotFoundError('session', namedSessionId)
        }
        await interruptChatSession(DEFAULT_PROVIDER_ID, namedSessionId)
        return c.json({ interrupted: true })
      }
      // No id: the global root's head, as before.
      const primary = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      const sessionId = primary?.currentSdkSessionId ?? null
      if (sessionId === null) return c.json({ interrupted: false })
      await interruptChatSession(DEFAULT_PROVIDER_ID, sessionId)
      return c.json({ interrupted: true })
    },
  )

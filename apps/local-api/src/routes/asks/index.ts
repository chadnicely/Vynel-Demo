// The `asks` HTTP surface — USER-scoped only, mounted at `/asks` from
// `apps/local-api/src/app.ts`:
//
//   GET  /pending          -> listPendingAsks    [UI poll — the notifier]
//   POST /:askId/answer    -> resolveAskRequest(answered) + unblock the waiter
//   POST /:askId/dismiss   -> resolveAskRequest(dismissed) + unblock the waiter
//
// NO x-mcp anywhere — the agent's surface is the `vynel-ask` descriptor tool
// (`ask_user`), never these routes; the answering surface is always the user.
// Not featureGated: Ask is core interaction plumbing, like approvals.
//
// Resolution order is DB FIRST, then waiter: the op commits the answer +
// outbox event, and only then is the parked tool resumed — the awaiting turn
// can never observe answers the DB doesn't hold. A missing waiter (the turn
// died between poll and answer) is logged and tolerated — the row still
// records the user's input.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { listPendingAsks, resolveAskRequest } from '@vynel/asks'
import { serializeAskRequestForResponse } from './serializers.js'
import {
  AskParamSchema,
  AnswerAskRequestSchema,
  AskRequestResponseSchema,
  ListPendingAsksResponseSchema,
} from './schemas.js'

export const asksApp = factory
  .createApp()
  // GET /pending — the notifier poll (newest first).
  .get(
    '/pending',
    describeRoute({
      tags: ['asks'],
      summary: "List the user's pending asks (forms Claude is waiting on).",
      'x-sdk-name': 'asks.listPending',
      responses: {
        200: {
          description: 'Array of AskRequest (pending only, newest first).',
          content: { 'application/json': { schema: resolver(ListPendingAsksResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const asks = listPendingAsks(c.var.db, { userId: c.var.user.id })
      return c.json(asks.map(serializeAskRequestForResponse))
    },
  )
  // POST /:askId/answer — submit the wizard; unblocks the waiting turn.
  .post(
    '/:askId/answer',
    describeRoute({
      tags: ['asks'],
      summary: 'Answer a pending ask (unblocks the waiting turn).',
      'x-sdk-name': 'asks.answer',
      responses: {
        200: {
          description: 'AskRequest (answered).',
          content: { 'application/json': { schema: resolver(AskRequestResponseSchema) } },
        },
        400: { description: "The answers don't fit the form." },
        404: { description: 'No such pending ask owned by this user.' },
        409: { description: 'The ask was already resolved.' },
      },
    }),
    validator('param', AskParamSchema),
    validator('json', AnswerAskRequestSchema),
    ...userScoped,
    (c) => {
      const { askId } = c.req.valid('param')
      const resolved = resolveAskRequest(
        c.var.db,
        {
          askId,
          userId: c.var.user.id,
          resolution: { kind: 'answered', answers: c.req.valid('json').answers },
        },
        { logger: c.var.logger },
      )
      // For kind:'answered' the op always returns validated answers — a null
      // here is an impossible state, not a default to paper over.
      if (resolved.validatedAnswers === null) {
        throw new Error('resolveAskRequest returned no validated answers for an answered ask')
      }
      const unblocked = c.var.askWaiters.resolve(askId, {
        answered: true,
        answers: resolved.validatedAnswers,
      })
      if (!unblocked) {
        c.var.logger.warn({ askId }, 'ask answered but no waiter was parked (turn already gone)')
      }
      return c.json(serializeAskRequestForResponse(resolved))
    },
  )
  // POST /:askId/dismiss — the explicit "proceed without me".
  .post(
    '/:askId/dismiss',
    describeRoute({
      tags: ['asks'],
      summary: 'Dismiss a pending ask (the turn proceeds without the answers).',
      'x-sdk-name': 'asks.dismiss',
      responses: {
        200: {
          description: 'AskRequest (dismissed).',
          content: { 'application/json': { schema: resolver(AskRequestResponseSchema) } },
        },
        404: { description: 'No such pending ask owned by this user.' },
        409: { description: 'The ask was already resolved.' },
      },
    }),
    validator('param', AskParamSchema),
    ...userScoped,
    (c) => {
      const { askId } = c.req.valid('param')
      const resolved = resolveAskRequest(
        c.var.db,
        { askId, userId: c.var.user.id, resolution: { kind: 'dismissed' } },
        { logger: c.var.logger },
      )
      const unblocked = c.var.askWaiters.resolve(askId, { answered: false, reason: 'dismissed' })
      if (!unblocked) {
        c.var.logger.warn({ askId }, 'ask dismissed but no waiter was parked (turn already gone)')
      }
      return c.json(serializeAskRequestForResponse(resolved))
    },
  )

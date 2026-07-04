// The `approvals` HTTP surface — the GLOBAL approval queue, mounted under
// `/approvals` from `apps/local-api/src/app.ts`. USER-scoped (NOT
// workspace-scoped): the queue spans every session + workspace + the brain, so
// the user answers a card from any surface.
//
//   GET  /pending                     -> listPendingApprovalsForUser
//   POST /:providerApprovalId/decide  -> resolveApproval
//
// NO `x-mcp` on either route — approvals are the sensitive human-in-the-loop
// path (D16: no MCP exposure in Phase 1); an agent must never self-approve.
//
// Responses are CAST from `@vynel/contracts` (`ApprovalRequestResponse`) per the
// approvals cast-from-contracts convention — no response Zod (contrast knowledge's
// `resolver()`). Locked Hono protocol: `describeRoute` (local `openapi.js` wrapper
// widening the type for `x-sdk-name`) -> `validator` (hono-openapi/zod) ->
// `...userScoped` -> handler. `VynelError` -> HTTP via the global `app.onError`
// (`NotFoundError` 404 / `ConflictError` 409) — handlers just throw.

import { validator } from 'hono-openapi/zod'
import {
  listPendingApprovalsForUser,
  resolveApproval,
  type ResolveApprovalInput,
} from '@vynel/approvals'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ApprovalRequestParamSchema, ResolveApprovalRequestBodySchema } from './schemas.js'
import { serializeApprovalRequestForResponse } from './serializers.js'

export const approvalsApp = factory
  .createApp()
  .get(
    '/pending',
    describeRoute({
      tags: ['approvals'],
      summary:
        'List every pending approval for the user — the global queue, across all sessions/workspaces + the brain.',
      'x-sdk-name': 'approvals.listPending',
      responses: {
        200: { description: 'Pending approval requests, newest first (ApprovalRequestResponse[]).' },
      },
    }),
    ...userScoped,
    (c) =>
      c.json(
        listPendingApprovalsForUser(c.var.db, c.var.user.id).map(serializeApprovalRequestForResponse),
      ),
  )
  .post(
    '/:providerApprovalId/decide',
    describeRoute({
      tags: ['approvals'],
      summary:
        'Resolve an approval — approve (optionally with edited input / a remembered rule) or deny with a reason.',
      'x-sdk-name': 'approvals.decide',
      responses: {
        200: { description: 'Resolved; the paused agent is unblocked (ApprovalRequestResponse).' },
        404: { description: 'No pending approval with that id for this user.' },
        409: { description: 'The approval was already resolved.' },
      },
    }),
    validator('param', ApprovalRequestParamSchema),
    validator('json', ResolveApprovalRequestBodySchema),
    ...userScoped,
    async (c) => {
      const { providerApprovalId } = c.req.valid('param')
      const body = c.req.valid('json')
      // Conditional spread for `exactOptionalPropertyTypes` — Zod `.optional()`
      // yields `T | undefined`, but the op's fields are truly optional (`T?`).
      const decision: ResolveApprovalInput['decision'] =
        body.kind === 'denied'
          ? { kind: 'denied', reason: body.reason }
          : {
              kind: 'approved',
              ...(body.updatedInput !== undefined ? { updatedInput: body.updatedInput } : {}),
              ...(body.rememberRule !== undefined ? { rememberRule: body.rememberRule } : {}),
            }
      const updated = await resolveApproval(
        c.var.db,
        { providerApprovalId, userId: c.var.user.id, providerId: DEFAULT_PROVIDER_ID, decision },
        { logger: c.var.logger },
      )
      return c.json(serializeApprovalRequestForResponse(updated))
    },
  )

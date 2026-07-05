// The USER-scoped `approvals` HTTP surface — the GLOBAL approval queue, mounted
// at `/approvals` (NO workspace prefix) from `apps/local-api/src/app.ts`,
// alongside the workspace-scoped twins (`/workspaces/:workspaceId/approvals` +
// `/workspaces/:workspaceId/approval-rules`, `./index.ts`). USER-scoped (NOT
// workspace-scoped): the queue spans every session + workspace + the brain, so
// the user answers a card from any surface.
//
//   GET  /pending                     -> listPendingApprovalsForUser
//   POST /:providerApprovalId/decide  -> resolveApproval
//
// NO `x-mcp` on either route — approvals are the sensitive human-in-the-loop
// path (D16: no MCP exposure in Phase 1); an agent must never self-approve.
//
// Serializers still cast to `@vynel/contracts` (`ApprovalRequestResponse`) per the
// approvals cast-from-contracts convention — that stays the cross-app source of
// truth `apps/local-web` casts to — but each response also carries a `resolver()`
// schema (`ApprovalRequestResponseSchema` in `./schemas.js`) so the OpenAPI spec,
// and therefore the generated SDK return types, are real (mirrors the workspaces
// group's identical fix). Locked Hono protocol: `describeRoute` (local
// `openapi.js` wrapper widening the type for `x-sdk-name`) -> `validator`
// (hono-openapi/zod) -> `...userScoped` -> handler. `VynelError` -> HTTP via the
// global `app.onError` (`NotFoundError` 404 / `ConflictError` 409) — handlers
// just throw.

import { resolver, validator } from 'hono-openapi/zod'
import {
  listPendingApprovalsForUser,
  resolveApproval,
  type ResolveApprovalInput,
} from '@vynel/approvals'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  ApprovalRequestParamSchema,
  ApprovalRequestResponseSchema,
  ListPendingApprovalsResponseSchema,
  ResolveApprovalRequestBodySchema,
} from './schemas.js'
import { serializeApprovalRequestForResponse } from './serializers.js'

export const approvalsUserApp = factory
  .createApp()
  .get(
    '/pending',
    describeRoute({
      tags: ['approvals'],
      summary:
        'List every pending approval for the user — the global queue, across all sessions/workspaces + the brain.',
      'x-sdk-name': 'approvals.listPending',
      responses: {
        200: {
          description: 'Pending approval requests, newest first (ApprovalRequestResponse[]).',
          content: { 'application/json': { schema: resolver(ListPendingApprovalsResponseSchema) } },
        },
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
        200: {
          description: 'Resolved; the paused agent is unblocked (ApprovalRequestResponse).',
          content: { 'application/json': { schema: resolver(ApprovalRequestResponseSchema) } },
        },
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

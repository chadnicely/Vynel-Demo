// The workspace-scoped `approvals` HTTP surface — two Hono sub-apps (source:
// `docs/blueprints/approvals/blueprint.md §7` + D15), mounted from
// `apps/local-api/src/app.ts`:
//   app.route('/workspaces/:workspaceId/approvals', approvalsApp)
//   app.route('/workspaces/:workspaceId/approval-rules', approvalRulesApp)
//
// approvalsApp routes (workspace-scoped):
//   GET    /pending                    -> pending requests
//   GET    /recent                     -> recent requests (cursor)
//   POST   /:providerApprovalId/decide -> resolveApproval
//
// approvalRulesApp routes (workspace-scoped):
//   GET    /                           -> active rules
//   DELETE /:ruleId                    -> softDeleteApprovalRule
//
// The USER-scoped global queue (`/approvals`) lives in `./user-scoped.ts`.
//
// Locked Hono protocol: describeRoute (local `openapi.js` wrapper) → validator
// (hono-openapi/zod) → `...workspaceScoped` → handler. Handlers THROW typed
// errors; the global `onError` maps them (`NotFoundError` 404 /
// `ConflictError` 409). MCP: only the safe-read GETs are exposed — decide +
// rule delete stay unexposed (an agent must never self-approve).
//
// `resolveApproval`'s core contract is deliberately USER-scoped (the global
// queue answers a card from any surface), so the decide route enforces the
// workspace boundary HERE with the same 404 as "missing" — no enumeration
// leak (knowledge getDocument precedent).

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/errors'
import {
  findApprovalRequestByProviderApprovalId,
  listApprovalRequestsForWorkspace,
  listApprovalRulesForWorkspace,
  resolveApproval,
  softDeleteApprovalRule,
  type ResolveApprovalInput,
} from '@vynel/approvals'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  ApprovalRequestParamSchema,
  ApprovalRequestResponseSchema,
  ApprovalRequestListResponseSchema,
  ApprovalRuleListResponseSchema,
  ApprovalRuleParamSchema,
  ListPendingQuerySchema,
  ListRecentQuerySchema,
  ResolveApprovalRequestBodySchema,
} from './schemas.js'
import {
  serializeApprovalRequestForResponse,
  serializeApprovalRuleForResponse,
} from './serializers.js'

export const approvalsApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /pending — list pending requests in this workspace
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/pending',
    describeRoute({
      tags: ['approvals'],
      summary: 'List pending approval requests for the workspace (workspace-scoped).',
      'x-sdk-name': 'approvalsWorkspace.listPending',
      responses: {
        200: {
          description: 'Array of ApprovalRequest (status=pending).',
          content: { 'application/json': { schema: resolver(ApprovalRequestListResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListPendingQuerySchema),
    ...workspaceScoped,
    (c) => {
      const rows = listApprovalRequestsForWorkspace(c.var.db, c.var.workspace!.id, { limit: 200 })
        .filter((row) => row.status === 'pending')
      return c.json(rows.map(serializeApprovalRequestForResponse))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /recent — cursor-paginated audit view
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/recent',
    describeRoute({
      tags: ['approvals'],
      summary: 'List recent approval requests (cursor-paginated; audit view).',
      'x-sdk-name': 'approvalsWorkspace.listRecent',
      responses: {
        200: {
          description: 'Array of ApprovalRequest, ordered by requestedAt desc.',
          content: { 'application/json': { schema: resolver(ApprovalRequestListResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListRecentQuerySchema),
    ...workspaceScoped,
    (c) => {
      const q = c.req.valid('query')
      const options: { limit?: number; cursor?: { requestedAt: Date; id: string } } = {}
      if (q.limit !== undefined) options.limit = q.limit
      if (q.cursorRequestedAt && q.cursorId) {
        options.cursor = { requestedAt: q.cursorRequestedAt, id: q.cursorId }
      }
      const rows = listApprovalRequestsForWorkspace(c.var.db, c.var.workspace!.id, options)
      return c.json(rows.map(serializeApprovalRequestForResponse))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /:providerApprovalId/decide — approve or deny
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/:providerApprovalId/decide',
    describeRoute({
      tags: ['approvals'],
      summary:
        'Resolve an approval — approve (optionally with edited input and/or remember-rule) or deny (with reason).',
      'x-sdk-name': 'approvalsWorkspace.decide',
      responses: {
        200: {
          description: 'Approval resolved; provider unblocked (ApprovalRequestResponse).',
          content: { 'application/json': { schema: resolver(ApprovalRequestResponseSchema) } },
        },
        404: { description: 'No active approval request with that id in this workspace.' },
        409: { description: 'Approval has already been resolved.' },
      },
    }),
    validator('param', ApprovalRequestParamSchema),
    validator('json', ResolveApprovalRequestBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { providerApprovalId } = c.req.valid('param')
      const body = c.req.valid('json')
      // Workspace ownership pre-check — the core op is user-scoped by design,
      // so the tenant boundary of THIS surface is enforced at the route.
      const request = findApprovalRequestByProviderApprovalId(c.var.db, providerApprovalId)
      if (!request || request.workspaceId !== c.var.workspace!.id) {
        throw new NotFoundError('approval-request', providerApprovalId)
      }
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

export const approvalRulesApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET / — list active rules in this workspace
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/',
    describeRoute({
      tags: ['approval-rules'],
      summary: 'List approval rules for the workspace (active, non-deleted).',
      'x-sdk-name': 'approvalRules.list',
      responses: {
        200: {
          description: 'Array of ApprovalRule.',
          content: { 'application/json': { schema: resolver(ApprovalRuleListResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    (c) => {
      const rules = listApprovalRulesForWorkspace(c.var.db, c.var.workspace!.id)
      return c.json(rules.map(serializeApprovalRuleForResponse))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // DELETE /:ruleId — soft-delete a rule
  // ──────────────────────────────────────────────────────────────────
  .delete(
    '/:ruleId',
    describeRoute({
      tags: ['approval-rules'],
      summary: 'Soft-delete an approval rule (restorable for 30 days; then hard-purged).',
      'x-sdk-name': 'approvalRules.delete',
      responses: {
        204: { description: 'Rule soft-deleted.' },
        404: { description: 'No active rule with that id in this workspace.' },
      },
    }),
    validator('param', ApprovalRuleParamSchema),
    ...workspaceScoped,
    (c) => {
      const { ruleId } = c.req.valid('param')
      softDeleteApprovalRule(c.var.db, {
        ruleId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      return c.body(null, 204)
    },
  )

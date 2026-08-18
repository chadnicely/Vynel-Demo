// The USER-scoped `plans` HTTP surface — mounted at `/plans` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/plans`). These routes span BOTH scopes: a
// user's GLOBAL (null-workspace) plans AND every workspace plan they own —
// the surface behind the plan panel and the CLI.
//
//   GET    /                  -> listPlansForUser  [x-mcp: list_my_plans]
//   POST   /                  -> createPlan (scope: global|workspace; source=user)
//   PATCH  /:planId           -> updatePlan
//   DELETE /:planId           -> deletePlan (hard delete)
//
// THIS IS THE USER'S SURFACE: `POST /` hard-codes `source: 'user'` (the agent
// creates through its workspace-scoped door, which hard-codes 'assistant' —
// provenance is unspoofable by construction). Only the safe-read `GET /` is
// x-mcp exposed; the mutating routes are panel/CLI-only — the agent's write
// tools live on the workspace-scoped twin. The id-ops authorize by userId
// (the tenant boundary); not-found and not-owned both return an identical 404
// (no enumeration leak).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { createPlan, deletePlan, listPlansForUser, updatePlan } from '@vynel/plans'
import { serializePlanForResponse } from './serializers.js'
import {
  PlanParamSchema,
  ListPlansQuerySchema,
  CreatePlanForUserRequestSchema,
  UpdatePlanRequestSchema,
  PlanResponseSchema,
  ListPlansResponseSchema,
} from './schemas.js'

export const plansUserApp = factory
  .createApp()
  // GET / — every plan the user owns, both scopes (optional status/day filters).
  .get(
    '/',
    describeRoute({
      tags: ['plans'],
      summary: 'List every plan the user owns — global + workspace.',
      'x-sdk-name': 'plansUser.list',
      responses: {
        200: {
          description: 'Array of Plan.',
          content: { 'application/json': { schema: resolver(ListPlansResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_my_plans',
        description:
          'List every plan the user owns — both global (no workspace) and workspace-scoped, ' +
          'newest day first. Each has a title, optional detail, `planDate` (YYYY-MM-DD), status ' +
          '(open / in-progress / done), and who created it. Optional `status` and `planDate` ' +
          'queries narrow the list. Read-only.',
      },
    }),
    validator('query', ListPlansQuerySchema),
    ...userScoped,
    (c) => {
      const { status, planDate, taskId } = c.req.valid('query')
      const plans = listPlansForUser(c.var.db, {
        userId: c.var.user.id,
        ...(status !== undefined ? { status } : {}),
        ...(planDate !== undefined ? { planDate } : {}),
        ...(taskId !== undefined ? { taskId } : {}),
      })
      return c.json(plans.map(serializePlanForResponse))
    },
  )
  // POST / — the USER's create door; scope picks global (null workspace) vs a workspace.
  .post(
    '/',
    describeRoute({
      tags: ['plans'],
      summary: 'Create a global or workspace plan (user provenance).',
      'x-sdk-name': 'plansUser.create',
      responses: {
        201: {
          description: 'Plan created.',
          content: { 'application/json': { schema: resolver(PlanResponseSchema) } },
        },
        400: { description: 'Validation error, or workspaceId missing for a workspace scope.' },
      },
    }),
    validator('json', CreatePlanForUserRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const plan = createPlan(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: body.scope === 'global' ? null : body.workspaceId,
          title: body.title,
          planDate: body.planDate,
          source: 'user',
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializePlanForResponse(plan), 201)
    },
  )
  // PATCH /:planId — update a plan the user owns (title, detail, date, status).
  .patch(
    '/:planId',
    describeRoute({
      tags: ['plans'],
      summary: 'Update a plan the user owns (title, detail, date, or status).',
      'x-sdk-name': 'plansUser.update',
      responses: {
        200: {
          description: 'Plan updated.',
          content: { 'application/json': { schema: resolver(PlanResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such plan owned by this user.' },
      },
    }),
    validator('param', PlanParamSchema),
    validator('json', UpdatePlanRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const plan = updatePlan(
        c.var.db,
        {
          planId: c.req.valid('param').planId,
          userId: c.var.user.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.planDate !== undefined ? { planDate: body.planDate } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializePlanForResponse(plan))
    },
  )
  // DELETE /:planId — remove a plan (hard delete; the user's call, never the agent's).
  .delete(
    '/:planId',
    describeRoute({
      tags: ['plans'],
      summary: 'Delete a plan the user owns (hard delete).',
      'x-sdk-name': 'plansUser.delete',
      responses: {
        204: { description: 'Plan deleted.' },
        404: { description: 'No such plan owned by this user.' },
      },
    }),
    validator('param', PlanParamSchema),
    ...userScoped,
    (c) => {
      deletePlan(
        c.var.db,
        { planId: c.req.valid('param').planId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )

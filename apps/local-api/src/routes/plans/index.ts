// The workspace-scoped `plans` HTTP surface — mounted under
// `/workspaces/:workspaceId/plans` from `apps/local-api/src/app.ts`:
//
//   GET    /                  -> listPlans                     [x-mcp]
//   POST   /                  -> createPlan (source=assistant) [x-mcp, mutatingApproved]
//   PATCH  /:planId           -> updatePlan                    [x-mcp, mutatingApproved]
//   POST   /:planId/complete  -> updatePlan(status=done)       [x-mcp, mutatingApproved]
//
// THIS IS THE AGENT'S SURFACE. Plans are the date-wise layer above the task
// list — "what is planned for this day"; a plan's work items are tasks
// carrying its loose `planId` ref. `POST /` hard-codes `source: 'assistant'`
// (there is no source field in the body to spoof); the USER's create/delete
// doors live on the user-scoped twin (`/plans`, source='user'). The `plans.*`
// SDK namespace exists as a generation artifact — app surfaces use
// `plansUser.*`.
//
// Plan writes are deliberately UNCARDED (mutatingApproved, like task writes):
// low-stakes, fully visible in the panel, trivially reversible. Delete is NOT
// exposed to the agent — reopening/completing covers its needs; removal is
// the user's call.
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { createPlan, listPlans, updatePlan } from '@vynel/plans'
import { serializePlanForResponse } from './serializers.js'
import {
  PlanParamSchema,
  ListPlansQuerySchema,
  CreatePlanRequestSchema,
  UpdatePlanRequestSchema,
  PlanResponseSchema,
  ListPlansResponseSchema,
} from './schemas.js'

export const plansApp = factory
  .createApp()
  // GET / — list the workspace's plans (owner-scoped; optional status/day filters).
  .get(
    '/',
    describeRoute({
      tags: ['plans'],
      summary: 'List plans for the active workspace (owner-scoped).',
      'x-sdk-name': 'plans.list',
      responses: {
        200: {
          description: 'Array of Plan.',
          content: { 'application/json': { schema: resolver(ListPlansResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_plans',
        description:
          "List the active workspace's plans (owner-scoped), newest day first. A plan is what is " +
          'planned for a calendar day — title, optional detail, `planDate` (YYYY-MM-DD), status ' +
          '(open / in-progress / done), and who created it. Optional `status` filters to one ' +
          "status; optional `planDate` narrows to one day. A plan's work items are the tasks " +
          'whose `planId` points at it (list_tasks with `planId`). Check this when the user asks ' +
          'what is planned, or before planning new dated work. Read-only.',
      },
    }),
    validator('query', ListPlansQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status, planDate } = c.req.valid('query')
      const plans = listPlans(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
        ...(planDate !== undefined ? { planDate } : {}),
      })
      return c.json(plans.map(serializePlanForResponse))
    },
  )
  // POST / — the AGENT's create door (source is hard-coded 'assistant').
  .post(
    '/',
    describeRoute({
      tags: ['plans'],
      summary: "Create a plan on the active workspace's list (assistant provenance).",
      'x-sdk-name': 'plans.create',
      responses: {
        201: {
          description: 'Plan created.',
          content: { 'application/json': { schema: resolver(PlanResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_plan',
        description:
          'Create a plan for a calendar day — use this when the user lays out dated intent ' +
          '("tomorrow we tackle the launch", "plan Friday for bookkeeping"). `title` is the ' +
          'short label (≤200 chars); `detail` carries the specifics; `planDate` is the day it ' +
          'belongs to (YYYY-MM-DD, required). Phrase titles in plain language the user ' +
          'recognizes. Break the plan into tasks with create_task, passing this plan\'s id as ' +
          '`planId`, and move the plan with update_plan / complete_plan as the day\'s work ' +
          'lands. Side effect: the plan appears in the user\'s plan list.',
        mutatingApproved: true,
      },
    }),
    validator('json', CreatePlanRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const plan = createPlan(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          title: body.title,
          planDate: body.planDate,
          source: 'assistant',
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializePlanForResponse(plan), 201)
    },
  )
  // PATCH /:planId — update title/detail/planDate/status (owner-scoped).
  .patch(
    '/:planId',
    describeRoute({
      tags: ['plans'],
      summary: 'Update a plan (title, detail, date, or status).',
      'x-sdk-name': 'plans.update',
      responses: {
        200: {
          description: 'Plan updated.',
          content: { 'application/json': { schema: resolver(PlanResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such plan owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_plan',
        description:
          'Update a plan. Set status "in-progress" when its day\'s work starts, back to "open" ' +
          'if it stalls, or "done" when everything landed (complete_plan is the shortcut). ' +
          '`planDate` moves the plan to another day when the user reschedules; title/detail ' +
          'edits keep the wording current. Statuses: open / in-progress / done.',
        mutatingApproved: true,
      },
    }),
    validator('param', PlanParamSchema),
    validator('json', UpdatePlanRequestSchema),
    ...workspaceScoped,
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
  // POST /:planId/complete — mark done (stamps completedAt; emits plan.completed).
  .post(
    '/:planId/complete',
    describeRoute({
      tags: ['plans'],
      summary: 'Mark a plan done.',
      'x-sdk-name': 'plans.complete',
      responses: {
        200: {
          description: 'Plan completed.',
          content: { 'application/json': { schema: resolver(PlanResponseSchema) } },
        },
        404: { description: 'No such plan owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'complete_plan',
        description:
          "Mark a plan done when its day's work is finished and verified — typically after its " +
          'linked tasks are complete. The user sees completed plans as the record of what a day ' +
          'delivered.',
        mutatingApproved: true,
      },
    }),
    validator('param', PlanParamSchema),
    ...workspaceScoped,
    (c) => {
      const plan = updatePlan(
        c.var.db,
        { planId: c.req.valid('param').planId, userId: c.var.user.id, status: 'done' },
        { logger: c.var.logger },
      )
      return c.json(serializePlanForResponse(plan))
    },
  )

// Zod request/query schemas for `plans` routes. XxxSchema suffix; API-internal
// (single consumer) so they live beside the routes. Validated via `validator`
// from `hono-openapi/zod`. Caps mirror the core op's
// PLAN_TITLE_MAX_LENGTH / PLAN_DETAIL_MAX_LENGTH; the date shape mirrors
// PLAN_DATE_PATTERN (the core op is the one home).

import { z } from 'zod'
import { PLAN_DATE_PATTERN } from '@vynel/plans'

export const PlanParamSchema = z.object({
  planId: z.string().min(1),
})

const PlanDateSchema = z.string().regex(PLAN_DATE_PATTERN, 'Use the YYYY-MM-DD format.')

export const ListPlansQuerySchema = z.object({
  status: z.enum(['open', 'in-progress', 'done']).optional(),
  planDate: PlanDateSchema.optional(),
})

// The workspace-scoped `POST /` body — the AGENT's create door (the route
// hard-codes source='assistant'; there is no source field to spoof).
export const CreatePlanRequestSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000).optional(),
  planDate: PlanDateSchema,
  sessionId: z.string().min(1).optional(),
})

// The user-scoped `POST /plans` body — the PANEL/CLI create door (the route
// hard-codes source='user'). `scope` discriminates a GLOBAL plan (no
// workspace) from a WORKSPACE plan; the discriminated union makes
// `workspaceId` REQUIRED in the workspace branch (the tasksUser.create
// precedent).
const createPlanFields = {
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000).optional(),
  planDate: PlanDateSchema,
}

export const CreatePlanForUserRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...createPlanFields }),
  z.object({ scope: z.literal('workspace'), workspaceId: z.string().min(1), ...createPlanFields }),
])

export const UpdatePlanRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(4000).nullable().optional(),
  planDate: PlanDateSchema.optional(),
  status: z.enum(['open', 'in-progress', 'done']).optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `PlanResponse` from `@vynel/contracts/plans/plan-http`
// (the type `serializePlanForResponse` is cast to). Declared here — not
// inverted to `z.infer` — because the canonical type lives in contracts; the
// schema exists so `describeRoute` can attach a real OpenAPI response body
// via `resolver()` (the tasks precedent).

const PlanStatusResponseSchema = z.enum(['open', 'in-progress', 'done'])
const PlanSourceResponseSchema = z.enum(['assistant', 'user'])

export const PlanResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = GLOBAL scope — a user-level plan with no workspace.
  workspaceId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  planDate: z.string(), // YYYY-MM-DD
  status: PlanStatusResponseSchema,
  source: PlanSourceResponseSchema,
  sessionId: z.string().nullable(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListPlansResponseSchema = z.array(PlanResponseSchema)

// Zod request/query schemas for `tasks` routes. XxxSchema suffix; API-internal
// (single consumer) so they live beside the routes. Validated via `validator`
// from `hono-openapi/zod`. Caps mirror the core op's
// TASK_TITLE_MAX_LENGTH / TASK_DETAIL_MAX_LENGTH.

import { z } from 'zod'

export const TaskParamSchema = z.object({
  taskId: z.string().min(1),
})

export const StepParamSchema = z.object({
  stepId: z.string().min(1),
})

export const ListTasksQuerySchema = z.object({
  status: z.enum(['open', 'in-progress', 'done']).optional(),
  // Narrow to one plan's work items (loose ref — no FK).
  planId: z.string().min(1).optional(),
})

// The workspace-scoped `POST /` body — the AGENT's create door (the route
// hard-codes source='assistant'; there is no source field to spoof).
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000).optional(),
  sessionId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
})

// The user-scoped `POST /tasks` body — the PANEL/CLI create door (the route
// hard-codes source='user'). `scope` discriminates a GLOBAL task (no
// workspace) from a WORKSPACE task; the discriminated union makes
// `workspaceId` REQUIRED in the workspace branch (the schedulesUser.create
// precedent).
const createTaskFields = {
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000).optional(),
}

export const CreateTaskForUserRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...createTaskFields }),
  z.object({ scope: z.literal('workspace'), workspaceId: z.string().min(1), ...createTaskFields }),
])

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(4000).nullable().optional(),
  status: z.enum(['open', 'in-progress', 'done']).optional(),
  // Attach to a plan; null detaches.
  planId: z.string().min(1).nullable().optional(),
})

// The agent's whole-list replace for a task's steps (`set_task_steps`). Caps
// mirror the core op's STEP_TITLE_MAX_LENGTH / MAX_STEPS_PER_TASK; `planId`
// declares the plan the steps derive from (the tasks leaf cannot read the
// sibling plans leaf to derive it). The writing SESSION is never a body field
// — it comes from the ambient turn-session header.
export const SetTaskStepsRequestSchema = z.object({
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        status: z.enum(['open', 'in-progress', 'done']),
      }),
    )
    .max(50),
  planId: z.string().min(1).nullable().optional(),
})

export const UpdateStepStatusRequestSchema = z.object({
  status: z.enum(['open', 'in-progress', 'done']),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `TaskResponse` from `@vynel/contracts/tasks/task-http`
// (the type `serializeTaskForResponse` is cast to). Declared here — not
// inverted to `z.infer` — because the canonical type lives in contracts; the
// schema exists so `describeRoute` can attach a real OpenAPI response body
// via `resolver()` (the schedules precedent).

const TaskStatusResponseSchema = z.enum(['open', 'in-progress', 'done'])
const TaskSourceResponseSchema = z.enum(['assistant', 'user'])

export const TaskResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = GLOBAL scope — a user-level task with no workspace.
  workspaceId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  status: TaskStatusResponseSchema,
  source: TaskSourceResponseSchema,
  sessionId: z.string().nullable(),
  // Loose cross-feature ref — the plan this task belongs to (no FK).
  planId: z.string().nullable(),
  // The session WORKING the task (stamped on pickup; sessionId = creator).
  assignedSessionId: z.string().nullable(),
  // Step rollup — present on LIST responses only.
  stepsTotal: z.number().optional(),
  stepsDone: z.number().optional(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListTasksResponseSchema = z.array(TaskResponseSchema)

export const TaskStepResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  taskId: z.string(),
  planId: z.string().nullable(),
  sessionId: z.string().nullable(),
  title: z.string(),
  status: TaskStatusResponseSchema,
  orderIndex: z.number(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListTaskStepsResponseSchema = z.array(TaskStepResponseSchema)

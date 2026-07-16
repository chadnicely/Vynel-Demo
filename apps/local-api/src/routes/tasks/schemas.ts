// Zod request/query schemas for `tasks` routes. XxxSchema suffix; API-internal
// (single consumer) so they live beside the routes. Validated via `validator`
// from `hono-openapi/zod`. Caps mirror the core op's
// TASK_TITLE_MAX_LENGTH / TASK_DETAIL_MAX_LENGTH.

import { z } from 'zod'

export const TaskParamSchema = z.object({
  taskId: z.string().min(1),
})

export const ListTasksQuerySchema = z.object({
  status: z.enum(['open', 'in-progress', 'done']).optional(),
})

// The workspace-scoped `POST /` body — the AGENT's create door (the route
// hard-codes source='assistant'; there is no source field to spoof).
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(4000).optional(),
  sessionId: z.string().min(1).optional(),
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
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListTasksResponseSchema = z.array(TaskResponseSchema)

// Zod request/query schemas for the `todos` routes (the working-steps dock).
// XxxSchema suffix; API-internal (single consumer) so they live beside the
// routes. Caps mirror the core op's TODO_TITLE_MAX_LENGTH /
// MAX_TODOS_PER_SESSION.

import { z } from 'zod'

const TodoStatusSchema = z.enum(['open', 'in-progress', 'done'])

export const TodoParamSchema = z.object({
  todoId: z.string().min(1),
})

// The dock reads ONE session's steps; there is no cross-session list.
export const ListTodosQuerySchema = z.object({
  sessionId: z.string().min(1),
})

// The AGENT's whole-list-replace body. NOTE what is absent: no sessionId — the
// turn's session rides the ambient `x-vynel-turn-session` header so the model
// can never write another session's dock.
export const SetTodosRequestSchema = z.object({
  todos: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        status: TodoStatusSchema,
      }),
    )
    .max(50),
})

// The USER's door: ticking a box (or un-ticking it). Title/order belong to the
// session's list — the dock never edits them.
export const UpdateTodoStatusRequestSchema = z.object({
  status: TodoStatusSchema,
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `SessionTodoResponse` from
// `@vynel/contracts/tasks/session-todo-http` (the canonical type); declared
// here so `describeRoute` can attach a real OpenAPI body via `resolver()`.

export const SessionTodoResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  sessionId: z.string(),
  title: z.string(),
  status: TodoStatusSchema,
  orderIndex: z.number(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListSessionTodosResponseSchema = z.array(SessionTodoResponseSchema)

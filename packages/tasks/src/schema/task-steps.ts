// `task_steps` table — the durable STEPS of one task's execution, a sibling of
// `tasks` and `session_todos` inside the same work-tracking leaf. A session
// todo is "what is this session doing right now" (the dock); a task step is
// the task's plan-of-record the user watches on the task panel. The whole
// list is replaced each time the assistant revises it — the session-todos
// semantics, keyed by task (docs/module-notes/task-execution.md).
//
// A step row carries the FULL work linkage (Kafi's clearance 2026-08-18):
// `taskId` is a same-leaf FK (steps die with their task — `tasks` lives in
// this package, so the FK is allowed); `planId` is a LOOSE ref to the sibling
// `plans` leaf (NO FK — the plan the steps derive from; NULL on simple tasks);
// `sessionId` is a LOOSE ref to the chat session that wrote the list
// (server-stamped, never model-supplied). `workspaceId` mirrors the task's
// scope — nullable, NULL = global. Hard-deleted like tasks.

import { table, id, text, integer, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import { tasks } from './tasks.js'

export type TaskStepStatus = 'open' | 'in-progress' | 'done'

export const taskSteps = table(
  'task_steps',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: copied from the task row so the value can never be
    // model-supplied. Uses `text().references(...)` since `id()` is NOT NULL
    // by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // NOT NULL same-leaf FK — a step without its task has nothing to render
    // under, and a hard-deleted task takes its steps with it.
    taskId: id().references(() => tasks.id, { onDelete: 'cascade' }),
    // Loose cross-feature ref — the plan these steps derive from (`plans` is
    // a sibling leaf; NO FK). NULL = a simple task worked without a plan.
    planId: text(),
    // Loose cross-domain ref — the chat session that wrote the list (NO FK).
    sessionId: text(),
    title: text().notNull(),
    status: text().$type<TaskStepStatus>().notNull(),
    // The list is ORDERED; position comes from the array the assistant sends.
    orderIndex: integer().notNull(),
    completedAt: timestamp(), // stamped while status is 'done'
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userTaskIdx: index('idx_task_steps_user_task').on(t.userId, t.taskId),
  }),
)

export type TaskStep = typeof taskSteps.$inferSelect
export type NewTaskStep = typeof taskSteps.$inferInsert

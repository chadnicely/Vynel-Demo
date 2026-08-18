// Outbox event type constants + payload interfaces for the task-steps half of
// the `tasks` leaf — `task-steps.replaced`, `task-step.updated`,
// `task-step.deleted`.
//
// Each event row is co-committed in the same sync `withTransaction(db, …)`
// block as the state change via the `_shared/outbox` infra (architecture
// invariant 5). Mirrors `session-todos-events.ts` — including WHY there is no
// `task-step.completed` twin: a step flipping to done is bookkeeping inside
// the task's execution; the task-level `task.completed` is the fact that
// matters, and a subscriber that wants step completions filters `updated`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only — they
// carry the step row's full work linkage (task/plan/session).

import type { TaskStepStatus } from './repositories/task-steps.js'

export const TASK_STEPS_REPLACED = 'task-steps.replaced' as const
export const TASK_STEP_UPDATED = 'task-step.updated' as const
export const TASK_STEP_DELETED = 'task-step.deleted' as const

export type TaskStepsReplacedPayload = {
  userId: string
  workspaceId: string | null // null = a global (no-workspace) task
  taskId: string
  planId: string | null // null = a simple task worked without a plan
  sessionId: string | null // the session that wrote the list, when known
  stepCount: number
  replacedAt: string
}

export type TaskStepUpdatedPayload = {
  stepId: string
  userId: string
  workspaceId: string | null
  taskId: string
  status: TaskStepStatus
  updatedAt: string
}

export type TaskStepDeletedPayload = {
  stepId: string
  userId: string
  workspaceId: string | null
  taskId: string
  deletedAt: string
}

// HTTP response shape for the TASK-STEPS half of the `tasks` domain — a
// task's durable execution steps on the task panel. Single source of truth
// for the serialized response: `apps/local-api` types
// `serializeTaskStepForResponse`'s return as `TaskStepResponse`;
// `apps/local-web` casts SDK responses to it (the task-http precedent).
//
// Union re-declared locally — `@vynel/contracts` has no `@vynel/db` dep (kept
// in sync with `packages/tasks/src/schema/task-steps.ts`).

export type TaskStepStatus = 'open' | 'in-progress' | 'done'

export interface TaskStepResponse {
  id: string
  userId: string
  // Nullable: the task's own scope (null = a global, no-workspace task).
  workspaceId: string | null
  // The task these steps execute (same-leaf FK — steps die with their task).
  taskId: string
  // Loose cross-feature ref — the plan the steps derive from (no FK; null on
  // a simple task worked without a plan).
  planId: string | null
  // Loose cross-domain ref — the session that wrote the list (no FK).
  sessionId: string | null
  title: string
  status: TaskStepStatus
  // Position in the list the assistant sent (0-based, ascending).
  orderIndex: number
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

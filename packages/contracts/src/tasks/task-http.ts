// HTTP response shape for the `tasks` domain. Single source of truth for the
// serialized response: `apps/local-api` types `serializeTaskForResponse`'s
// return as `TaskResponse`; `apps/local-web` casts SDK responses to it (the
// schedules/channels cast-from-contracts precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (kept in sync with `packages/tasks/src/schema/tasks.ts`).

export type TaskStatus = 'open' | 'in-progress' | 'done'
export type TaskSource = 'assistant' | 'user'

export interface TaskResponse {
  id: string
  userId: string
  // Nullable to match the schema (NULL = GLOBAL scope — a user-level task
  // with no workspace).
  workspaceId: string | null
  title: string
  detail: string | null
  status: TaskStatus
  source: TaskSource
  sessionId: string | null
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

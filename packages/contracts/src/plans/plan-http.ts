// HTTP response shape for the `plans` domain. Single source of truth for the
// serialized response: `apps/local-api` types `serializePlanForResponse`'s
// return as `PlanResponse`; `apps/local-web` casts SDK responses to it (the
// tasks cast-from-contracts precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (kept in sync with `packages/plans/src/schema/plans.ts`).

export type PlanStatus = 'open' | 'in-progress' | 'done'
export type PlanSource = 'assistant' | 'user'

export interface PlanResponse {
  id: string
  userId: string
  // Nullable to match the schema (NULL = GLOBAL scope — a user-level plan
  // with no workspace).
  workspaceId: string | null
  title: string
  detail: string | null
  /** YYYY-MM-DD — the day this plan belongs to */
  planDate: string
  status: PlanStatus
  source: PlanSource
  sessionId: string | null
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

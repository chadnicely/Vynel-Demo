// HTTP response shape for the WORKING-STEPS half of the `tasks` domain — the
// dock above the chat composer. Single source of truth for the serialized
// response: `apps/local-api` types `serializeSessionTodoForResponse`'s return
// as `SessionTodoResponse`; `apps/local-web` casts SDK responses to it (the
// task-http precedent).
//
// Union re-declared locally — `@vynel/contracts` has no `@vynel/db` dep (kept
// in sync with `packages/tasks/src/schema/session-todos.ts`).

export type SessionTodoStatus = 'open' | 'in-progress' | 'done'

export interface SessionTodoResponse {
  id: string
  userId: string
  // Nullable: the session's own scope (null = the global root, a spawned session).
  workspaceId: string | null
  // Loose cross-domain ref — the chat session these steps belong to (no FK).
  sessionId: string
  title: string
  status: SessionTodoStatus
  // Position in the list the session sent (0-based, ascending).
  orderIndex: number
  /** ISO-8601 or null */
  completedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

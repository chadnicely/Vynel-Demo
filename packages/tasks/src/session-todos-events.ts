// Outbox event type constants + payload interfaces for the working-steps half
// of the `tasks` leaf — `session-todos.replaced`, `session-todo.updated`,
// `session-todo.deleted`.
//
// Each event row is co-committed in the same sync `withTransaction(db, …)`
// block as the state change via the `_shared/outbox` infra (architecture
// invariant 5). Mirrors `tasks-events.ts`.
//
// WHY no `session-todo.completed` twin (tasks has one): a task completion is
// the fact future subscribers care about — it is what the assistant DELIVERED.
// A step flipping to done is bookkeeping inside one turn; it rides the plain
// `updated` event with its status, and a subscriber that wants completions can
// filter on it.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { SessionTodoStatus } from './repositories/session-todos.js'

export const SESSION_TODOS_REPLACED = 'session-todos.replaced' as const
export const SESSION_TODO_UPDATED = 'session-todo.updated' as const
export const SESSION_TODO_DELETED = 'session-todo.deleted' as const

export type SessionTodosReplacedPayload = {
  userId: string
  workspaceId: string | null // null = the session has no workspace
  sessionId: string
  todoCount: number
  replacedAt: string
}

export type SessionTodoUpdatedPayload = {
  todoId: string
  userId: string
  workspaceId: string | null
  sessionId: string
  status: SessionTodoStatus
  updatedAt: string
}

export type SessionTodoDeletedPayload = {
  todoId: string
  userId: string
  workspaceId: string | null
  sessionId: string
  deletedAt: string
}

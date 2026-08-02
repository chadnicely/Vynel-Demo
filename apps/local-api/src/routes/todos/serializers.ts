// Response serializer for `todos` HTTP routes. Date columns emit as ISO
// strings. No secret field to strip — the whole row is owner-visible. Single
// source of truth for the response shape is
// `@vynel/contracts/tasks/session-todo-http` (the tasks precedent).

import type { SessionTodo } from '@vynel/tasks'
import type { SessionTodoResponse } from '@vynel/contracts/tasks/session-todo-http'

export function serializeSessionTodoForResponse(todo: SessionTodo): SessionTodoResponse {
  return {
    id: todo.id,
    userId: todo.userId,
    workspaceId: todo.workspaceId,
    sessionId: todo.sessionId,
    title: todo.title,
    status: todo.status,
    orderIndex: todo.orderIndex,
    completedAt: todo.completedAt ? todo.completedAt.toISOString() : null,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  }
}

// Response serializer for `tasks` HTTP routes. Date columns emit as ISO
// strings. No secret field to strip — the whole row is owner-visible. Single
// source of truth for the response shape is
// `@vynel/contracts/tasks/task-http` (the schedules precedent).

import type { Task } from '@vynel/tasks'
import type { TaskResponse } from '@vynel/contracts/tasks/task-http'

export function serializeTaskForResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    userId: task.userId,
    workspaceId: task.workspaceId,
    title: task.title,
    detail: task.detail,
    status: task.status,
    source: task.source,
    sessionId: task.sessionId,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

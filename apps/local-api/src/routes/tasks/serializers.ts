// Response serializer for `tasks` HTTP routes. Date columns emit as ISO
// strings. No secret field to strip — the whole row is owner-visible. Single
// source of truth for the response shape is
// `@vynel/contracts/tasks/task-http` (the schedules precedent).

import type { Task, TaskStep, TaskStepCounts } from '@vynel/tasks'
import type { TaskResponse } from '@vynel/contracts/tasks/task-http'
import type { TaskStepResponse } from '@vynel/contracts/tasks/task-step-http'

// `stepCounts` rides LIST responses only (the panel's `n/m` without
// expanding); single-task responses omit it — the list query is the truth.
export function serializeTaskForResponse(task: Task, stepCounts?: TaskStepCounts): TaskResponse {
  return {
    id: task.id,
    userId: task.userId,
    workspaceId: task.workspaceId,
    title: task.title,
    detail: task.detail,
    status: task.status,
    source: task.source,
    sessionId: task.sessionId,
    planId: task.planId,
    assignedSessionId: task.assignedSessionId,
    ...(stepCounts !== undefined
      ? { stepsTotal: stepCounts.total, stepsDone: stepCounts.done }
      : {}),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

// Attach each task's rollup from ONE grouped read — tasks with no steps get
// an explicit 0/0 so the panel needn't special-case absence on list rows.
export function serializeTasksWithStepCounts(
  tasks: Task[],
  counts: TaskStepCounts[],
): TaskResponse[] {
  const countsByTaskId = new Map(counts.map((row) => [row.taskId, row]))
  return tasks.map((task) =>
    serializeTaskForResponse(
      task,
      countsByTaskId.get(task.id) ?? { taskId: task.id, total: 0, done: 0 },
    ),
  )
}

export function serializeTaskStepForResponse(step: TaskStep): TaskStepResponse {
  return {
    id: step.id,
    userId: step.userId,
    workspaceId: step.workspaceId,
    taskId: step.taskId,
    planId: step.planId,
    sessionId: step.sessionId,
    title: step.title,
    status: step.status,
    orderIndex: step.orderIndex,
    completedAt: step.completedAt ? step.completedAt.toISOString() : null,
    createdAt: step.createdAt.toISOString(),
    updatedAt: step.updatedAt.toISOString(),
  }
}

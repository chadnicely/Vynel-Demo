// Core op — remove a task (owner-scoped). Hard delete: a task row is not
// irrecoverable user content (docs/module-notes/tasks.md). Delete +
// `task.deleted` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as tasksRepository from '../repositories/index.js'
import { TASK_DELETED, type TaskDeletedPayload } from '../tasks-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../tasks-types.js'

export function deleteTask(
  db: Database,
  input: { taskId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const task = tasksRepository.findTaskById(db, input.taskId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!task || task.userId !== input.userId) {
    throw new NotFoundError('task', input.taskId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    tasksRepository.hardDeleteTask(tx, task.id)
    const payload: TaskDeletedPayload = {
      taskId: task.id,
      userId: task.userId,
      workspaceId: task.workspaceId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TASK_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ taskId: task.id }, 'task deleted')
}

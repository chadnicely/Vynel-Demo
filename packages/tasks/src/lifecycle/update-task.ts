// Core op — patch a task (owner-scoped): title, detail, status. sync.
// Status is the one home for the completion rule: a transition TO 'done'
// stamps `completedAt` and emits `task.completed`; leaving 'done' clears it
// (reopening); every other patch emits `task.updated`. Patch + event
// co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as tasksRepository from '../repositories/index.js'
import { TASK_TITLE_MAX_LENGTH, TASK_DETAIL_MAX_LENGTH } from './create-task.js'
import {
  TASK_COMPLETED,
  TASK_UPDATED,
  type TaskCompletedPayload,
  type TaskUpdatedPayload,
} from '../tasks-events.js'
import type { Database } from '@vynel/db'
import type { NewTask, Task, TaskStatus } from '../repositories/index.js'
import type { StructuralLogger } from '../tasks-types.js'

export interface UpdateTaskInput {
  taskId: string
  userId: string
  title?: string
  detail?: string | null
  status?: TaskStatus
  planId?: string | null // null detaches the task from its plan
  // The session WORKING the task — server-stamped at the route from the
  // turn-session header on pickup, never model-supplied; null releases it.
  assignedSessionId?: string | null
}

export function updateTask(
  db: Database,
  input: UpdateTaskInput,
  deps: { logger?: StructuralLogger } = {},
): Task {
  const task = tasksRepository.findTaskById(db, input.taskId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!task || task.userId !== input.userId) {
    throw new NotFoundError('task', input.taskId)
  }

  const now = new Date()
  const patch: Partial<NewTask> = { updatedAt: now }

  if (input.title !== undefined) {
    const title = input.title.trim()
    if (title.length === 0) {
      throw new ValidationError('A task needs a title. Add a short description of the work.')
    }
    if (title.length > TASK_TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Task titles are capped at ${TASK_TITLE_MAX_LENGTH} characters. Put the rest in the detail.`,
      )
    }
    patch.title = title
  }
  if (input.detail !== undefined) {
    const detail = input.detail?.trim() || null
    if (detail && detail.length > TASK_DETAIL_MAX_LENGTH) {
      throw new ValidationError(`Task detail is capped at ${TASK_DETAIL_MAX_LENGTH} characters.`)
    }
    patch.detail = detail
  }

  if (input.planId !== undefined) patch.planId = input.planId
  if (input.assignedSessionId !== undefined) patch.assignedSessionId = input.assignedSessionId

  const isCompleting = input.status === 'done' && task.status !== 'done'
  if (input.status !== undefined) {
    patch.status = input.status
    if (isCompleting) patch.completedAt = now
    if (input.status !== 'done' && task.status === 'done') patch.completedAt = null
  }

  const updated = withTransaction(db, (tx) => {
    const row = tasksRepository.updateTask(tx, input.taskId, patch)
    if (isCompleting) {
      const payload: TaskCompletedPayload = {
        taskId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        completedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: TASK_COMPLETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    } else {
      const payload: TaskUpdatedPayload = {
        taskId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        status: row.status,
        updatedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: TASK_UPDATED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    }
    return row
  })

  deps.logger?.info({ taskId: updated.id, status: updated.status }, 'task updated')
  return updated
}

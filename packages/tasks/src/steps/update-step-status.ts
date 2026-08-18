// Core op — move ONE step (owner-scoped): the user ticking a box on the task
// panel. Status is the only mutable field; the title belongs to the
// assistant's list. A transition TO 'done' stamps `completedAt`, leaving
// 'done' clears it. Patch + `task-step.updated` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as taskStepsRepository from '../repositories/task-steps.js'
import { TASK_STEP_UPDATED, type TaskStepUpdatedPayload } from '../task-steps-events.js'
import type { Database } from '@vynel/db'
import type { NewTaskStep, TaskStep, TaskStepStatus } from '../repositories/task-steps.js'
import type { StructuralLogger } from '../tasks-types.js'

export interface UpdateStepStatusInput {
  stepId: string
  userId: string
  status: TaskStepStatus
}

export function updateStepStatus(
  db: Database,
  input: UpdateStepStatusInput,
  deps: { logger?: StructuralLogger } = {},
): TaskStep {
  const step = taskStepsRepository.findTaskStepById(db, input.stepId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!step || step.userId !== input.userId) {
    throw new NotFoundError('step', input.stepId)
  }

  const now = new Date()
  const patch: Partial<NewTaskStep> = { status: input.status, updatedAt: now }
  if (input.status === 'done' && step.status !== 'done') patch.completedAt = now
  if (input.status !== 'done' && step.status === 'done') patch.completedAt = null

  const updated = withTransaction(db, (tx) => {
    const row = taskStepsRepository.updateTaskStep(tx, input.stepId, patch)
    const payload: TaskStepUpdatedPayload = {
      stepId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      taskId: row.taskId,
      status: row.status,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TASK_STEP_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  deps.logger?.info({ stepId: updated.id, status: updated.status }, 'task step updated')
  return updated
}

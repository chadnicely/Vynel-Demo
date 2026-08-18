// Core op — drop ONE step off a task's list (owner-scoped). Hard delete, like
// tasks: a step is not irrecoverable user content. Delete +
// `task-step.deleted` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as taskStepsRepository from '../repositories/task-steps.js'
import { TASK_STEP_DELETED, type TaskStepDeletedPayload } from '../task-steps-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../tasks-types.js'

export function deleteStep(
  db: Database,
  input: { stepId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const step = taskStepsRepository.findTaskStepById(db, input.stepId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!step || step.userId !== input.userId) {
    throw new NotFoundError('step', input.stepId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    taskStepsRepository.hardDeleteTaskStep(tx, step.id)
    const payload: TaskStepDeletedPayload = {
      stepId: step.id,
      userId: step.userId,
      workspaceId: step.workspaceId,
      taskId: step.taskId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TASK_STEP_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ stepId: step.id }, 'task step deleted')
}

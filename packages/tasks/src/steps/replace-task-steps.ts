// Core op — the assistant lays out (or revises) one task's execution steps.
// WHOLE-LIST REPLACE, the session-todos semantics keyed by task: the caller
// sends the task's complete current list, the old rows go, the new ones land
// in array order. Delete + inserts + `task-steps.replaced` co-commit in ONE
// transaction.
//
// The row's linkage is derived, not trusted: the task is resolved
// owner-scoped and `workspaceId` is COPIED from it (never caller-supplied);
// `sessionId` comes from the route's ambient turn-session header; `planId` is
// the one caller-declared link (the plan the steps derive from — the tasks
// leaf cannot read the sibling `plans` leaf to derive it).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as tasksRepository from '../repositories/tasks.js'
import * as taskStepsRepository from '../repositories/task-steps.js'
import { TASK_STEPS_REPLACED, type TaskStepsReplacedPayload } from '../task-steps-events.js'
import type { Database } from '@vynel/db'
import type { TaskStep, TaskStepStatus } from '../repositories/task-steps.js'
import type { StructuralLogger } from '../tasks-types.js'

export const STEP_TITLE_MAX_LENGTH = 200
// A step list is a handful of items by nature; the cap is a defensive wall
// against a runaway generation, not a product limit.
export const MAX_STEPS_PER_TASK = 50

export interface ReplaceTaskStepsInput {
  userId: string
  taskId: string
  planId?: string | null // the plan the steps derive from; null/absent = none
  sessionId?: string | null // the writing session — server-stamped at the route
  steps: readonly { title: string; status: TaskStepStatus }[]
}

export function replaceTaskSteps(
  db: Database,
  input: ReplaceTaskStepsInput,
  deps: { logger?: StructuralLogger } = {},
): TaskStep[] {
  const task = tasksRepository.findTaskById(db, input.taskId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!task || task.userId !== input.userId) {
    throw new NotFoundError('task', input.taskId)
  }

  if (input.steps.length > MAX_STEPS_PER_TASK) {
    throw new ValidationError(
      `A task tracks at most ${MAX_STEPS_PER_TASK} steps. Send a shorter list — ` +
        'collapse finished work into one line.',
    )
  }
  const cleaned = input.steps.map((step) => {
    const title = step.title.trim()
    if (title.length === 0) {
      throw new ValidationError('Every step needs a title. Drop the empty one and send again.')
    }
    // The cap is the actionable part — the title itself is user work content
    // and never echoed into an error (the createTask precedent: errors are logged).
    if (title.length > STEP_TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Step titles are capped at ${STEP_TITLE_MAX_LENGTH} characters. Shorten the long one and send the list again.`,
      )
    }
    return { title, status: step.status }
  })

  const now = new Date()
  const rows = withTransaction(db, (tx) => {
    // THE WORKING SESSION IS WHOEVER WRITES THE STEPS: the pickup stamp on
    // update_task only fires on the in-progress TRANSITION, so a session
    // taking over an already-running task never re-stamped and the panel
    // credited the wrong session (Adam's own 2026-08-18 smoke finding). The
    // steps write is the ground truth of "who is working this" — re-stamp
    // in the same transaction; the steps event's sessionId carries the fact.
    if (input.sessionId != null && task.assignedSessionId !== input.sessionId) {
      tasksRepository.updateTask(tx, task.id, {
        assignedSessionId: input.sessionId,
        updatedAt: now,
      })
    }
    taskStepsRepository.hardDeleteTaskStepsForTask(tx, {
      userId: input.userId,
      taskId: task.id,
    })
    const inserted = cleaned.map((step, orderIndex) =>
      taskStepsRepository.insertTaskStep(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        planId: input.planId ?? null,
        sessionId: input.sessionId ?? null,
        title: step.title,
        status: step.status,
        orderIndex,
        completedAt: step.status === 'done' ? now : null,
        createdAt: now,
        updatedAt: now,
      }),
    )
    const payload: TaskStepsReplacedPayload = {
      userId: input.userId,
      workspaceId: task.workspaceId,
      taskId: task.id,
      planId: input.planId ?? null,
      sessionId: input.sessionId ?? null,
      stepCount: inserted.length,
      replacedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TASK_STEPS_REPLACED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  // Titles are user work content — counted at info, never quoted.
  deps.logger?.info({ taskId: task.id, stepCount: rows.length }, 'task steps replaced')
  return rows
}

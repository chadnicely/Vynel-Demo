// Core op — put a task on the list (assistant via its MCP tools, or the user
// via UI/CLI). sync. Insert + `task.created` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as tasksRepository from '../repositories/index.js'
import { TASK_CREATED, type TaskCreatedPayload } from '../tasks-events.js'
import type { Database } from '@vynel/db'
import type { Task, TaskSource } from '../repositories/index.js'
import type { StructuralLogger } from '../tasks-types.js'

export const TASK_TITLE_MAX_LENGTH = 200
export const TASK_DETAIL_MAX_LENGTH = 4000

export interface CreateTaskInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  title: string
  detail?: string
  source: TaskSource
  sessionId?: string // the chat session whose turn created the task
}

export function createTask(
  db: Database,
  input: CreateTaskInput,
  deps: { logger?: StructuralLogger } = {},
): Task {
  const title = input.title.trim()
  if (title.length === 0) {
    throw new ValidationError('A task needs a title. Add a short description of the work.')
  }
  if (title.length > TASK_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `Task titles are capped at ${TASK_TITLE_MAX_LENGTH} characters. Put the rest in the detail.`,
    )
  }
  const detail = input.detail?.trim() || null
  if (detail && detail.length > TASK_DETAIL_MAX_LENGTH) {
    throw new ValidationError(`Task detail is capped at ${TASK_DETAIL_MAX_LENGTH} characters.`)
  }

  const now = new Date()
  const task = withTransaction(db, (tx) => {
    const inserted = tasksRepository.insertTask(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      title,
      detail,
      status: 'open',
      source: input.source,
      sessionId: input.sessionId ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: TaskCreatedPayload = {
      taskId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      source: inserted.source,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TASK_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ taskId: task.id, source: task.source }, 'task created')
  return task
}

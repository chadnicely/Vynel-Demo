// Core op — move ONE step (owner-scoped): the user ticking a box in the dock.
// Status is the only mutable field; the title belongs to the session's list.
// A transition TO 'done' stamps `completedAt`, leaving 'done' clears it.
// Patch + `session-todo.updated` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as sessionTodosRepository from '../repositories/session-todos.js'
import {
  SESSION_TODO_UPDATED,
  type SessionTodoUpdatedPayload,
} from '../session-todos-events.js'
import type { Database } from '@vynel/db'
import type {
  NewSessionTodo,
  SessionTodo,
  SessionTodoStatus,
} from '../repositories/session-todos.js'
import type { StructuralLogger } from '../tasks-types.js'

export interface UpdateTodoStatusInput {
  todoId: string
  userId: string
  status: SessionTodoStatus
}

export function updateTodoStatus(
  db: Database,
  input: UpdateTodoStatusInput,
  deps: { logger?: StructuralLogger } = {},
): SessionTodo {
  const todo = sessionTodosRepository.findSessionTodoById(db, input.todoId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!todo || todo.userId !== input.userId) {
    throw new NotFoundError('todo', input.todoId)
  }

  const now = new Date()
  const patch: Partial<NewSessionTodo> = { status: input.status, updatedAt: now }
  if (input.status === 'done' && todo.status !== 'done') patch.completedAt = now
  if (input.status !== 'done' && todo.status === 'done') patch.completedAt = null

  const updated = withTransaction(db, (tx) => {
    const row = sessionTodosRepository.updateSessionTodo(tx, input.todoId, patch)
    const payload: SessionTodoUpdatedPayload = {
      todoId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId,
      status: row.status,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SESSION_TODO_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  deps.logger?.info({ todoId: updated.id, status: updated.status }, 'session todo updated')
  return updated
}

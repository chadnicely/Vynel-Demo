// Core op — drop ONE step off the dock (owner-scoped). Hard delete, like
// tasks: a step is not irrecoverable user content. Delete +
// `session-todo.deleted` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as sessionTodosRepository from '../repositories/session-todos.js'
import {
  SESSION_TODO_DELETED,
  type SessionTodoDeletedPayload,
} from '../session-todos-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../tasks-types.js'

export function deleteTodo(
  db: Database,
  input: { todoId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const todo = sessionTodosRepository.findSessionTodoById(db, input.todoId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!todo || todo.userId !== input.userId) {
    throw new NotFoundError('todo', input.todoId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    sessionTodosRepository.hardDeleteSessionTodo(tx, todo.id)
    const payload: SessionTodoDeletedPayload = {
      todoId: todo.id,
      userId: todo.userId,
      workspaceId: todo.workspaceId,
      sessionId: todo.sessionId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SESSION_TODO_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ todoId: todo.id }, 'session todo deleted')
}

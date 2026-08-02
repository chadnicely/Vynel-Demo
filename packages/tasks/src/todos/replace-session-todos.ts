// Core op — the session revises its working steps. WHOLE-LIST REPLACE (Claude
// Code's TodoWrite semantics): the caller sends its complete current list, the
// old rows go, the new ones land in array order. Delete + inserts +
// `session-todos.replaced` co-commit in ONE transaction.
//
// WHY replace rather than diff-and-preserve-ids: the only race that matters —
// the user ticks a box, then the session sends its own view of that step —
// resolves the same way under either strategy (the session's payload wins), so
// id preservation buys nothing but a diffing branch (module notes, decision 1).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as sessionTodosRepository from '../repositories/session-todos.js'
import {
  SESSION_TODOS_REPLACED,
  type SessionTodosReplacedPayload,
} from '../session-todos-events.js'
import type { Database } from '@vynel/db'
import type { SessionTodo, SessionTodoStatus } from '../repositories/session-todos.js'
import type { StructuralLogger } from '../tasks-types.js'

export const TODO_TITLE_MAX_LENGTH = 200
// A step list is a handful of items by nature; the cap is a defensive wall
// against a runaway generation, not a product limit.
export const MAX_TODOS_PER_SESSION = 50

export interface ReplaceSessionTodosInput {
  userId: string
  workspaceId: string | null // the session's own scope; null = no workspace
  sessionId: string
  todos: readonly { title: string; status: SessionTodoStatus }[]
}

export function replaceSessionTodos(
  db: Database,
  input: ReplaceSessionTodosInput,
  deps: { logger?: StructuralLogger } = {},
): SessionTodo[] {
  if (input.todos.length > MAX_TODOS_PER_SESSION) {
    throw new ValidationError(
      `A session tracks at most ${MAX_TODOS_PER_SESSION} steps. Send a shorter list — ` +
        'collapse finished work into one line.',
    )
  }
  const cleaned = input.todos.map((todo) => {
    const title = todo.title.trim()
    if (title.length === 0) {
      throw new ValidationError('Every step needs a title. Drop the empty one and send again.')
    }
    // The cap is the actionable part — the title itself is user work content
    // and never echoed into an error (the createTask precedent: errors are logged).
    if (title.length > TODO_TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Step titles are capped at ${TODO_TITLE_MAX_LENGTH} characters. Shorten the long one and send the list again.`,
      )
    }
    return { title, status: todo.status }
  })

  const now = new Date()
  const rows = withTransaction(db, (tx) => {
    sessionTodosRepository.hardDeleteSessionTodosForSession(tx, {
      userId: input.userId,
      sessionId: input.sessionId,
    })
    const inserted = cleaned.map((todo, orderIndex) =>
      sessionTodosRepository.insertSessionTodo(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        title: todo.title,
        status: todo.status,
        orderIndex,
        completedAt: todo.status === 'done' ? now : null,
        createdAt: now,
        updatedAt: now,
      }),
    )
    const payload: SessionTodosReplacedPayload = {
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      todoCount: inserted.length,
      replacedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SESSION_TODOS_REPLACED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  // Titles are user work content — counted at info, never quoted.
  deps.logger?.info(
    { sessionId: input.sessionId, todoCount: rows.length },
    'session todos replaced',
  )
  return rows
}

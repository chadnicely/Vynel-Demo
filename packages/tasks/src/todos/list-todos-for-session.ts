// Read op — one session's working steps in list order. Backs the dock and the
// retired `set_todos` door's response (the write IS the read: the session sees exactly
// what the user's dock now shows).

import * as sessionTodosRepository from '../repositories/session-todos.js'
import type { Database } from '@vynel/db'
import type { SessionTodo } from '../repositories/session-todos.js'

export function listTodosForSession(
  db: Database,
  input: { userId: string; sessionId: string },
): SessionTodo[] {
  return sessionTodosRepository.listSessionTodos(db, input)
}

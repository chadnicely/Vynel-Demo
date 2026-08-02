// Functional repository for the `session_todos` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside here.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  sessionTodos,
  type SessionTodo,
  type NewSessionTodo,
} from '../schema/session-todos.js'

export type {
  SessionTodo,
  NewSessionTodo,
  SessionTodoStatus,
} from '../schema/session-todos.js'

export function listSessionTodos(
  db: Database,
  input: { userId: string; sessionId: string },
): SessionTodo[] {
  return db
    .select()
    .from(sessionTodos)
    .where(
      and(eq(sessionTodos.userId, input.userId), eq(sessionTodos.sessionId, input.sessionId)),
    )
    .orderBy(asc(sessionTodos.orderIndex))
    .all()
}

export function findSessionTodoById(db: Database, id: string): SessionTodo | null {
  const [row] = db.select().from(sessionTodos).where(eq(sessionTodos.id, id)).limit(1).all()
  return row ?? null
}

export function insertSessionTodo(db: Database, row: NewSessionTodo): SessionTodo {
  const [inserted] = db.insert(sessionTodos).values(row).returning().all()
  if (!inserted) throw new Error('insertSessionTodo: no row returned')
  return inserted
}

export function updateSessionTodo(
  db: Database,
  id: string,
  patch: Partial<NewSessionTodo>,
): SessionTodo {
  const [updated] = db
    .update(sessionTodos)
    .set(patch)
    .where(eq(sessionTodos.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateSessionTodo: no row for ${id}`)
  return updated
}

export function hardDeleteSessionTodo(db: Database, id: string): void {
  db.delete(sessionTodos).where(eq(sessionTodos.id, id)).run()
}

/** Clear a session's whole list — the first half of the whole-list replace. */
export function hardDeleteSessionTodosForSession(
  db: Database,
  input: { userId: string; sessionId: string },
): void {
  db.delete(sessionTodos)
    .where(
      and(eq(sessionTodos.userId, input.userId), eq(sessionTodos.sessionId, input.sessionId)),
    )
    .run()
}
